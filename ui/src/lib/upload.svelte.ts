// Home watches the handoff; the modules alone read and ingest the files.
import type { ModuleTab } from './links';
import type { WebSet } from './drop';
import { identity } from './identity.svelte';
import { MODULE_OF, opener, type OpenProgress } from './opener.svelte';
import { desktopFiles } from './platform';
import { parseAtlas, type MountOut, type RunOut, type SessionOut } from './overview.svelte';

export const POLL_MS = 5_000;
export const WATCH_MS = 10 * 60_000;
const PACKAGE_WAIT_MS = 10_000;
export interface UploadStep { text: string; done: boolean }
const size = (files: number, bytes: number) => `${files} files, ${(bytes / (1024 * 1024)).toFixed(2)} MB`;
const context = () => `${identity.target?.server ?? ''}|${identity.target?.key ?? ''}|${identity.revision}`;
let sequence = 0;

export class Upload {
  open = $state(false);
  listed = $state<{ files: number; bytes: number } | null>(null);
  sent = $state(false);
  taken = $state<{ files: number; bytes: number } | null>(null);
  outcome = $state('');
  error = $state('');
  session = $state<SessionOut | null>(null);
  completeRun = $state<string | null>(null);
  mounts = $state<MountOut[]>([]);
  mountId = $state('');
  imageOpened = $state(false);
  private from = '';
  private id = '';
  private name = '';
  private names = new Set<string>();
  private stems = new Set<string>();
  private before = new Set<string>();
  private account = '';
  private generation = 0;
  private deadline = 0;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private packageTimer?: ReturnType<typeof setTimeout>;
  private packagePath = '';
  private unsubscribe: () => void;

  constructor(readonly target: ModuleTab) {
    this.unsubscribe = opener.observe(event => this.progress(event));
  }

  get ready() { return this.target === 'sessions' ? !!this.completeRun : this.imageOpened && !!this.mountId; }
  get steps(): UploadStep[] {
    if (!this.open) return [];
    return [
      { text: this.listed ? `Files listed (${size(this.listed.files, this.listed.bytes)})` : 'Listing files…', done: !!this.listed },
      { text: `Sent to ${this.target === 'sessions' ? 'Sessions' : 'Images'}`, done: this.sent },
      { text: `Taken by ${MODULE_OF[this.target]}${this.taken ? ` (${size(this.taken.files, this.taken.bytes)})` : ''}`, done: !!this.taken },
      { text: this.outcome || (this.target === 'sessions' ? 'Waiting for ingest in Sessions' : 'Waiting for Images'), done: this.target === 'sessions' ? !!this.session : this.imageOpened },
      { text: 'Ready to review', done: this.ready },
    ];
  }

  close() {
    this.generation++;
    clearTimeout(this.pollTimer);
    clearTimeout(this.packageTimer);
    this.packagePath = '';
    this.open = false;
  }
  dispose() { this.close(); this.unsubscribe(); }
  syncIdentity() { if (this.open && context() !== this.account) this.close(); }
  private valid(gen = this.generation) { return this.open && gen === this.generation && context() === this.account; }
  private fail(reason: unknown) { this.error = reason instanceof Error ? reason.message : String(reason); }

  private async begin(stems: string[]) {
    this.close();
    this.open = true;
    this.account = context();
    this.from = `upload:${this.target}:${++sequence}`;
    this.listed = null; this.sent = false; this.taken = null; this.outcome = ''; this.error = '';
    this.session = null; this.completeRun = null; this.mounts = []; this.mountId = ''; this.imageOpened = false;
    this.deadline = 0;
    this.id = ''; this.name = ''; this.names.clear(); this.before.clear();
    this.stems = new Set(stems.map(s => s.replace(/[\\/]+$/, '').split(/[\\/]/).pop()!.replace(/\.(csv|zip)$/i, '')));
    const gen = this.generation;
    if (this.target === 'sessions') {
      try {
        // Ingest.svelte / IngestDialog.svelte only call ondone locally: no
        // bridge notify on success. Snapshot before offering, then poll after take.
        const sessions = await this.list<SessionOut>('/v1/sessions');
        if (this.valid(gen)) this.before = new Set(sessions.map(s => s.id));
      } catch (err) { if (this.valid(gen)) this.fail(err); return false; }
    }
    return this.valid(gen);
  }

  async openPaths(paths: string[]) {
    if (!await this.begin(paths)) return;
    const gen = this.generation;
    if (this.target === 'images' && paths.length === 1 && /\.grainatlas[\\/]*$/i.test(paths[0])) {
      try {
        const pkg = await desktopFiles.projectPackage(paths[0]);
        if (!this.valid(gen)) return;
        if (pkg?.exists) this.packagePath = pkg.path;
      } catch (err) { if (this.valid(gen)) this.fail(err); return; }
    }
    if (!this.valid(gen)) return;
    const routed = await opener.openPaths(paths, this.from, this.target);
    if (this.valid(gen) && routed.target && routed.kind === 'project' && this.packagePath) {
      this.packageTimer = setTimeout(() => void this.offerPackage(gen), PACKAGE_WAIT_MS);
    }
  }

  async openWebFiles(set: WebSet) {
    if (await this.begin(set.roots.map(r => r.name))) opener.openWebFiles(set, this.from, this.target);
  }

  private async offerPackage(gen: number) {
    if (!this.valid(gen) || !this.packagePath || this.imageOpened) return;
    clearTimeout(this.packageTimer);
    const path = this.packagePath;
    this.packagePath = '';
    await opener.openPaths([path], this.from, 'images');
  }

  private progress(event: OpenProgress) {
    if (!this.valid()) return;
    if ('from' in event && event.from !== this.from) return;
    if (event.type === 'listed') {
      this.listed = { files: event.routed.picks.length, bytes: event.routed.bytes };
      this.name = event.routed.name;
      this.names.add(this.name);
      this.stems.add(this.name);
      this.sent = false; this.taken = null;
    } else if (event.type === 'offered') {
      this.id = event.id; this.sent = true;
    } else if (event.type === 'error') {
      this.fail(event.reason);
    } else if (event.type === 'taken') {
      if (event.id !== this.id || event.module !== MODULE_OF[this.target]) return;
      this.taken = { files: event.files, bytes: event.bytes };
      if (this.target === 'sessions' && !this.deadline) {
        this.deadline = Date.now() + WATCH_MS;
        this.schedule(this.generation);
      }
    } else if (event.type === 'outcome') {
      if (this.target !== 'images' || event.module !== 'grainatlas' || !this.names.has(String(event.event.name))) return;
      this.outcome = String(event.event.outcome ?? '');
      if (/^(failed|refused):/.test(this.outcome)) { this.fail(this.outcome); this.packagePath = ''; clearTimeout(this.packageTimer); }
      else if (this.outcome.startsWith('waiting:')) void this.offerPackage(this.generation);
      else if (this.outcome.startsWith('opened:')) {
        this.imageOpened = true;
        clearTimeout(this.packageTimer);
        const project = event.event.project ?? event.event.project_id ?? event.event.projectId;
        void this.loadMounts(typeof project === 'string' ? project : null, this.generation);
      }
    }
  }

  private async list<T>(path: string): Promise<T[]> {
    const r = await identity.get<T[]>(path);
    if (r.status !== 200 || !Array.isArray(r.body)) {
      const detail = (r.body as unknown as { detail?: string })?.detail;
      throw new Error(`${path}: ${detail ?? `HTTP ${r.status}`}`);
    }
    return r.body;
  }

  private schedule(gen: number) {
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.poll(gen), POLL_MS);
  }
  private async poll(gen: number) {
    if (!this.valid(gen)) return;
    try {
      if (!this.session) {
        const sessions = await this.list<SessionOut>('/v1/sessions');
        if (!this.valid(gen)) return;
        this.session = sessions.find(s => !this.before.has(s.id) || this.stems.has(s.session_key)) ?? null;
        if (this.session) this.outcome = `Session ${this.session.session_key} ingested, ${this.session.acquisition_count} acquisitions`;
      }
      await this.refreshReview();
    } catch (err) { if (this.valid(gen)) this.fail(err); }
    if (!this.valid(gen) || this.completeRun) return;
    if (Date.now() >= this.deadline) {
      if (!this.session) this.fail('No session detected after 10 minutes. Check the ingest dialog in Sessions.');
      return;
    }
    this.schedule(gen);
  }

  async refreshReview() {
    if (!this.valid() || !this.session || this.completeRun) return;
    const gen = this.generation;
    try {
      const runs = await this.list<RunOut>(`/v1/sessions/${encodeURIComponent(this.session.id)}/reductions`);
      if (this.valid(gen)) this.completeRun = runs.find(r => r.status === 'completed' || r.status === 'complete')?.id ?? null;
    } catch (err) { if (this.valid(gen)) this.fail(err); }
  }

  private async loadMounts(project: string | null, gen: number) {
    try {
      const mounts = await this.list<MountOut>('/v1/mounts');
      if (!this.valid(gen)) return;
      this.mounts = mounts;
      if (!project) return; // Current grainatlas notify has no project id: let the user choose.
      const matches = await Promise.all(mounts.map(async m => {
        const r = await identity.get(`/v1/mounts/${encodeURIComponent(m.id)}/atlas`);
        return r.status === 200 && parseAtlas(r.body)?.projectId === project ? m.id : null;
      }));
      if (this.valid(gen)) this.mountId = matches.find((id): id is string => id !== null) ?? '';
    } catch (err) { if (this.valid(gen)) this.fail(err); }
  }
}

export const upload = { sessions: new Upload('sessions'), images: new Upload('images') };

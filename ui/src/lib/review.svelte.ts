import type { SpotSelectedEvent, BridgeCommand } from '@lab/bridge';
import { identity } from './identity.svelte';
import { shell } from './shell.svelte';
import { settings } from './settings.svelte';
import { sendCommand } from './incoming';
import { resolve } from './links';
import type { SessionOut, MountOut, RunOut } from './overview.svelte';
import { assignSampleColors } from '../components/review/plot-data';
import { normalise, parseScope, type ReviewScope, type ReviewSpot, type ResultTable, type ResultRow, type RunBrief, type DepthProfile } from './review-data';
const enc = encodeURIComponent;
type ScopeInput = {
  kind: 'session';
  id: string;
  run?: string;
} | {
  kind: 'mount';
  id: string;
};
export class Review {
  scope = $state<ReviewScope | null>(null);
  state = $state<'idle' | 'signed-out' | 'loading' | 'ready' | 'error'>('idle');
  error = $state('');
  sessions = $state<SessionOut[]>([]);
  mounts = $state<MountOut[]>([]);
  rows = $state<ReviewSpot[]>([]);
  runs = $state<RunOut[]>([]);
  run = $state<RunBrief | null>(null);
  runInfo = $state<Record<string, RunBrief>>({});
  selectedKey = $state<string | null>(null);
  hoveredKey = $state<string | null>(null);
  externalSpot = $state<ReviewSpot | null>(null);
  depth = $state<DepthProfile | null>(null);
  depthState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  depthError = $state('');
  scrollVersion = $state(0);
  private generation = 0;
  private depthGeneration = 0;
  private selectionGeneration = 0;
  get selected(): ReviewSpot | null { return this.rows.find(r => r.key === this.selectedKey) ?? this.externalSpot; }
  private async get<T>(path: string): Promise<T> {
    const r = await identity.get<T>(path);
    if (r.status !== 200) {
      const d = (r.body as {
        detail?: string;
      } | null)?.detail;
      throw new Error(r.status === 401 ? 'Sign in again to read results.' : `${path}: ${d ?? `HTTP ${r.status}`}`);
    }
    return r.body;
  }
  async open(scope: ScopeInput) {
    this.selectionGeneration++;
    this.scope = scope.kind === 'session' ? { ...scope, run: scope.run ?? 'preferred' } : scope;
    if (settings.loaded)
      void settings.update({ reviewScope: JSON.stringify(this.scope) });
    await this.load();
  }
  private async referenceNames(rows: ReviewSpot[]) {
    const sessions = new Set(rows.flatMap(row => row.isReference && row.sessionId && !row.values.reference_material_name
      ? [row.sessionId] : []));
    const names = new Map<string, string>();
    await Promise.all([...sessions].map(async id => {
      try {
        const acquisitions = await this.get<{ id: string; reference_material_name?: string }[]>(`/v1/sessions/${enc(id)}/acquisitions`);
        for (const acq of acquisitions) {
          if (acq.reference_material_name) names.set(acq.id, acq.reference_material_name);
        }
      } catch { /* Older or unavailable metadata leaves the result table's names usable. */ }
    }));
    return rows.map(row => {
      const sampleName = row.isReference && row.acquisitionId ? names.get(row.acquisitionId) : undefined;
      return sampleName ? { ...row, sampleName } : row;
    });
  }
  async load() {
    const gen = ++this.generation;
    this.depthGeneration++;
    this.depth = null;
    this.depthState = 'idle';
    this.rows = [];
    this.hoveredKey = null;
    this.runs = [];
    this.run = null;
    this.runInfo = {};
    this.externalSpot = null;
    this.error = '';
    if (!identity.target || !identity.signedIn) {
      this.state = identity.target ? 'signed-out' : 'idle';
      this.sessions = [];
      this.mounts = [];
      this.selectedKey = null;
      return;
    }
    this.state = 'loading';
    try {
      const [sessions, mounts] = await Promise.all([this.get<SessionOut[]>('/v1/sessions'), this.get<MountOut[]>('/v1/mounts')]);
      if (gen !== this.generation)
        return;
      this.sessions = sessions;
      this.mounts = mounts;
      if (!this.scope)
        this.scope = parseScope(settings.reviewScope);
      const scope = this.scope;
      let rows: ReviewSpot[] = [], runs: RunOut[] = [], run: RunBrief | null = null;
      const info: Record<string, RunBrief> = {};
      if (scope?.kind === 'session') {
        const [table, list] = await Promise.all([this.get<ResultTable>(`/v1/sessions/${enc(scope.id)}/results?run=${enc(scope.run)}`), this.get<RunOut[]>(`/v1/sessions/${enc(scope.id)}/reductions`)]);
        rows = table.rows.map(r => normalise(r, table));
        runs = list;
        run = table.run ?? null;
        if (run)
          info[run.run_id] = run;
      }
      else if (scope?.kind === 'mount') {
        const mount = await this.get<{
          spots: ResultRow[];
        }>(`/v1/mounts/${enc(scope.id)}/results`);
        const ids = [...new Set(mount.spots.map(s => s.session_id).filter((v): v is string => typeof v === 'string'))];
        const atlasIds = new Set(mount.spots.map(s => s.atlas_spot_id));
        const tables = await Promise.all(ids.map(id => this.get<ResultTable>(`/v1/sessions/${enc(id)}/results?run=preferred`)));
        rows = tables.flatMap(t => {
          if (t.run)
            info[t.run.run_id] = t.run;
          return t.rows.filter(r => r.mount_id ? r.mount_id === scope.id : !!r.atlas_spot_id && atlasIds.has(r.atlas_spot_id)).map(r => normalise({ ...r, mount_id: r.mount_id ?? scope.id }, t));
        });
        const keys = new Set(rows.map(r => r.key));
        // Preserve mount spots absent from any results table (including unmeasured ones).
        for (const summary of mount.spots) {
          const spot = normalise({ ...summary, mount_id: scope.id });
          if (!keys.has(spot.key)) {
            rows.push(spot);
            keys.add(spot.key);
          }
        }
      }
      if (gen !== this.generation)
        return;
      rows = await this.referenceNames(rows);
      if (gen !== this.generation)
        return;
      assignSampleColors(rows.map(r => r.sampleName));
      this.rows = rows;
      this.runs = runs;
      this.run = run;
      this.runInfo = info;
      this.selectedKey = rows.some(r => r.key === this.selectedKey) ? this.selectedKey : rows.find(r => !r.isReference)?.key ?? rows[0]?.key ?? null;
      this.state = 'ready';
      void this.loadDepth();
    }
    catch (err) {
      if (gen !== this.generation)
        return;
      this.error = err instanceof Error ? err.message : String(err);
      this.state = /Sign in again/.test(this.error) ? 'signed-out' : 'error';
    }
  }
  async loadDepth() {
    const gen = ++this.depthGeneration, spot = this.selected;
    this.depth = null;
    this.depthError = '';
    if (!spot?.acquisitionId || !spot.runId) {
      this.depthState = 'idle';
      return;
    }
    this.depthState = 'loading';
    try {
      const depth = await this.get<DepthProfile>(`/v1/acquisitions/${enc(spot.acquisitionId)}/depth-profile?run=${enc(spot.runId)}`);
      if (gen !== this.depthGeneration)
        return;
      this.depth = depth;
      this.depthState = 'ready';
    }
    catch (err) {
      if (gen !== this.depthGeneration)
        return;
      this.depthError = String(err);
      this.depthState = 'error';
    }
  }
  select(spot: ReviewSpot, focus = true) {
    this.selectionGeneration++;
    this.selectedKey = spot.key;
    this.externalSpot = this.rows.some(r => r.key === spot.key) ? null : spot;
    this.scrollVersion++;
    void this.loadDepth();
    if (focus)
      void this.focus(spot);
  }
  private async command(spot: ReviewSpot, command: BridgeCommand) {
    try {
      if (await sendCommand('images', command))
        return;
      const route = resolve(`grainatlas://project/${spot.atlasProjectId}/spot/${spot.atlasSpotId}`);
      if (route.kind === 'tab')
        shell.load('images', route.route);
    }
    catch (err) {
      this.error = `Could not show the spot in Images: ${String(err)}`;
    }
  }
  async focus(spot: ReviewSpot, show = false) {
    if (!spot.atlasProjectId || !spot.atlasSpotId)
      return;
    await this.command(spot, { type: 'focus-spot', project: spot.atlasProjectId, spot: spot.atlasSpotId, flash: true, via: 'review', server: shell.serverUrl });
    const split = shell.view === 'review' && settings.reviewSplit;
    if (show && !split)
      shell.show('images');
  }
  async focusGrain(spots: ReviewSpot[]) {
    const spot = spots.find(s => s.atlasProjectId && s.atlasSpotId && s.grainLabel);
    if (!spot)
      return;
    await this.command(spot, { type: 'focus-grain', project: spot.atlasProjectId!, grain: spot.grainLabel!, spot: spot.atlasSpotId!, flash: true, via: 'review', server: shell.serverUrl });
  }
  /** Called when Review is visible. Hidden-tab events remain in selection.fromImages. */
  async fromImages(event: SpotSelectedEvent) {
    if (event.via === 'shell')
      return;
    const request = ++this.selectionGeneration;
    const scopeGen = this.generation;
    const matches = this.rows.filter(r => r.atlasSpotId === event.spot && (!r.atlasProjectId || r.atlasProjectId === event.project));
    const current = matches.find(r => r.runId === this.selected?.runId && r.sessionId === this.selected?.sessionId) ?? matches[0];
    if (current) {
      this.select(current, false);
      return;
    }
    try {
      const reply = await this.get<{
        spot: ResultRow;
        rows: ResultRow[];
        columns: string[];
      }>(`/v1/spots/by-atlas/${enc(event.spot)}/results`);
      if (request !== this.selectionGeneration || scopeGen !== this.generation)
        return;
      const raw = reply.rows[0];
      const mountId = String(reply.spot.mount_id ?? raw?.mount_id ?? '');
      let next: ScopeInput | null = null;
      // A mount view stays on the mount, reloading newly published spots if needed.
      if (this.scope?.kind === 'mount' && mountId)
        next = { kind: 'mount', id: mountId };
      else if (raw?.session_id)
        next = { kind: 'session', id: String(raw.session_id) };
      if (next) {
        await this.open(next);
        if (this.selectionGeneration !== request + 1)
          return;
      }
      const found = this.rows.find(r => r.atlasSpotId === event.spot && (!r.atlasProjectId || r.atlasProjectId === event.project));
      this.select(found ?? normalise({ ...reply.spot, ...raw, atlas_project_id: event.project, atlas_spot_id: event.spot, label: raw?.label ?? reply.spot.label ?? event.name }), false);
    }
    catch (err) {
      if (request === this.selectionGeneration && scopeGen === this.generation)
        this.error = `Could not read the Images selection: ${String(err)}`;
    }
  }
}
export const review = new Review();

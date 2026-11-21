import { mountFractions, tims, TimsReadError, type FractionOut, type BatchDetail } from './tims-api';
import { batchAffected } from './tims-overlay';
import { indexFractions, spotFractions } from './review-data';
import { listPath } from './api-list';
import { RegionResults } from './region-results';
import type { ViewerRegion } from './region-summary';
import type { ViewerRegionEvent, SpotSelectedEvent, BridgeCommand } from '@lab/bridge';
import { identity } from './identity.svelte';
import { logWarn } from './platform';
import { shell } from './shell.svelte';
import { settings } from './settings.svelte';
import { moduleSurfaces, sendCommand } from './incoming';
import type { SessionOut, MountOut, RunOut } from './overview.svelte';
import { assignSampleColors } from '../components/review/plot-data';
import { normalise, parseScope, type ReviewScope, type ReviewSpot, type ResultTable, type ResultRow, type RunBrief, type DepthProfile } from './review-data';
import { apiReplyMessage, ApiReadError } from './server-error';
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
  region = $state<ViewerRegion | null>(null);
  regionRows = $state.raw<ReviewSpot[]>([]);
  regionFractions = $state.raw<FractionOut[]>([]);
  regionLoading = $state(false);
  regionError = $state('');
  regionFractionNotice = $state('');
  regionBack = $state<ReviewSpot | null>(null);
  private regionGeneration = 0;
  private regionResults = new RegionResults();
  private fractionMounts = new Set<string>();
  closeRegion() { this.regionGeneration++; this.region = null; this.regionBack = null; this.regionLoading = false; }
  async showRegion(event: ViewerRegionEvent, source: ViewerRegion['source']) {
    this.selectionGeneration++;
    const mount = event.mount ?? this.rows.find(row => row.atlasProjectId === event.project)?.mountId
      ?? this.mounts.find(mount => mount.atlas?.project_id === event.project)?.id ?? null;
    this.regionBack = this.region ? this.regionBack : this.selected;
    this.region = { ...event, mount, source };
    const gen = ++this.regionGeneration, account = this.currentSource();
    const current = () => gen === this.regionGeneration && account === this.currentSource();
    this.regionError = ''; this.regionFractionNotice = ''; this.regionFractions = []; this.regionLoading = false;
    if (!mount) { this.regionRows = []; this.regionError = 'Mount not linked to UPbDB.'; return; }
    const inScope = this.scope?.kind === 'mount' && this.scope.id === mount;
    this.regionRows = inScope ? this.rows : this.regionResults.peek(account, mount);
    this.regionLoading = !inScope;
    const results = inScope ? Promise.resolve() : this.regionResults.load(account, mount, path => identity.get(path))
      .then(rows => { if (current()) this.regionRows = rows; })
      .catch(error => { if (current()) this.regionError = String(error); })
      .finally(() => { if (current()) this.regionLoading = false; });
    const fractions = this.fractionMounts.has(mount) ? Promise.resolve().then(() => {
      if (current()) { this.regionFractions = this.fractions; this.regionFractionNotice = this.fractionNotice; }
    }) : mountFractions(mount, 10_000, value => {
      if (current()) { this.regionFractions = value.items; this.regionFractionNotice = value.showing; }
    }).catch(error => {
      if (!current()) return;
      this.regionFractionNotice = error instanceof ApiReadError && [404, 405].includes(error.status)
        ? 'TIMS not available on this server' : `Could not read TIMS fractions: ${String(error)}`;
    });
    await Promise.all([results, fractions]);
  }
  scope = $state<ReviewScope | null>(null);
  state = $state<'idle' | 'signed-out' | 'loading' | 'ready' | 'error'>('idle');
  error = $state('');
  sessions = $state<SessionOut[]>([]);
  mounts = $state<MountOut[]>([]);
  sessionCursor = $state<string | null>(null);
  mountCursor = $state<string | null>(null);
  listsLoading = $state(false);
  rows = $state<ReviewSpot[]>([]);
  fractions = $state.raw<FractionOut[]>([]);
  fractionIndex = $derived(indexFractions(this.fractions));
  fractionError = $state('');
  fractionNotice = $state('');
  batches = $state.raw<Record<string, BatchDetail>>({});
  batchErrors = $state<Record<string, string>>({});
  private fractionGeneration = 0;
  private batchPending = new Map<string, Promise<void>>();
  private batchSource = '';
  private batchGeneration = 0;
  async outboxSaved(objectKey: string) {
    if (this.fractions.some(f => objectKey === `fraction:${f.id}`) ||
      Object.values(this.batches).some(b => objectKey === `capsule_set:${b.capsule_set_id}`)) {
      await this.loadFractions();
    } else if (Object.values(this.batches).some(b => batchAffected(b, objectKey))) {
      await this.loadSelectedBatches(true);
    }
  }
  async loadFractions() {
    const gen = ++this.fractionGeneration, source = this.currentSource();
    const current = () => gen === this.fractionGeneration && source === this.currentSource();
    const mounts = this.scope?.kind === 'mount' ? [this.scope.id] : [...new Set(this.rows.flatMap(row => row.mountId ? [row.mountId] : []))];
    this.fractionError = ''; this.fractionNotice = ''; this.fractionMounts.clear();
    const loaded = new Map<string, FractionOut[]>(), errors: string[] = [], notices = new Map<string, string>();
    const publish = () => {
      if (!current()) return;
      this.fractions = [...new Map([...loaded.values()].flat().map(f => [f.id, f])).values()];
      this.fractionNotice = [...notices.values()].filter(Boolean).join('; ');
    };
    await Promise.all(mounts.map(async mount => {
      try {
        await mountFractions(mount, 10_000, value => { loaded.set(mount, value.items); notices.set(mount, value.showing); publish(); });
      } catch (error) {
        // Older UPbDB servers do not provide TIMS endpoints.
        if (error instanceof ApiReadError && [404, 405].includes(error.status)) {
          loaded.delete(mount); notices.delete(mount); publish();
        } else errors.push(String(error));
      }
    }));
    if (current()) { this.fractionMounts = new Set(loaded.keys()); publish(); this.fractionError = errors.join('; '); await this.loadSelectedBatches(true); }
  }
  async loadSelectedBatches(revalidate = false) {
    const source = this.currentSource(), gen = this.batchGeneration;
    if (this.batchSource !== source) { this.batchSource = source; this.batches = {}; this.batchErrors = {}; this.batchPending.clear(); }
    const spot = this.selected;
    if (!spot) return;
    const batches = [...new Set(spotFractions(spot, this.fractionIndex).flatMap(m => m.fraction.batch_id ? [m.fraction.batch_id] : []))];
    await Promise.all(batches.map(batch => {
      if (this.batchPending.has(batch)) return this.batchPending.get(batch);
      if (!revalidate && this.batches[batch]) return;
      const pending = tims.batch(batch).then(detail => {
        if (source === this.currentSource() && gen === this.batchGeneration) { this.batches = { ...this.batches, [batch]: detail }; delete this.batchErrors[batch]; }
      }).catch(error => {
        if (source !== this.currentSource() || gen !== this.batchGeneration) return;
        if (error instanceof TimsReadError && [401, 403, 404].includes(error.status)) {
          this.batches = Object.fromEntries(Object.entries(this.batches).filter(([id]) => id !== batch));
        }
        this.batchErrors[batch] = String(error);
      })
        .finally(() => { if (this.batchPending.get(batch) === pending) this.batchPending.delete(batch); });
      this.batchPending.set(batch, pending); return pending;
    }));
  }

  runs = $state<RunOut[]>([]);
  run = $state<RunBrief | null>(null);
  runInfo = $state<Record<string, RunBrief>>({});
  // A details-panel selection may coexist with sample-group presentation (solo).
  groupView = $state(true);
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
  private source = '';
  private listsAt = -Infinity;
  private listsPending: Promise<void> | null = null;
  private listGeneration = 0;
  clear() {
    this.closeRegion(); this.regionResults.clear(); this.regionRows = []; this.regionFractions = []; this.fractionMounts.clear();
    this.batchGeneration++; this.batchPending.clear();
    this.fractionGeneration++; this.fractions = []; this.fractionError = ''; this.fractionNotice = ''; this.batches = {}; this.batchErrors = {};
    this.generation++; this.depthGeneration++; this.selectionGeneration++; this.listGeneration++;
    this.listsPending = null; this.listsAt = -Infinity;
    this.sessions = []; this.mounts = []; this.sessionCursor = null; this.mountCursor = null;
    this.rows = []; this.runs = []; this.run = null; this.runInfo = {}; this.selectedKey = null;
    this.externalSpot = null; this.depth = null; this.depthState = 'idle'; this.error = ''; this.state = 'idle';
  }
  private currentSource() { return `${identity.target?.server ?? ''}:${identity.revision}`; }
  private loadLists() {
    if (this.listsPending) return this.listsPending;
    if (Date.now() - this.listsAt < 60_000) return Promise.resolve();
    const source = this.source, gen = ++this.listGeneration;
    const pending = Promise.all([identity.get<SessionOut[]>(listPath('/v1/sessions')), identity.get<MountOut[]>(listPath('/v1/mounts'))])
      .then(([sessions, mounts]) => {
        if (gen !== this.listGeneration || source !== this.currentSource()) return;
        if (sessions.status !== 200 || !Array.isArray(sessions.body)) throw new Error(apiReplyMessage(sessions));
        if (mounts.status !== 200 || !Array.isArray(mounts.body)) throw new Error(apiReplyMessage(mounts));
        this.sessions = sessions.body; this.sessionCursor = sessions.nextCursor ?? null;
        this.mounts = mounts.body; this.mountCursor = mounts.nextCursor ?? null;
        this.listsAt = Date.now();
      }).finally(() => {
        if (gen === this.listGeneration) this.listsPending = null;
      });
    this.listsPending = pending;
    return pending;
  }
  async loadMoreLists() {
    if (this.listsLoading) return;
    this.listsLoading = true;
    const source = this.currentSource(), gen = this.listGeneration;
    try {
      await Promise.all((['sessions', 'mounts'] as const).map(async kind => {
        const cursor = kind === 'sessions' ? this.sessionCursor : this.mountCursor;
        if (!cursor) return;
        const reply = await identity.get<(SessionOut | MountOut)[]>(listPath(kind === 'sessions' ? '/v1/sessions' : '/v1/mounts', cursor));
        if (source !== this.currentSource() || gen !== this.listGeneration) return;
        if (reply.status !== 200 || !Array.isArray(reply.body)) throw new Error(apiReplyMessage(reply));
        const known = new Set((kind === 'sessions' ? this.sessions : this.mounts).map(row => row.id));
        const rows = reply.body.filter(row => !known.has(row.id));
        if (kind === 'sessions') { this.sessions = [...this.sessions, ...rows as SessionOut[]]; this.sessionCursor = reply.nextCursor ?? null; }
        else { this.mounts = [...this.mounts, ...rows as MountOut[]]; this.mountCursor = reply.nextCursor ?? null; }
      }));
    } catch (err) { if (source === this.currentSource()) this.error = String(err); }
    finally { this.listsLoading = false; }
  }
  private rowsByKey = $derived.by(() => {
    const index = new Map<string, ReviewSpot>();
    for (const row of this.rows) if (!index.has(row.key)) index.set(row.key, row);
    return index;
  });
  get selected(): ReviewSpot | null {
    const key = this.selectedKey;
    return (key === null ? undefined : this.rowsByKey.get(key)) ?? this.externalSpot;
  }
  private async get<T>(path: string): Promise<T> {
    const r = await identity.get<T>(path);
    if (r.status !== 200) {
      if (r.status !== 401) void logWarn(`[review] ${path}: ${r.status} ${JSON.stringify(r.body)?.slice(0, 300)}`);
      throw new Error(r.status === 401 ? 'Sign in again to read results.' : apiReplyMessage(r));
    }
    return r.body;
  }
  async open(scope: ScopeInput) {
    this.closeRegion();
    this.groupView = true;
    this.selectionGeneration++;
    this.scope = scope.kind === 'session' ? { ...scope, run: scope.run ?? 'preferred' } : scope;
    if (settings.loaded)
      void settings.update({ reviewScope: JSON.stringify(this.scope) });
    await this.load();
  }
  private async referenceNames(rows: ReviewSpot[], quiet = false) {
    const sessions = new Set((quiet ? [] : rows).flatMap(row => row.isReference && row.sessionId && !row.values.reference_material_name
      ? [row.sessionId] : []));
    // Reuse acquisition metadata on quiet refreshes, but let fresh stored names win.
    const names = new Map<string, string>(quiet ? this.rows.flatMap(row => row.isReference && row.acquisitionId
      && row.sampleName !== normalise(row.values).sampleName ? [[row.acquisitionId, row.sampleName] as const] : []) : []);
    await Promise.all([...sessions].map(async id => {
      try {
        const acquisitions = await this.get<{ id: string; reference_material_name?: string }[]>(`/v1/sessions/${enc(id)}/acquisitions`);
        for (const acq of acquisitions) {
          if (acq.reference_material_name) names.set(acq.id, acq.reference_material_name);
        }
      } catch { /* Older or unavailable metadata leaves the result table's names usable. */ }
    }));
    return rows.map(row => {
      const sampleName = row.isReference && row.acquisitionId && !row.values.reference_material_name ? names.get(row.acquisitionId) : undefined;
      return sampleName ? { ...row, sampleName } : row;
    });
  }
  async refresh() {
    await this.load({ quiet: true, strict: true });
  }
  async load({ quiet = false, strict = false } = {}) {
    const source = this.currentSource();
    if (source !== this.source || !identity.target || !identity.signedIn) {
      this.closeRegion(); this.regionResults.clear(); this.fractionMounts.clear();
      this.source = source;
      this.batches = {}; this.batchErrors = {}; this.batchPending.clear(); this.batchSource = source;
      this.listGeneration++;
      this.listsPending = null;
      this.listsAt = -Infinity;
      this.sessions = [];
      this.mounts = [];
      this.sessionCursor = null; this.mountCursor = null;
      quiet = false;
    }
    quiet = quiet && this.state === 'ready';
    const gen = ++this.generation;
    const current = () => gen === this.generation && source === this.currentSource();
    if (!quiet) {
      this.depthGeneration++;
      this.depth = null;
      this.depthState = 'idle';
      this.fractionGeneration++; this.fractions = []; this.fractionError = ''; this.fractionNotice = '';
      this.rows = [];
      this.hoveredKey = null;
      this.runs = [];
      this.run = null;
      this.runInfo = {};
      this.externalSpot = null;
      this.error = '';
    }
    if (!identity.target || !identity.signedIn) {
      this.state = identity.target ? 'signed-out' : 'idle';
      this.sessions = [];
      this.mounts = [];
      this.sessionCursor = null; this.mountCursor = null;
      this.selectedKey = null;
      return;
    }
    if (!quiet) this.state = 'loading';
    try {
      if (!this.scope)
        this.scope = parseScope(settings.reviewScope);
      const scope = this.scope;
      // Let results finish before picker lists compete for server CPU.
      const results = this.scopeResults(scope, quiet);
      if (!scope) await this.loadLists();
      const { rows: resultRows, runs, run, info } = await results.finally(() => {
        if (scope && current())
          void this.loadLists().catch(err => logWarn(`[review] Could not refresh lists: ${String(err)}`));
      });
      if (!current()) return;
      const rows = await this.referenceNames(resultRows, quiet);
      if (!current()) return;
      const selected = this.selected;
      const keepExternal = quiet && this.externalSpot !== null && this.selectedKey === this.externalSpot.key
        && !rows.some(r => r.key === this.selectedKey);
      assignSampleColors(rows.map(r => r.sampleName));
      this.rows = rows;
      this.runs = runs;
      this.run = run;
      this.runInfo = info;
      if (!keepExternal) {
        this.externalSpot = null;
        this.selectedKey = rows.some(r => r.key === this.selectedKey) ? this.selectedKey : rows.find(r => !r.isReference)?.key ?? rows[0]?.key ?? null;
      }
      this.state = 'ready';
      void this.loadFractions();
      if (!quiet || !selected || (!keepExternal && !rows.some(r => r.key === selected.key))
        || selected.acquisitionId !== this.selected?.acquisitionId || selected.runId !== this.selected?.runId)
        void this.loadDepth();
    }
    catch (err) {
      if (!current()) return;
      if (strict) throw err;
      if (quiet) {
        void logWarn(`[review] Could not refresh results: ${String(err)}`);
        return;
      }
      this.error = err instanceof Error ? err.message : String(err);
      this.state = /Sign in again/.test(this.error) ? 'signed-out' : 'error';
    }
  }
  private async scopeResults(scope: ReviewScope | null, quiet: boolean) {
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
      const summaries = new Map(mount.spots.map(row => [normalise(row).key, row]));
      rows = rows.map(row => {
        const summary = summaries.get(row.key);
        if (!summary) return row;
        const optional = Object.fromEntries(['session_started_at', 'sample_id', 'sample_name']
          .filter(key => row.values[key] == null && typeof summary[key] === 'string').map(key => [key, summary[key] as string]));
        return { ...row, sampleName: row.sampleName === 'No sample' && typeof optional.sample_name === 'string' ? optional.sample_name : row.sampleName,
          values: { ...row.values, ...optional } };
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
    return { rows, runs, run, info };
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
    this.closeRegion();
    this.groupView = false;
    this.selectionGeneration++;
    this.selectedKey = spot.key;
    this.externalSpot = this.rowsByKey.has(spot.key) ? null : spot;
    this.scrollVersion++;
    void this.loadDepth();
    void this.loadSelectedBatches();
    if (focus)
      void this.focus(spot);
  }
  private async command(_spot: ReviewSpot, command: BridgeCommand) {
    if (!moduleSurfaces.has('images') || shell.view !== 'review' || !settings.reviewSplit) return;
    try { await sendCommand('images', command); }
    catch (err) { this.error = `Could not focus the Review viewer: ${String(err)}`; }
  }
  async focus(spot: ReviewSpot, _show = false) {
    this.groupView = false;
    if (!spot.atlasProjectId || !spot.atlasSpotId) return;
    await this.command(spot, { type: 'focus-spot', project: spot.atlasProjectId, spot: spot.atlasSpotId, flash: true, via: 'review', server: shell.serverUrl });
  }
  async focusGrain(spots: ReviewSpot[]) {
    this.groupView = false;
    const spot = spots.find(s => s.atlasProjectId && s.atlasSpotId && s.grainLabel);
    if (!spot)
      return;
    await this.command(spot, { type: 'focus-grain', project: spot.atlasProjectId!, grain: spot.grainLabel!, spot: spot.atlasSpotId!, flash: true, via: 'review', server: shell.serverUrl });
  }
  /** Called when Review is visible. Hidden-tab events remain in selection.fromImages. */
  async fromImages(event: SpotSelectedEvent) {
    if (event.via === 'shell')
      return;
    this.closeRegion();
    const request = ++this.selectionGeneration;
    const scopeGen = this.generation;
    const matches = this.rows.filter(r => r.atlasSpotId === event.spot && (!r.atlasProjectId || r.atlasProjectId === event.project));
    const current = matches.find(r => r.runId === this.selected?.runId && r.sessionId === this.selected?.sessionId) ?? matches[0];
    if (current) {
      this.select(current, false);
      return current;
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
      const project = raw?.atlas_project_id ?? reply.spot.atlas_project_id;
      if (project && project !== event.project) return;
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
      const selected = found ?? normalise({ ...reply.spot, ...raw, atlas_project_id: event.project, atlas_spot_id: event.spot, label: raw?.label ?? reply.spot.label ?? event.name });
      this.select(selected, false);
      return selected;
    }
    catch (err) {
      if (request === this.selectionGeneration && scopeGen === this.generation)
        this.error = `Could not read the Images selection: ${String(err)}`;
    }
  }
}
export const review = new Review();

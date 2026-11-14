// Home's view of laicpmsdb (roadmap phase 4, docs/WORKFLOW.md stage 9):
// sessions with their reduction runs (count, preferred run) and the
// current atlas of each mount. Read as the shell's signed-in account.
//
//   GET /v1/sessions                     newest first
//   GET /v1/sessions/{id}/reductions     per session
//   GET /v1/mounts
//   GET /v1/mounts/{id}/atlas            {current: {...} | null, versions, …}; current null = none published

import { atlasFileUrl, capInventory, newestMounts, thumbnailPaths } from './home';
import { identity } from './identity.svelte';
import type { ApiReply } from './platform';
import { serverMessage } from './server-error';

export interface SessionOut {
  id: string;
  session_key: string;
  material: string;
  kind?: string;
  status?: string;
  started_at: string | null;
  acquisition_count: number;
  run_count?: number;
  kind_counts?: Record<string, number>;
  preferred_run?: Partial<RunOut> | null;
  instrument?: { name?: string } | null;
  analyst?: string | null;
}

export interface RunOut {
  id: string;
  session_id: string;
  pipeline_name: string;
  pipeline_version: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  upbrpy_version: string;
  is_preferred_for_session: boolean;
  run_by: string | null;
  result_count: number;
  parsing_changed_at?: string | null;
}

export interface MountOut {
  id: string;
  label: string;
  mount_type?: string;
  grain_count: number;
  spot_count: number;
}

/** The current atlas of a mount, whatever the exact field names the server uses. */
export interface Atlas {
  projectId: string;
  name: string | null;
  version: string | number | null;
  publishedAt: string | null;
}

export interface SessionRow {
  session: SessionOut;
  detailsPending?: boolean;
  /** null: could not be read. */
  runs: number | null;
  preferred: RunOut | null;
  latest: RunOut | null;
  completed?: RunOut | null;
  kindCounts?: Record<string, number> | null;
  access?: { role: 'Owner' | 'Admin' | 'Editor' | 'Viewer'; owner: string | null; canShare: boolean };
}

interface SessionDetail {
  kind_counts?: Record<string, number>;
  owner?: string | null;
  is_owner?: boolean;
  can_share?: boolean;
  can_edit?: boolean;
}

export interface MountRow {
  mount: MountOut;
  detailsPending?: boolean;
  /** null: none published; 'error': could not be read. */
  atlas: Atlas | null | 'error';
  thumbnails?: string[];
}

export type OverviewState = 'idle' | 'signed-out' | 'loading' | 'ready' | 'unreachable' | 'error';

/** Count, preferred and latest run of a session's runs. */
export function summariseRuns(runs: RunOut[]): Pick<SessionRow, 'runs' | 'preferred' | 'latest' | 'completed'> {
  const byStart = [...runs].sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''));
  return {
    runs: runs.length,
    preferred: runs.find((r) => r.is_preferred_for_session) ?? null,
    latest: byStart[0] ?? null,
    completed: byStart.find(r => r.status === 'completed') ?? null,
  };
}

/**
 * The current atlas from GET /v1/mounts/{id}/atlas (laicpmsdb docs/workflow_api.md):
 * `{mount_id, current: {project_id, version, name, uploaded_at, …} | null, versions, …}`.
 * A bare atlas object is read too. null when none is published.
 */
export function parseAtlas(body: unknown): Atlas | null {
  if (!body || typeof body !== 'object') return null;
  let b = body as Record<string, unknown>;
  if ('current' in b) {
    if (!b.current || typeof b.current !== 'object') return null;
    b = b.current as Record<string, unknown>;
  }
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const projectId = str(b.project_id) ?? str(b.atlas_project_id) ?? str(b.projectId) ?? str((b.atlas as Record<string, unknown> | undefined)?.project_id);
  if (!projectId) return null;
  const v = b.version;
  return {
    projectId,
    name: str(b.name) ?? str(b.project_name) ?? str(b.title),
    version: typeof v === 'string' || typeof v === 'number' ? v : null,
    publishedAt: str(b.uploaded_at) ?? str(b.published_at) ?? str(b.created_at),
  };
}

function isList<T>(r: ApiReply<unknown>): r is ApiReply<T[]> {
  return r.status === 200 && Array.isArray(r.body);
}

function detail(r: ApiReply<unknown>): string {
  return serverMessage(r.body, r.status);
}

class Overview {
  state = $state<OverviewState>('idle');
  error = $state('');
  sessions = $state<SessionRow[]>([]);
  mounts = $state<MountRow[]>([]);
  totalSessions = $state(0);
  totalMounts = $state(0);
  loadedAt = $state<Date | null>(null);
  sessionProgress = $state({ completed: 0, total: 0 });
  mountProgress = $state({ completed: 0, total: 0 });
  private sessionList: SessionOut[] = [];
  private mountList: MountOut[] = [];
  private thumbnailSources = new Map<string, { server: string; atlas: Atlas; access: string; started: boolean }>();
  refreshing = $state(false);
  private generation = 0;

  private source = '';

  async load({ force = false } = {}) {
    const source = `${identity.target?.server ?? ''}:${identity.revision}`;
    if (source !== this.source) {
      this.clear();
      this.source = source;
    }
    if (!force && identity.target && identity.signedIn && this.state === 'ready'
      && (this.refreshing || (this.loadedAt && Date.now() - this.loadedAt.getTime() < 60_000))) return;
    const inPlace = !force && this.state === 'ready';
    const gen = ++this.generation;
    if (!inPlace) this.thumbnailSources.clear();
    if (!identity.target) {
      this.clear();
      return;
    }
    if (!identity.signedIn) {
      this.clear();
      this.state = 'signed-out';
      return;
    }
    if (this.state !== 'ready') this.state = 'loading';
    this.refreshing = true;
    try {
      const [sessions, mounts] = await Promise.all([identity.get('/v1/sessions'), identity.get('/v1/mounts')]);
      if (gen !== this.generation) return;
      if (sessions.status === 401) {
        this.clear();
        this.state = 'signed-out';
        return;
      }
      if (!isList<SessionOut>(sessions)) throw new Error(`sessions: ${detail(sessions)}`);
      this.sessionList = sessions.body;
      this.mountList = isList<MountOut>(mounts) ? newestMounts(mounts.body) : [];
      const shown = capInventory(this.sessionList);
      const shownMounts = capInventory(this.mountList);
      const previousSessions = new Map(inPlace ? this.sessions.map(row => [row.session.id, row]) : []);
      const previousMounts = new Map(inPlace ? this.mounts.map(row => [row.mount.id, row]) : []);
      this.sessions = shown.map(session => previousSessions.get(session.id) ?? baseSession(session));
      this.mounts = shownMounts.map(mount => previousMounts.get(mount.id) ?? { mount, atlas: null, detailsPending: true });
      for (const id of this.thumbnailSources.keys()) {
        if (!this.mountList.some(mount => mount.id === id)) this.thumbnailSources.delete(id);
      }
      this.totalSessions = this.sessionList.length;
      this.totalMounts = this.mountList.length;
      this.sessionProgress = { completed: inPlace ? shown.length : 0, total: shown.length };
      this.mountProgress = { completed: inPlace ? shownMounts.length : 0, total: shownMounts.length };
      // Publish base rows before any per-row detail finishes.
      this.state = 'ready';
      this.error = isList(mounts) ? '' : `mounts: ${detail(mounts)}`;
      await Promise.all([
        this.fillSessions(shown, 0, gen, !inPlace),
        this.fillMounts(shownMounts, 0, gen, !inPlace),
      ]);
      if (gen === this.generation) this.loadedAt = new Date(Date.now());
    } catch (err) {
      if (gen !== this.generation) return;
      const msg = err instanceof Error ? err.message : String(err);
      this.state = /unreachable|connect|fetch|network/i.test(msg) ? 'unreachable' : 'error';
      this.error = msg;
    } finally {
      if (gen === this.generation) this.refreshing = false;
    }
  }

  /** Refresh a session row without disturbing the inventory or Review selection. */
  async refreshSession(id: string, { strict = false } = {}) {
    if (!identity.target || !identity.signedIn) return;
    const gen = this.generation, source = `${identity.target.server}:${identity.revision}`;
    try {
      const reply = await identity.get<SessionOut>(`/v1/sessions/${encodeURIComponent(id)}`);
      const existing = this.sessions.find(row => row.session.id === id)?.session;
      const session = reply.status === 200 && reply.body?.id === id ? reply.body : existing;
      if (!session) { if (strict) throw new Error('Session unavailable'); return; }
      const row = await this.sessionRow(session);
      if (gen !== this.generation || source !== `${identity.target?.server}:${identity.revision}`) return;
      const index = this.sessions.findIndex(row => row.session.id === id);
      if (index >= 0) this.sessions[index] = row;
      else this.sessions = [...this.sessions, row];
      const listed = this.sessionList.findIndex(s => s.id === id);
      if (listed >= 0) this.sessionList[listed] = session;
      else this.sessionList.push(session);
      this.totalSessions = this.sessionList.length;
    } catch (err) { if (strict) throw err; /* Keep the last readable row while offline. */ }
  }

  /** Refresh one mount in place; keep the visible inventory during the request. */
  async refreshMount(id: string, { strict = false } = {}) {
    if (!identity.target || !identity.signedIn) return;
    const gen = this.generation, server = identity.target.server, access = identity.revision;
    const current = () => gen === this.generation && server === identity.target?.server && access === identity.revision;
    try {
      const reply = await identity.get<MountOut>(`/v1/mounts/${encodeURIComponent(id)}`);
      if (!current()) return;
      let mount: MountOut | undefined;
      if (reply.status === 200 && reply.body?.id === id) {
        // Detail replies contain other metadata that Home does not use.
        const { id, label, mount_type, grain_count, spot_count } = reply.body;
        mount = { id, label, mount_type, grain_count, spot_count };
      } else if (reply.status === 404 || reply.status === 405) {
        const list = await identity.get<MountOut[]>('/v1/mounts');
        if (!current() || !isList<MountOut>(list)) return;
        mount = list.body.find(m => m.id === id);
      }
      if (!mount) { if (strict) throw new Error('Mount unavailable'); return; }
      const reloadThumbnails = this.thumbnailSources.get(id)?.started === true
        || this.mounts.find(row => row.mount.id === id)?.thumbnails !== undefined;
      const row = await this.mountRow(mount, gen, false);
      if (strict && row.atlas === 'error') throw new Error('Mount atlas unavailable');
      if (!current()) return;
      const listed = this.mountList.findIndex(m => m.id === id);
      if (listed >= 0) this.mountList[listed] = mount;
      else this.mountList = [...this.mountList, mount];
      this.totalMounts = this.mountList.length;
      const index = this.mounts.findIndex(r => r.mount.id === id);
      if (index >= 0) this.mounts[index] = row;
      else this.mounts = [...this.mounts, row];
      // Already visible cards need a fresh manifest even if their project is unchanged.
      if (reloadThumbnails) await this.loadThumbnails(id);
    } catch (err) { if (strict) throw err; /* Keep the last readable mount while offline. */ }
  }

  /** The explicit escape hatch for inventories over 500, using the list already read. */
  async loadRest(section: 'sessions' | 'mounts') {
    if (this.refreshing || this.state !== 'ready') return;
    const gen = this.generation;
    this.refreshing = true;
    try {
      if (section === 'sessions') {
        const offset = this.sessions.length;
        const rest = this.sessionList.slice(offset);
        this.sessions = [...this.sessions, ...rest.map(baseSession)];
        this.sessionProgress.total = this.sessions.length;
        await this.fillSessions(rest, offset, gen);
      } else {
        const offset = this.mounts.length;
        const rest = this.mountList.slice(offset);
        this.mounts = [...this.mounts, ...rest.map(mount => ({ mount, atlas: null, detailsPending: true }))];
        this.mountProgress.total = this.mounts.length;
        await this.fillMounts(rest, offset, gen);
      }
    } finally {
      if (gen === this.generation) this.refreshing = false;
    }
  }

  private async fillSessions(items: SessionOut[], offset: number, gen: number, progress = true) {
    await mapLimited(items, async (session, index) => {
      const row = await this.sessionRow(session);
      if (gen !== this.generation) return;
      this.sessions[offset + index] = row;
      if (progress) this.sessionProgress.completed += 1;
    }, () => gen === this.generation);
  }

  private async fillMounts(items: MountOut[], offset: number, gen: number, progress = true) {
    await mapLimited(items, async (mount, index) => {
      const reloadThumbnails = this.thumbnailSources.get(mount.id)?.started === true
        || this.mounts.find(row => row.mount.id === mount.id)?.thumbnails !== undefined;
      const row = await this.mountRow(mount, gen);
      if (gen !== this.generation) return;
      this.mounts[offset + index] = row;
      if (reloadThumbnails) void this.loadThumbnails(mount.id);
      if (progress) this.mountProgress.completed += 1;
    }, () => gen === this.generation);
  }

  private async sessionRow(session: SessionOut): Promise<SessionRow> {
    const path = `/v1/sessions/${encodeURIComponent(session.id)}`;
    const [runs, detail] = await Promise.allSettled([identity.get(path + '/reductions'), identity.get<SessionDetail>(path)]);
    const info = detail.status === 'fulfilled' && detail.value.status === 200 ? detail.value.body : null;
    const access: SessionRow['access'] = typeof info?.is_owner === 'boolean'
      ? {
        role: info.is_owner ? 'Owner' : info.can_share ? 'Admin' : info.can_edit ? 'Editor' : 'Viewer',
        owner: info.owner ?? null,
        canShare: info.can_share === true,
      } : undefined;
    return {
      session, kindCounts: info?.kind_counts ?? session.kind_counts ?? null, access,
      ...(runs.status === 'fulfilled' && isList<RunOut>(runs.value)
        ? summariseRuns(runs.value.body) : { runs: null, preferred: null, latest: null }),
    };
  }

  private async mountRow(mount: MountOut, gen: number, preserve = true): Promise<MountRow> {
    const server = identity.target?.server;
    try {
      const r = await identity.get(`/v1/mounts/${encodeURIComponent(mount.id)}/atlas`);
      if (r.status === 200) {
        const atlas = parseAtlas(r.body);
        const access = (r.body as { access?: unknown } | null)?.access;
        const previous = this.mounts.find(row => row.mount.id === mount.id);
        if (preserve && this.thumbnailSources.has(mount.id) && previous?.atlas && previous.atlas !== 'error' && atlas
          && previous.atlas.projectId === atlas.projectId && previous.atlas.version === atlas.version)
          return { mount, atlas, thumbnails: previous.thumbnails };
        if (gen === this.generation) this.thumbnailSources.delete(mount.id);
        if (gen === this.generation && atlas && server && typeof access === 'string' && access)
          this.thumbnailSources.set(mount.id, { server, atlas, access, started: false });
        return { mount, atlas };
      }
      if (gen === this.generation) this.thumbnailSources.delete(mount.id);
      if (r.status === 404 || r.status === 405) return { mount, atlas: null };
    } catch { /* fall through */ }
    return { mount, atlas: 'error' };
  }

  /** Called on intersection; remounted cards reuse the same manifest request. */
  async loadThumbnails(mountId: string) {
    const source = this.thumbnailSources.get(mountId);
    if (!source || source.started) return;
    source.started = true;
    const { server, atlas, access } = source;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let thumbnails: string[] = [];
    // The host's authenticated proxy only permits /v1/. Atlas files use the
    // project-scoped read token directly, also in desktop webviews.
    try {
      const response = await fetch(atlasFileUrl(server, atlas.projectId, 'atlas.json', access), { cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
      if (response.ok)
        thumbnails = thumbnailPaths(await response.json()).map(path => atlasFileUrl(server, atlas.projectId, path, access));
    } catch { /* A missing thumbnail must never hide the mount. */ }
    finally { clearTimeout(timeout); }
    // Unchanged atlases retain their source across an in-place revalidation.
    if (source !== this.thumbnailSources.get(mountId)) return;
    const row = this.mounts.find(row => row.mount.id === mountId);
    if (row) row.thumbnails = thumbnails;
  }

  clear() {
    this.generation += 1;
    this.state = 'idle';
    this.refreshing = false;
    this.sessionProgress = { completed: 0, total: 0 };
    this.mountProgress = { completed: 0, total: 0 };
    this.sessionList = [];
    this.mountList = [];
    this.thumbnailSources.clear();
    this.error = '';
    this.totalSessions = 0;
    this.totalMounts = 0;
    this.loadedAt = null;
    this.sessions = [];
    this.mounts = [];
  }
}

function baseSession(session: SessionOut): SessionRow {
  return { session, runs: session.run_count ?? null, preferred: null, latest: null,
    kindCounts: session.kind_counts, detailsPending: true };
}

/** Bound background detail fan-out, stopping queued work on refresh. */
async function mapLimited<T>(items: T[], read: (item: T, index: number) => Promise<void>, current: () => boolean): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length && current()) {
      const index = next++;
      await read(items[index], index);
    }
  }));
}

export const overview = new Overview();

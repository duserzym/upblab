// Home's view of laicpmsdb (roadmap phase 4, docs/WORKFLOW.md stage 9):
// recent sessions with their reduction runs (count, preferred run) and the
// current atlas of each mount. Read as the shell's signed-in account.
//
//   GET /v1/sessions                     newest first
//   GET /v1/sessions/{id}/reductions     per shown session
//   GET /v1/mounts
//   GET /v1/mounts/{id}/atlas            {current: {...} | null, versions, …}; current null = none published

import { atlasFileUrl, newestMounts, thumbnailPaths } from './home';
import { identity } from './identity.svelte';
import type { ApiReply } from './platform';

/** How many sessions and mounts Home shows. */
export const LIMIT = 12;

export interface SessionOut {
  id: string;
  session_key: string;
  material: string;
  kind?: string;
  status?: string;
  started_at: string | null;
  acquisition_count: number;
  run_count?: number;
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
  /** null: could not be read. */
  runs: number | null;
  preferred: RunOut | null;
  latest: RunOut | null;
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
  /** null: none published; 'error': could not be read. */
  atlas: Atlas | null | 'error';
  thumbnails?: string[];
}

export type OverviewState = 'idle' | 'signed-out' | 'loading' | 'ready' | 'unreachable' | 'error';

/** Count, preferred and latest run of a session's runs. */
export function summariseRuns(runs: RunOut[]): Pick<SessionRow, 'runs' | 'preferred' | 'latest'> {
  const byStart = [...runs].sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''));
  return {
    runs: runs.length,
    preferred: runs.find((r) => r.is_preferred_for_session) ?? null,
    latest: byStart[0] ?? null,
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
  const d = (r.body as { detail?: unknown } | null)?.detail;
  return typeof d === 'string' ? d : `HTTP ${r.status}`;
}

class Overview {
  state = $state<OverviewState>('idle');
  error = $state('');
  sessions = $state<SessionRow[]>([]);
  mounts = $state<MountRow[]>([]);
  totalSessions = $state(0);
  totalMounts = $state(0);
  loadedAt = $state<Date | null>(null);
  allLoaded = $state(false);
  refreshing = $state(false);
  private generation = 0;

  private source = '';

  async load(all = this.allLoaded) {
    const source = `${identity.target?.server ?? ''}:${identity.revision}`;
    if (source !== this.source) {
      this.clear();
      this.source = source;
      all = false;
    }
    const gen = ++this.generation;
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
      const shown = all ? sessions.body : sessions.body.slice(0, LIMIT);
      const mountList = isList<MountOut>(mounts) ? newestMounts(mounts.body) : [];
      const shownMounts = all ? mountList : mountList.slice(0, LIMIT);
      const [rows, mountRows] = await Promise.all([
        mapLimited(shown, (s) => this.sessionRow(s), () => gen === this.generation),
        mapLimited(shownMounts, (m) => this.mountRow(m), () => gen === this.generation),
      ]);
      if (gen !== this.generation) return;
      this.allLoaded = all;
      this.sessions = rows;
      this.mounts = mountRows;
      this.totalSessions = sessions.body.length;
      this.totalMounts = mountList.length;
      this.state = 'ready';
      this.error = isList(mounts) ? '' : `mounts: ${detail(mounts)}`;
      this.loadedAt = new Date();
    } catch (err) {
      if (gen !== this.generation) return;
      const msg = err instanceof Error ? err.message : String(err);
      this.state = /unreachable|connect|fetch|network/i.test(msg) ? 'unreachable' : 'error';
      this.error = msg;
    } finally {
      if (gen === this.generation) this.refreshing = false;
    }
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
      session, kindCounts: info?.kind_counts ?? null, access,
      ...(runs.status === 'fulfilled' && isList<RunOut>(runs.value)
        ? summariseRuns(runs.value.body) : { runs: null, preferred: null, latest: null }),
    };
  }

  private async mountRow(mount: MountOut): Promise<MountRow> {
    const server = identity.target?.server;
    try {
      const r = await identity.get(`/v1/mounts/${encodeURIComponent(mount.id)}/atlas`);
      if (r.status === 200) {
        const atlas = parseAtlas(r.body);
        const access = (r.body as { access?: unknown } | null)?.access;
        let thumbnails: string[] = [];
        // The host's authenticated proxy only permits /v1/. Atlas files use the
        // project-scoped read token directly, also in desktop webviews.
        if (atlas && server && typeof access === 'string' && access) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          try {
            const response = await fetch(atlasFileUrl(server, atlas.projectId, 'atlas.json', access), { referrerPolicy: 'no-referrer', signal: controller.signal });
            if (response.ok)
              thumbnails = thumbnailPaths(await response.json()).map(path => atlasFileUrl(server, atlas.projectId, path, access));
          } catch { /* A missing thumbnail must never hide the mount. */ }
          finally { clearTimeout(timeout); }
        }
        return { mount, atlas, thumbnails };
      }
      if (r.status === 404 || r.status === 405) return { mount, atlas: null };
    } catch { /* fall through */ }
    return { mount, atlas: 'error' };
  }

  clear() {
    this.generation += 1;
    this.state = 'idle';
    this.refreshing = false;
    this.allLoaded = false;
    this.error = '';
    this.totalSessions = 0;
    this.totalMounts = 0;
    this.loadedAt = null;
    this.sessions = [];
    this.mounts = [];
  }
}

/** Bound the fan-out when Show all loads a large inventory. */
async function mapLimited<T, R>(items: T[], read: (item: T) => Promise<R>, current: () => boolean): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length && current()) {
      const index = next++;
      output[index] = await read(items[index]);
    }
  }));
  return output;
}

export const overview = new Overview();

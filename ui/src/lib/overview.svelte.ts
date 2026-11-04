// Home's view of laicpmsdb (roadmap phase 4, docs/WORKFLOW.md stage 9):
// recent sessions with their reduction runs (count, preferred run) and the
// current atlas of each mount. Read as the shell's signed-in account.
//
//   GET /v1/sessions                     newest first
//   GET /v1/sessions/{id}/reductions     per shown session
//   GET /v1/mounts
//   GET /v1/mounts/{id}/atlas            {current: {...} | null, versions, …}; current null = none published

import { identity } from './identity.svelte';
import type { ApiReply } from './platform';

/** How many sessions and mounts Home shows. */
export const LIMIT = 8;

export interface SessionOut {
  id: string;
  session_key: string;
  material: string;
  kind?: string;
  status?: string;
  started_at: string | null;
  acquisition_count: number;
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
}

export interface MountRow {
  mount: MountOut;
  /** null: none published; 'error': could not be read. */
  atlas: Atlas | null | 'error';
}

export type OverviewState = 'idle' | 'signed-out' | 'loading' | 'ready' | 'unreachable' | 'error';

/** Count, preferred and latest run of a session's runs. */
export function summariseRuns(runs: RunOut[]): Omit<SessionRow, 'session'> {
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
  private generation = 0;

  async load() {
    const gen = ++this.generation;
    if (!identity.target) {
      this.state = 'idle';
      return;
    }
    if (!identity.signedIn) {
      this.state = 'signed-out';
      this.sessions = [];
      this.mounts = [];
      return;
    }
    if (this.state !== 'ready') this.state = 'loading';
    try {
      const [sessions, mounts] = await Promise.all([identity.get('/v1/sessions'), identity.get('/v1/mounts')]);
      if (gen !== this.generation) return;
      if (sessions.status === 401) {
        this.state = 'signed-out';
        return;
      }
      if (!isList<SessionOut>(sessions)) throw new Error(`sessions: ${detail(sessions)}`);
      const shown = sessions.body.slice(0, LIMIT);
      const mountList = isList<MountOut>(mounts) ? mounts.body : [];
      const shownMounts = mountList.slice(0, LIMIT);
      const [rows, mountRows] = await Promise.all([
        Promise.all(shown.map((s) => this.sessionRow(s))),
        Promise.all(shownMounts.map((m) => this.mountRow(m))),
      ]);
      if (gen !== this.generation) return;
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
    }
  }

  private async sessionRow(session: SessionOut): Promise<SessionRow> {
    try {
      const r = await identity.get(`/v1/sessions/${encodeURIComponent(session.id)}/reductions`);
      if (isList<RunOut>(r)) return { session, ...summariseRuns(r.body) };
    } catch {
      /* shown as unknown */
    }
    return { session, runs: null, preferred: null, latest: null };
  }

  private async mountRow(mount: MountOut): Promise<MountRow> {
    try {
      const r = await identity.get(`/v1/mounts/${encodeURIComponent(mount.id)}/atlas`);
      if (r.status === 200) return { mount, atlas: parseAtlas(r.body) };
      // 404/405: a laicpmsdb from before the atlas endpoint.
      if (r.status === 404 || r.status === 405) return { mount, atlas: null };
    } catch {
      /* fall through */
    }
    return { mount, atlas: 'error' };
  }

  clear() {
    this.generation += 1;
    this.state = 'idle';
    this.sessions = [];
    this.mounts = [];
  }
}

export const overview = new Overview();

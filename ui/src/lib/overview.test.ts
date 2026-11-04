import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('./identity.svelte', () => ({
  identity: {
    target: { server: 'http://h', key: 'http://h' },
    signedIn: true,
    get: (path: string) => get(path),
  },
}));

const { overview, parseAtlas, summariseRuns } = await import('./overview.svelte');
const { identity } = await import('./identity.svelte');

const run = (id: string, started: string, preferred = false) => ({
  id,
  session_id: 's1',
  pipeline_name: 'upbrpy',
  pipeline_version: '1.0',
  status: 'completed',
  started_at: started,
  completed_at: started,
  upbrpy_version: '1.0',
  is_preferred_for_session: preferred,
  run_by: 'analyst',
  result_count: 10,
});

describe('summariseRuns', () => {
  it('counts runs and finds the preferred and the latest', () => {
    const s = summariseRuns([run('a', '2026-01-01'), run('b', '2026-03-01', true), run('c', '2026-02-01')]);
    expect(s.runs).toBe(3);
    expect(s.preferred?.id).toBe('b');
    expect(s.latest?.id).toBe('b');
    expect(summariseRuns([])).toEqual({ runs: 0, preferred: null, latest: null });
  });
});

describe('parseAtlas', () => {
  it('reads the atlas reply under the likely field names', () => {
    expect(parseAtlas({ project_id: 'p', name: 'Mount A', version: 2, published_at: '2026-11-03' })).toEqual({
      projectId: 'p',
      name: 'Mount A',
      version: 2,
      publishedAt: '2026-11-03',
    });
    expect(parseAtlas({ atlas_project_id: 'q' })?.projectId).toBe('q');
    expect(parseAtlas({ atlas: { project_id: 'r' } })?.projectId).toBe('r');
    expect(parseAtlas({})).toBeNull();
    expect(parseAtlas(null)).toBeNull();
  });
});

describe('overview.load', () => {
  beforeEach(() => {
    get.mockReset();
    (identity as { signedIn: boolean }).signedIn = true;
  });

  it('lists sessions with their runs and mounts with their atlas', async () => {
    get.mockImplementation(async (path: string) => {
      if (path === '/v1/sessions') return { status: 200, body: [{ id: 's1', session_key: 'Apatite_demo', material: 'apatite', started_at: null, acquisition_count: 197 }] };
      if (path === '/v1/mounts') return { status: 200, body: [{ id: 'm1', label: 'YZ-APT-01', grain_count: 2, spot_count: 4 }, { id: 'm2', label: 'M2', grain_count: 0, spot_count: 0 }] };
      if (path === '/v1/sessions/s1/reductions') return { status: 200, body: [run('r1', '2026-01-01', true)] };
      if (path === '/v1/mounts/m1/atlas') return { status: 200, body: { project_id: 'p1' } };
      if (path === '/v1/mounts/m2/atlas') return { status: 404, body: { detail: 'Not Found' } };
      throw new Error(path);
    });
    await overview.load();
    expect(overview.state).toBe('ready');
    expect(overview.sessions[0]).toMatchObject({ runs: 1, preferred: { id: 'r1' } });
    expect(overview.mounts.map((m) => m.atlas)).toEqual([{ projectId: 'p1', name: null, version: null, publishedAt: null }, null]);
  });

  it('says signed out without asking the server', async () => {
    (identity as { signedIn: boolean }).signedIn = false;
    await overview.load();
    expect(overview.state).toBe('signed-out');
    expect(get).not.toHaveBeenCalled();
  });

  it('reports an unreachable server', async () => {
    get.mockRejectedValue(new Error('server unreachable: connection refused'));
    await overview.load();
    expect(overview.state).toBe('unreachable');
  });

  it('keeps a session whose runs cannot be read', async () => {
    get.mockImplementation(async (path: string) => {
      if (path === '/v1/sessions') return { status: 200, body: [{ id: 's1', session_key: 'k', material: 'zircon', started_at: null, acquisition_count: 1 }] };
      if (path === '/v1/mounts') return { status: 200, body: [] };
      return { status: 500, body: null };
    });
    await overview.load();
    expect(overview.state).toBe('ready');
    expect(overview.sessions[0].runs).toBeNull();
  });
});

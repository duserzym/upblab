import { beforeEach, describe, expect, it, vi } from 'vitest';
const get = vi.fn();
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'http://h', key: 'h' }, signedIn: true, revision: 0, get: (path: string) => get(path) } }));
vi.mock('./saved-data.svelte', () => ({ savedData: { reset: vi.fn(), schedule: vi.fn() } }));
import { overview, parseAtlas, summariseRuns } from './overview.svelte';
import { oversight } from './oversight.svelte';
import { identity } from './identity.svelte';
const run = (id: string, started: string, preferred = false) => ({ id, session_id: 's', pipeline_name: 'demo', pipeline_version: '1', status: 'completed', started_at: started, completed_at: started, upbrpy_version: '1', is_preferred_for_session: preferred, run_by: 'Invented', result_count: 1 });
describe('summariseRuns', () => {
  it('counts runs and finds the preferred and the latest', () => {
    const s = summariseRuns([run('a', '2026-01-01'), run('b', '2026-03-01', true), run('c', '2026-02-01')]);
    expect(s.runs).toBe(3);
    expect(s.preferred?.id).toBe('b');
    expect(s.latest?.id).toBe('b');
    expect(summariseRuns([])).toEqual({ runs: 0, preferred: null, latest: null, completed: null });
  });
});

describe('parseAtlas', () => {
  it('reads upbdb\'s reply: current atlas, or none when current is null', () => {
    const reply = {
      mount_id: 'm',
      current: { id: 'a2', project_id: 'p', version: 2, name: 'YZ-APT-01 CL', is_current: true, uploaded_at: '2026-11-03T20:00:00Z' },
      versions: [],
      access: null,
      viewer_url: null,
    };
    expect(parseAtlas(reply)).toEqual({ projectId: 'p', name: 'YZ-APT-01 CL', version: 2, publishedAt: '2026-11-03T20:00:00Z' });
    expect(parseAtlas({ mount_id: 'm', current: null, versions: [] })).toBeNull();
  });

  it('reads a bare atlas object too', () => {
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

beforeEach(() => { get.mockReset(); overview.clear(); oversight.reset(); vi.unstubAllGlobals(); identity.target = { server: 'http://h', key: 'h' }; identity.revision = 0; (identity as { signedIn: boolean }).signedIn = true; });
it('summarises stored runs and reads atlas summaries and detail responses', () => {
  expect(summariseRuns([run('a', '2026-01-01'), run('b', '2026-02-01', true)])).toMatchObject({ runs: 2, preferred: { id: 'b' }, latest: { id: 'b' } });
  expect(summariseRuns([])).toEqual({ runs: 0, preferred: null, latest: null, completed: null });
  expect(parseAtlas({ current: { project_id: 'p', version: 2, uploaded_at: '2026-01-01' } })).toEqual({ projectId: 'p', version: 2, name: null, publishedAt: '2026-01-01' });
  expect(parseAtlas({ project_id: 'p' })?.projectId).toBe('p'); expect(parseAtlas({ current: null })).toBeNull(); expect(parseAtlas(null)).toBeNull();
});
it('uses list summaries for thousands of rows with no per-row requests and pages only on demand', async () => {
  const sessions = Array.from({ length: 3000 }, (_, i) => ({ id: `s${i}`, session_key: `Invented ${i}`, material: 'zircon', started_at: null, acquisition_count: 4, run_count: 2, spot_kinds: { sample: 4 }, owner_name: 'Cedar', preferred_run: { id: 'r', status: 'completed', created_at: '2026-01-01', finished_at: '2026-01-02' } }));
  const mounts = [{ id: 'm', label: 'Invented mount', grain_count: 1, spot_count: 2, creator: { id: 'c', name: 'Cedar' }, atlas: { project_id: 'p', version: 2, thumbnail: '/atlas/projects/p/thumb.png?access=invented' } }];
  get.mockImplementation(async path => path === '/v1/sessions?limit=500' ? { status: 200, body: sessions.slice(0, 500), nextCursor: 'opaque/next' }
    : path === '/v1/mounts?limit=500' ? { status: 200, body: mounts } : { status: 200, body: sessions.slice(500, 1000) });
  const start = performance.now(); await overview.load({ force: true });
  expect(get).toHaveBeenCalledTimes(2); expect(overview.sessions).toHaveLength(500);
  expect(overview.sessions[0]).toMatchObject({ runs: 2, kindCounts: { sample: 4 }, preferred: { id: 'r', started_at: '2026-01-01' } });
  expect(overview.mounts[0]).toMatchObject({ atlas: { projectId: 'p', version: 2 }, thumbnails: ['http://h/atlas/projects/p/thumb.png?access=invented'] });
  expect(overview.sessionCursor).toBe('opaque/next'); await overview.loadRest('sessions'); expect(overview.sessions).toHaveLength(1000); expect(get).toHaveBeenCalledTimes(3);
  console.info(`[overview scale] initial page: 2 reads (before: 1502 for 500 sessions + 500 mounts), paged 1000 sessions: 3 reads in ${(performance.now() - start).toFixed(1)} ms`);
});
it('combines server filters on both lists and clears old rows before reloading', async () => {
  get.mockResolvedValue({ status: 200, body: [] });
  oversight.filters = { owner: 'cedar', team: 'Team A', project: 'DEMO', lab: 'lab' }; await overview.load();
  expect(get.mock.calls.map(([path]) => path)).toEqual(['/v1/sessions?limit=500&owner=cedar&team=Team+A&project=DEMO&lab=lab', '/v1/mounts?limit=500&owner=cedar&team=Team+A&project=DEMO&lab=lab']);
});
it('scopes list-provided thumbnails to the selected account', async () => {
  oversight.select({ username: 'cedar', name: 'Cedar' });
  get.mockImplementation(async path => ({ status: 200, body: path.startsWith('/v1/mounts')
    ? [{ id: 'm', label: 'Invented', atlas: { project_id: 'p', thumbnail: '/atlas/projects/p/thumb.png?access=invented' } }] : [] }));
  await overview.load();
  expect(overview.mounts[0].thumbnails).toEqual(['http://h/atlas/projects/p/thumb.png?access=invented&as=cedar']);
});
it('rejects a superseded inventory without restoring stale rows', async () => {
  let finish!: (r: unknown) => void;
  get.mockImplementation(path => path.startsWith('/v1/sessions') ? new Promise(resolve => finish = resolve) : Promise.resolve({ status: 200, body: [] }));
  const old = overview.load({ force: true }); overview.clear(); finish({ status: 200, body: [{ id: 'stale' }] }); await old;
  expect(overview.sessions).toEqual([]); expect(overview.state).toBe('idle');
});
it('leaves missing summaries unavailable without fan-out', async () => {
  get.mockImplementation(async path => ({ status: 200, body: path.startsWith('/v1/sessions') ? [{ id: 's', session_key: 'Invented' }]
    : [{ id: 'm', label: 'Invented mount' }] }));
  await overview.load({ force: true }); expect(overview.sessions[0].runs).toBeNull(); expect(get).toHaveBeenCalledTimes(2);
  expect(overview.mounts[0].atlas).toBe('error');
  expect(oversight.filters).toEqual({ owner: '', team: '', project: '', lab: '' });
});
it('says signed out without requesting rows and reports server failures', async () => {
  (identity as { signedIn: boolean }).signedIn = false; await overview.load(); expect(get).not.toHaveBeenCalled(); expect(overview.state).toBe('signed-out');
  (identity as { signedIn: boolean }).signedIn = true; get.mockRejectedValue(new Error('server unreachable: connection failed')); await overview.load(); expect(overview.state).toBe('unreachable');
});
it('refreshes one explicitly requested session and mount, preserving owner names', async () => {
  get.mockImplementation(async path => path.endsWith('/reductions') ? { status: 200, body: [run('r', '2026-01-01', true)] }
    : path.endsWith('/atlas') ? { status: 200, body: { project_id: 'p' } }
    : { status: 200, body: { id: path.includes('/sessions/') ? 's' : 'm', session_key: 'Invented', label: 'Invented', owner_name: 'Cedar', grain_count: 1, spot_count: 2 } });
  await overview.refreshSession('s'); await overview.refreshMount('m'); expect(overview.sessions[0].session.owner_name).toBe('Cedar'); expect(overview.mounts[0].mount.owner_name).toBe('Cedar');
});
it('retains whichever saved inventory is available', async () => {
  get.mockImplementation(async path => path.startsWith('/v1/sessions') ? { status: 503, body: {} } : { status: 200, body: [{ id: 'm', label: 'Saved', grain_count: 0, spot_count: 0 }] });
  await overview.load(); expect(overview.mounts).toHaveLength(1); expect(overview.error).toContain('503');
});

describe('refreshMount', () => {
  beforeEach(() => {
    overview.clear();
    get.mockReset();
    vi.unstubAllGlobals();
    identity.target = { server: 'http://h', key: 'http://h' };
    (identity as unknown as { signedIn: boolean }).signedIn = true;
    const older = { id: 'm1', label: 'Earlier name', grain_count: 1, spot_count: 2 };
    overview.mounts = [{ mount: older, atlas: { projectId: 'p1', name: null, version: 1, publishedAt: null } }];
  });
  it('keeps the shown row while fetching and replaces just that mount and its atlas', async () => {
    let finish!: (reply: unknown) => void;
    const updated = { id: 'm1', label: 'Updated name', grain_count: 3, spot_count: 12 };
    get.mockImplementation((path: string) => path === '/v1/mounts/m1'
      ? new Promise(resolve => { finish = resolve; })
      : Promise.resolve({ status: 200, body: { current: { project_id: 'p1', version: 3 } } }));
    const refreshing = overview.refreshMount('m1');
    expect(overview.mounts[0].mount.label).toBe('Earlier name');
    finish({ status: 200, body: { ...updated, ignored: true } });
    await refreshing;
    expect(overview.mounts[0]).toMatchObject({ mount: updated, atlas: { version: 3 } });
    expect(overview.mounts[0].mount).not.toHaveProperty('ignored');
    expect(get.mock.calls.map(([path]) => path)).toEqual(['/v1/mounts/m1', '/v1/mounts/m1/atlas']);
  });
  it('keeps unrequested thumbnails lazy after refreshing a mount', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ files: {} }) });
    vi.stubGlobal('fetch', fetch);
    get.mockImplementation(async (path: string) => path === '/v1/mounts/m1'
      ? { status: 200, body: overview.mounts[0].mount }
      : { status: 200, body: { current: { project_id: 'p1', version: 2 }, access: 'read-token' } });
    await overview.refreshMount('m1');
    expect(fetch).not.toHaveBeenCalled();
    await overview.loadThumbnails('m1');
    expect(fetch).toHaveBeenCalledExactlyOnceWith('http://h/atlas/projects/p1/atlas.json?access=read-token', expect.objectContaining({ cache: 'no-store' }));
  });
  it('ignores an older in-flight manifest after refreshing just its mount', async () => {
    let finish!: (reply: unknown) => void;
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue({ ok: true, json: async () => ({ files: { 'pyramid/new/0/0_0.webp': 'invented' } }) });
    vi.stubGlobal('fetch', fetch);
    get.mockImplementation(async (path: string) => path === '/v1/mounts/m1'
      ? { status: 200, body: overview.mounts[0].mount }
      : { status: 200, body: { current: { project_id: 'p1' }, access: 'read-token' } });
    await overview.refreshMount('m1');
    const stale = overview.loadThumbnails('m1');
    await overview.refreshMount('m1');
    const latest = [...overview.mounts[0].thumbnails!];
    expect(latest).toEqual(['http://h/atlas/projects/p1/pyramid/new/0/0_0.webp?access=read-token']);
    finish({ ok: true, json: async () => ({ files: { 'pyramid/old/0/0_0.webp': 'invented' } }) });
    await stale;
    expect(overview.mounts[0].thumbnails).toEqual(latest);
  });
  it('ignores an unavailable list and a reply from an old server', async () => {
    get.mockResolvedValue({ status: 404, body: {} });
    await overview.refreshMount('m1');
    expect(overview.mounts[0].mount.label).toBe('Earlier name');
    let finish!: (reply: unknown) => void;
    get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const refreshing = overview.refreshMount('m1');
    identity.target = { server: 'http://other', key: 'http://other' };
    finish({ status: 200, body: [{ id: 'm1', label: 'Stale response' }] });
    await refreshing;
    expect(overview.mounts[0].mount.label).toBe('Earlier name');
  });
});


it.each([404, 405])('refreshMount falls back to the inventory only for HTTP %s and appends new mounts', async status => {
  overview.clear();
  get.mockReset();
  const mount = { id: 'new', label: 'New', grain_count: 1, spot_count: 1 };
  get.mockImplementation(async path => path === '/v1/mounts/new' ? { status, body: {} }
    : path === '/v1/mounts?limit=500' ? { status: 200, body: [mount] } : { status: 200, body: { current: null } });
  await overview.refreshMount('new');
  expect(get.mock.calls.map(([path]) => path)).toEqual(['/v1/mounts/new', '/v1/mounts?limit=500', '/v1/mounts/new/atlas']);
  expect(overview.mounts[0].mount).toEqual(mount);
  expect(overview.totalMounts).toBe(1);
});

it('does not fall back to the inventory on other mount errors', async () => {
  overview.clear();
  get.mockReset();
  get.mockResolvedValue({ status: 503, body: {} });
  await overview.refreshMount('missing');
  expect(get.mock.calls.map(([path]) => path)).toEqual(['/v1/mounts/missing']);
});

it('refreshes a single session in place and keeps other rows', async () => {
  overview.sessions = [{ session: { id: 's1', session_key: 'Demo' }, runs: 0, latest: null, preferred: null },
    { session: { id: 's2', session_key: 'Other' }, runs: 0, latest: null, preferred: null }] as typeof overview.sessions;
  get.mockImplementation(async (path: string) => path.endsWith('/reductions')
    ? { status: 200, body: [run('new', '2026-11-13')] }
    : { status: 200, body: { id: 's1', session_key: 'Updated' } });
  await overview.refreshSession('s1');
  expect(overview.sessions[0].session.session_key).toBe('Updated');
  expect(overview.sessions[0].latest?.id).toBe('new');
  expect(overview.sessions[1].session.session_key).toBe('Other');
});

it('keeps a submitted run version across the first Home list load and later revalidation', async () => {
  const session = { id: 's', session_key: 'Invented', material: 'zircon', started_at: null,
    acquisition_count: 1, run_count: 2, preferred_run: { id: 'old-preferred' }, owner_name: 'Cedar' };
  const submitted = { ...run('submitted', '2026-11-18', true), pipeline_name: 'UPbRPy', pipeline_version: '0.2.0' };
  get.mockImplementation(async path => ({ status: 200, body: path === '/v1/sessions?limit=500' ? [session]
    : path === '/v1/mounts?limit=500' ? [] : path.endsWith('/reductions') ? [submitted] : session }));
  await overview.refreshSession('s');
  const before = get.mock.calls.length;
  await overview.load();
  expect(get).toHaveBeenCalledTimes(before + 2);
  expect(overview.sessions[0]).toMatchObject({ session: { owner_name: 'Cedar' }, preferred: { id: 'submitted', pipeline_version: '0.2.0' } });
  await overview.load({ force: true });
  expect(overview.sessions[0].preferred?.pipeline_version).toBe('0.2.0');
  get.mockImplementation(async path => ({ status: 200, body: path.startsWith('/v1/sessions')
    ? [{ ...session, run_count: 3, preferred_run: { id: 'new-preferred', pipeline_version: '0.3.0' } }] : [] }));
  await overview.load({ force: true });
  expect(overview.sessions[0].preferred).toMatchObject({ id: 'new-preferred', pipeline_version: '0.3.0' });
});

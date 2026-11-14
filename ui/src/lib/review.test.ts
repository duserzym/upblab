import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiReply } from './platform';
import { reviewFixtures, table, rows, mountResults, session } from '../../tests/fixtures/review';
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'http://h' }, signedIn: true, revision: 0, get: vi.fn() } }));
vi.mock('./shell.svelte', () => ({ shell: { serverUrl: 'http://h', view: 'review', load: vi.fn(), show: vi.fn() } }));
vi.mock('./settings.svelte', () => ({ settings: { loaded: true, reviewScope: '', reviewSplit: false, update: vi.fn() } }));
vi.mock('./platform', () => ({ logWarn: vi.fn(async () => {}) }));
vi.mock('./incoming', () => ({ sendCommand: vi.fn(async () => true) }));
const { identity } = await import('./identity.svelte');
const { shell } = await import('./shell.svelte');
const { sendCommand } = await import('./incoming');
const { logWarn } = await import('./platform');
const { settings } = await import('./settings.svelte');
const { Review } = await import('./review.svelte');
const get = vi.mocked(identity.get);
let review: InstanceType<typeof Review>;
const event = (spot: string, via: 'user' | 'shell' = 'user') => ({ type: 'lab.spot.selected' as const, project: 'project-demo', spot, via });
beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  identity.target = { server: 'http://h' } as typeof identity.target;
  identity.revision = 0;
  (identity as { signedIn: boolean }).signedIn = true;
  vi.unstubAllGlobals();
  settings.reviewSplit = false;
  settings.reviewScope = '';
  review = new Review();
  get.mockImplementation(async (path) => ({ status: path in reviewFixtures ? 200 : 404, body: reviewFixtures[path] }) as never);
  vi.mocked(sendCommand).mockResolvedValue(true);
});
describe('Review selection and loading', () => {
  it('leaves an unsaved scope for the header to prompt and restores a saved scope', async () => {
    await review.load();
    expect(review.state).toBe('ready');
    expect(review.sessions).toHaveLength(1);
    expect(review.scope).toBeNull();
    expect(get.mock.calls.some(([path]) => path.includes('/results'))).toBe(false);
    settings.reviewScope = JSON.stringify({ kind: 'session', id: session.id, run: 'preferred' });
    await review.load();
    expect(review.scope).toEqual({ kind: 'session', id: session.id, run: 'preferred' });
    expect(review.rows).toHaveLength(12);
  });
  it('groups standard spots by the acquisition reference name while preserving raw labels', async () => {
    const previous = get.getMockImplementation()!;
    get.mockImplementation(async path => path === `/v1/sessions/${session.id}/acquisitions`
      ? { status: 200, body: [{ id: 'acq-9', reference_material_name: 'Canonical reference' }] } as never
      : previous(path));
    await review.open({ kind: 'session', id: session.id });
    expect(review.rows[8]).toMatchObject({ isReference: true, sampleName: 'Canonical reference', label: 'Reference_1' });
    expect(review.rows[9].sampleName).toBe('Demo reference');
    expect(review.selected?.isReference).toBe(false);
  });

  it('loads a run and focuses Images while keeping Review selected', async () => {
    await review.open({ kind: 'session', id: session.id });
    review.select(review.rows[1]);
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalled());
    expect(sendCommand).toHaveBeenCalledWith('images', { type: 'focus-spot', project: 'project-demo', spot: 'atlas-2', server: 'http://h', flash: true, via: 'review' });
    expect(shell.show).not.toHaveBeenCalled();
    vi.mocked(sendCommand).mockResolvedValue(false);
    await review.focus(review.rows[0]);
    expect(shell.load).toHaveBeenCalledWith('images', '/atlas/?project=project-demo&spot=atlas-1');
    await review.focus(review.rows[0], true);
    expect(shell.show).toHaveBeenCalledWith('images');
    await review.focusGrain(review.rows);
    expect(sendCommand).toHaveBeenLastCalledWith('images', expect.objectContaining({ type: 'focus-grain', grain: 'area/1', server: 'http://h' }));
  });
  it('keeps both views open when Show in Images is used in the split', async () => {
    await review.open({ kind: 'session', id: session.id });
    settings.reviewSplit = true;
    vi.stubGlobal('window', { innerWidth: 1440 });
    await review.focus(review.rows[0], true);
    expect(shell.show).not.toHaveBeenCalled();
    vi.stubGlobal('window', { innerWidth: 1280 });
    await review.focus(review.rows[0], true);
    expect(shell.show).not.toHaveBeenCalled();
  });
  it('does not echo shell selections and selects loaded user spots without sending a command', async () => {
    await review.open({ kind: 'session', id: session.id });
    const key = review.selectedKey;
    await review.fromImages(event('atlas-2', 'shell'));
    expect(review.selectedKey).toBe(key);
    expect(await review.fromImages(event('atlas-2'))).toBe(review.rows[1]);
    expect(review.selectedKey).toBe('acq-2');
    expect(sendCommand).not.toHaveBeenCalled();
  });
  it('switches to another session on an Images selection', async () => {
    await review.open({ kind: 'session', id: session.id });
    const other = { ...rows[0], acquisition_id: 'acq-other', atlas_spot_id: 'atlas-other', session_id: 'other', run_id: 'run-other' };
    get.mockImplementation(async (path) => ({ status: 200, body: path === '/v1/spots/by-atlas/atlas-other/results' ? { spot: other, columns: [], rows: [other] } : path === '/v1/sessions/other/results?run=preferred' ? { ...table, session_id: 'other', rows: [other] } : path === '/v1/sessions/other/reductions' ? [] : reviewFixtures[path] }) as never);
    await review.fromImages(event('atlas-other'));
    expect(review.scope).toEqual({ kind: 'session', id: 'other', run: 'preferred' });
    expect(review.selectedKey).toBe('acq-other');
    expect(sendCommand).not.toHaveBeenCalled();
  });
  it('does not select a lookup result belonging to a different atlas project', async () => {
    await review.open({ kind: 'session', id: session.id });
    const selected = review.selectedKey;
    const previous = get.getMockImplementation()!;
    const other = { ...rows[0], atlas_project_id: 'other-project', atlas_spot_id: 'atlas-other' };
    get.mockImplementation(path => path === '/v1/spots/by-atlas/atlas-other/results'
      ? Promise.resolve({ status: 200, body: { spot: other, rows: [other], columns: table.columns } }) as never : previous(path));
    expect(await review.fromImages(event('atlas-other'))).toBeUndefined();
    expect(review.selectedKey).toBe(selected);
  });
  it('retains all mount spots and uses only full results on that mount, with the legacy atlas fallback', async () => {
    get.mockImplementation(async (path) => ({ status: 200, body: path.includes('/results?run=') ? { ...table, rows: [{ ...rows[0], mount_id: null }, { ...rows[1], mount_id: 'elsewhere' }] } : reviewFixtures[path] }) as never);
    await review.open({ kind: 'mount', id: 'mount-demo' });
    expect(review.rows).toHaveLength(mountResults.spots.length);
    expect(review.rows.find(r => r.key === 'acq-1')?.values.La).toBe(0.3);
    expect(review.rows.find(r => r.key === 'acq-2')?.values.La).toBeUndefined();
    await review.fromImages(event('atlas-unmeasured'));
    expect(review.selected?.acquisitionId).toBeNull();
  });
  it('keeps the mount scope for a newly linked spot on the same mount', async () => {
    await review.open({ kind: 'mount', id: 'mount-demo' });
    const added = { ...rows[0], acquisition_id: 'acq-added', atlas_spot_id: 'atlas-added', session_id: session.id };
    const previous = get.getMockImplementation()!;
    get.mockImplementation(async path => path === '/v1/spots/by-atlas/atlas-added/results'
      ? { status: 200, body: { spot: added, rows: [added], columns: table.columns } } as never
      : previous(path));
    await review.fromImages(event('atlas-added'));
    expect(review.scope).toEqual({ kind: 'mount', id: 'mount-demo' });
    expect(review.selectedKey).toBe('acq-added');
    expect(sendCommand).not.toHaveBeenCalled();
  });
  it('shows never-measured details and switches to another mount when needed', async () => {
    await review.open({ kind: 'mount', id: 'mount-demo' });
    get.mockImplementation(async (path) => ({ status: 200, body: path === '/v1/spots/by-atlas/atlas-new/results' ? { spot: { spot_id: 'new', atlas_spot_id: 'atlas-new', label: 'New spot', mount_id: 'new-mount' }, rows: [], columns: [] } : path === '/v1/mounts/new-mount/results' ? { spots: [] } : reviewFixtures[path] }) as never);
    await review.fromImages(event('atlas-new'));
    expect(review.scope).toEqual({ kind: 'mount', id: 'new-mount' });
    expect(review.selected?.label).toBe('New spot');
    expect(review.selected?.date).toBeNull();
  });
  it('ignores late scope and depth responses', async () => {
    let release!: (v: unknown) => void;
    get.mockImplementationOnce(() => new Promise(r => { release = r as typeof release; }));
    const old = review.open({ kind: 'session', id: 'old' });
    await review.open({ kind: 'session', id: session.id });
    release({ status: 200, body: [] });
    await old;
    expect(review.scope?.id).toBe(session.id);
    expect(review.rows).toHaveLength(12);
    let depthRelease!: (v: unknown) => void;
    get.mockImplementation(async (path) => path.includes('/acq-1/depth-profile') ? await new Promise(r => { depthRelease = r as typeof depthRelease; }) : { status: 200, body: { acquisition_id: 'acq-2', columns: [], data: {}, run: null } } as never);
    const depth = review.loadDepth();
    review.select(review.rows[1], false);
    await vi.waitFor(() => expect(review.depth?.acquisition_id).toBe('acq-2'));
    depthRelease({ status: 200, body: { acquisition_id: 'acq-1', columns: [], data: {} } });
    await depth;
    expect(review.depth?.acquisition_id).toBe('acq-2');
  });
  it('shares hover without selecting or sending an Images command and clears it on reload', async () => {
    await review.open({ kind: 'session', id: session.id });
    const selected = review.selectedKey;
    review.hoveredKey = review.rows[1].key;
    expect(review.selectedKey).toBe(selected);
    expect(sendCommand).not.toHaveBeenCalled();
    await review.load();
    expect(review.hoveredKey).toBeNull();
  });
  it('shows API errors', async () => {
    get.mockResolvedValue({ status: 503, body: { detail: 'maintenance' } } as never);
    await review.load();
    expect(review.state).toBe('error');
    expect(review.error).toContain('maintenance');
  });
  it('does not restore rows when an in-flight load completes after sign-out', async () => {
    let release!: (value: unknown) => void;
    get.mockImplementationOnce(() => new Promise(r => { release = r as typeof release; }));
    const pending = review.open({ kind: 'session', id: session.id });
    (identity as {
      signedIn: boolean;
    }).signedIn = false;
    await review.load();
    expect(review.state).toBe('signed-out');
    release({ status: 200, body: [session] });
    await pending;
    expect(review.rows).toEqual([]);
    expect(review.state).toBe('signed-out');
    (identity as {
      signedIn: boolean;
    }).signedIn = true;
  });
  it('ignores a late reverse lookup after the user selects another row', async () => {
    await review.open({ kind: 'session', id: session.id });
    let release!: (value: unknown) => void;
    get.mockImplementationOnce(() => new Promise(r => { release = r as typeof release; }));
    const lookup = review.fromImages(event('atlas-late'));
    review.select(review.rows[2], false);
    release({ status: 200, body: { spot: { spot_id: 'late', label: 'Late' }, rows: [], columns: [] } });
    await lookup;
    expect(review.selectedKey).toBe('acq-3');
  });
});

it('reloads results keeping scope, run and the selected spot if still present', async () => {
  await review.open({ kind: 'session', id: session.id, run: 'run-newer' });
  review.select(review.rows[3], false);
  await review.load();
  expect(review.scope).toEqual({ kind: 'session', id: session.id, run: 'run-newer' });
  expect(review.selectedKey).toBe('acq-4');
});


describe('Review refresh speed', () => {
  it.each(['session', 'mount'] as const)('starts picker lists only after %s results resolve', async kind => {
    const path = kind === 'session' ? `/v1/sessions/${session.id}/results?run=preferred` : '/v1/mounts/mount-demo/results';
    const previous = get.getMockImplementation()!;
    let finish!: (reply: ApiReply<unknown>) => void;
    get.mockImplementation(request => request === path
      ? new Promise(resolve => { finish = resolve; }) : previous(request));
    const pending = review.open({ kind, id: kind === 'session' ? session.id : 'mount-demo' });
    expect(get).toHaveBeenCalledWith(path);
    expect(get).not.toHaveBeenCalledWith('/v1/sessions');
    expect(get).not.toHaveBeenCalledWith('/v1/mounts');
    finish({ status: 200, body: reviewFixtures[path] });
    await pending;
    expect(get).toHaveBeenCalledWith('/v1/sessions');
    expect(get).toHaveBeenCalledWith('/v1/mounts');
  });

  it('starts picker lists after results fail without awaiting the lists', async () => {
    let fail!: (error: Error) => void;
    const previous = get.getMockImplementation()!;
    get.mockImplementation(path => path.includes('/results?run=')
      ? new Promise((_resolve, reject) => { fail = reject; })
      : path === '/v1/sessions' || path === '/v1/mounts' ? new Promise(() => {}) : previous(path));
    const pending = review.open({ kind: 'session', id: session.id });
    expect(get).not.toHaveBeenCalledWith('/v1/sessions');
    expect(get).not.toHaveBeenCalledWith('/v1/mounts');
    fail(new Error('offline'));
    await pending;
    expect(review.state).toBe('error');
    expect(get).toHaveBeenCalledWith('/v1/sessions');
    expect(get).toHaveBeenCalledWith('/v1/mounts');
  });

  it.each([true, false])('preserves an external Images selection only on quiet loads (quiet=%s)', async quiet => {
    await review.open({ kind: 'session', id: session.id });
    const previous = get.getMockImplementation()!;
    get.mockImplementation(path => path === '/v1/spots/by-atlas/atlas-outside/results'
      ? Promise.resolve({ status: 200, body: { spot: { spot_id: 'outside', label: 'Outside scope' }, rows: [], columns: [] } }) as never
      : previous(path));
    await review.fromImages(event('atlas-outside'));
    const external = review.externalSpot;
    expect(external).not.toBeNull();
    expect(review.selectedKey).toBe(external!.key);
    expect(review.rows.some(row => row.key === external!.key)).toBe(false);
    const loadDepth = vi.spyOn(review, 'loadDepth');
    await review.load({ quiet });
    expect(review.scope).toEqual({ kind: 'session', id: session.id, run: 'preferred' });
    expect(review.externalSpot).toBe(quiet ? external : null);
    expect(review.selectedKey).toBe(quiet ? external!.key : review.rows[0].key);
    expect(review.selected).toBe(quiet ? external : review.rows[0]);
    expect(loadDepth).toHaveBeenCalledTimes(quiet ? 0 : 1);
  });

  it('finishes results before slow picker lists resolve, including a scope switch', async () => {
    const pending = new Map<string, (reply: ApiReply<unknown>) => void>();
    const previous = get.getMockImplementation()!;
    get.mockImplementation(path => path === '/v1/sessions' || path === '/v1/mounts'
      ? new Promise(resolve => pending.set(path, resolve)) : previous(path));
    await review.open({ kind: 'session', id: session.id });
    expect(review.state).toBe('ready');
    expect(review.rows).toHaveLength(12);
    expect(get.mock.calls[0][0]).toContain('/results?run=preferred');
    await review.open({ kind: 'mount', id: 'mount-demo' });
    expect(review.rows).toHaveLength(mountResults.spots.length);
    expect(get.mock.calls.filter(([path]) => path === '/v1/mounts')).toHaveLength(1);
    pending.get('/v1/sessions')!({ status: 200, body: [session] });
    pending.get('/v1/mounts')!({ status: 200, body: [] });
    await vi.waitFor(() => expect(review.sessions).toHaveLength(1));
  });

  it('keeps rows, run, selection and depth visible and reads only results with fresh lists', async () => {
    await review.open({ kind: 'session', id: session.id });
    review.select(review.rows[3], false);
    await vi.waitFor(() => expect(review.depthState).toBe('ready'));
    const oldRows = review.rows, depth = review.depth, run = review.run, info = review.runInfo;
    get.mockClear();
    let finish!: (reply: ApiReply<unknown>) => void;
    get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const refreshing = review.refresh();
    expect(review.state).toBe('ready');
    expect(review.rows).toBe(oldRows);
    expect(review.run).toBe(run);
    expect(review.runInfo).toBe(info);
    expect(review.depth).toBe(depth);
    finish({ status: 200, body: { ...table, rows: rows.map(row => ({ ...row, label: `${row.label} updated` })) } });
    await refreshing;
    expect(review.state).toBe('ready');
    expect(review.selectedKey).toBe('acq-4');
    expect(review.rows[3].label).toBe('Zircon_4 updated');
    expect(review.depth).toBe(depth);
    expect(get.mock.calls.map(([path]) => path)).toEqual([`/v1/sessions/${session.id}/results?run=preferred`]);
  });

  it('keeps old rows and logs a failed quiet refresh', async () => {
    await review.open({ kind: 'session', id: session.id });
    const oldRows = review.rows;
    get.mockResolvedValueOnce({ status: 503, body: { detail: 'maintenance' } } as never);
    await review.refresh();
    expect(review.state).toBe('ready');
    expect(review.rows).toBe(oldRows);
    expect(review.error).toBe('');
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('maintenance'));
  });

  it('ignores a quiet response superseded by a user scope change', async () => {
    await review.open({ kind: 'session', id: session.id });
    let finish!: (reply: ApiReply<unknown>) => void;
    get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const refreshing = review.refresh();
    await review.open({ kind: 'mount', id: 'mount-demo' });
    finish({ status: 200, body: { ...table, rows: [] } });
    await refreshing;
    expect(review.scope).toEqual({ kind: 'mount', id: 'mount-demo' });
    expect(review.rows).toHaveLength(mountResults.spots.length);
    expect(review.state).toBe('ready');
  });

  it('reuses reference acquisition names without hiding fresh stored names', async () => {
    const previous = get.getMockImplementation()!;
    get.mockImplementation(path => path.endsWith('/acquisitions')
      ? Promise.resolve({ status: 200, body: [{ id: 'acq-9', reference_material_name: 'Canonical reference' }] }) as never
      : previous(path));
    await review.open({ kind: 'session', id: session.id });
    get.mockClear();
    await review.refresh();
    expect(review.rows[8].sampleName).toBe('Canonical reference');
    expect(get.mock.calls.map(([path]) => path)).toEqual([`/v1/sessions/${session.id}/results?run=preferred`]);
    get.mockResolvedValueOnce({ status: 200, body: { ...table, rows: rows.map(row => ({ ...row, reference_material_name: 'Updated reference' })) } } as never);
    await review.refresh();
    expect(review.rows[8].sampleName).toBe('Updated reference');
  });

  it('reloads depth only when the selected acquisition/run changes or the spot disappears', async () => {
    await review.open({ kind: 'session', id: session.id });
    await vi.waitFor(() => expect(review.depthState).toBe('ready'));
    const previous = get.getMockImplementation()!;
    let nextRows = rows.map(row => ({ ...row, run_id: 'run-newer' }));
    get.mockImplementation(path => path.includes('/results?run=')
      ? Promise.resolve({ status: 200, body: { ...table, rows: nextRows } }) as never : previous(path));
    get.mockClear();
    await review.refresh();
    expect(review.selectedKey).toBe('acq-1');
    expect(get).toHaveBeenCalledWith('/v1/acquisitions/acq-1/depth-profile?run=run-newer');
    nextRows = nextRows.slice(1);
    get.mockClear();
    await review.refresh();
    expect(review.selectedKey).toBe('acq-2');
    expect(get).toHaveBeenCalledWith('/v1/acquisitions/acq-2/depth-profile?run=run-newer');
  });

  it('refreshes stale lists in the background and invalidates them on identity/server changes', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    await review.open({ kind: 'session', id: session.id });
    get.mockClear();
    clock.mockReturnValue(61_001);
    const previous = get.getMockImplementation()!;
    const releases: ((reply: ApiReply<unknown>) => void)[] = [];
    get.mockImplementation(path => path === '/v1/sessions' || path === '/v1/mounts'
      ? new Promise(resolve => releases.push(resolve)) : previous(path));
    let finish!: (reply: ApiReply<unknown>) => void;
    get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const refreshing = review.refresh();
    expect(get).not.toHaveBeenCalledWith('/v1/sessions');
    expect(get).not.toHaveBeenCalledWith('/v1/mounts');
    finish({ status: 200, body: table });
    await refreshing;
    expect(review.state).toBe('ready');
    expect(get).toHaveBeenCalledWith('/v1/mounts');
    identity.revision++;
    get.mockImplementation(previous);
    await review.load();
    releases.forEach(resolve => resolve({ status: 200, body: [] }));
    await vi.waitFor(() => expect(review.sessions).toHaveLength(1));
    get.mockClear();
    identity.target = { server: 'http://other' } as typeof identity.target;
    await review.load();
    expect(get).toHaveBeenCalledWith('/v1/sessions');
    expect(get).toHaveBeenCalledWith('/v1/mounts');
  });
});

it('keeps an acquisition selected when a submitted-run link changes the session run', async () => {
  await review.open({ kind: 'session', id: session.id });
  review.select(review.rows[3], false);
  await review.open({ kind: 'session', id: session.id, run: 'run-newer' });
  expect(review.selectedKey).toBe('acq-4');
  expect(review.selected?.runId).toBe('run-newer');
});

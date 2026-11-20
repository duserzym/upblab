import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalise } from './review-data';
import { ApiReadError } from './server-error';
import type { ApiReply } from './platform';
import { reviewFixtures, table, rows, mountResults, session } from '../../tests/fixtures/review';
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'http://h' }, signedIn: true, revision: 0, get: vi.fn() } }));
vi.mock('./shell.svelte', () => ({ shell: { serverUrl: 'http://h', view: 'review', load: vi.fn(), show: vi.fn() } }));
vi.mock('./settings.svelte', () => ({ settings: { loaded: true, reviewScope: '', reviewSplit: false, update: vi.fn() } }));
vi.mock('./platform', () => ({ logWarn: vi.fn(async () => {}) }));
vi.mock('./incoming', () => ({ sendCommand: vi.fn(async () => true), moduleSurfaces: new Set<string>() }));
const { identity } = await import('./identity.svelte');
const { shell } = await import('./shell.svelte');
const { sendCommand, moduleSurfaces } = await import('./incoming');
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
  get.mockImplementation(async (path) => { const key = path.replace('?limit=500', ''); return { status: key in reviewFixtures ? 200 : 404, body: reviewFixtures[key] } as never; });
  vi.mocked(sendCommand).mockResolvedValue(true);
  moduleSurfaces.clear(); shell.view = 'review';
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
  it('opens in group view, preserves it for shell echoes, and leaves it for every explicit spot or grain focus', async () => {
    await review.open({ kind: 'session', id: session.id });
    expect(review.groupView).toBe(true);
    await review.fromImages(event('atlas-2', 'shell'));
    expect(review.groupView).toBe(true);
    await review.fromImages(event('atlas-2'));
    expect(review.groupView).toBe(false);
    review.groupView = true;
    review.select(review.rows[1]); // Re-picking the same spot also leaves group view.
    expect(review.groupView).toBe(false);
    review.groupView = true;
    await review.focus(review.rows[1], true); // Enter / Show in Images.
    expect(review.groupView).toBe(false);
    review.groupView = true;
    await review.focusGrain(review.rows);
    expect(review.groupView).toBe(false);
    await review.open({ kind: 'session', id: session.id });
    expect(review.groupView).toBe(true);
    review.select(review.rows[0], false);
    await review.refresh();
    expect(review.groupView).toBe(false);
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

  it('focuses the split Review viewer only, never showing or loading an Images tab', async () => {
    await review.open({ kind: 'session', id: session.id });
    settings.reviewSplit = true; moduleSurfaces.add('images');
    review.select(review.rows[1]);
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalled());
    expect(sendCommand).toHaveBeenCalledWith('images', { type: 'focus-spot', project: 'project-demo', spot: 'atlas-2', server: 'http://h', flash: true, via: 'review' });
    await review.focusGrain(review.rows);
    expect(sendCommand).toHaveBeenLastCalledWith('images', expect.objectContaining({ type: 'focus-grain', grain: 'area/1', server: 'http://h' }));
    vi.mocked(sendCommand).mockRejectedValueOnce(new Error('gone'));
    await review.focus(review.rows[0], true);
    expect(review.error).toContain('gone');
    expect(shell.show).not.toHaveBeenCalled();
    expect(shell.load).not.toHaveBeenCalled();
  });
  it('sends nothing without an open viewer, outside the split or outside Review', async () => {
    await review.open({ kind: 'session', id: session.id });
    vi.mocked(sendCommand).mockClear();
    settings.reviewSplit = true;
    await review.focus(review.rows[0], true);
    moduleSurfaces.add('images'); settings.reviewSplit = false;
    await review.focus(review.rows[0], true);
    settings.reviewSplit = true; shell.view = 'home';
    await review.focus(review.rows[0], true);
    expect(sendCommand).not.toHaveBeenCalled();
    expect(shell.show).not.toHaveBeenCalled();
    expect(shell.load).not.toHaveBeenCalled();
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
    expect(review.groupView).toBe(false);
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
    expect(review.error).toBe('Server returned 503: maintenance');
  });
  it('shows non-JSON and body-read diagnostics from identity', async () => {
    for (const error of [
      'Server returned 502: <html> Bad gateway </html>',
      'Reading the reply from lab.example/v1/results failed after 30.0 s: timed out (status 200, 919000 bytes expected)',
    ]) {
      get.mockRejectedValue(new Error(error));
      await review.load();
      expect(review.state).toBe('error');
      expect(review.error).toBe(error);
    }
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
    expect(get).not.toHaveBeenCalledWith('/v1/sessions?limit=500');
    expect(get).not.toHaveBeenCalledWith('/v1/mounts?limit=500');
    finish({ status: 200, body: reviewFixtures[path] });
    await pending;
    expect(get).toHaveBeenCalledWith('/v1/sessions?limit=500');
    expect(get).toHaveBeenCalledWith('/v1/mounts?limit=500');
  });

  it('starts picker lists after results fail without awaiting the lists', async () => {
    let fail!: (error: Error) => void;
    const previous = get.getMockImplementation()!;
    get.mockImplementation(path => path.includes('/results?run=')
      ? new Promise((_resolve, reject) => { fail = reject; })
      : path === '/v1/sessions?limit=500' || path === '/v1/mounts?limit=500' ? new Promise(() => {}) : previous(path));
    const pending = review.open({ kind: 'session', id: session.id });
    expect(get).not.toHaveBeenCalledWith('/v1/sessions?limit=500');
    expect(get).not.toHaveBeenCalledWith('/v1/mounts?limit=500');
    fail(new Error('offline'));
    await pending;
    expect(review.state).toBe('error');
    expect(get).toHaveBeenCalledWith('/v1/sessions?limit=500');
    expect(get).toHaveBeenCalledWith('/v1/mounts?limit=500');
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
    get.mockImplementation(path => path === '/v1/sessions?limit=500' || path === '/v1/mounts?limit=500'
      ? new Promise(resolve => pending.set(path, resolve)) : previous(path));
    await review.open({ kind: 'session', id: session.id });
    expect(review.state).toBe('ready');
    expect(review.rows).toHaveLength(12);
    expect(get.mock.calls[0][0]).toContain('/results?run=preferred');
    await review.open({ kind: 'mount', id: 'mount-demo' });
    expect(review.rows).toHaveLength(mountResults.spots.length);
    expect(get.mock.calls.filter(([path]) => path === '/v1/mounts?limit=500')).toHaveLength(1);
    pending.get('/v1/sessions?limit=500')!({ status: 200, body: [session] });
    pending.get('/v1/mounts?limit=500')!({ status: 200, body: [] });
    await vi.waitFor(() => expect(review.sessions).toHaveLength(1));
  });

  it('keeps rows, run, selection and depth visible and revalidates results, runs and one mount fraction list with fresh lists', async () => {
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
    expect(get.mock.calls.map(([path]) => path)).toEqual([`/v1/sessions/${session.id}/results?run=preferred`, `/v1/sessions/${session.id}/reductions`, `/v1/fractions?limit=500&mount=mount-demo`]);
  });

  it('keeps old rows on a failed refresh, which rejects, and logs a failed quiet load', async () => {
    await review.open({ kind: 'session', id: session.id });
    const oldRows = review.rows;
    get.mockResolvedValueOnce({ status: 503, body: { detail: 'maintenance' } } as never);
    await expect(review.refresh()).rejects.toThrow('maintenance');
    expect(review.state).toBe('ready');
    expect(review.rows).toBe(oldRows);
    expect(review.error).toBe('');
    vi.mocked(logWarn).mockClear();
    get.mockResolvedValueOnce({ status: 503, body: { detail: 'maintenance' } } as never);
    await review.load({ quiet: true });
    expect(review.rows).toBe(oldRows);
    expect(review.error).toBe('');
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('Could not refresh results'));
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
    expect(get.mock.calls.map(([path]) => path)).toEqual([`/v1/sessions/${session.id}/results?run=preferred`, `/v1/sessions/${session.id}/reductions`, `/v1/fractions?limit=500&mount=mount-demo`]);
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
    get.mockImplementation(path => path === '/v1/sessions?limit=500' || path === '/v1/mounts?limit=500'
      ? new Promise(resolve => releases.push(resolve)) : previous(path));
    let finish!: (reply: ApiReply<unknown>) => void;
    get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const refreshing = review.refresh();
    expect(get).not.toHaveBeenCalledWith('/v1/sessions?limit=500');
    expect(get).not.toHaveBeenCalledWith('/v1/mounts?limit=500');
    finish({ status: 200, body: table });
    await refreshing;
    expect(review.state).toBe('ready');
    expect(get).toHaveBeenCalledWith('/v1/mounts?limit=500');
    identity.revision++;
    get.mockImplementation(previous);
    await review.load();
    releases.forEach(resolve => resolve({ status: 200, body: [] }));
    await vi.waitFor(() => expect(review.sessions).toHaveLength(1));
    get.mockClear();
    identity.target = { server: 'http://other' } as typeof identity.target;
    await review.load();
    expect(get).toHaveBeenCalledWith('/v1/sessions?limit=500');
    expect(get).toHaveBeenCalledWith('/v1/mounts?limit=500');
  });
});

it('keeps an acquisition selected when a submitted-run link changes the session run', async () => {
  await review.open({ kind: 'session', id: session.id });
  review.select(review.rows[3], false);
  await review.open({ kind: 'session', id: session.id, run: 'run-newer' });
  expect(review.selectedKey).toBe('acq-4');
  expect(review.selected?.runId).toBe('run-newer');
});

import { timsReviewFixtures, timsFraction, timsBatch } from '../../tests/fixtures/review';
it('reads one fraction list per distinct mount and one detail per selected batch, with revalidation on reload', async () => {
  const previous = get.getMockImplementation()!;
  get.mockImplementation(async path => path in timsReviewFixtures ? { status: 200, body: timsReviewFixtures[path] } as never : previous(path));
  await review.open({ kind: 'session', id: session.id });
  await vi.waitFor(() => expect(review.batches[timsBatch.id]).toBeDefined());
  expect(get.mock.calls.filter(([p]) => p.startsWith('/v1/fractions?'))).toHaveLength(1);
  expect(get.mock.calls.filter(([p]) => p === `/v1/tims/batches/${timsBatch.id}`)).toHaveLength(1);
  review.select(review.rows[1], false); await review.loadSelectedBatches();
  expect(get.mock.calls.filter(([p]) => p === `/v1/tims/batches/${timsBatch.id}`)).toHaveLength(1);
  await review.loadFractions();
  expect(get.mock.calls.filter(([p]) => p.startsWith('/v1/fractions?'))).toHaveLength(2);
  expect(get.mock.calls.filter(([p]) => p === `/v1/tims/batches/${timsBatch.id}`)).toHaveLength(2);
  // Multiple rows on another mount still produce one list, never one read per spot.
  review.rows = [...review.rows, ...review.rows.slice(0, 3).map((r, i) => ({ ...r, key: `other-${i}`, mountId: 'other-mount' }))];
  get.mockClear(); await review.loadFractions();
  expect(get.mock.calls.filter(([p]) => p.startsWith('/v1/fractions?')).map(([p]) => p)).toEqual(['/v1/fractions?limit=500&mount=mount-demo', '/v1/fractions?limit=500&mount=other-mount']);
});
it('keeps results usable after a fraction read fails and discards stale scope replies', async () => {
  const previous = get.getMockImplementation()!;
  get.mockImplementation(path => path.startsWith('/v1/fractions?')
    ? Promise.resolve({ status: 503, body: { detail: 'Synthetic chemistry maintenance.' } } as never) : previous(path));
  await review.open({ kind: 'mount', id: 'mount-demo' }); await review.loadFractions();
  expect(review.state).toBe('ready'); expect(review.rows.length).toBeGreaterThan(0);
  expect(review.fractionError).toContain('503'); expect(review.fractionError).toContain('Synthetic chemistry maintenance.');
  let finish!: (reply: ApiReply<unknown>) => void;
  get.mockImplementation(path => path.startsWith('/v1/fractions?') ? new Promise(resolve => { finish = resolve; }) : previous(path));
  const pending = review.loadFractions(); review.clear();
  finish({ status: 200, body: [timsFraction] }); await pending; expect(review.fractions).toEqual([]);
});
it.each([404, 405])('treats fraction HTTP %i as no TIMS records in session and mount scopes, without logging', async status => {
  const previous = get.getMockImplementation()!;
  get.mockImplementation(async path => path in timsReviewFixtures ? { status: 200, body: timsReviewFixtures[path] } as never : previous(path));
  for (const scope of [{ kind: 'session' as const, id: session.id }, { kind: 'mount' as const, id: 'mount-demo' }]) {
    await review.open(scope); await review.loadFractions();
    expect(review.fractions.length).toBeGreaterThan(0);
    const supported = get.getMockImplementation()!;
    get.mockImplementation(path => path.startsWith('/v1/fractions?')
      ? Promise.resolve({ status, body: { detail: 'Synthetic older server.' } } as never) : supported(path));
    vi.mocked(logWarn).mockClear();
    await review.loadFractions();
    expect(review.state).toBe('ready'); expect(review.rows.length).toBeGreaterThan(0);
    expect(review.fractions).toEqual([]); expect(review.fractionNotice).toBe(''); expect(review.fractionError).toBe('');
    expect(logWarn).not.toHaveBeenCalled();
    get.mockImplementation(supported);
  }
});
it.each([401, 403, 500])('keeps a fraction HTTP %i diagnostic', async status => {
  const previous = get.getMockImplementation()!;
  get.mockImplementation(path => path.startsWith('/v1/fractions?')
    ? Promise.resolve({ status, body: { detail: 'Synthetic failure.' } } as never) : previous(path));
  await review.open({ kind: 'session', id: session.id }); await review.loadFractions();
  expect(review.state).toBe('ready'); expect(review.rows.length).toBeGreaterThan(0);
  expect(review.fractionError).toContain(String(status));
});
it.each([404, 405, 503])('handles non-JSON fraction HTTP %i by status', async status => {
  const previous = get.getMockImplementation()!;
  get.mockImplementation(path => path.startsWith('/v1/fractions?')
    ? Promise.reject(new ApiReadError(status, null, `Server returned ${status}: <html>Invented legacy reply</html>`)) : previous(path));
  await review.open({ kind: 'session', id: session.id });
  vi.mocked(logWarn).mockClear(); await review.loadFractions();
  expect(review.state).toBe('ready'); expect(review.fractions).toEqual([]);
  expect(review.fractionError).toBe(status === 503 ? 'Error: Server returned 503: <html>Invented legacy reply</html>' : '');
  expect(logWarn).not.toHaveBeenCalled();
});
it('publishes 5000 fractions progressively with ten cursor reads and no per-spot requests', async () => {
  review.scope = { kind: 'session', id: session.id, run: 'preferred' };
  review.rows = rows.map(row => normalise(row));
  const fractions = Array.from({ length: 5000 }, (_, i) => ({ ...timsFraction, id: `synthetic-${i}`, batch_id: null }));
  const progress: number[] = [];
  get.mockImplementation(async path => {
    const query = new URL(path, 'https://synthetic.example').searchParams;
    const page = Number(query.get('after') ?? 0);
    expect(path.startsWith('/v1/fractions?')).toBe(true);
    expect(query.get('limit')).toBe('500'); expect(query.get('mount')).toBe('mount-demo');
    progress.push(review.fractions.length);
    return { status: 200, body: fractions.slice(page * 500, (page + 1) * 500), nextCursor: page < 9 ? String(page + 1) : undefined } as never;
  });
  const started = performance.now();
  await review.loadFractions();
  const elapsed = performance.now() - started;
  expect(progress).toEqual(Array.from({ length: 10 }, (_, i) => i * 500));
  expect(review.fractions).toHaveLength(5000); expect(review.fractionError).toBe('');
  expect(get).toHaveBeenCalledTimes(10);
  console.info(`Review 5000 fractions: ${get.mock.calls.length} requests, ${elapsed.toFixed(2)} ms (mock network).`);
});
it('removes a cached batch when the server revokes permission', async () => {
  review.rows = rows.map(row => normalise(row)); review.selectedKey = review.rows[0].key;
  review.fractions = [timsFraction];
  get.mockResolvedValueOnce({ status: 200, body: timsBatch } as never); await review.loadSelectedBatches(); expect(review.batches[timsBatch.id]).toBeDefined();
  get.mockResolvedValueOnce({ status: 403, body: { code: 'forbidden', detail: 'Synthetic membership removed.' } } as never);
  await review.loadSelectedBatches(true); expect(review.batches[timsBatch.id]).toBeUndefined(); expect(review.batchErrors[timsBatch.id]).toContain('Synthetic membership removed.');
});
it('does no chemistry reads for unrelated saves, and revalidates only the needed layer', async () => {
  const previous = get.getMockImplementation()!;
  get.mockImplementation(async path => path in timsReviewFixtures ? { status: 200, body: timsReviewFixtures[path] } as never : previous(path));
  await review.open({ kind: 'session', id: session.id });
  await vi.waitFor(() => expect(review.batches[timsBatch.id]).toBeDefined());
  get.mockClear(); const before = performance.now();
  await review.loadFractions(); const beforeMs = performance.now() - before;
  expect(get).toHaveBeenCalledTimes(2);
  get.mockClear(); const start = performance.now();
  for (const key of ['batch:unrelated', 'fraction:unrelated', 'capsule_set:unrelated', 'recipe:unrelated', 'spike_version:unrelated']) await review.outboxSaved(key);
  expect(get).not.toHaveBeenCalled();
  const afterMs = performance.now() - start;
  await review.outboxSaved(`batch:${timsBatch.id}`);
  expect(get.mock.calls.map(([path]) => path)).toEqual([`/v1/tims/batches/${timsBatch.id}`]);
  get.mockClear(); await review.outboxSaved(`fraction:${timsFraction.id}`);
  expect(get.mock.calls.map(([path]) => path)).toEqual(['/v1/fractions?limit=500&mount=mount-demo', `/v1/tims/batches/${timsBatch.id}`]);
  console.info(`TIMS saved edits: unrelated save before 2 reads / ${beforeMs.toFixed(2)} ms, after 0 reads / ${afterMs.toFixed(2)} ms for 5 saves; batch save after 1 read; fraction save after 2 reads (mock network).`);
});
it('does not restore chemistry from a late batch reply after Review is cleared', async () => {
  review.rows = rows.map(row => normalise(row)); review.selectedKey = review.rows[0].key; review.fractions = [timsFraction];
  let finish!: (reply: ApiReply<unknown>) => void;
  get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = review.loadSelectedBatches(); review.clear();
  finish({ status: 200, body: timsBatch }); await pending;
  expect(review.batches).toEqual({}); expect(review.batchErrors).toEqual({});
});

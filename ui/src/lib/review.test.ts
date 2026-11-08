import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reviewFixtures, table, rows, mountResults, session } from '../../tests/fixtures/review';
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'http://h' }, signedIn: true, get: vi.fn() } }));
vi.mock('./shell.svelte', () => ({ shell: { serverUrl: 'http://h', view: 'review', load: vi.fn(), show: vi.fn() } }));
vi.mock('./settings.svelte', () => ({ settings: { loaded: true, reviewScope: '', reviewSplit: false, update: vi.fn() } }));
vi.mock('./incoming', () => ({ sendCommand: vi.fn(async () => true) }));
const { identity } = await import('./identity.svelte');
const { shell } = await import('./shell.svelte');
const { sendCommand } = await import('./incoming');
const { settings } = await import('./settings.svelte');
const { Review } = await import('./review.svelte');
const get = vi.mocked(identity.get);
let review: InstanceType<typeof Review>;
const event = (spot: string, via: 'user' | 'shell' = 'user') => ({ type: 'lab.spot.selected' as const, project: 'project-demo', spot, via });
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  settings.reviewSplit = false;
  review = new Review();
  get.mockImplementation(async (path) => ({ status: path in reviewFixtures ? 200 : 404, body: reviewFixtures[path] }) as never);
  vi.mocked(sendCommand).mockResolvedValue(true);
});
describe('Review selection and loading', () => {
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
    await review.fromImages(event('atlas-2'));
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

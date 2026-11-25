import { beforeEach, expect, it, vi } from 'vitest';
import type { RunOut, SessionRow } from './overview.svelte';
vi.mock('./platform', () => ({ isDesktop: true, launchGrainAtlas: vi.fn(async () => {}), studioStatus: vi.fn(async () => ({ found: true, path: '/invented/Studio.app', version: '0.1.2' })) }));
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'https://lab' }, handoff: vi.fn(async () => 'CODE') } }));
vi.mock('./shell.svelte', () => ({ shell: { view: 'review', studioConfig: { path: '', checkout: '' }, studio: { state: 'launched' }, show: vi.fn(async () => true), handleLink: vi.fn(async () => true), homeUrl: vi.fn(() => 'https://lab/atlas/?server=https%3A%2F%2Flab') } }));
vi.mock('./app-watch.svelte', () => ({ appWatch: { atlas: vi.fn(), session: vi.fn() } }));
vi.mock('./overview.svelte', () => ({ overview: { sessions: [] } }));
vi.mock('./review.svelte', () => ({ review: { runs: [], sessions: [], run: null, runInfo: {}, scope: null, rows: [] } }));
const { editInAtlas, openInStudio, openStudioAnyway, apps } = await import('./apps.svelte');
const platform = await import('./platform');
const { identity } = await import('./identity.svelte');
const { shell } = await import('./shell.svelte');
const { connectivity } = await import('./connectivity.svelte');
const { appWatch } = await import('./app-watch.svelte');
const { overview } = await import('./overview.svelte');
const { review } = await import('./review.svelte');
const target = { project: 'p', mount: 'm', spot: 's' };
const studioTarget = { session: 's', run: 'r', acquisition: 'a' };
const savedRun = (version = '0.1.3', id = 'r'): RunOut => ({ id, session_id: 's', upbrpy_version: version, is_preferred_for_session: true,
  pipeline_name: 'invented', pipeline_version: '9.0.0', status: 'completed', started_at: '2026-11-01T00:00:00Z', completed_at: null, run_by: null, result_count: 1 });
const sessionRow = (preferred: RunOut | null): SessionRow => ({ session: { id: 's', session_key: 'invented', material: 'zircon', started_at: null, acquisition_count: 1 }, runs: 1, preferred, latest: preferred });
beforeEach(() => {
  connectivity.reset(); vi.clearAllMocks(); apps.atlas = null; apps.studio = null;
  overview.sessions = []; review.runs = []; review.sessions = []; review.run = null; review.runInfo = {}; review.scope = null; review.rows = [];
  vi.mocked(platform.studioStatus).mockResolvedValue({ found: true, path: '/invented/Studio.app', version: '0.1.2' });
});
it('hands off context and watches a successful atlas opener', async () => {
  await editInAtlas(target, 'review');
  expect(platform.launchGrainAtlas).toHaveBeenCalledWith('p', 'https://lab', 'CODE', undefined, 's', undefined);
  expect(appWatch.atlas).toHaveBeenCalledWith('p', 'm');
  expect(apps.atlas?.state).toBe('launched');
  expect(shell.handleLink).not.toHaveBeenCalled();
});
it('passes the requested atlas revision alongside spot context', async () => {
  await editInAtlas({ ...target, revision: 41 }, 'images');
  expect(platform.launchGrainAtlas).toHaveBeenCalledWith('p', 'https://lab', 'CODE', 41, 's', undefined);
});
it('shows install guidance without navigating for a missing app', async () => {
  vi.mocked(platform.launchGrainAtlas).mockRejectedValueOnce(new Error('GrainAtlas is not installed (looked in /Applications and ~/Applications)'));
  await expect(editInAtlas(target, 'review')).resolves.toBeUndefined();
  expect(apps.atlas).toMatchObject({ state: 'missing', message: expect.stringContaining('/Applications') });
  expect(shell.handleLink).not.toHaveBeenCalled();
});
it('marks signed-out, failed handoff and launch errors as failed, with no tab fallback', async () => {
  for (const fail of ['signed-out', 'handoff', 'launch']) {
    if (fail === 'signed-out') vi.mocked(identity.handoff).mockResolvedValueOnce(null);
    if (fail === 'handoff') vi.mocked(identity.handoff).mockRejectedValueOnce(new Error('offline'));
    if (fail === 'launch') vi.mocked(platform.launchGrainAtlas).mockRejectedValueOnce(new Error('cannot launch'));
    await expect(editInAtlas(target, 'review')).resolves.toBeUndefined();
    expect(apps.atlas).toMatchObject({ state: 'failed', message: expect.any(String) });
  }
  expect(shell.handleLink).not.toHaveBeenCalled();
  expect(appWatch.atlas).not.toHaveBeenCalled();
});
it('fails without a project instead of opening the mount', async () => {
  await editInAtlas({ project: null, mount: 'm' }, 'home');
  expect(apps.atlas?.state).toBe('failed');
  expect(identity.handoff).not.toHaveBeenCalled();
  expect(platform.launchGrainAtlas).not.toHaveBeenCalled();
  expect(shell.handleLink).not.toHaveBeenCalled();
});
it('prefers run context, retains acquisition and always marks the sender', async () => {
  await openInStudio({ session: 's', run: 'r', acquisition: 'a' }, 'review');
  expect(shell.handleLink).toHaveBeenLastCalledWith('upbr://run/r?acquisition=a&via=upblab', 'review');
  expect(appWatch.session).toHaveBeenCalledWith('s');
  await openInStudio({ session: 's', run: null }, 'home');
  expect(shell.handleLink).toHaveBeenLastCalledWith('upbr://session/s?via=upblab', 'home');
  await openInStudio({ session: null, run: null }, 'review');
  expect(apps.studio?.state).toBe('failed');
});
it('warns for an older Studio before launching or starting a session watcher', async () => {
  review.runs = [savedRun()];
  await openInStudio(studioTarget, 'review');
  expect(platform.studioStatus).toHaveBeenCalledExactlyOnceWith(shell.studioConfig);
  expect(apps.studio).toMatchObject({ state: 'outdated', target: studioTarget,
    message: 'Saved by UPbRPy Studio 0.1.3; you have 0.1.2. Update Studio to open it.' });
  expect(shell.handleLink).not.toHaveBeenCalled();
  expect(identity.handoff).not.toHaveBeenCalled();
  expect(appWatch.session).not.toHaveBeenCalled();
  expect(shell.show).not.toHaveBeenCalled();
  await openStudioAnyway();
  expect(shell.handleLink).toHaveBeenCalledExactlyOnceWith('upbr://run/r?acquisition=a&via=upblab', 'review');
  expect(platform.studioStatus).toHaveBeenCalledTimes(1);
  expect(apps.studio?.state).toBe('launched');
  expect(appWatch.session).toHaveBeenCalledWith('s');
  await openStudioAnyway();
  expect(shell.handleLink).toHaveBeenCalledTimes(1);
});
it.each(['0.1.3', '0.1.10', 'v0.2.0', undefined, 'unknown', '0.1.2rc1'])('launches with equal, newer or unknown installed version %s', async version => {
  review.runs = [savedRun()];
  vi.mocked(platform.studioStatus).mockResolvedValueOnce({ found: true, path: null, version });
  await openInStudio(studioTarget, 'review');
  expect(shell.handleLink).toHaveBeenCalledExactlyOnceWith('upbr://run/r?acquisition=a&via=upblab', 'review');
  expect(apps.studio?.state).toBe('launched');
});
it.each(['', 'unknown', '0.1.3.dev1'])('launches with an unknown saved version %s', async version => {
  review.runs = [savedRun(version)];
  await openInStudio(studioTarget, 'review');
  expect(shell.handleLink).toHaveBeenCalledTimes(1);
});
it('skips the check without loaded run metadata and keeps missing/probe-failure handling in the launcher', async () => {
  await openInStudio(studioTarget, 'review');
  expect(platform.studioStatus).not.toHaveBeenCalled();
  review.runs = [savedRun()];
  vi.mocked(platform.studioStatus).mockResolvedValueOnce({ found: false, path: null });
  await openInStudio(studioTarget, 'review');
  vi.mocked(platform.studioStatus).mockRejectedValueOnce(new Error('probe failed'));
  await openInStudio(studioTarget, 'review');
  expect(shell.handleLink).toHaveBeenCalledTimes(3);
});
it('uses only the requested run, even when another loaded run is preferred', async () => {
  review.runs = [savedRun('0.1.10', 'preferred'), { ...savedRun('0.1.1'), is_preferred_for_session: false }];
  await openInStudio(studioTarget, 'review');
  expect(apps.studio?.state).toBe('launched');
  await openInStudio({ ...studioTarget, run: 'not-loaded' }, 'review');
  expect(shell.handleLink).toHaveBeenCalledTimes(2);
  expect(platform.studioStatus).toHaveBeenCalledTimes(1);
});
it('checks a session preferred run already loaded in Review without navigating from Home', async () => {
  review.runs = [savedRun()];
  await openInStudio({ session: 's', run: null }, 'home');
  expect(apps.studio?.state).toBe('outdated');
  expect(shell.show).not.toHaveBeenCalled();
  expect(shell.handleLink).not.toHaveBeenCalled();
  await openStudioAnyway();
  expect(shell.handleLink).toHaveBeenCalledExactlyOnceWith('upbr://session/s?via=upblab', 'home');
});
it('checks loaded overview summaries, including a preferred run embedded in the session list', async () => {
  overview.sessions = [sessionRow(savedRun())];
  await openInStudio(studioTarget, 'review');
  expect(apps.studio?.state).toBe('outdated');
  overview.sessions = [{ ...sessionRow(null), session: { ...sessionRow(null).session, preferred_run: savedRun() } }];
  await openInStudio({ session: 's', run: null }, 'reduce');
  expect(apps.studio?.state).toBe('outdated');
  expect(shell.handleLink).not.toHaveBeenCalled();
});
it('does not substitute the latest run for a session with no loaded preferred run', async () => {
  overview.sessions = [{ ...sessionRow(null), latest: { ...savedRun(), is_preferred_for_session: false } }];
  await openInStudio({ session: 's', run: null }, 'home');
  expect(shell.handleLink).toHaveBeenCalledTimes(1);
  expect(platform.studioStatus).not.toHaveBeenCalled();
});
it('uses a loaded Review result brief without mistaking its pipeline version for Studio', async () => {
  review.runInfo = { r: { run_id: 'r', is_preferred: true, upbrpy_version: '0.1.3', pipeline_version: '9.0.0' } };
  await openInStudio(studioTarget, 'review');
  expect(apps.studio?.state).toBe('outdated');
  review.runInfo = { r: { run_id: 'r', is_preferred: true, pipeline_version: '9.0.0' } };
  await openInStudio(studioTarget, 'review');
  expect(apps.studio?.state).toBe('launched');
});
it('checks a session preferred result brief when its run list is unavailable', async () => {
  review.scope = { kind: 'session', id: 's', run: 'preferred' };
  review.run = { run_id: 'r', is_preferred: true, upbrpy_version: '0.1.3' };
  await openInStudio({ session: 's', run: null }, 'review');
  expect(apps.studio?.state).toBe('outdated');
  expect(shell.handleLink).not.toHaveBeenCalled();
});
it('ignores a late version probe after a newer launch request', async () => {
  review.runs = [savedRun()];
  let resolve!: (status: Awaited<ReturnType<typeof platform.studioStatus>>) => void;
  vi.mocked(platform.studioStatus).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const pending = openInStudio(studioTarget, 'review');
  await openInStudio({ session: 'other', run: null }, 'review');
  resolve({ found: true, path: null, version: '0.1.2' });
  await pending;
  expect(apps.studio).toMatchObject({ state: 'launched', target: { session: 'other' } });
  expect(shell.handleLink).toHaveBeenCalledTimes(1);
});
it('opens GrainAtlas locally without minting a handoff for a read-only copy, and leaves Studio available', async () => {
  connectivity.offlineCopy = 'invented copy';
  await editInAtlas(target, 'review');
  expect(identity.handoff).not.toHaveBeenCalled();
  expect(platform.launchGrainAtlas).toHaveBeenCalledWith('p', undefined, undefined, undefined, 's', undefined);
  expect(apps.atlas?.state).toBe('launched');
  expect(connectivity.grainAtlasLocal).toBe('review');
  expect(appWatch.atlas).not.toHaveBeenCalled();
  await openInStudio({ session: 's', run: null }, 'review');
  expect(shell.handleLink).toHaveBeenCalledWith('upbr://session/s?via=upblab', 'review');
});
it('shows no local notice while a copy launch is pending or after it fails', async () => {
  connectivity.offlineCopy = 'invented copy';
  let fail!: (reason: Error) => void;
  vi.mocked(platform.launchGrainAtlas).mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
  const pending = editInAtlas(target, 'review');
  expect(connectivity.grainAtlasLocal).toBeNull();
  fail(new Error('GrainAtlas is not installed'));
  await pending;
  expect(apps.atlas?.state).toBe('missing');
  expect(connectivity.grainAtlasLocal).toBeNull();
});
it('opens the hosted build in a new window on web without minting a code', async () => {
  vi.resetModules();
  vi.doMock('./platform', () => ({ isDesktop: false, launchGrainAtlas: vi.fn() }));
  const open = vi.fn();
  vi.stubGlobal('window', { open });
  vi.stubGlobal('location', { href: 'https://lab/desk/' });
  try {
    const web = await import('./apps.svelte');
    await web.editInAtlas(target, 'review');
    expect(identity.handoff).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledExactlyOnceWith('https://lab/atlas/?server=https%3A%2F%2Flab&project=p&spot=s', '_blank', 'noopener');
    expect(shell.handleLink).not.toHaveBeenCalled();
    expect(appWatch.atlas).toHaveBeenCalledWith('p', 'm');
    expect(web.apps.atlas?.state).toBe('fallback');
    const { connectivity: webConnectivity } = await import('./connectivity.svelte');
    webConnectivity.offlineCopy = 'invented copy';
    await web.editInAtlas(target, 'review');
    expect(open).toHaveBeenLastCalledWith('https://lab/atlas/?project=p&spot=s', '_blank', 'noopener');
    expect(webConnectivity.grainAtlasLocal).toBeNull();
  } finally { vi.unstubAllGlobals(); vi.doUnmock('./platform'); }
});
it('lets TIMS own its bounded revision watcher instead of adding a second project poll', async () => {
  await editInAtlas({ project: 'synthetic-project', mount: 'synthetic-mount', grain: 'synthetic-grain' }, 'tims');
  expect(platform.launchGrainAtlas).toHaveBeenCalledExactlyOnceWith('synthetic-project', 'https://lab', 'CODE', undefined, undefined, 'synthetic-grain');
  expect(appWatch.atlas).not.toHaveBeenCalled();
});

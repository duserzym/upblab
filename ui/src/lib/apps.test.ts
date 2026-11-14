import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./platform', () => ({ isDesktop: true, launchGrainAtlas: vi.fn(async () => {}) }));
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'https://lab' }, handoff: vi.fn(async () => 'CODE') } }));
vi.mock('./shell.svelte', () => ({ shell: { studio: { state: 'launched' }, handleLink: vi.fn(async () => true), homeUrl: vi.fn(() => 'https://lab/atlas/?server=https%3A%2F%2Flab') } }));
vi.mock('./app-watch.svelte', () => ({ appWatch: { atlas: vi.fn(), session: vi.fn() } }));
const { editInAtlas, openInStudio, apps } = await import('./apps.svelte');
const platform = await import('./platform');
const { identity } = await import('./identity.svelte');
const { shell } = await import('./shell.svelte');
const { appWatch } = await import('./app-watch.svelte');
const target = { project: 'p', mount: 'm', spot: 's' };
beforeEach(() => { vi.clearAllMocks(); apps.atlas = null; apps.studio = null; });
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
  } finally { vi.unstubAllGlobals(); vi.doUnmock('./platform'); }
});

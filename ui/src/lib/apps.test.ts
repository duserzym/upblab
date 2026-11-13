import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./platform', () => ({ isDesktop: true, launchGrainAtlas: vi.fn(async () => {}) }));
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'https://lab' }, handoff: vi.fn(async () => 'CODE') } }));
vi.mock('./shell.svelte', () => ({ shell: { studio: { state: 'launched' }, handleLink: vi.fn(async () => true) } }));
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
it('shows install guidance without navigating for a missing app', async () => {
  vi.mocked(platform.launchGrainAtlas).mockRejectedValueOnce(new Error('GrainAtlas is not installed (looked in /Applications and ~/Applications)'));
  await expect(editInAtlas(target, 'review')).resolves.toBeUndefined();
  expect(apps.atlas).toMatchObject({ state: 'missing', message: expect.stringContaining('/Applications') });
  expect(shell.handleLink).not.toHaveBeenCalled();
});
it('falls back for signed-out, failed handoff and launch errors', async () => {
  for (const fail of ['signed-out', 'handoff', 'launch']) {
    if (fail === 'signed-out') vi.mocked(identity.handoff).mockResolvedValueOnce(null);
    if (fail === 'handoff') vi.mocked(identity.handoff).mockRejectedValueOnce(new Error('offline'));
    if (fail === 'launch') vi.mocked(platform.launchGrainAtlas).mockRejectedValueOnce(new Error('cannot launch'));
    await editInAtlas(target, 'review');
    expect(apps.atlas?.state).toBe('fallback');
    expect(shell.handleLink).toHaveBeenLastCalledWith('grainatlas://project/p/spot/s', 'review');
  }
});
it('uses project and mount fallbacks and never throws when routing fails', async () => {
  vi.mocked(identity.handoff).mockResolvedValueOnce(null);
  await editInAtlas({ project: 'p', mount: 'm' }, 'home');
  expect(shell.handleLink).toHaveBeenLastCalledWith('grainatlas://project/p', 'home');
  await editInAtlas({ project: null, mount: 'm' }, 'home');
  expect(shell.handleLink).toHaveBeenLastCalledWith('laicpmsdb://mount/m', 'home');
  vi.mocked(shell.handleLink).mockRejectedValueOnce(new Error('offline'));
  await expect(editInAtlas({ project: null, mount: 'm' }, 'home')).resolves.toBeUndefined();
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
it('uses the same fallback on web delivery without minting a code', async () => {
  vi.resetModules();
  vi.doMock('./platform', () => ({ isDesktop: false, launchGrainAtlas: vi.fn() }));
  const web = await import('./apps.svelte');
  await web.editInAtlas(target, 'review');
  expect(identity.handoff).not.toHaveBeenCalled();
  expect(shell.handleLink).toHaveBeenCalledWith('grainatlas://project/p/spot/s', 'review');
  expect(web.apps.atlas?.state).toBe('fallback');
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./identity.svelte', () => ({ identity: { target: { server: 'https://lab' }, revision: 0, signedIn: true, get: vi.fn() } }));
vi.mock('./atlas-refresh', () => ({ refreshAtlasProject: vi.fn(async () => {}) }));
vi.mock('./overview.svelte', () => ({ overview: { mounts: [], refreshSession: vi.fn(async () => {}) } }));
vi.mock('./review.svelte', () => ({ review: { scope: null, rows: [], load: vi.fn(async () => {}) } }));
vi.mock('./platform', () => ({ takeInbox: vi.fn(async () => []), logWarn: vi.fn(async () => {}) }));
const { appWatch, POLL_MS, INBOX_MS } = await import('./app-watch.svelte');
const { identity } = await import('./identity.svelte');
const { refreshAtlasProject } = await import('./atlas-refresh');
const { overview } = await import('./overview.svelte');
const { review } = await import('./review.svelte');
const { takeInbox, logWarn } = await import('./platform');
const strict = { strict: true };
async function settle() { await vi.advanceTimersByTimeAsync(0); }
function hide(hidden: boolean) {
  Object.assign(document, { visibilityState: hidden ? 'hidden' : 'visible' });
  appWatch.visibilityChanged();
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(0); vi.clearAllMocks(); appWatch.clear();
  vi.stubGlobal('document', { visibilityState: 'visible' });
  identity.revision++; (identity as { signedIn: boolean }).signedIn = true;
  review.scope = null; review.rows = []; overview.mounts = [];
  vi.mocked(refreshAtlasProject).mockResolvedValue(undefined);
  vi.mocked(takeInbox).mockResolvedValue([]);
  vi.mocked(identity.get).mockResolvedValue({ status: 200, body: [] });
});
afterEach(() => { appWatch.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('checks every 60 s while visible and pauses while hidden', async () => {
  expect(POLL_MS).toBe(60_000);
  appWatch.atlas('p', 'm'); await settle();
  expect(refreshAtlasProject).toHaveBeenCalledExactlyOnceWith('p', 'm');
  await vi.advanceTimersByTimeAsync(POLL_MS - 1);
  expect(refreshAtlasProject).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(refreshAtlasProject).toHaveBeenCalledTimes(2);
  hide(true);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(3 * POLL_MS);
  expect(refreshAtlasProject).toHaveBeenCalledTimes(2);
  hide(false); await settle();
  expect(refreshAtlasProject).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(POLL_MS);
  expect(refreshAtlasProject).toHaveBeenCalledTimes(4);
});
it('allows at most one in-flight request per watched object and backs errors off ten minutes', async () => {
  let finish!: (error: Error) => void;
  vi.mocked(refreshAtlasProject).mockImplementationOnce(() => new Promise((_, reject) => { finish = reject; }));
  appWatch.atlas('p', 'm'); await settle();
  await vi.advanceTimersByTimeAsync(POLL_MS);
  expect(refreshAtlasProject).toHaveBeenCalledTimes(1);
  finish(new Error('offline')); await settle();
  await vi.advanceTimersByTimeAsync(8 * POLL_MS);
  expect(refreshAtlasProject).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(POLL_MS);
  expect(refreshAtlasProject).toHaveBeenCalledTimes(2);
});
it('retries a failed refresh after its back-off, as the version was not recorded', async () => {
  vi.mocked(refreshAtlasProject).mockRejectedValueOnce(new Error('offline'));
  appWatch.atlas('p', 'm'); await settle();
  await vi.advanceTimersByTimeAsync(10 * POLL_MS);
  expect(refreshAtlasProject).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(POLL_MS);
  expect(refreshAtlasProject).toHaveBeenCalledTimes(3);
});
it('discovers new session run ids, refreshes matching Review and keeps unrelated scopes alone', async () => {
  review.scope = { kind: 'session', id: 's', run: 'preferred' };
  appWatch.session('s'); await settle();
  vi.clearAllMocks();
  await appWatch.check();
  expect(overview.refreshSession).not.toHaveBeenCalled();
  vi.mocked(identity.get).mockResolvedValue({ status: 200, body: [{ id: 'r1' }] });
  await appWatch.check();
  expect(overview.refreshSession).toHaveBeenCalledWith('s', strict);
  expect(review.load).toHaveBeenCalledWith({ quiet: true, strict: true });
  vi.clearAllMocks();
  review.scope = { kind: 'mount', id: 'm' };
  review.rows = [{ sessionId: 's' }] as typeof review.rows;
  vi.mocked(identity.get).mockResolvedValue({ status: 200, body: [{ id: 'r1' }, { id: 'r2' }] });
  await appWatch.check();
  expect(review.load).toHaveBeenCalledTimes(1);
  vi.clearAllMocks(); review.rows = [];
  vi.mocked(identity.get).mockResolvedValue({ status: 200, body: [{ id: 'r3' }] });
  await appWatch.check();
  expect(overview.refreshSession).toHaveBeenCalledTimes(1);
  expect(review.load).not.toHaveBeenCalled();
});
it('keeps the old run ids when a session refresh fails, so it refreshes again', async () => {
  appWatch.session('s'); await settle();
  vi.mocked(identity.get).mockResolvedValue({ status: 200, body: [{ id: 'r1' }] });
  vi.mocked(overview.refreshSession).mockRejectedValueOnce(new Error('offline'));
  await appWatch.check();
  vi.mocked(overview.refreshSession).mockClear();
  await appWatch.check(600_000);
  expect(overview.refreshSession).toHaveBeenCalledOnce();
});
it('expires opener watches two hours after the last opener', async () => {
  appWatch.session('s'); await settle();
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  appWatch.session('s');
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(appWatch.size).toBe(1);
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(appWatch.size).toBe(0);
});
it('watches the Review scope without an opener: its session and mount projects', async () => {
  review.scope = { kind: 'session', id: 's', run: 'preferred' };
  review.rows = [{ sessionId: 's', mountId: 'm', atlasProjectId: 'p' }] as typeof review.rows;
  appWatch.start(); await settle();
  expect(identity.get).toHaveBeenCalledWith('/v1/sessions/s/reductions');
  expect(refreshAtlasProject).toHaveBeenCalledExactlyOnceWith('p', 'm');
  vi.clearAllMocks();
  review.scope = { kind: 'mount', id: 'm2' }; review.rows = [];
  overview.mounts = [{ mount: { id: 'm2' }, atlas: { projectId: 'p2' } }] as typeof overview.mounts;
  await vi.advanceTimersByTimeAsync(5 * 60 * 60_000);
  expect(refreshAtlasProject).toHaveBeenCalledWith('p2', 'm2');
  expect(appWatch.size).toBe(1);
});
it('reads the inbox every 5 s while visible and logs a failed read', async () => {
  expect(INBOX_MS).toBe(5_000);
  appWatch.start(); await settle();
  expect(takeInbox).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(INBOX_MS);
  expect(takeInbox).toHaveBeenCalledTimes(2);
  vi.mocked(takeInbox).mockRejectedValueOnce(new Error('denied'));
  await vi.advanceTimersByTimeAsync(INBOX_MS);
  expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('denied'));
  hide(true);
  await vi.advanceTimersByTimeAsync(4 * INBOX_MS);
  expect(takeInbox).toHaveBeenCalledTimes(3);
});
it('checks a notice for the same server now and ignores notices for another server', async () => {
  appWatch.start(); await settle();
  vi.mocked(takeInbox).mockResolvedValueOnce([
    { type: 'lab.atlas.synced', mount: 'm', project: 'p', server: 'https://other' },
    { type: 'lab.run.submitted', session: 's2', run: null, server: 'https://other' },
  ]);
  await vi.advanceTimersByTimeAsync(INBOX_MS);
  expect(refreshAtlasProject).not.toHaveBeenCalled();
  expect(identity.get).not.toHaveBeenCalled();
  expect(appWatch.size).toBe(0);
  vi.mocked(takeInbox).mockResolvedValueOnce([
    { type: 'lab.atlas.synced', mount: 'm', project: 'p', server: 'https://lab/' },
    { type: 'lab.run.submitted', session: 's2', run: 'r1', server: 'https://lab' },
  ]);
  await vi.advanceTimersByTimeAsync(INBOX_MS);
  expect(refreshAtlasProject).toHaveBeenCalledExactlyOnceWith('p', 'm');
  expect(identity.get).toHaveBeenCalledExactlyOnceWith('/v1/sessions/s2/reductions');
});
it('a notice clears the back-off of its item', async () => {
  vi.mocked(refreshAtlasProject).mockRejectedValueOnce(new Error('offline'));
  appWatch.atlas('p', 'm'); await settle();
  await vi.advanceTimersByTimeAsync(POLL_MS);
  expect(refreshAtlasProject).toHaveBeenCalledTimes(1);
  appWatch.notice([{ type: 'lab.atlas.synced', mount: 'm', project: 'p', server: 'https://lab' }]); await settle();
  expect(refreshAtlasProject).toHaveBeenCalledTimes(2);
});
it('clears watches and ignores old replies on identity source changes', async () => {
  let finish!: (value: { status: number; body: unknown }) => void;
  vi.mocked(identity.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  appWatch.session('s');
  identity.revision++; appWatch.syncSource();
  finish({ status: 200, body: [{ id: 'r1' }] }); await settle();
  expect(appWatch.size).toBe(0);
  expect(overview.refreshSession).not.toHaveBeenCalled();
});

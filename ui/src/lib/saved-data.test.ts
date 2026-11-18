import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ prefetch: vi.fn(), identity: { target: { server: 'https://invented.invalid', key: 'invented' }, signedIn: true, account: { id: 'one' } } }));
vi.mock('./platform', () => ({ isDesktop: true, savedReads: { prefetch: mocked.prefetch }, logInfo: vi.fn() }));
vi.mock('./identity.svelte', () => ({ identity: mocked.identity }));
vi.mock('./settings.svelte', () => ({ settings: { reviewScope: '' } }));
const { SavedData } = await import('./saved-data.svelte');
let saved: InstanceType<typeof SavedData>;
beforeEach(() => { vi.useFakeTimers(); mocked.prefetch.mockReset().mockResolvedValue({ fetched: 2, unchanged: 0, failed: 0 }); mocked.identity.account.id = 'one'; saved = new SavedData(); });
afterEach(() => { saved.cancel(); vi.useRealTimers(); });
it('defers work 3 seconds and throttles each account for 10 minutes', async () => {
  saved.schedule([], []); await vi.advanceTimersByTimeAsync(2999); expect(mocked.prefetch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(mocked.prefetch).toHaveBeenCalledTimes(1);
  saved.schedule([], []); await vi.advanceTimersByTimeAsync(30_000); expect(mocked.prefetch).toHaveBeenCalledTimes(1);
  mocked.identity.account.id = 'two'; saved.schedule([], []); await vi.advanceTimersByTimeAsync(3000); expect(mocked.prefetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(600_000); saved.schedule([], []); await vi.advanceTimersByTimeAsync(3000); expect(mocked.prefetch).toHaveBeenCalledTimes(3);
});
it('cancels pending work when the source changes and coalesces manual saves', async () => {
  saved.schedule([], []); mocked.identity.account.id = 'two'; await vi.advanceTimersByTimeAsync(3000); expect(mocked.prefetch).not.toHaveBeenCalled();
  await Promise.all([saved.save([], []), saved.save([], [])]); expect(mocked.prefetch).toHaveBeenCalledTimes(1);
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connectivity } from './connectivity.svelte';
const cached = (asOf: string, reason: 'unreachable' | 'server_error' = 'unreachable') => ({ status: 200, body: [], cached: { asOf, reason, detail: reason === 'server_error' ? 'Server returned 503' : 'connection failed' } });
let state: Connectivity;
beforeEach(() => { vi.useFakeTimers(); state = new Connectivity(); });
afterEach(() => { state.stop(); vi.useRealTimers(); });
describe('connectivity', () => {
  it('keeps the oldest saved timestamp, distinguishes server errors, and resets on a live reply', () => {
    expect(state.state).toBe('unknown');
    state.report(cached('2026-11-17T22:00:00Z'));
    state.report(cached('2026-11-17T21:49:00Z', 'server_error'));
    state.unavailable('another detail was never saved');
    expect(state.detail).toContain('503');
    expect(state.state).toBe('server-error'); expect(state.asOf).toBe('2026-11-17T21:49:00Z');
    state.report(cached('2026-11-17T22:10:00Z')); expect(state.asOf).toBe('2026-11-17T21:49:00Z');
    state.report({ status: 404, body: {} }); expect(state.state).toBe('online'); expect(state.asOf).toBeNull();
  });
  it('backs off 10, 30, 60, then 120 seconds, pauses hidden windows, and recovers once', async () => {
    const read = vi.fn().mockRejectedValue(new Error('network failed')), recovered = vi.fn();
    let visible = true;
    state.start(read, recovered, () => visible); state.unavailable('network failed');
    for (const seconds of [10,30,60,120,120]) {
      expect(state.retryIn).toBe(seconds);
      await vi.advanceTimersByTimeAsync(seconds * 1000);
    }
    expect(read).toHaveBeenCalledTimes(5);
    visible = false; await vi.advanceTimersByTimeAsync(240_000); expect(read).toHaveBeenCalledTimes(5);
    visible = true; read.mockResolvedValue({ status: 200, body: {} });
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.state).toBe('online'); expect(recovered).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(240_000); expect(read).toHaveBeenCalledTimes(6);
  });
  it('Retry now ignores duplicate requests and reset ignores stale results', async () => {
    let finish!: (value: unknown) => void;
    const read = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    state.start(read as never, vi.fn(), () => true); state.unavailable();
    const pending = state.retryNow(); await state.retryNow(); expect(read).toHaveBeenCalledTimes(1);
    state.reset(); finish(cached('2026-11-17T00:00:00Z')); await pending;
    expect(state.state).toBe('unknown'); expect(state.retrying).toBe(false);
  });
});

it('tracks copy marking through cached fallback and clears it on a live server or target reset', () => {
  const offlineCopy = 'offline copy as of 2026-11-17 21:49 UTC, read-only';
  state.report({ status: 200, body: [], offlineCopy });
  expect(state.offlineCopy).toBe(offlineCopy); expect(state.state).toBe('online');
  state.unavailable('copy stopped');
  expect(state.offlineCopy).toBe(offlineCopy);
  state.report({ ...cached('2026-11-17T21:49:00Z'), offlineCopy });
  expect(state.state).toBe('offline'); expect(state.offlineCopy).toBe(offlineCopy);
  state.report({ status: 200, body: [] }); expect(state.offlineCopy).toBeNull();
  state.report({ status: 403, body: { code: 'offline_read_only' }, offlineCopy });
  expect(state.offlineCopy).toBe(offlineCopy);
  state.grainAtlasLocal = 'review'; state.reset();
  expect(state.offlineCopy).toBeNull(); expect(state.grainAtlasLocal).toBeNull();
});

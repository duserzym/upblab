import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { UpdateInfo } from './updates';
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), listen: vi.fn(), off: vi.fn(),
  settings: { updateChannel: 'stable', updateAuto: true, updateLastCheck: 0, update: vi.fn() },
}));
vi.mock('./platform', () => ({ isDesktop: true }));
vi.mock('./settings.svelte', () => ({ settings: mocks.settings }));
vi.mock('./versions', () => ({ shellVersion: async () => '0.1.0' }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
const info: UpdateInfo = { version: '0.2.0', currentVersion: '0.1.0', notes: null, date: null, ready: false };
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  mocks.settings.updateChannel = 'stable';
  mocks.settings.updateAuto = true;
  mocks.settings.updateLastCheck = 0;
  mocks.settings.update.mockImplementation(async (patch) => { Object.assign(mocks.settings, patch); });
  mocks.listen.mockResolvedValue(mocks.off);
  mocks.invoke.mockImplementation(async (command) => {
    if (command === 'update_supported') return true;
    if (command === 'update_check') return info;
    if (command === 'update_download') return { ...info, ready: true };
    return null;
  });
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
it('downloads automatically, releases the progress listener and rechecks ready only on request', async () => {
  const runtime = await import('./updater.svelte');
  await runtime.check();
  expect(runtime.updater.status.kind).toBe('ready');
  expect(mocks.off).toHaveBeenCalledOnce();
  await runtime.check();
  expect(mocks.invoke.mock.calls.filter(([name]) => name === 'update_check')).toHaveLength(1);
  mocks.invoke.mockImplementation(async (command) => command === 'update_supported' ? true : { ...info, ready: true });
  await runtime.check(true);
  expect(mocks.invoke.mock.calls.filter(([name]) => name === 'update_check')).toHaveLength(2);
  expect(runtime.updater.status.kind).toBe('ready');
});
it('retains the available state when automatic downloads are disabled', async () => {
  mocks.settings.updateAuto = false;
  const runtime = await import('./updater.svelte');
  await runtime.check(true);
  expect(runtime.updater.status).toEqual({ kind: 'available', info });
  expect(mocks.invoke).not.toHaveBeenCalledWith('update_download', undefined);
});
it('formats an unconfigured key error and records the check time', async () => {
  mocks.invoke.mockRejectedValue(new Error('Updater public key is not configured'));
  const runtime = await import('./updater.svelte');
  await runtime.check(true);
  expect(runtime.updater.status).toEqual({ kind: 'error', message: 'Updates are not configured for this build yet' });
  expect(mocks.settings.updateLastCheck).toBeGreaterThan(0);
});
it('shows manual up-to-date feedback for five seconds', async () => {
  mocks.invoke.mockImplementation(async (command) => command === 'update_supported' ? true : null);
  const runtime = await import('./updater.svelte');
  await runtime.check(true);
  expect(runtime.updater.justChecked).toBe(true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(runtime.updater.justChecked).toBe(false);
});
it('can check unsupported installs but never downloads them', async () => {
  mocks.invoke.mockImplementation(async (command) => command === 'update_supported' ? false : info);
  const runtime = await import('./updater.svelte');
  await runtime.check(true);
  expect(runtime.updater.status).toMatchObject({ kind: 'unsupported', info });
  await runtime.download();
  expect(mocks.invoke).not.toHaveBeenCalledWith('update_download', undefined);
});
it('cleans the listener up on download failure', async () => {
  mocks.invoke.mockImplementation(async (command) => {
    if (command === 'update_download') throw new Error('Signature verification failed');
    return command === 'update_supported' ? true : info;
  });
  const runtime = await import('./updater.svelte');
  await runtime.check();
  expect(runtime.updater.status).toMatchObject({ kind: 'error', message: 'Error: Signature verification failed' });
  expect(mocks.off).toHaveBeenCalledOnce();
});
it('schedules after eight seconds and every six hours, and stops on cleanup', async () => {
  const runtime = await import('./updater.svelte');
  const stop = runtime.startScheduler();
  await vi.advanceTimersByTimeAsync(7999);
  expect(mocks.invoke).not.toHaveBeenCalledWith('update_check', expect.anything());
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.invoke.mock.calls.filter(([name]) => name === 'update_check')).toHaveLength(1);
  // Ready background checks are suppressed, so use a fresh idle state for the periodic tick.
  runtime.updater.status = { kind: 'idle' };
  await vi.advanceTimersByTimeAsync(6 * 3600_000 - 8000);
  expect(mocks.invoke.mock.calls.filter(([name]) => name === 'update_check')).toHaveLength(2);
  stop();
  runtime.updater.status = { kind: 'idle' };
  await vi.advanceTimersByTimeAsync(6 * 3600_000);
  expect(mocks.invoke.mock.calls.filter(([name]) => name === 'update_check')).toHaveLength(2);
});
it('checks standards in the background when the app updater is unsupported', async () => {
  const standards = { warning: true, changed: ['rutile/check.toml'], message: 'Standards differ.' };
  mocks.invoke.mockImplementation(async (command) => command === 'standards_check' ? standards : false);
  const runtime = await import('./updater.svelte');
  const stop = runtime.startScheduler();
  try {
    await vi.advanceTimersByTimeAsync(8000);
    expect(runtime.updater.standards).toEqual(standards);
    expect(mocks.invoke).not.toHaveBeenCalledWith('update_check', expect.anything());
  } finally {
    stop();
  }
});

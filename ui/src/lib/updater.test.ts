import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { STABLE_ENDPOINT } from './updates';
import type { UpdateInfo } from './updates';
const mocks = vi.hoisted(() => ({
  desktop: true,
  invoke: vi.fn(), listen: vi.fn(), off: vi.fn(),
  settings: { lastSeenVersion: '', savedUpdateVersion: '', savedUpdateNotes: '', updateAuto: true, updateLastCheck: 0, update: vi.fn() },
}));
vi.mock('./platform', () => ({ get isDesktop() { return mocks.desktop; } }));
vi.mock('./settings.svelte', () => ({ settings: mocks.settings }));
vi.mock('./versions', () => ({ shellVersion: async () => '0.1.0' }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
const info: UpdateInfo = { version: '0.2.0', currentVersion: '0.1.0', notes: null, date: null, ready: false };
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  mocks.desktop = true;
  mocks.settings.lastSeenVersion = '';
  mocks.settings.savedUpdateVersion = '';
  mocks.settings.savedUpdateNotes = '';
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
it('preserves the diagnostic, records friendly feedback and the check time', async () => {
  mocks.invoke.mockRejectedValue(new Error('Updater public key is not configured'));
  const runtime = await import('./updater.svelte');
  await runtime.check(true);
  expect(runtime.updater.status).toEqual({ kind: 'error', message: 'Error: Updater public key is not configured' });
  expect(runtime.updater.lastResult).toBe('Updates are not configured for this build yet.');
  expect(mocks.settings.updateLastCheck).toBeGreaterThan(0);
});
it.each(['idle', 'none', 'available', 'downloading', 'ready', 'error', 'unsupported'])(
  'a manual preview check restores the %s scenario after 600 ms', async (scenario) => {
    mocks.desktop = false;
    vi.stubGlobal('location', { search: `?update-preview=${scenario}` });
    const runtime = await import('./updater.svelte');
    const initial = runtime.updater.status;
    const pending = runtime.check(true);
    if (scenario === 'downloading') {
      await pending;
      expect(runtime.updater.status).toEqual(initial);
    } else {
      expect(runtime.updater.status.kind).toBe('checking');
      await vi.advanceTimersByTimeAsync(599);
      expect(runtime.updater.status.kind).toBe('checking');
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(runtime.updater.status.kind).toBe(scenario === 'idle' ? 'none' : scenario);
    }
    expect(mocks.invoke).not.toHaveBeenCalled();
  },
);
it('keeps the checking preview busy indefinitely without issuing another check', async () => {
  mocks.desktop = false;
  vi.stubGlobal('location', { search: '?update-preview=checking' });
  const runtime = await import('./updater.svelte');
  await runtime.check(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(runtime.updater.status).toEqual({ kind: 'checking' });
  expect(mocks.settings.update).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it('opening during a background check does not start another request', async () => {
  let resolveCheck!: (value: UpdateInfo) => void;
  mocks.settings.updateAuto = false;
  mocks.invoke.mockImplementation(async (command) => command === 'update_check'
    ? new Promise<UpdateInfo>((resolve) => { resolveCheck = resolve; }) : command === 'update_supported');
  const runtime = await import('./updater.svelte');
  const background = runtime.check();
  await vi.advanceTimersByTimeAsync(0);
  await runtime.check(true);
  expect(mocks.invoke.mock.calls.filter(([command]) => command === 'update_check')).toHaveLength(1);
  resolveCheck(info);
  await background;
  expect(runtime.updater.status).toEqual({ kind: 'available', info });
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
  expect(runtime.updater.lastResult).toBe('UPb Lab cannot replace itself in this folder. Download the new version from GitHub.');
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
  expect(runtime.updater.lastResult).toBe("The update's signature did not match. Nothing was installed.");
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

it('uses only the stable feed without fetching a releases list', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const runtime = await import('./updater.svelte');
  await runtime.check(true);
  expect(mocks.invoke).toHaveBeenCalledWith('update_check', { endpoint: STABLE_ENDPOINT });
  expect(fetch).not.toHaveBeenCalled();
});
it('saves manifest notes durably before installing', async () => {
  const runtime = await import('./updater.svelte');
  runtime.updater.supported = true;
  runtime.updater.status = { kind: 'ready', info: { ...info, notes: 'New sample view.', ready: true } };
  mocks.invoke.mockImplementation(async (command) => {
    if (command === 'update_install') {
      expect(mocks.settings.savedUpdateVersion).toBe(info.version);
      expect(mocks.settings.savedUpdateNotes).toBe('New sample view.');
    }
  });
  await runtime.install();
  expect(mocks.invoke).toHaveBeenCalledWith('update_install', undefined);
});
it('does not install if saving fallback notes fails', async () => {
  const runtime = await import('./updater.svelte');
  runtime.updater.supported = true;
  runtime.updater.status = { kind: 'ready', info };
  mocks.settings.update.mockRejectedValueOnce(new Error('store unavailable'));
  await runtime.install();
  expect(runtime.updater.status.kind).toBe('error');
  expect(mocks.invoke).not.toHaveBeenCalledWith('update_install', undefined);
});
it('records a first install silently and shows an upgrade only once', async () => {
  const runtime = await import('./updater.svelte');
  await runtime.recordRunningVersion('0.1.0');
  expect(runtime.updater.whatsNewOpen).toBe(false);
  expect(mocks.settings.lastSeenVersion).toBe('0.1.0');
  mocks.settings.savedUpdateVersion = '0.2.0';
  mocks.settings.savedUpdateNotes = 'Saved release notes.';
  await runtime.recordRunningVersion('0.2.0');
  expect(runtime.updater.whatsNewOpen).toBe(true);
  expect(runtime.updater.whatsNewNotes).toBe('Saved release notes.');
  runtime.updater.whatsNewOpen = false;
  await runtime.recordRunningVersion('0.2.0');
  expect(runtime.updater.whatsNewOpen).toBe(false);
  await runtime.recordRunningVersion('0.1.0');
  expect(runtime.updater.whatsNewOpen).toBe(false);
});

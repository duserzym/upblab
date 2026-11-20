import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), save: vi.fn() }));
vi.mock('./platform', () => ({ isDesktop: true }));
vi.mock('@tauri-apps/plugin-store', () => ({ load: async () => store }));
vi.mock('./versions', () => ({ shellVersion: async () => '0.1.3' }));
const { settings, DEFAULTS } = await import('./settings.svelte');
const { recordRunningVersion } = await import('./updater.svelte');

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal('document', { documentElement: { setAttribute: vi.fn() } });
  store.get.mockImplementation(async (key: string) => key === 'reviewDockSplit' ? 'legacy preset' : undefined);
  await settings.load();
});
afterEach(() => { settings.dispose(); vi.unstubAllGlobals(); });

it('records only the running version in the desktop store and skips an unchanged version', async () => {
  await recordRunningVersion('0.1.3');
  expect(settings.lastSeenVersion).toBe('0.1.3');
  expect(settings.reviewDockSplit).toBe('legacy preset');
  expect(store.set.mock.calls).toEqual([['lastSeenVersion', '0.1.3']]);
  expect(store.save).toHaveBeenCalledOnce();

  store.set.mockClear();
  store.save.mockClear();
  await recordRunningVersion('0.1.3');
  expect(store.set).not.toHaveBeenCalled();
  expect(store.save).not.toHaveBeenCalled();
});

it('serializes full and key-specific saves with their edit-time values', async () => {
  let release!: () => void;
  store.save.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const first = settings.update({ lastSeenVersion: '0.1.0' });
  const second = settings.update({ lastSeenVersion: '0.1.1' }, { keysOnly: true });
  const third = settings.update({ lastSeenVersion: '0.1.2' });
  expect(settings.lastSeenVersion).toBe('0.1.2');

  await vi.waitFor(() => expect(store.save).toHaveBeenCalledOnce());
  expect(store.set.mock.calls.filter(([key]) => key === 'lastSeenVersion')).toEqual([['lastSeenVersion', '0.1.0']]);
  release();
  await Promise.all([first, second, third]);
  const keys = Object.keys(DEFAULTS);
  expect(store.set.mock.calls.map(([key]) => key)).toEqual([...keys, 'lastSeenVersion', ...keys]);
  expect(store.set.mock.calls.filter(([key]) => key === 'lastSeenVersion')).toEqual([
    ['lastSeenVersion', '0.1.0'], ['lastSeenVersion', '0.1.1'], ['lastSeenVersion', '0.1.2'],
  ]);
  expect(store.save).toHaveBeenCalledTimes(3);
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./platform', () => ({ isDesktop: false }));
const { Settings, DEFAULTS } = await import('./settings.svelte');

let stored: Record<string, unknown>;
let dark: boolean;
let changes: Set<(event: { matches: boolean }) => void>;
let root: { setAttribute: ReturnType<typeof vi.fn> };
let settings: InstanceType<typeof Settings>;

beforeEach(() => {
  stored = {};
  dark = false;
  changes = new Set();
  root = { setAttribute: vi.fn() };
  vi.stubGlobal('document', { documentElement: root });
  vi.stubGlobal('localStorage', {
    getItem: () => JSON.stringify(stored),
    setItem: (_key: string, value: string) => { stored = JSON.parse(value); },
  });
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: dark,
    addEventListener: (_type: string, fn: (event: { matches: boolean }) => void) => changes.add(fn),
    removeEventListener: (_type: string, fn: (event: { matches: boolean }) => void) => changes.delete(fn),
  })));
  settings = new Settings();
});
afterEach(() => {
  settings.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Home section preferences', () => {
  it('starts with the existing default layout for an older settings file', async () => {
    await settings.load();
    expect(DEFAULTS.homeSections).toEqual({});
    expect(settings.homeSections).toEqual({});
  });

  it.each([null, [], 'broken', { sessions: { height: '300', collapsed: 'yes' }, unknown: { height: 200 } }])(
    'validates a malformed saved layout %j', async homeSections => {
      stored = { homeSections };
      await settings.load();
      expect(settings.homeSections).toEqual({});
    },
  );

  it('clamps heights and keeps only known sections and valid fields', async () => {
    stored = { homeSections: { sessions: { height: 10, collapsed: false, extra: true }, mounts: { height: 9000, collapsed: true }, atlases: { height: null }, unknown: {} } };
    await settings.load();
    expect(settings.homeSections).toEqual({ sessions: { height: 80, collapsed: false }, mounts: { height: 4000, collapsed: true } });
  });

  it('fits a height restored from a larger screen to 80% of this viewport', async () => {
    vi.stubGlobal('window', { innerHeight: 640 });
    stored = { homeSections: { mounts: { height: 4000 } } };
    await settings.load();
    expect(settings.homeSections.mounts?.height).toBe(512);
  });

  it('keeps each height and collapse choice across unrelated saves and loads', async () => {
    await settings.load();
    await settings.updateHomeSection('sessions', { height: 450 });
    await settings.updateHomeSection('mounts', { collapsed: true, atlasFilter: 'with' });
    await settings.update({ lastTab: 'review' });
    await settings.load();
    expect(settings.homeSections).toEqual({ sessions: { height: 450 }, mounts: { collapsed: true, atlasFilter: 'with' } });
    await settings.updateHomeSection('sessions', { collapsed: true });
    await settings.updateHomeSection('sessions', { height: null });
    expect(stored.homeSections).toMatchObject({ sessions: { height: null, collapsed: true } });
    await settings.update({ homeSections: {} });
    await settings.load();
    expect(settings.homeSections).toEqual({});
  });

  it('debounces dragging for 300 ms, with immediate collapse and reset', async () => {
    vi.useFakeTimers();
    await settings.load();
    await settings.updateHomeSection('mounts', { height: 350 }, true);
    await vi.advanceTimersByTimeAsync(200);
    await settings.updateHomeSection('mounts', { height: 400 }, true);
    expect(settings.homeSections.mounts?.height).toBe(400);
    await vi.advanceTimersByTimeAsync(299);
    expect(stored.homeSections).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(stored.homeSections).toEqual({ mounts: { height: 400 } });
    await settings.updateHomeSection('mounts', { height: 500 }, true);
    await settings.updateHomeSection('sessions', { collapsed: true });
    expect(stored.homeSections).toEqual({ mounts: { height: 500 }, sessions: { collapsed: true } });
    await settings.updateHomeSection('mounts', { height: 550 }, true);
    await settings.update({ homeSections: {} });
    await vi.advanceTimersByTimeAsync(300);
    expect(stored.homeSections).toEqual({});
  });

  it('flushes an unfinished drag when Home is left', async () => {
    vi.useFakeTimers();
    await settings.load();
    await settings.updateHomeSection('mounts', { height: 500 }, true);
    await settings.flushHomeSections();
    expect(stored.homeSections).toEqual({ mounts: { height: 500 } });
    expect(vi.getTimerCount()).toBe(0);
  });
});

function system(value: boolean) {
  dark = value;
  for (const fn of changes) fn({ matches: value });
}

describe('web server settings', () => {
  it('uses the page origin before load, after load and after updates', async () => {
    vi.stubGlobal('location', new URL('http://127.0.0.1:8765/desk/?server=http://localhost:8000'));
    stored = { serverUrl: 'http://localhost:8000' };
    expect(settings.serverUrl).toBe('http://127.0.0.1:8765');
    await settings.load();
    expect(settings.serverUrl).toBe('http://127.0.0.1:8765');
    await settings.update({ serverUrl: 'https://other.example.test' });
    expect(settings.serverUrl).toBe('http://127.0.0.1:8765');
  });
});

describe('theme preference and migration', () => {
  it('defaults to System and does not turn unrelated saves into a theme choice', async () => {
    expect(DEFAULTS.theme).toBe('system');
    expect(DEFAULTS.themeChosen).toBe(false);
    await settings.load();
    await settings.update({ lastTab: 'review' });
    expect(stored).toMatchObject({ theme: 'system', themeChosen: false });
  });

  it.each([
    [{ theme: 'light' }, 'system'],
    [{ theme: 'dark', themeChosen: true }, 'dark'],
    [{ theme: 'light', themeChosen: false }, 'system'],
    [{ theme: 'dark', themeChosen: 'true' }, 'system'],
    [{ theme: 'invalid', themeChosen: true }, 'system'],
  ])('migrates %j to %s', async (data, theme) => {
    stored = data;
    await settings.load();
    expect(settings.theme).toBe(theme);
  });

  it('persists an explicit choice across loads', async () => {
    await settings.load();
    await settings.update({ theme: 'dark', themeChosen: true });
    expect(stored).toMatchObject({ theme: 'dark', themeChosen: true });
    await settings.load();
    expect(settings.theme).toBe('dark');
  });
});

describe('Review pane widths', () => {
  it.each([[undefined, 50], [63, 63], [20, 30], [100, 70], ['60', 50]])(
    'restores a saved width of %s as %s', async (width, expected) => {
      stored = { reviewDataWidth: width };
      await settings.load();
      expect(settings.reviewDataWidth).toBe(expected);
    },
  );

  it('keeps the split width when other settings are saved', async () => {
    await settings.load();
    await settings.update({ reviewDataWidth: 62 });
    await settings.update({ lastTab: 'images' });
    await settings.load();
    expect(settings.reviewDataWidth).toBe(62);
  });
});

describe('resolved theme', () => {
  it.each([false, true])('writes an explicit attribute for System (dark=%s)', async (value) => {
    dark = value;
    await settings.load();
    expect(settings.effectiveTheme).toBe(value ? 'dark' : 'light');
    expect(root.setAttribute).toHaveBeenLastCalledWith('data-theme', value ? 'dark' : 'light');
    expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
  });

  it('follows live OS changes only while System is selected', async () => {
    await settings.load();
    system(true);
    expect(settings.effectiveTheme).toBe('dark');
    expect(root.setAttribute).toHaveBeenLastCalledWith('data-theme', 'dark');
    await settings.update({ theme: 'light', themeChosen: true });
    system(false);
    system(true);
    expect(settings.effectiveTheme).toBe('light');
    expect(root.setAttribute).toHaveBeenLastCalledWith('data-theme', 'light');
    await settings.update({ theme: 'system', themeChosen: true });
    expect(settings.effectiveTheme).toBe('dark');
    expect(root.setAttribute).toHaveBeenLastCalledWith('data-theme', 'dark');
  });

  it('does not accumulate listeners when loading again', async () => {
    await settings.load();
    await settings.load();
    expect(changes.size).toBe(1);
    settings.dispose();
    expect(changes.size).toBe(0);
  });
});

it('keeps only the newest 200 valid Studio opener timestamps', async () => {
  const { readStudioOpened } = await import('./settings.svelte');
  const entries = Object.fromEntries(Array.from({ length: 205 }, (_, i) => [`s-${i}`, new Date(i * 1000).toISOString()]));
  const kept = readStudioOpened({ ...entries, bad: 'yesterday', '../x': new Date().toISOString() });
  expect(Object.keys(kept)).toHaveLength(200);
  expect(kept['s-204']).toBe(entries['s-204']);
  expect(kept['s-0']).toBeUndefined();
  expect(readStudioOpened(null)).toEqual({});
});

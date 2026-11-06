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
  vi.unstubAllGlobals();
});

function system(value: boolean) {
  dark = value;
  for (const fn of changes) fn({ matches: value });
}

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

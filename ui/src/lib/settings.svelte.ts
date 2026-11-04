// Shell settings: how to reach laicpmsdb (ADR-0003: "This computer" or a lab
// server URL), UPbRPy Studio path, theme.
// Desktop: Tauri store plugin (settings.json in the app config directory).
// Web: localStorage. Dark is the default theme.

import { isDesktop } from './platform';

export type ThemePref = 'dark' | 'light' | 'system';
/** '' until the first-run wizard has run. */
export type Mode = '' | 'local' | 'server';

export interface SettingsData {
  mode: Mode;
  serverUrl: string;
  /** This computer: laicpmsdb data root (raw files, attachments, exports). */
  dataRoot: string;
  /** This computer, without a bundled service: a laicpmsdb checkout with its .venv. */
  devServicePath: string;
  /** This computer: a PostgreSQL 17 `bin` folder instead of the bundled one (development). */
  pgBin: string;
  studioPath: string;
  theme: ThemePref;
  lastTab: string;
}

export const DEFAULT_DATA_ROOT = '~/laicpmsdb';

export const DEFAULTS: SettingsData = {
  mode: '',
  serverUrl: 'http://localhost:8000',
  dataRoot: DEFAULT_DATA_ROOT,
  devServicePath: '',
  pgBin: '',
  studioPath: '',
  theme: 'dark',
  lastTab: 'home',
};

const FILE = 'settings.json';
const LS_KEY = 'upbstudio.settings';

interface Backend {
  read(): Promise<Partial<SettingsData>>;
  write(data: SettingsData): Promise<void>;
}

const storeBackend: Backend = {
  async read() {
    const { load } = await import('@tauri-apps/plugin-store');
    const store = await load(FILE, { defaults: {}, autoSave: 100 });
    const out: Partial<SettingsData> = {};
    for (const key of Object.keys(DEFAULTS) as (keyof SettingsData)[]) {
      const v = await store.get<string>(key);
      if (typeof v === 'string') (out as Record<string, string>)[key] = v;
    }
    return out;
  },
  async write(data) {
    const { load } = await import('@tauri-apps/plugin-store');
    const store = await load(FILE, { defaults: {}, autoSave: 100 });
    for (const [k, v] of Object.entries(data)) await store.set(k, v);
    await store.save();
  },
};

const localBackend: Backend = {
  async read() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
    } catch {
      return {};
    }
  },
  async write(data) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch {
      /* private mode: settings last for this page only */
    }
  },
};

function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

const MODES: readonly Mode[] = ['', 'local', 'server'];

class Settings {
  mode = $state<Mode>(DEFAULTS.mode);
  serverUrl = $state(DEFAULTS.serverUrl);
  dataRoot = $state(DEFAULTS.dataRoot);
  devServicePath = $state(DEFAULTS.devServicePath);
  pgBin = $state(DEFAULTS.pgBin);
  studioPath = $state(DEFAULTS.studioPath);
  theme = $state<ThemePref>(DEFAULTS.theme);
  lastTab = $state(DEFAULTS.lastTab);
  loaded = $state(false);
  private backend: Backend = isDesktop ? storeBackend : localBackend;

  async load() {
    try {
      const data = { ...DEFAULTS, ...(await this.backend.read()) };
      this.mode = MODES.includes(data.mode) ? data.mode : '';
      this.serverUrl = data.serverUrl;
      this.dataRoot = data.dataRoot || DEFAULT_DATA_ROOT;
      this.devServicePath = data.devServicePath;
      this.pgBin = data.pgBin;
      this.studioPath = data.studioPath;
      this.theme = (['dark', 'light', 'system'] as const).includes(data.theme) ? data.theme : 'dark';
      this.lastTab = data.lastTab;
    } catch (err) {
      console.warn('[settings] could not load, using defaults', err);
    }
    applyTheme(this.theme);
    this.loaded = true;
  }

  async update(patch: Partial<SettingsData>) {
    Object.assign(this, patch);
    if (patch.theme) applyTheme(patch.theme);
    await this.backend.write(this.snapshot());
  }

  snapshot(): SettingsData {
    return {
      mode: this.mode,
      serverUrl: this.serverUrl,
      dataRoot: this.dataRoot,
      devServicePath: this.devServicePath,
      pgBin: this.pgBin,
      studioPath: this.studioPath,
      theme: this.theme,
      lastTab: this.lastTab,
    };
  }
}

export const settings = new Settings();

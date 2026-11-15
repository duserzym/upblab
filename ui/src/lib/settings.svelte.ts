// Shell settings: how to reach UPbDB (ADR-0003: "This computer" or a lab
// server URL), UPbRPy Studio path (or a development checkout), theme.
// Desktop: Tauri store plugin (settings.json in the app config directory).
// Web: localStorage. System is the default; an explicit choice is kept per viewer.

import { isDesktop } from './platform';
import { resolveServerUrl } from './server-url';
import { readHomeSections, type HomeSection, type HomeSectionLayout, type HomeSections } from './home-sections';
import { viewerInset, type ViewerInset } from '@lab/bridge';

/** A stored inset, checked like a bridge report; anything else is forgotten. */
export function readInset(value: unknown): ViewerInset | null {
  const v = value && typeof value === 'object' ? viewerInset({ ...(value as object), type: 'lab.viewer.inset' }) : null;
  return v ? { width: v.width, collapsed: v.collapsed } : null;
}

export type ThemePref = 'dark' | 'light' | 'system';
/** '' until the first-run wizard has run. */
export type Mode = '' | 'local' | 'server';

export interface SettingsData {
  mode: Mode;
  serverUrl: string;
  /** This computer: UPbDB data root (raw files, attachments, exports). */
  dataRoot: string;
  /** This computer, without a bundled service: a UPbDB checkout with its .venv. */
  devServicePath: string;
  /** This computer: a PostgreSQL 17 `bin` folder instead of the bundled one (development). */
  pgBin: string;
  studioOpened: Record<string, string>;
  studioPath: string;
  /** Development: a UPbRPy checkout to run as `python -m GUI` when Studio is not installed. */
  studioCheckout: string;
  theme: ThemePref;
  /** True only after a theme is explicitly picked in Settings. */
  themeChosen: boolean;
  lastTab: string;
  homeSections: HomeSections;
  reviewScope: string;
  reviewSplit: boolean;
  reviewDataWidth: number;
  reviewDockSolo: string;
  reviewDockSplit: string;
  /** The Review viewer's mount inset as last left (bridge v5.1); null until first changed. */
  reviewInset: ViewerInset | null;
  updateChannel: 'stable' | 'beta';
  updateAuto: boolean;
  updateLastCheck: number;
}

export const DEFAULT_DATA_ROOT = '~/upbdb';
export const REVIEW_DATA_WIDTH_MIN = 30;
export const REVIEW_DATA_WIDTH_MAX = 70;

export const DEFAULTS: SettingsData = {
  mode: '',
  serverUrl: 'http://localhost:8000',
  dataRoot: DEFAULT_DATA_ROOT,
  devServicePath: '',
  pgBin: '',
  studioOpened: {},
  studioPath: '',
  studioCheckout: '',
  theme: 'system',
  themeChosen: false,
  lastTab: 'home',
  homeSections: {},
  reviewScope: '',
  reviewSplit: false,
  reviewDataWidth: 42,
  reviewDockSolo: '',
  reviewDockSplit: '',
  reviewInset: null,
  updateChannel: 'stable',
  updateAuto: true,
  updateLastCheck: 0,
};

export function clampReviewDataWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULTS.reviewDataWidth;
  const width = Math.max(REVIEW_DATA_WIDTH_MIN, Math.min(REVIEW_DATA_WIDTH_MAX, value));
  return Math.round(width * 10) / 10;
}

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
      const v = await store.get<unknown>(key);
      if (typeof v === typeof DEFAULTS[key]) (out as Record<string, unknown>)[key] = v;
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

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

const MODES: readonly Mode[] = ['', 'local', 'server'];

export type Theme = 'light' | 'dark';

function prefersDark(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export class Settings {
  mode = $state<Mode>(DEFAULTS.mode);
  private storedServerUrl = $state(DEFAULTS.serverUrl);
  /** Every consumer sees the same web origin; persisted URLs are desktop settings. */
  get serverUrl(): string {
    return resolveServerUrl(this.storedServerUrl, isDesktop, typeof location === 'undefined' ? '' : location.href);
  }
  set serverUrl(value: string) { this.storedServerUrl = value; }
  dataRoot = $state(DEFAULTS.dataRoot);
  devServicePath = $state(DEFAULTS.devServicePath);
  pgBin = $state(DEFAULTS.pgBin);
  studioOpened = $state<Record<string, string>>({});
  studioPath = $state(DEFAULTS.studioPath);
  studioCheckout = $state(DEFAULTS.studioCheckout);
  theme = $state<ThemePref>(DEFAULTS.theme);
  themeChosen = $state(DEFAULTS.themeChosen);
  lastTab = $state(DEFAULTS.lastTab);
  homeSections = $state<HomeSections>({});
  reviewScope = $state(DEFAULTS.reviewScope);
  reviewSplit = $state(DEFAULTS.reviewSplit);
  reviewDataWidth = $state(DEFAULTS.reviewDataWidth);
  reviewDockSolo = $state(DEFAULTS.reviewDockSolo);
  reviewDockSplit = $state(DEFAULTS.reviewDockSplit);
  reviewInset = $state<ViewerInset | null>(DEFAULTS.reviewInset);
  updateChannel = $state<SettingsData['updateChannel']>(DEFAULTS.updateChannel);
  updateAuto = $state(DEFAULTS.updateAuto);
  updateLastCheck = $state(DEFAULTS.updateLastCheck);
  loaded = $state(false);
  /** The OS asks for dark (only matters for the System choice). */
  systemDark = $state(prefersDark());
  private backend: Backend = isDesktop ? storeBackend : localBackend;

  /** Resolved theme for shell tokens, plots and live module delivery. */
  get effectiveTheme(): Theme {
    if (this.theme === 'system') return this.systemDark ? 'dark' : 'light';
    return this.theme;
  }

  private stopMedia: (() => void) | undefined;
  private homeSave: ReturnType<typeof setTimeout> | undefined;

  /** Drag updates render immediately; persistence waits until the pointer settles. */
  async updateHomeSection(section: HomeSection, patch: HomeSectionLayout, debounce = false) {
    this.homeSections = { ...this.homeSections, [section]: { ...this.homeSections[section], ...patch } };
    clearTimeout(this.homeSave);
    this.homeSave = undefined;
    if (debounce) {
      this.homeSave = setTimeout(() => { void this.flushHomeSections(); }, 300);
    } else {
      await this.update({ homeSections: this.homeSections });
    }
  }

  async flushHomeSections() {
    if (this.homeSave === undefined) return;
    clearTimeout(this.homeSave);
    this.homeSave = undefined;
    await this.update({ homeSections: this.homeSections });
  }

  dispose() {
    void this.flushHomeSections();
    this.stopMedia?.();
    this.stopMedia = undefined;
  }

  async load() {
    this.dispose();
    this.systemDark = prefersDark();
    applyTheme(this.effectiveTheme);
    try {
      const media = matchMedia('(prefers-color-scheme: dark)');
      const change = (e: MediaQueryListEvent) => {
        this.systemDark = e.matches;
        applyTheme(this.effectiveTheme);
      };
      media.addEventListener('change', change);
      this.stopMedia = () => media.removeEventListener('change', change);
    } catch {
      /* no matchMedia (tests) */
    }
    try {
      const data = { ...DEFAULTS, ...(await this.backend.read()) };
      this.mode = MODES.includes(data.mode) ? data.mode : '';
      this.serverUrl = data.serverUrl;
      this.dataRoot = data.dataRoot || DEFAULT_DATA_ROOT;
      this.devServicePath = data.devServicePath;
      this.pgBin = data.pgBin;
      this.studioOpened = readStudioOpened(data.studioOpened);
      this.studioPath = data.studioPath;
      this.studioCheckout = data.studioCheckout;
      this.themeChosen = data.themeChosen === true;
      this.theme = this.themeChosen && (['dark', 'light', 'system'] as const).includes(data.theme) ? data.theme : 'system';
      this.lastTab = data.lastTab === 'images' ? 'home' : data.lastTab;
      this.homeSections = readHomeSections(data.homeSections, typeof window === 'undefined' ? undefined : window.innerHeight);
      this.reviewScope = typeof data.reviewScope === 'string' ? data.reviewScope : '';
      this.reviewSplit = data.reviewSplit === true;
      this.reviewDataWidth = clampReviewDataWidth(data.reviewDataWidth);
      this.reviewDockSolo = typeof data.reviewDockSolo === 'string' ? data.reviewDockSolo : '';
      this.reviewDockSplit = typeof data.reviewDockSplit === 'string' ? data.reviewDockSplit : '';
      this.reviewInset = readInset(data.reviewInset);
      this.updateChannel = data.updateChannel === 'beta' ? 'beta' : 'stable';
      this.updateAuto = typeof data.updateAuto === 'boolean' ? data.updateAuto : true;
      this.updateLastCheck = Number.isFinite(data.updateLastCheck) && data.updateLastCheck > 0 ? data.updateLastCheck : 0;
    } catch (err) {
      console.warn('[settings] could not load, using defaults', err);
    }
    applyTheme(this.effectiveTheme);
    this.loaded = true;
  }

  async update(patch: Partial<SettingsData>) {
    if (patch.homeSections !== undefined) {
      clearTimeout(this.homeSave);
      this.homeSave = undefined;
    }
    if (patch.studioOpened) patch = { ...patch, studioOpened: readStudioOpened(patch.studioOpened) };
    Object.assign(this, patch);
    if (patch.theme) applyTheme(this.effectiveTheme);
    await this.backend.write(this.snapshot());
  }

  snapshot(): SettingsData {
    return {
      mode: this.mode,
      serverUrl: this.storedServerUrl,
      dataRoot: this.dataRoot,
      devServicePath: this.devServicePath,
      pgBin: this.pgBin,
      studioOpened: $state.snapshot(this.studioOpened),
      studioPath: this.studioPath,
      studioCheckout: this.studioCheckout,
      theme: this.theme,
      themeChosen: this.themeChosen,
      lastTab: this.lastTab,
      homeSections: $state.snapshot(this.homeSections),
      reviewScope: this.reviewScope,
      reviewSplit: this.reviewSplit,
      reviewDataWidth: this.reviewDataWidth,
      reviewDockSolo: this.reviewDockSolo,
      reviewDockSplit: this.reviewDockSplit,
      reviewInset: this.reviewInset ? { ...this.reviewInset } : null,
      updateChannel: this.updateChannel,
      updateAuto: this.updateAuto,
      updateLastCheck: this.updateLastCheck,
    };
  }
}

export const settings = new Settings();

/** Keep the newest 200 valid opener timestamps, including when loading older settings. */
export function readStudioOpened(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, at]) => /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(id)
    && typeof at === 'string' && Number.isFinite(Date.parse(at)))
    .sort((a, b) => Date.parse(b[1] as string) - Date.parse(a[1] as string)).slice(0, 200));
}

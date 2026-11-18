// The two deliveries of the shell page (plan decision 3): inside Tauri on the
// desktop, and as a plain page served by UPbDB at /desk/. Everything that
// differs between them goes through this file.

import { connectivity } from './connectivity.svelte';
import type { BridgeCommand } from '@lab/bridge';
import type { ModuleTab } from './links';

export const isDesktop: boolean =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as unknown as Record<string, unknown>);

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The shell's CSS viewport height; lets the host correct the macOS title bar inset. */
  viewportHeight?: number;
}

export interface ProbeResult {
  reachable: boolean;
  error?: string;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args);
}

/** Desktop: native child webviews laid over the shell page (ADR-0002). */
export const desktopModules = {
  command: (module: ModuleTab, command: BridgeCommand) => invoke<boolean>('module_command', { module, command }),
  open(module: ModuleTab, url: string, bounds: Bounds, navigate: boolean): Promise<void> {
    return invoke('module_open', { module, url, bounds, navigate });
  },
  bounds(module: ModuleTab, bounds: Bounds): Promise<void> {
    return invoke('module_bounds', { module, bounds });
  },
  hide(module: ModuleTab): Promise<void> {
    return invoke('module_hide', { module });
  },
  reload(module: ModuleTab): Promise<void> {
    return invoke('module_reload', { module });
  },
};

/** Is a server accepting connections? Desktop asks Rust (no CORS, no mixed content); the web uses fetch. */
export async function probe(url: string): Promise<ProbeResult> {
  if (isDesktop) return invoke<ProbeResult>('probe', { url });
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(3000) });
    return { reachable: true };
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function openExternal(url: string): Promise<void> {
  if (isDesktop) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

/** Settings that locate UPbRPy Studio (src-tauri/src/studio.rs `StudioConfig`). */
export interface StudioConfig {
  /** Installed app: `.app` (macOS) or `.exe` (Windows); empty for auto-detection. */
  path: string;
  /** Development fallback: a UPbRPy checkout run as `python -m GUI`. */
  checkout: string;
}

/** Mirrors `StudioStatus` in src-tauri/src/studio.rs. */
export interface StudioStatus {
  found: boolean;
  kind?: 'installed' | 'checkout';
  path: string | null;
  /** How it is launched, with `<url>` for the link. */
  command?: string;
  error?: string;
}

const studioArgs = (c: StudioConfig) => ({ path: c.path || null, checkout: c.checkout || null });

export async function studioStatus(config: StudioConfig): Promise<StudioStatus> {
  if (!isDesktop) return { found: false, path: null, error: 'desktop app only' };
  return invoke<StudioStatus>('studio_status', { config: studioArgs(config) });
}

/** Launch Studio, with a upbr:// link; resolves with the command line (codes redacted). */
export async function launchStudio(config: StudioConfig, url: string | null): Promise<string> {
  if (!isDesktop) throw new Error('UPbRPy Studio can only be launched from the desktop app.');
  const r = await invoke<{ command: string }>('studio_launch', { config: studioArgs(config), url });
  return r.command;
}

export async function logWarn(message: string): Promise<void> {
  console.warn(message);
  if (isDesktop) {
    const { warn } = await import('@tauri-apps/plugin-log');
    await warn(message).catch(() => {});
  }
}

export async function logInfo(message: string): Promise<void> {
  console.info(message);
  if (isDesktop) {
    const { info } = await import('@tauri-apps/plugin-log');
    await info(message).catch(() => {});
  }
}

// ------------------------------------------------ "This computer" (ADR-0003)

export type LocalPhase = 'idle' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

export interface LocalPart {
  running: boolean;
  port: number | null;
  pid: number | null;
  source: string | null;
  version: string | null;
  path: string | null;
}

/** Mirrors `Status` in src-tauri/src/local_service/mod.rs. */
export interface LocalStatus {
  phase: LocalPhase;
  step: string;
  postgres: LocalPart;
  service: LocalPart;
  url: string | null;
  error: string | null;
  logTail: string | null;
  bundle: string | null;
  devDefault: string | null;
  logDir: string;
  dataDir: string;
}

export interface LocalStartConfig {
  dataRoot: string;
  devPath: string | null;
  pgBin: string | null;
}

export interface LocalLogs {
  dir: string;
  postgres: string;
  service: string;
}

export const LOCAL_STATUS_EVENT = 'local-service://status';

export const localServiceApi = {
  status: () => invoke<LocalStatus>('local_service_status'),
  start: (config: LocalStartConfig) => invoke<LocalStatus>('local_service_start', { config }),
  stop: () => invoke<LocalStatus>('local_service_stop'),
  bootstrap: (account: { username: string; email: string; password: string; loadDemo: boolean }) =>
    invoke<LocalStatus>('local_service_bootstrap', account),
  logs: (lines = 200) => invoke<LocalLogs>('local_service_logs', { lines }),
  openLogs: () => invoke<void>('local_service_open_logs'),
};

// ------------------------------------------------ identity (plan decision 5)

/** Which UPbDB the shell signs in to, and the keychain entry for its token. */
export interface AuthTarget {
  server: string;
  key: string;
}

/** UPbDB's AccountOut, the fields the shell uses. */
export interface Account {
  username: string;
  display_name?: string;
  email?: string;
  affiliation?: string;
  orcid?: string;
  sign_in_methods?: string[];
  groups?: { id: string; name: string; description: string }[];
  is_lab_staff?: boolean;
  can_manage_people?: boolean;
  is_admin?: boolean;
  [field: string]: unknown;
}

/** Mirrors `AuthState` in src-tauri/src/auth.rs. */
export interface AuthState {
  offlineCopy?: string;
  signedIn: boolean;
  account: Account | null;
  /** A stored token, but the server could not confirm it (unreachable). */
  offline: boolean;
  error?: string;
}

export interface ApiReply<T = unknown> {
  offlineCopy?: string;
  status: number;
  body: T;
  /** A non-JSON response, with status and a short, credential-free excerpt. */
  error?: string;
  cached?: { asOf: string; reason: 'unreachable' | 'server_error'; detail?: string };
  nextCursor?: string;
}

export interface CacheStatus { entries: number; bytes: number; newest: string | null; oldest: string | null }
export interface Prefetched { fetched: number; unchanged: number; failed: number }
export const savedReads = {
  status: (target: AuthTarget) => invoke<CacheStatus>('cache_status', { target }),
  clear: (target: AuthTarget) => invoke<void>('cache_clear', { target }),
  prefetch: (target: AuthTarget, paths: string[]) => invoke<Prefetched>('cache_prefetch', { target, paths }),
};
export interface LocalSession {
  format: string | null; openable: boolean;
  path: string; key: string; id: string | null; material: string | null; kind: string | null;
  started_at: string | null; acquisitions: number; has_project: boolean; modified: string;
}
export const localSessions = () => isDesktop ? invoke<LocalSession[]>('local_sessions') : Promise.resolve([]);
export const openLocalSession = (path: string, config: StudioConfig) =>
  invoke<{ command: string }>('studio_open_local', { path, config: studioArgs(config) });

/** Desktop: the token stays in Rust and the OS keychain (src-tauri/src/auth.rs). */
export const desktopAuth = {
  restore: (target: AuthTarget) => invoke<AuthState>('auth_restore', { target }),
  login: (target: AuthTarget, username: string, password: string) =>
    invoke<AuthState>('auth_login', { target, username, password }),
  exchange: (target: AuthTarget, code: string) => invoke<AuthState>('auth_exchange', { target, code }),
  logout: (target: AuthTarget) => invoke<AuthState>('auth_logout', { target }),
  handoff: (target: AuthTarget) => invoke<string>('auth_handoff', { target }),
  get: <T>(target: AuthTarget, path: string) => invoke<ApiReply<T>>('api_get', { target, path }),
};

// ------------------------------------------------ open anything (ux-conventions rule 4)

/** Mirrors `ScanOut` in src-tauri/src/files.rs. */
export interface FileScan {
  scan: string;
  roots: { path: string; name: string; dir: boolean }[];
  entries: { root: number; rel: string; size: number }[];
  truncated: boolean;
  missing: string[];
}

/** Mirrors `OfferOut` in src-tauri/src/files.rs. */
export interface FileOffer {
  id: string;
  files: number;
  bytes: number;
  nudged: boolean;
}

/** Desktop: the host lists dropped or opened paths and hands files to module webviews (src-tauri/src/files.rs). */
export const desktopFiles = {
  scan: (paths: string[]) => invoke<FileScan>('files_scan', { paths }),
  offer: (args: {
    scan: string;
    module: ModuleTab;
    files: { index: number; path: string }[];
    kind: string;
    name: string;
    path: string | null;
    nudge: boolean;
  }) => invoke<FileOffer>('files_offer', args),
  projectPackage: (path: string) => invoke<{ name: string; path: string; exists: boolean } | null>('files_project_package', { path }),
  takeOpened: () => invoke<string[]>('files_take_opened'),
};

/** Desktop: the OS dialog, for a folder or for files. Resolves with the chosen paths (none when cancelled). */
export async function pickPaths(folder: boolean): Promise<string[]> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open(
    folder
      ? { directory: true, multiple: true, title: 'Open a folder: a TM4000 package, an area folder or a Qtegra export' }
      : { directory: false, multiple: true, title: 'Open files: images, Qtegra CSVs or a zip' },
  );
  if (!picked) return [];
  return Array.isArray(picked) ? picked : [picked];
}

// ------------------------------------------------ window (ux-conventions rule 7)

/** Desktop: forget the remembered window place; 1280 x 800, centred (src-tauri/src/geometry.rs). */
export function resetWindowLayout(): Promise<void> {
  return invoke('window_reset');
}

/** Mixed native picker: a Rich CSV and its per-spot folder may be selected together. */
export function pickSessionPaths(): Promise<string[]> {
  return invoke<string[]>('files_pick_session');
}

/** Hand local images and project paths to the standalone application. */
export async function openGrainAtlasPaths(paths: string[]): Promise<void> {
  if (connectivity.offlineCopy) connectivity.grainAtlasLocal = true;
  await invoke('grainatlas_open_paths', { paths });
}

/** src-tauri/src/inbox.rs `Notice`: what a standalone app reported; looked up again, never trusted. */
export type InboxNotice =
  | { type: 'lab.atlas.synced'; mount: string; project: string; server: string }
  | { type: 'lab.run.submitted'; session: string; run: string | null; server: string };
/** Take (and remove) the notices standalone grainatlas and Studio left for UPb Lab. Desktop only. */
export async function takeInbox(): Promise<InboxNotice[]> {
  if (!isDesktop) return [];
  return invoke<InboxNotice[]>('inbox_take');
}

/** One-time code is passed only through IPC, never logged or retained. */

export async function launchGrainAtlas(project: string, server: string | undefined, code: string | undefined, revision?: number, spot?: string | null, grain?: string | null): Promise<void> {
  if (!isDesktop) throw new Error('GrainAtlas can only be launched from the desktop app.');
  if (connectivity.offlineCopy) { server = undefined; code = undefined; connectivity.grainAtlasLocal = true; }
  await invoke('grainatlas_launch', { project, ...(server ? { server, code } : {}), ...(revision === undefined ? {} : { revision }), ...(spot ? { spot } : grain ? { grain } : {}) });
}

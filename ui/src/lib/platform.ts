// The two deliveries of the shell page (plan decision 3): inside Tauri on the
// desktop, and as a plain page served by laicpmsdb at /desk/. Everything that
// differs between them goes through this file.

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

export interface StudioStatus {
  path: string | null;
  found: boolean;
}

export async function studioStatus(configured: string): Promise<StudioStatus> {
  if (!isDesktop) return { path: null, found: false };
  return invoke<StudioStatus>('studio_status', { configured: configured || null });
}

export async function launchStudio(path: string, url: string | null): Promise<void> {
  if (!isDesktop) throw new Error('UPbRPy Studio can only be launched from the desktop app.');
  await invoke('studio_launch', { path, url });
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

/** Which laicpmsdb the shell signs in to, and the keychain entry for its token. */
export interface AuthTarget {
  server: string;
  key: string;
}

/** laicpmsdb's AccountOut, the fields the shell uses. */
export interface Account {
  username: string;
  display_name?: string;
  email?: string;
  is_lab_staff?: boolean;
  is_admin?: boolean;
  [field: string]: unknown;
}

/** Mirrors `AuthState` in src-tauri/src/auth.rs. */
export interface AuthState {
  signedIn: boolean;
  account: Account | null;
  /** A stored token, but the server could not confirm it (unreachable). */
  offline: boolean;
  error?: string;
}

export interface ApiReply<T = unknown> {
  status: number;
  body: T;
}

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

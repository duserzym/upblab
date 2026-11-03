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

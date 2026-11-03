// Wire protocol shared by the module side (`createBridge`) and the shell side
// (`createFrameHost`, and the Rust host's commands). Bump PROTOCOL_VERSION only
// for incompatible changes; the shell keeps accepting older versions.

export const PROTOCOL_VERSION = 1;

/** Tag on every postMessage envelope, so unrelated messages are ignored. */
export const MESSAGE_TAG = 'lab-bridge';

/** The shell names each module iframe `lab-shell:<module>` (web delivery). */
export const FRAME_NAME_PREFIX = 'lab-shell:';

/**
 * On desktop the shell injects `window.__LAB_SHELL__ = { module, v }` into each
 * module webview before any page script runs.
 */
export const SHELL_GLOBAL = '__LAB_SHELL__';

/** Tauri commands the desktop shell exposes to module webviews. */
export const COMMANDS = {
  open: 'bridge_open',
  token: 'bridge_token',
  notify: 'bridge_notify',
} as const;

/** Events the desktop host emits to the shell webview after a module call. */
export const EVENTS = {
  open: 'lab-bridge://open',
  notify: 'lab-bridge://notify',
} as const;

/** A module event for the shell (timeline entries, status, title changes). */
export interface BridgeEvent {
  /** Namespaced type, e.g. `grainatlas.spot.selected`. */
  type: string;
  [key: string]: unknown;
}

export type BridgeOp = 'open' | 'token' | 'notify';

export interface BridgeRequest {
  tag: typeof MESSAGE_TAG;
  v: number;
  id: string;
  op: BridgeOp;
  url?: string;
  event?: BridgeEvent;
}

export interface BridgeResponse {
  tag: typeof MESSAGE_TAG;
  v: number;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface ShellMarker {
  module: string;
  v: number;
}

export function isBridgeRequest(data: unknown): data is BridgeRequest {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    d.tag === MESSAGE_TAG &&
    typeof d.id === 'string' &&
    (d.op === 'open' || d.op === 'token' || d.op === 'notify') &&
    !('ok' in d)
  );
}

export function isBridgeResponse(data: unknown): data is BridgeResponse {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return d.tag === MESSAGE_TAG && typeof d.id === 'string' && typeof d.ok === 'boolean';
}

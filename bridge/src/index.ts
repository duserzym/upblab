// @lab/bridge: the small API a module calls to talk to the UPb Studio shell.
//
//   import { open, token, notify, isHosted } from '@lab/bridge';
//   await open('laicpmsdb://acquisition/<uuid>');
//
// Three transports, picked once per page:
//   tauri        desktop shell: the module runs in a child webview that the
//                shell marked with window.__LAB_SHELL__; calls go to Tauri
//                commands, which the host re-emits as events to the shell UI.
//   postMessage  web delivery (/desk/): the module runs in an iframe named
//                `lab-shell:<module>`; calls are posted to window.parent.
//   none         the module runs on its own: open() resolves false, token()
//                resolves null, notify() does nothing.

import {
  COMMANDS,
  FRAME_NAME_PREFIX,
  MESSAGE_TAG,
  PROTOCOL_VERSION,
  SHELL_GLOBAL,
  isBridgeResponse,
  type BridgeEvent,
  type BridgeOp,
  type BridgeRequest,
  type ShellMarker,
} from './protocol';

export * from './protocol';

export type Transport = 'tauri' | 'postMessage' | 'none';

export interface Bridge {
  readonly transport: Transport;
  /** Name of the module as the shell knows it, or null when not hosted. */
  readonly module: string | null;
  /** Ask the shell to route a URL (laicpmsdb://, grainatlas://, upbr://, https://). */
  open(url: string): Promise<boolean>;
  /** The signed-in laicpmsdb bearer token, or null (not hosted, or signed out). */
  token(): Promise<string | null>;
  /** Tell the shell something happened (fire and forget). */
  notify(event: BridgeEvent): Promise<void>;
  /** True when running inside the UPb Studio shell. */
  isHosted(): boolean;
}

interface TauriInternals {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

/** The parts of `window` the bridge touches; injectable for tests. */
export interface BridgeEnv {
  name?: string;
  parent?: { postMessage(message: unknown, targetOrigin: string): void } | null;
  self?: unknown;
  location?: { ancestorOrigins?: ArrayLike<string> };
  addEventListener?(type: 'message', listener: (ev: MessageEvent) => void): void;
  removeEventListener?(type: 'message', listener: (ev: MessageEvent) => void): void;
  [SHELL_GLOBAL]?: ShellMarker;
  __TAURI_INTERNALS__?: TauriInternals;
}

export interface BridgeOptions {
  /** Milliseconds to wait for a postMessage reply before giving up. Default 5000. */
  timeoutMs?: number;
}

function noopBridge(): Bridge {
  return {
    transport: 'none',
    module: null,
    open: async () => false,
    token: async () => null,
    notify: async () => {},
    isHosted: () => false,
  };
}

function tauriBridge(marker: ShellMarker, internals: TauriInternals): Bridge {
  return {
    transport: 'tauri',
    module: marker.module,
    async open(url) {
      try {
        return (await internals.invoke(COMMANDS.open, { url })) !== false;
      } catch {
        return false;
      }
    },
    async token() {
      try {
        const t = await internals.invoke(COMMANDS.token);
        return typeof t === 'string' && t ? t : null;
      } catch {
        return null;
      }
    },
    async notify(event) {
      try {
        await internals.invoke(COMMANDS.notify, { event });
      } catch {
        /* the shell may be older than the module; notify is best effort */
      }
    },
    isHosted: () => true,
  };
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

function frameBridge(env: BridgeEnv, module: string, opts: BridgeOptions): Bridge {
  const parent = env.parent!;
  const timeoutMs = opts.timeoutMs ?? 5000;
  // Same-origin in the /desk/ delivery; ancestorOrigins narrows the target when
  // the browser exposes it (WebKit, Chromium). Requests carry no secrets.
  const targetOrigin = env.location?.ancestorOrigins?.[0] ?? '*';

  function request(op: BridgeOp, body: Partial<BridgeRequest>): Promise<unknown> {
    const id = nextId();
    const msg: BridgeRequest = { tag: MESSAGE_TAG, v: PROTOCOL_VERSION, id, op, ...body };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        env.removeEventListener?.('message', onMessage);
        reject(new Error(`lab-bridge: no reply to ${op} within ${timeoutMs} ms`));
      }, timeoutMs);
      function onMessage(ev: MessageEvent) {
        if (ev.source !== parent || !isBridgeResponse(ev.data) || ev.data.id !== id) return;
        clearTimeout(timer);
        env.removeEventListener?.('message', onMessage);
        if (ev.data.ok) resolve(ev.data.result);
        else reject(new Error(ev.data.error ?? `lab-bridge: ${op} refused`));
      }
      env.addEventListener?.('message', onMessage);
      parent.postMessage(msg, targetOrigin);
    });
  }

  return {
    transport: 'postMessage',
    module,
    async open(url) {
      try {
        return (await request('open', { url })) !== false;
      } catch {
        return false;
      }
    },
    async token() {
      try {
        const t = await request('token', {});
        return typeof t === 'string' && t ? t : null;
      } catch {
        return null;
      }
    },
    async notify(event) {
      const msg: BridgeRequest = { tag: MESSAGE_TAG, v: PROTOCOL_VERSION, id: nextId(), op: 'notify', event };
      parent.postMessage(msg, targetOrigin);
    },
    isHosted: () => true,
  };
}

/** Detect the transport for `env` (defaults to the global `window`). */
export function detectTransport(env: BridgeEnv | undefined = globalEnv()): Transport {
  if (!env) return 'none';
  const marker = env[SHELL_GLOBAL];
  if (marker && typeof marker.module === 'string' && env.__TAURI_INTERNALS__) return 'tauri';
  if (
    typeof env.name === 'string' &&
    env.name.startsWith(FRAME_NAME_PREFIX) &&
    env.parent &&
    env.parent !== env.self
  ) {
    return 'postMessage';
  }
  return 'none';
}

/** Build a bridge for `env`. Most modules use the default exports instead. */
export function createBridge(env: BridgeEnv | undefined = globalEnv(), opts: BridgeOptions = {}): Bridge {
  switch (detectTransport(env)) {
    case 'tauri':
      return tauriBridge(env![SHELL_GLOBAL]!, env!.__TAURI_INTERNALS__!);
    case 'postMessage':
      return frameBridge(env!, env!.name!.slice(FRAME_NAME_PREFIX.length), opts);
    default:
      return noopBridge();
  }
}

function globalEnv(): BridgeEnv | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as BridgeEnv);
}

let shared: Bridge | undefined;
function bridge(): Bridge {
  return (shared ??= createBridge());
}

export const open = (url: string): Promise<boolean> => bridge().open(url);
export const token = (): Promise<string | null> => bridge().token();
export const notify = (event: BridgeEvent): Promise<void> => bridge().notify(event);
export const isHosted = (): boolean => bridge().isHosted();

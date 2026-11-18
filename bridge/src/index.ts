// @lab/bridge: the small API a module calls to talk to the UPb Lab shell.
//
//   import { open, token, notify, isHosted, onOpenFiles } from '@lab/bridge';
//   await open('upbdb://acquisition/<uuid>');
//   onOpenFiles(({ kind, name, files }) => openPackage(name, files));
//
// Three transports, picked once per page:
//   tauri        desktop shell: the module runs in a child webview that the
//                shell marked with window.__LAB_SHELL__; calls go to Tauri
//                commands, which the host re-emits as events to the shell UI.
//   postMessage  web delivery (/desk/): the module runs in an iframe named
//                `lab-shell:<module>`; calls are posted to window.parent.
//   none         the module runs on its own: open() resolves false, token()
//                resolves null, notify() does nothing, onOpenFiles() never fires.

import {
  COMMANDS,
  OVERSIGHT_EVENT,
  isOversightState,
  type OversightState,
  COMMAND_EVENT,
  THEME_EVENT,
  isTheme,
  type Theme,
  FRAME_NAME_PREFIX,
  MESSAGE_TAG,
  OPEN_FILES_EVENT,
  PROTOCOL_VERSION,
  SHELL_GLOBAL,
  isBridgePush,
  isBridgeCommand,
  isBridgeResponse,
  type BridgeEvent,
  type BridgeCommand,
  type BridgeOp,
  type BridgeRequest,
  type OpenFilesManifest,
  type OpenFilesTransfer,
  type ShellMarker,
} from './protocol';

export * from './protocol';

export type Transport = 'tauri' | 'postMessage' | 'none';

/** Files the shell hands to the module (`onOpenFiles`), ready to read like a dropped folder. */
export type OpenedFiles = OpenFilesTransfer;

export type OpenFilesHandler = (files: OpenedFiles) => void | Promise<void>;

export type ThemeHandler = (theme: Theme) => void;

export type CommandHandler = (command: BridgeCommand) => void | Promise<void>;

export interface Bridge {
  readonly transport: Transport;
  /** Name of the module as the shell knows it, or null when not hosted. */
  readonly module: string | null;
  /** v3.1: last known resolved shell theme, null when unavailable. */
  theme(): Theme | null;
  /** v5.3: read the shell scope; null on older shells or standalone. */
  oversight(): Promise<OversightState | null>;
  onOversight(handler: (state: OversightState) => void): () => void;
  /** Called immediately if known, then for every change. Returns an unsubscribe. */
  onTheme(handler: ThemeHandler): () => void;
  /** Ask the shell to route a URL (upbdb://, grainatlas://, upbr://, https://). */
  open(url: string): Promise<boolean>;
  /** The signed-in UPbDB bearer token, or null (not hosted, or signed out). */
  token(): Promise<string | null>;
  /** Tell the shell something happened (fire and forget). */
  notify(event: BridgeEvent): Promise<void>;
  /** True when running inside the UPb Lab shell. */
  isHosted(): boolean;
  /**
   * Receive files the user dropped on the shell window, opened through the OS
   * or picked with Home's Open buttons, once the shell has routed them to this
   * module (protocol v2). Files already waiting when the handler is set are
   * delivered at once. Returns a function that removes the handler.
   */
  onOpenFiles(handler: OpenFilesHandler): () => void;
  /** v3: receive the newest waiting command once; register at start-up. */
  onCommand(handler: CommandHandler): () => void;
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
  addEventListener?(type: string, listener: (ev: MessageEvent) => void): void;
  removeEventListener?(type: string, listener: (ev: MessageEvent) => void): void;
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
    theme: () => null,
    oversight: async () => null,
    onOversight: () => () => {},
    onTheme: () => () => {},
    open: async () => false,
    token: async () => null,
    notify: async () => {},
    isHosted: () => false,
    onOpenFiles: () => () => {},
    onCommand: () => () => {},
  };
}

/** Bytes from a Tauri command: an ArrayBuffer for raw responses, an array of numbers from older hosts. */
function toBytes(data: unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  if (Array.isArray(data)) return new Uint8Array(data as number[]).buffer;
  throw new Error('lab-bridge: unexpected file data from the shell');
}

/** A `File` named after the last path segment, carrying the full path as `webkitRelativePath` too. */
function makeFile(bytes: BlobPart, path: string, type: string, lastModified: number): File {
  const file = new File([bytes], path.split('/').pop() || path, { type, lastModified: lastModified || undefined });
  try {
    Object.defineProperty(file, 'webkitRelativePath', { value: path, configurable: true });
  } catch {
    /* read-only in some engines; `path` is in the transfer anyway */
  }
  return file;
}

/**
 * Run `pull` for every handler registration and every shell nudge, one at a
 * time, and pass what it returns to the handlers.
 */
function deliveryHub<T>(pull: () => Promise<T | null>, subscribe: (nudge: () => void) => () => void, topic: string) {
  const handlers = new Set<(value: T) => void | Promise<void>>();
  let chain: Promise<unknown> = Promise.resolve();
  let unsubscribe: (() => void) | null = null;
  const run = () => {
    chain = chain
      .then(async () => {
        if (!handlers.size) return;
        const value = await pull();
        if (value) for (const h of [...handlers]) await h(value);
      })
      .catch((err) => console.warn(`[lab-bridge] ${topic}:`, err));
  };
  return (handler: (value: T) => void | Promise<void>) => {
    handlers.add(handler);
    unsubscribe ??= subscribe(run);
    run();
    return () => {
      handlers.delete(handler);
      if (!handlers.size && unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };
  };
}

/** Keep the latest value even without subscribers; ignore duplicates and invalid input. */
function themeHub(initial?: unknown) {
  let current: Theme | null = isTheme(initial) ? initial : null;
  const handlers = new Set<ThemeHandler>();
  return {
    theme: () => current,
    onTheme(handler: ThemeHandler) {
      handlers.add(handler);
      if (current) handler(current);
      return () => { handlers.delete(handler); };
    },
    receive(value: unknown) {
      if (!isTheme(value) || value === current) return;
      current = value;
      for (const handler of [...handlers]) handler(value);
    },
  };
}

function oversightHub(pull: () => Promise<unknown>) {
  let current: OversightState | null = null;
  let version = 0;
  const handlers = new Set<(state: OversightState) => void>();
  const receive = (value: unknown) => {
    if (!isOversightState(value)) return;
    version++;
    current = value;
    for (const handler of [...handlers]) handler(value);
  };
  const read = async () => {
    const before = version;
    try { const value = await pull(); if (version === before) receive(value); } catch { /* older shell */ }
    return current;
  };
  return { receive, oversight: read, onOversight(handler: (state: OversightState) => void) {
    handlers.add(handler);
    if (current) handler(current); else void read();
    return () => { handlers.delete(handler); };
  } };
}

function tauriBridge(marker: ShellMarker, internals: TauriInternals, env: BridgeEnv): Bridge {
  const themes = themeHub(marker.theme);
  const scope = oversightHub(() => internals.invoke(COMMANDS.oversight));
  env.addEventListener?.(OVERSIGHT_EVENT, event => scope.receive((event as unknown as { detail?: unknown }).detail));
  let receivedEvent = false;
  env.addEventListener?.(THEME_EVENT, (event) => {
    const detail = (event as unknown as { detail?: { theme?: unknown } }).detail;
    if (!isTheme(detail?.theme)) return;
    receivedEvent = true;
    themes.receive(detail.theme);
  });
  // Query once for hosts whose marker predates theme support. A later event wins
  // over this reply if the shell changes while the command is in flight.
  void Promise.resolve().then(() => internals.invoke(COMMANDS.theme)).then((value) => {
    if (!receivedEvent) themes.receive(value);
  }).catch(() => { /* older shells have no theme command */ });
  async function pull(): Promise<OpenedFiles | null> {
    let manifest: OpenFilesManifest | null;
    try {
      manifest = (await internals.invoke(COMMANDS.openFiles, { take: true })) as OpenFilesManifest | null;
    } catch {
      return null; // a v1 shell: no open-files
    }
    if (!manifest || !Array.isArray(manifest.files)) return null;
    const files: OpenedFiles['files'] = new Array(manifest.files.length);
    // A few reads at a time: packages hold hundreds of images.
    let next = 0;
    const worker = async () => {
      while (next < manifest!.files.length) {
        const index = next++;
        const e = manifest!.files[index];
        const bytes = toBytes(await internals.invoke(COMMANDS.readFile, { id: manifest!.id, index }));
        files[index] = { path: e.path, file: makeFile(bytes, e.path, e.type, e.lastModified) };
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return { ...manifest, files };
  }
  const onOpenFiles = deliveryHub(pull, (nudge) => {
    const listener = () => nudge();
    env.addEventListener?.(OPEN_FILES_EVENT, listener);
    return () => env.removeEventListener?.(OPEN_FILES_EVENT, listener);
  }, 'open-files');
  const onCommand = deliveryHub(async () => {
    try {
      const command = await internals.invoke(COMMANDS.takeCommand);
      return isBridgeCommand(command) ? command : null;
    } catch {
      return null; // v1/v2 hosts have no commands
    }
  }, (nudge) => {
    const listener = () => nudge();
    env.addEventListener?.(COMMAND_EVENT, listener);
    return () => env.removeEventListener?.(COMMAND_EVENT, listener);
  }, 'command');
  return {
    transport: 'tauri',
    theme: themes.theme,
    oversight: scope.oversight,
    onOversight: scope.onOversight,
    onTheme: themes.onTheme,
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
    onOpenFiles,
    onCommand,
  };
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

function frameBridge(env: BridgeEnv, module: string, opts: BridgeOptions): Bridge {
  const parent = env.parent!;
  const themes = themeHub();
  env.addEventListener?.('message', (event) => {
    if (event.source === parent && isBridgePush(event.data) && event.data.push === 'theme') {
      themes.receive(event.data.theme);
    }
  });
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

  const scope = oversightHub(() => request('oversight', {}));
  env.addEventListener?.('message', ev => {
    if (ev.source === parent && isBridgePush(ev.data) && ev.data.push === 'oversight') scope.receive(ev.data.oversight);
  });
  const onOpenFiles = deliveryHub(
    async () => {
      try {
        const r = (await request('open-files', { take: true })) as OpenFilesTransfer | null;
        if (!r || !Array.isArray(r.files)) return null;
        return { ...r, files: r.files.map((f) => ({ path: f.path, file: f.file })) };
      } catch {
        return null; // a v1 shell, or nothing waiting
      }
    },
    (nudge) => {
      const listener = (ev: MessageEvent) => {
        if (ev.source === parent && isBridgePush(ev.data) && ev.data.push === 'open-files') nudge();
      };
      env.addEventListener?.('message', listener);
      return () => env.removeEventListener?.('message', listener);
    },
    'open-files',
  );

  // Listen immediately, including before onCommand is registered. No reply is needed.
  let waiting: BridgeCommand | null = null;
  let nudgeCommand: (() => void) | null = null;
  env.addEventListener?.('message', (ev) => {
    if (ev.source !== parent || !isBridgePush(ev.data) || ev.data.push !== 'command' ||
        !isBridgeCommand(ev.data.command)) return;
    waiting = ev.data.command;
    nudgeCommand?.();
  });
  const onCommand = deliveryHub(async () => {
    const command = waiting;
    waiting = null;
    return command;
  }, (nudge) => {
    nudgeCommand = nudge;
    return () => { nudgeCommand = null; };
  }, 'command');

  return {
    transport: 'postMessage',
    theme: themes.theme,
    oversight: scope.oversight,
    onOversight: scope.onOversight,
    onTheme: themes.onTheme,
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
    onOpenFiles,
    onCommand,
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
      return tauriBridge(env![SHELL_GLOBAL]!, env!.__TAURI_INTERNALS__!, env!);
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
export const onOpenFiles = (handler: OpenFilesHandler): (() => void) => bridge().onOpenFiles(handler);
export const onCommand = (handler: CommandHandler): (() => void) => bridge().onCommand(handler);

export const theme = (): Theme | null => bridge().theme();
export const onTheme = (handler: ThemeHandler): (() => void) => bridge().onTheme(handler);

export const oversight = (): Promise<OversightState | null> => bridge().oversight();
export const onOversight = (handler: (state: OversightState) => void): (() => void) => bridge().onOversight(handler);

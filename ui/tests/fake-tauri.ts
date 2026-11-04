// A stand-in for the Tauri host, so the desktop delivery of the shell page
// (first-run wizard, native module areas, drops) can be laid out and walked
// in a plain browser. Installed with page.addInitScript before the page loads;
// it answers the commands the shell calls and records them in window.__fake.

export interface FakeOptions {
  /** Stored settings (plugin-store); mode '' shows the first-run wizard. */
  store: Record<string, string>;
  /** `files_scan` answers, by the joined paths. */
  scans?: Record<string, unknown>;
}

export function installFakeTauri(opts: FakeOptions) {
  type Cb = (msg: unknown) => void;
  const w = window as unknown as Record<string, unknown>;
  const callbacks = new Map<number, Cb>();
  const listeners = new Map<string, number[]>();
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const store = { ...opts.store };
  let next = 1;
  const status = {
    phase: 'idle',
    step: '',
    postgres: { running: false, port: null, pid: null, source: null, version: null, path: null },
    service: { running: false, port: null, pid: null, source: null, version: null, path: null },
    url: null,
    error: null,
    logTail: null,
    bundle: null,
    devDefault: '/Users/lab/Github/laicpmsdb',
    logDir: '/Users/lab/Library/Logs/edu.umn.upbstudio',
    dataDir: '/Users/lab/Library/Application Support/edu.umn.upbstudio',
  };
  w.__fake = { calls, store, listeners };
  w.__emit = (event: string, payload: unknown) =>
    (listeners.get(event) ?? []).forEach((id) => callbacks.get(id)?.({ event, id, payload }));
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  w.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'shell' } },
    transformCallback(cb: Cb) {
      const id = next++;
      callbacks.set(id, cb);
      return id;
    },
    unregisterCallback: (id: number) => callbacks.delete(id),
    convertFileSrc: (p: string) => p,
    async invoke(cmd: string, args?: Record<string, unknown>) {
      calls.push([cmd, args]);
      switch (cmd) {
        case 'plugin:event|listen': {
          const event = args!.event as string;
          listeners.set(event, [...(listeners.get(event) ?? []), args!.handler as number]);
          return args!.handler;
        }
        case 'plugin:store|load':
          return 1;
        case 'plugin:store|get':
          return [store[args!.key as string] ?? null, (args!.key as string) in store];
        case 'plugin:store|set':
          store[args!.key as string] = args!.value as string;
          return null;
        case 'local_service_status':
          return status;
        case 'probe':
          return { reachable: true };
        case 'studio_status':
          return { found: false, path: null, error: 'UPbRPy Studio is not installed' };
        case 'auth_restore':
          return { signedIn: false, account: null, offline: false };
        case 'api_get':
          return args!.path === '/v1/auth/providers' ? { status: 200, body: { orcid: true, google: true } } : { status: 401, body: {} };
        case 'files_take_opened':
          return [];
        case 'files_scan': {
          const key = (args!.paths as string[]).join('|');
          return opts.scans?.[key] ?? { scan: 's0', roots: [], entries: [], truncated: false, missing: args!.paths };
        }
        case 'files_offer':
          return { id: 'o1', files: (args!.files as unknown[]).length, bytes: 0, nudged: true };
        default:
          return null;
      }
    },
  };
}

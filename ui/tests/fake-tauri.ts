// A stand-in for the Tauri host, so the desktop delivery of the shell page
// (first-run wizard, native module areas, drops) can be laid out and walked
// in a plain browser. Installed with page.addInitScript before the page loads;
// it answers the commands the shell calls and records them in window.__fake.

export interface FakeOptions {
  /** Stored settings (plugin-store); mode '' shows the first-run wizard. */
  store: Record<string, unknown>;
  fixtures?: Record<string, unknown>;
  standards?: { warning: boolean; message: string; changed: string[] };
  signedIn?: boolean;
  grainatlasLaunchErrors?: string[];
  studioFound?: boolean;
  studioLaunchErrors?: string[];
  sessionPaths?: string[];
  folderPaths?: string[];
  projectPackages?: Record<string, unknown>;
  /** `files_scan` answers, by the joined paths. */
  scans?: Record<string, unknown>;
}

export function installFakeTauri(opts: FakeOptions) {
  type Cb = (msg: unknown) => unknown;
  const w = window as unknown as Record<string, unknown>;
  const callbacks = new Map<number, Cb>();
  const listeners = new Map<string, number[]>();
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const store = { ...opts.store };
  const fixtures = { ...opts.fixtures };
  let theme: 'light' | 'dark' = 'light';
  let offerSequence = 0;
  let quitSequence = 0;
  let next = 1;
  const launchErrors = [...(opts.grainatlasLaunchErrors ?? [])];
  const studioErrors = [...(opts.studioLaunchErrors ?? [])];
  const status = {
    phase: 'idle',
    step: '',
    postgres: { running: false, port: null, pid: null, source: null, version: null, path: null },
    service: { running: false, port: null, pid: null, source: null, version: null, path: null },
    url: null,
    error: null,
    logTail: null,
    bundle: null,
    devDefault: '/Users/lab/Github/upbdb',
    logDir: '/Users/lab/Library/Logs/edu.umn.upbstudio',
    dataDir: '/Users/lab/Library/Application Support/edu.umn.upbstudio',
  };
  // Notices standalone grainatlas and Studio leave for the shell; a spec
  // pushes onto window.__inbox and the next `inbox_take` empties it.
  const inbox: unknown[] = [];
  w.__inbox = inbox;
  w.__fake = { calls, store, listeners, fixtures };
  const emit = async (event: string, payload: unknown) => {
    await Promise.all((listeners.get(event) ?? []).map(id => callbacks.get(id)?.({ event, id, payload })));
  };
  w.__emit = emit;
  const quitRequest = () => emit('shell://quit-request', { id: ++quitSequence });
  w.__quitRequest = quitRequest;
  w.__commandResult = (id: string, command: string, result: Record<string, unknown>, source = 'images') =>
    emit('lab-bridge://notify', { source, event: { type: 'lab.command.result', id, command, ...result } });
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
        case 'plugin:event|unlisten': {
          const event = args!.event as string;
          listeners.set(event, (listeners.get(event) ?? []).filter(id => id !== args!.eventId));
          return null;
        }
        case 'plugin:window|close':
          await quitRequest();
          return null;
        case 'quit_answer':
        case 'quit_confirm':
        case 'quit_cancel':
          return null; // recorded in calls; native watchdog is covered by Rust tests
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
          return opts.studioFound ? { found: true, path: '/Applications/UPbRPy Studio.app', kind: 'installed' } : { found: false, path: null, error: 'UPbRPy Studio is not installed' };
        case 'studio_launch': {
          const error = studioErrors.shift();
          if (error) throw new Error(error);
          return { command: 'Studio opened' };
        }
        case 'standards_check':
          return opts.standards ?? null;
        case 'auth_restore':
          return { signedIn: opts.signedIn ?? false, account: opts.signedIn ? { username: 'demo', display_name: 'Demo analyst' } : null, offline: false };
        case 'auth_handoff':
          return 'ONE-TIME-FIXTURE';
        case 'grainatlas_launch': {
          const error = launchErrors.shift();
          if (error) throw new Error(error);
          return null;
        }
        case 'grainatlas_open_paths':
          return null; // recorded in calls; the standalone app takes the files
        case 'inbox_take':
          return inbox.splice(0);
        case 'module_theme':
          if (args?.theme !== 'light' && args?.theme !== 'dark') throw new Error('invalid bridge theme');
          theme = args.theme;
          return null;
        case 'bridge_theme':
          return theme;
        case 'module_command':
          return false; // exercises loading the target without leaving Review
        case 'api_get':
          if (Object.prototype.hasOwnProperty.call(fixtures, args!.path as string)) return { status: 200, body: fixtures[args!.path as string] };
          return args!.path === '/v1/auth/providers' ? { status: 200, body: { orcid: true, google: true } } : { status: 401, body: {} };
        case 'files_pick_session':
          return opts.sessionPaths ?? [];
        case 'plugin:dialog|open':
          return opts.folderPaths ?? [];
        case 'files_project_package':
          return opts.projectPackages?.[args!.path as string] ?? null;
        case 'files_take_opened':
          return [];
        case 'files_scan': {
          const key = (args!.paths as string[]).join('|');
          return opts.scans?.[key] ?? { scan: 's0', roots: [], entries: [], truncated: false, missing: args!.paths };
        }
        case 'files_offer':
          return { id: `o${++offerSequence}`, files: (args!.files as unknown[]).length, bytes: 0, nudged: true };
        default:
          return null;
      }
    },
  };
}

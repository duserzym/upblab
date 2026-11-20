// A stand-in for the Tauri host, so the desktop delivery of the shell page
// (first-run wizard, native module areas, drops) can be laid out and walked
// in a plain browser. Installed with page.addInitScript before the page loads;
// it answers the commands the shell calls and records them in window.__fake.

export interface FakeOptions {
  /** Stored settings (plugin-store); mode '' shows the first-run wizard. */
  store: Record<string, unknown>;
  appVersion?: string;
  update?: { version: string; currentVersion: string; notes: string | null; date: string | null; ready: boolean };
  fixtures?: Record<string, unknown>;
  standards?: { warning: boolean; message: string; changed: string[] };
  signedIn?: boolean;
  canViewAs?: boolean;
  apiPassthrough?: boolean;
  offline?: boolean;
  offlineCopy?: string;
  peopleAllowed?: boolean;
  cached?: { asOf: string; reason: 'unreachable' | 'server_error'; detail?: string };
  apiReplies?: Record<string, { offlineCopy?: string; status: number; body: unknown; cached?: { asOf: string; reason: 'unreachable' | 'server_error'; detail?: string }; nextCursor?: string }>;
  localSessions?: { path: string; key: string; format?: string | null; openable?: boolean; id: string | null; material: string | null; kind: string | null; started_at: string | null; acquisitions: number; has_project: boolean; modified: string }[];
  cacheStatus?: { entries: number; bytes: number; newest: string | null; oldest: string | null };
  grainatlasLaunchErrors?: string[];
  studioFound?: boolean;
  studioVersion?: string;
  studioLaunchErrors?: string[];
  sessionPaths?: string[];
  folderPaths?: string[];
  projectPackages?: Record<string, unknown>;
  /** `files_scan` answers, by the joined paths. */
  scans?: Record<string, unknown>;
  /** Paint native child webviews with bridge-connected iframes (docs previews). */
  renderModules?: boolean;
}

export function installFakeTauri(opts: FakeOptions) {
  // addInitScript also runs in child frames. They must use their real bridge.
  if (opts.renderModules && window.parent !== window) return;
  type Cb = (msg: unknown) => unknown;
  const w = window as unknown as Record<string, unknown>;
  const callbacks = new Map<number, Cb>();
  const listeners = new Map<string, number[]>();
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const writes: { method: string; path: string; body: unknown; idempotencyKey?: string }[] = [];
  const bridgeTokens: { module: string; token: string | null }[] = [];
  const moduleToken = (module: string) => {
    const token = opts.signedIn ? 'DEMO-SCREENSHOTS-TOKEN' : null;
    bridgeTokens.push({ module, token });
    return token; // Embedded modules can read a copy; standalone launches remain local.
  };
  const store = { ...opts.store };
  let update = opts.update;
  const fixtures = { ...opts.fixtures };
  const apiReplies = { ...opts.apiReplies };
  const apiGates = new Map<string, { wait: Promise<void>; release: () => void }>();
  const holdApi = (key: string) => {
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    apiGates.set(key, { wait, release });
  };
  const releaseApi = (key: string) => { const gate = apiGates.get(key); apiGates.delete(key); gate?.release(); };
  let savedReply = opts.cached;
  let offline = opts.offline ?? false;
  let theme: 'light' | 'dark' = 'light';
  let oversight = { viewAs: null, onBehalf: false } as { viewAs: { username: string; name: string } | null; onBehalf: boolean };
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
  w.__fake = { calls, writes, bridgeTokens, store, listeners, fixtures, apiReplies, holdApi, releaseApi, goOnline: () => { savedReply = undefined; offline = false; } };
  const emit = async (event: string, payload: unknown) => {
    await Promise.all((listeners.get(event) ?? []).map(id => callbacks.get(id)?.({ event, id, payload })));
  };
  w.__emit = emit;
  type ModuleFrame = { frame: HTMLIFrameElement; loaded: boolean; scope?: string };
  const modules = new Map<string, ModuleFrame>();
  // Rust keeps presentation separately from the newest focus/visibility command,
  // including commands sent before the child webview exists.
  const waitingCommands = new Map<string, { presentation?: unknown; command?: unknown }>();
  const latestCommands = new Map<string, Record<string, unknown>>();
  const latestPresentation = new Map<string, Record<string, unknown>>();
  const queueCommand = (module: string, command: Record<string, unknown>) => {
    const pending = waitingCommands.get(module) ?? {};
    if (command.type === 'set-presentation') { pending.presentation = command; latestPresentation.set(module, command); }
    else { pending.command = command; latestCommands.set(module, command); }
    waitingCommands.set(module, pending);
  };
  // Rust's theme script marks each module page's <html>; same-origin frames get the same here.
  const markTheme = (entry: ModuleFrame) => {
    try { entry.frame.contentDocument?.documentElement.setAttribute('data-theme', theme); } catch { /* cross-origin */ }
  };
  const push = (entry: ModuleFrame, body: Record<string, unknown>) =>
    entry.frame.contentWindow?.postMessage({ tag: 'lab-bridge', v: 5, ...body }, new URL(entry.frame.src).origin);
  const move = (entry: ModuleFrame, bounds: Record<string, number>) => {
    Object.assign(entry.frame.style, {
      left: `${bounds.x}px`, top: `${bounds.y}px`,
      width: `${bounds.width}px`, height: `${bounds.height}px`,
    });
  };
  if (opts.renderModules) window.addEventListener('message', event => {
    const match = [...modules].find(([, entry]) => entry.frame.contentWindow === event.source &&
      new URL(entry.frame.src).origin === event.origin);
    const request = event.data;
    if (!match || request?.tag !== 'lab-bridge' || typeof request.id !== 'string' || !request.op) return;
    const [module] = match;
    const reply = (result: unknown) => (event.source as WindowProxy).postMessage(
      { tag: 'lab-bridge', v: 5, id: request.id, ok: true, result }, event.origin);
    switch (request.op) {
      case 'token': reply(moduleToken(module)); break;
      case 'oversight': reply(oversight); break;
      case 'open-files': reply(null); break;
      case 'notify': void emit('lab-bridge://notify', { source: module, event: request.event }); break;
      case 'open': void emit('lab-bridge://open', { source: module, url: request.url }); reply(true); break;
    }
  });
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
        case 'plugin:app|version': return opts.appVersion ?? '0.1.0';
        case 'update_supported': return !!update;
        case 'update_check':
        case 'update_status': return update ?? null;
        case 'update_download':
          if (update) update = { ...update, ready: true };
          return update ?? null;
        case 'plugin:store|delete': {
          const present = (args!.key as string) in store;
          delete store[args!.key as string];
          return present;
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
          return opts.studioFound ? { found: true, path: '/Applications/UPbRPy Studio.app', kind: 'installed', version: opts.studioVersion } : { found: false, path: null, error: 'UPbRPy Studio is not installed' };
        case 'local_sessions': return opts.localSessions ?? [];
        case 'studio_open_local':
        case 'studio_launch': {
          const error = studioErrors.shift();
          if (error) throw new Error(error);
          return { command: 'Studio opened' };
        }
        case 'standards_check':
          return opts.standards ?? null;
        case 'auth_restore':
          return { signedIn: opts.signedIn ?? false, account: opts.signedIn ? { id: 'invented-account', username: 'demo', display_name: 'Demo analyst', can_view_as: opts.canViewAs ?? false, can_manage_people: opts.peopleAllowed ?? false } : null, offline: opts.offline ?? false, offlineCopy: opts.offlineCopy };
        case 'auth_handoff':
          if (opts.apiPassthrough) {
            const res = await fetch(String((args!.target as { server: string }).server) + '/v1/auth/handoff', { method: 'POST', headers: { Authorization: 'Bearer DEMO-SCREENSHOTS-TOKEN', ...(args!.onBehalf ? { 'X-UPbDB-Oversight': 'on-behalf' } : {}) }, body: '{}' });
            const body = await res.json();
            if (!res.ok) throw JSON.stringify({ status: res.status, body });
            return body.code;
          }
          return 'ONE-TIME-FIXTURE';
        case 'grainatlas_launch': {
          if (opts.offlineCopy && args?.server) throw new Error('GrainAtlas cannot connect to a read-only copy of UPbDB');
          const error = launchErrors.shift();
          if (error) throw new Error(error);
          return null;
        }
        case 'grainatlas_open_paths':
          return null; // recorded in calls; the standalone app takes the files
        case 'inbox_take':
          return inbox.splice(0);
        case 'module_oversight':
          oversight = args!.oversight as typeof oversight;
          for (const entry of modules.values()) if (entry.loaded) push(entry, { push: 'oversight', oversight });
          return null;
        case 'bridge_oversight': return oversight;
        case 'module_theme':
          if (args?.theme !== 'light' && args?.theme !== 'dark') throw new Error('invalid bridge theme');
          theme = args.theme;
          for (const entry of modules.values()) if (entry.loaded) { markTheme(entry); push(entry, { push: 'theme', theme }); push(entry, { push: 'oversight', oversight }); }
          return null;
        case 'bridge_theme':
          return theme;
        case 'module_open': {
          if (!opts.renderModules) return null;
          const module = args!.module as string;
          let entry = modules.get(module);
          if (entry && entry.scope !== args!.scope) { entry.frame.remove(); modules.delete(module); entry = undefined; }
          if (!entry) {
            const frame = document.createElement('iframe');
            frame.name = `lab-shell:${module}`;
            frame.title = `Demo ${module} module`;
            frame.dataset.fakeModule = module;
            Object.assign(frame.style, { position: 'absolute', border: '0', zIndex: '10' });
            entry = { frame, loaded: false, scope: args!.scope as string | undefined };
            modules.set(module, entry);
            const created = entry;
            frame.addEventListener('load', () => {
              created.loaded = true;
              markTheme(created);
              push(created, { push: 'theme', theme });
              // Let the shell reapply presentation first. The bridge retains
              // only the latest waiting command, so queued focus must go last.
              void emit('lab-bridge://ready', { module });
              const pending = waitingCommands.get(module);
              waitingCommands.delete(module);
              if (pending?.presentation) push(created, { push: 'command', command: pending.presentation });
              if (pending?.command) push(created, { push: 'command', command: pending.command });
              // The bridge keeps one waiting command until the module registers its
              // handler; replay presentation, then the newest command, a few times.
              for (const delay of [400, 1200, 2500]) setTimeout(() => {
                if (!created.loaded) return;
                const presentation = latestPresentation.get(module);
                if (presentation) push(created, { push: 'command', command: presentation });
                const last = latestCommands.get(module);
                if (last) push(created, { push: 'command', command: last });
              }, delay);
            });
          }
          for (const [other, value] of modules) if (other !== module) value.frame.style.display = 'none';
          move(entry, args!.bounds as Record<string, number>);
          entry.frame.style.display = 'block';
          if (args!.navigate !== false || !entry.frame.getAttribute('src')) {
            entry.loaded = false;
            entry.frame.src = args!.url as string;
          }
          if (!entry.frame.isConnected) document.body.append(entry.frame);
          return null;
        }
        case 'module_bounds': {
          if (!opts.renderModules) return null;
          const entry = modules.get(args!.module as string);
          if (entry) move(entry, args!.bounds as Record<string, number>);
          return null;
        }
        case 'module_hide': {
          if (!opts.renderModules) return null;
          const entry = modules.get(args!.module as string);
          if (entry) entry.frame.style.display = 'none';
          return null;
        }
        case 'module_reload': {
          if (!opts.renderModules) return null;
          const entry = modules.get(args!.module as string);
          if (entry) { entry.loaded = false; entry.frame.src = entry.frame.src; }
          return null;
        }
        case 'module_command': {
          if (!opts.renderModules) return false;
          const module = args!.module as string;
          const entry = modules.get(module);
          if (!entry || !entry.loaded) {
            queueCommand(module, args!.command as Record<string, unknown>);
            return !!entry;
          }
          push(entry, { push: 'command', command: args!.command });
          // Like Rust, keep presentation apart from the newest focus/visibility
          // command: the bridge holds one waiting command until the module
          // registers, so re-send that command after a presentation change.
          const command = args!.command as Record<string, unknown>;
          if (command.type === 'set-presentation') {
            latestPresentation.set(module, command);
            const last = latestCommands.get(module);
            if (last) push(entry, { push: 'command', command: last });
          } else latestCommands.set(module, command);
          return true;
        }
        case 'cache_status': return opts.cacheStatus ?? { entries: Object.keys(fixtures).length, bytes: 4096, newest: opts.cached?.asOf ?? null, oldest: opts.cached?.asOf ?? null };
        case 'cache_clear':
          opts.cacheStatus = { entries: 0, bytes: 0, newest: null, oldest: null };
          return null;
        case 'cache_prefetch': return { fetched: opts.offline ? 0 : (args!.paths as string[]).length, unchanged: 0, failed: opts.offline ? 1 : 0 };
        case 'api_write':
        case 'api_get': {
          if (cmd === 'api_write') writes.push({ method: String(args!.method), path: String(args!.path), body: args!.body, idempotencyKey: args!.idempotencyKey as string | undefined });
          if (opts.apiPassthrough) {
            const res = await fetch(String((args!.target as { server: string }).server) + String(args!.path), { method: cmd === 'api_get' ? 'GET' : String(args!.method), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer DEMO-SCREENSHOTS-TOKEN', ...(args!.onBehalf ? { 'X-UPbDB-Oversight': 'on-behalf' } : {}), ...(args!.idempotencyKey ? { 'Idempotency-Key': String(args!.idempotencyKey) } : {}) }, ...(cmd === 'api_write' ? { body: JSON.stringify(args!.body) } : {}) });
            return { status: res.status, body: await res.json(), nextCursor: res.headers.get('X-Next-Cursor') ?? undefined, retryAfter: res.headers.get('Retry-After') ?? undefined };
          }
          const path = args!.path as string;
          const requestKey = `${cmd === 'api_get' ? 'GET' : args!.method} ${path}`;
          const reply = apiReplies[requestKey] ?? apiReplies[path];
          await apiGates.get(requestKey)?.wait;
          if (reply) return { offlineCopy: opts.offlineCopy, ...reply };
          const key = Object.prototype.hasOwnProperty.call(fixtures, path) ? path : path.replace('?limit=500', '');
          if (Object.prototype.hasOwnProperty.call(fixtures, key)) return { offlineCopy: opts.offlineCopy, status: 200, body: fixtures[key], ...(savedReply ? { cached: savedReply } : {}) };
          if (offline) throw new Error('server unreachable: connection failed');
          return args!.path === '/v1/auth/providers' ? { offlineCopy: opts.offlineCopy, status: 200, body: { orcid: true, google: true } } : { offlineCopy: opts.offlineCopy, status: 401, body: {} };
        }
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

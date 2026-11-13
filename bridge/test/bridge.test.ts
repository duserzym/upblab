import { describe, expect, it, vi } from 'vitest';
import {
  COMMANDS,
  COMMAND_EVENT,
  THEME_EVENT,
  isBridgeCommand,
  isBridgePush,
  spotSelection,
  ATLAS_EVENTS,
  atlasStatus,
  atlasDrafts,
  atlasSynced,
  type BridgeCommand,
  MESSAGE_TAG,
  OPEN_FILES_EVENT,
  PROTOCOL_VERSION,
  isBridgeRequest,
  type OpenedFiles,
  createBridge,
  detectTransport,
  type BridgeEnv,
} from '../src/index';
import { createFrameHost, frameName, pushOpenFiles, pushCommand, pushTheme } from '../src/host';

it('validates optional review overlay colours while accepting older commands and unknown fields', () => {
  const command = { type: 'review-spots', projects: { p: ['s'] } };
  expect(isBridgeCommand(command)).toBe(true);
  expect(isBridgeCommand({ ...command, colors: { p: { s: '#aB12fF' } }, future: true })).toBe(true);
  expect(isBridgeCommand({ ...command, colors: {} })).toBe(true);
  for (const colors of [null, [], { 'bad/id': {} }, { p: [] }, { p: null }, { p: { 'bad/id': '#123456' } }])
    expect(isBridgeCommand({ ...command, colors })).toBe(false);
  for (const color of ['red', '123456', '#123', '#1234567', '#gg1234', '#12345\n', '#123456\n', '#é1234', 123456, null])
    expect(isBridgeCommand({ ...command, colors: { p: { s: color } } })).toBe(false);
  const projects = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`p${i}`, {}]));
  expect(isBridgeCommand({ ...command, colors: projects })).toBe(true);
  expect(isBridgeCommand({ ...command, colors: { ...projects, extra: {} } })).toBe(false);
  const spots = Object.fromEntries(Array.from({ length: 10000 }, (_, i) => [`s${i}`, '#123456']));
  expect(isBridgeCommand({ ...command, colors: { p: spots } })).toBe(true);
  expect(isBridgeCommand({ ...command, colors: { p: { ...spots, extra: '#123456' } } })).toBe(false);
});

describe('detectTransport', () => {
  it('is none without a window', () => {
    expect(detectTransport(undefined)).toBe('none');
  });

  it('is none for a plain page', () => {
    const env: BridgeEnv = { name: '', parent: null };
    expect(detectTransport(env)).toBe('none');
  });

  it('is none for a standalone Tauri app without the shell marker', () => {
    const env: BridgeEnv = { __TAURI_INTERNALS__: { invoke: vi.fn() } };
    expect(detectTransport(env)).toBe('none');
  });

  it('is tauri when the shell marked the webview', () => {
    const env: BridgeEnv = { __LAB_SHELL__: { module: 'grainatlas', v: 1 }, __TAURI_INTERNALS__: { invoke: vi.fn() } };
    expect(detectTransport(env)).toBe('tauri');
  });

  it('is postMessage inside a named shell iframe', () => {
    const parent = { postMessage: vi.fn() };
    const env: BridgeEnv = { name: frameName('laicpmsdb'), parent, self: {} };
    expect(detectTransport(env)).toBe('postMessage');
  });

  it('is none for a top-level page that happens to have the frame name', () => {
    const env: BridgeEnv = { name: frameName('laicpmsdb') };
    env.parent = env as never;
    env.self = env;
    expect(detectTransport(env)).toBe('none');
  });
});

describe('no-op bridge', () => {
  it('refuses open, has no token and swallows notify', async () => {
    const b = createBridge({});
    expect(b.transport).toBe('none');
    expect(b.isHosted()).toBe(false);
    expect(await b.open('laicpmsdb://acquisition/x')).toBe(false);
    expect(await b.token()).toBeNull();
    await expect(b.notify({ type: 'x' })).resolves.toBeUndefined();
  });
});

describe('tauri bridge', () => {
  it('invokes the shell commands', async () => {
    const invoke = vi.fn(async (cmd: string) => (cmd === COMMANDS.token ? 'tok' : true));
    const b = createBridge({ __LAB_SHELL__: { module: 'grainatlas', v: 1 }, __TAURI_INTERNALS__: { invoke } });
    expect(b.module).toBe('grainatlas');
    expect(b.isHosted()).toBe(true);
    expect(await b.open('laicpmsdb://acquisition/a1')).toBe(true);
    expect(invoke).toHaveBeenCalledWith(COMMANDS.open, { url: 'laicpmsdb://acquisition/a1' });
    expect(await b.token()).toBe('tok');
    await b.notify({ type: 'grainatlas.spot.selected', spot: 's1' });
    expect(invoke).toHaveBeenCalledWith(COMMANDS.notify, { event: { type: 'grainatlas.spot.selected', spot: 's1' } });
  });

  it('turns command failures into false and null', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('not allowed');
    });
    const b = createBridge({ __LAB_SHELL__: { module: 'laicpmsdb', v: 1 }, __TAURI_INTERNALS__: { invoke } });
    expect(await b.open('x://y')).toBe(false);
    expect(await b.token()).toBeNull();
    await expect(b.notify({ type: 't' })).resolves.toBeUndefined();
  });

  it('treats an empty token as signed out', async () => {
    const b = createBridge({
      __LAB_SHELL__: { module: 'laicpmsdb', v: 1 },
      __TAURI_INTERNALS__: { invoke: async () => '' },
    });
    expect(await b.token()).toBeNull();
  });
});

/** Node's MessageEvent only accepts MessagePort sources; fake the window-sourced kind. */
function msgEvent(init: { data: unknown; origin: string; source: unknown }): Event {
  return Object.assign(new Event('message'), init);
}

/** A child window and its parent, wired so postMessage dispatches MessageEvents. */
function framePair(origin = 'https://lab.example') {
  const childTarget = new EventTarget();
  const parentTarget = new EventTarget();
  const child: Record<string, unknown> = {};
  const parent = {
    postMessage(data: unknown) {
      queueMicrotask(() =>
        parentTarget.dispatchEvent(msgEvent({ data, origin, source: child })),
      );
    },
  };
  Object.assign(child, {
    postMessage(data: unknown) {
      queueMicrotask(() =>
        childTarget.dispatchEvent(msgEvent({ data, origin, source: parent })),
      );
    },
  });
  const env: BridgeEnv = {
    name: frameName('laicpmsdb'),
    parent,
    self: child,
    addEventListener: (t, l) => childTarget.addEventListener(t, l as EventListener),
    removeEventListener: (t, l) => childTarget.removeEventListener(t, l as EventListener),
  };
  return { env, parentTarget, childTarget, child, origin };
}

describe('postMessage bridge with frame host', () => {
  it('round-trips open, token and notify', async () => {
    const { env, parentTarget, child, origin } = framePair();
    const opened: string[] = [];
    const events: unknown[] = [];
    const stop = createFrameHost(
      {
        open: (url, module) => {
          opened.push(`${module} ${url}`);
          return url.startsWith('grainatlas://');
        },
        token: () => 'secret',
        notify: (e, module) => events.push({ module, ...e }),
      },
      {
        allowedOrigins: () => [origin],
        moduleOf: (src) => ((src as unknown) === child ? 'laicpmsdb' : null),
        target: parentTarget as never,
      },
    );
    const b = createBridge(env, { timeoutMs: 200 });
    expect(b.transport).toBe('postMessage');
    expect(b.module).toBe('laicpmsdb');
    expect(await b.open('grainatlas://project/p/spot/s')).toBe(true);
    expect(await b.open('mailto:x@y')).toBe(false);
    expect(await b.token()).toBe('secret');
    await b.notify({ type: 'laicpmsdb.session.viewed', id: 's1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(opened).toEqual(['laicpmsdb grainatlas://project/p/spot/s', 'laicpmsdb mailto:x@y']);
    expect(events).toEqual([{ module: 'laicpmsdb', type: 'laicpmsdb.session.viewed', id: 's1' }]);
    stop();
  });

  it('ignores untrusted origins, so the module times out to its fallback', async () => {
    const { env, parentTarget, child } = framePair('https://evil.example');
    const open = vi.fn(() => true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stop = createFrameHost(
      { open, token: () => 'secret', notify: () => {} },
      { allowedOrigins: () => ['https://lab.example'], moduleOf: () => 'laicpmsdb', target: parentTarget as never },
    );
    const b = createBridge(env, { timeoutMs: 50 });
    expect(await b.token()).toBeNull();
    expect(await b.open('laicpmsdb://session/1')).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    stop();
    void child;
  });

  it('ignores replies that come from somewhere other than the parent', async () => {
    const { env, childTarget } = framePair();
    const b = createBridge(env, { timeoutMs: 50 });
    const pending = b.token();
    // A sibling frame forges a reply with a guessed id: wrong source, ignored.
    const forged = { tag: MESSAGE_TAG, v: PROTOCOL_VERSION, id: 'guess', ok: true, result: 'x' };
    childTarget.dispatchEvent(msgEvent({ data: forged, origin: 'https://lab.example', source: {} }));
    expect(await pending).toBeNull();
  });
});

describe('open-files (protocol v2)', () => {
  const manifest = {
    id: 'o1',
    kind: 'area',
    name: '001_HJ-GC1',
    path: '/data/001_HJ-GC1',
    files: [
      { path: '001_HJ-GC1_0000.jpg', size: 3, lastModified: 1700000000000, type: 'image/jpeg' },
      { path: 'sub/001_HJ-GC1_0000.txt', size: 2, lastModified: 0, type: 'text/plain' },
    ],
  };

  it('still accepts v1 requests and knows the new op', () => {
    expect(PROTOCOL_VERSION).toBe(4);
    expect(isBridgeRequest({ tag: MESSAGE_TAG, v: 1, id: 'a', op: 'token' })).toBe(true);
    expect(isBridgeRequest({ tag: MESSAGE_TAG, v: 2, id: 'a', op: 'open-files' })).toBe(true);
    expect(isBridgeRequest({ tag: MESSAGE_TAG, v: 2, id: 'a', op: 'delete' })).toBe(false);
  });

  it('tauri: pulls waiting files on registration and on every nudge, bytes per file', async () => {
    const target = new EventTarget();
    let waiting: typeof manifest | null = manifest;
    const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === COMMANDS.openFiles) {
        const m = waiting;
        waiting = null;
        return m;
      }
      if (cmd === COMMANDS.readFile) return new TextEncoder().encode(args!.index === 0 ? 'jpg' : 'tx').buffer;
      return null;
    });
    const b = createBridge({
      __LAB_SHELL__: { module: 'grainatlas', v: 2 },
      __TAURI_INTERNALS__: { invoke },
      addEventListener: (t, l) => target.addEventListener(t, l as EventListener),
      removeEventListener: (t, l) => target.removeEventListener(t, l as EventListener),
    });
    const got: OpenedFiles[] = [];
    const stop = b.onOpenFiles((f) => void got.push(f));
    await vi.waitFor(() => expect(got).toHaveLength(1));
    expect(got[0].kind).toBe('area');
    expect(got[0].name).toBe('001_HJ-GC1');
    expect(got[0].files.map((f) => f.path)).toEqual(['001_HJ-GC1_0000.jpg', 'sub/001_HJ-GC1_0000.txt']);
    const [jpg, txt] = got[0].files.map((f) => f.file);
    expect(jpg.name).toBe('001_HJ-GC1_0000.jpg');
    expect(jpg.type).toBe('image/jpeg');
    expect(await jpg.text()).toBe('jpg');
    expect(txt.name).toBe('001_HJ-GC1_0000.txt');
    expect((txt as File & { webkitRelativePath: string }).webkitRelativePath).toBe('sub/001_HJ-GC1_0000.txt');
    expect(invoke).toHaveBeenCalledWith(COMMANDS.readFile, { id: 'o1', index: 1 });

    waiting = { ...manifest, id: 'o2' };
    target.dispatchEvent(new Event(OPEN_FILES_EVENT));
    await vi.waitFor(() => expect(got).toHaveLength(2));
    expect(got[1].id).toBe('o2');
    stop();
    waiting = { ...manifest, id: 'o3' };
    target.dispatchEvent(new Event(OPEN_FILES_EVENT));
    await new Promise((r) => setTimeout(r, 10));
    expect(got).toHaveLength(2);
  });

  it('tauri: an older shell without the command delivers nothing', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('command bridge_open_files not found');
    });
    const b = createBridge({ __LAB_SHELL__: { module: 'laicpmsdb', v: 1 }, __TAURI_INTERNALS__: { invoke } });
    const handler = vi.fn();
    b.onOpenFiles(handler);
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).not.toHaveBeenCalled();
  });

  it('postMessage: the push makes the module ask, and Files come back', async () => {
    const { env, parentTarget, child, childTarget, origin } = framePair();
    let waiting: OpenedFiles | null = null;
    const stop = createFrameHost(
      {
        open: () => true,
        token: () => null,
        notify: () => {},
        openFiles: (module, take) => {
          const w = module === 'laicpmsdb' ? waiting : null;
          if (take) waiting = null;
          return w;
        },
      },
      { allowedOrigins: () => [origin], moduleOf: (src) => ((src as unknown) === child ? 'laicpmsdb' : null), target: parentTarget as never },
    );
    const b = createBridge(env, { timeoutMs: 200 });
    const got: OpenedFiles[] = [];
    b.onOpenFiles((f) => void got.push(f));
    await new Promise((r) => setTimeout(r, 10));
    expect(got).toHaveLength(0); // nothing waiting at registration

    waiting = { id: 'w1', kind: 'csv', name: 'Apatite_demo', files: [{ path: 'a.csv', file: new File(['x,y'], 'a.csv') }] };
    // The shell's push, as the parent posts it into the iframe.
    pushOpenFiles(
      {
        postMessage: (data: unknown) =>
          queueMicrotask(() => childTarget.dispatchEvent(msgEvent({ data, origin, source: env.parent }))),
      } as never,
      origin,
    );
    await vi.waitFor(() => expect(got).toHaveLength(1));
    expect(got[0].kind).toBe('csv');
    expect(await got[0].files[0].file.text()).toBe('x,y');
    expect(waiting).toBeNull();
    stop();
  });

  it('postMessage: a v1 shell host answers null', async () => {
    const { env, parentTarget, child, origin } = framePair();
    const stop = createFrameHost(
      { open: () => true, token: () => null, notify: () => {} },
      { allowedOrigins: () => [origin], moduleOf: (src) => ((src as unknown) === child ? 'laicpmsdb' : null), target: parentTarget as never },
    );
    const handler = vi.fn();
    createBridge(env, { timeoutMs: 100 }).onOpenFiles(handler);
    await new Promise((r) => setTimeout(r, 20));
    expect(handler).not.toHaveBeenCalled();
    stop();
  });
});


describe('commands (protocol v3)', () => {
  const first: BridgeCommand = { type: 'focus-spot', project: 'p', spot: 'first' };
  const latest: BridgeCommand = { type: 'focus-grain', project: 'p', grain: 'area/2', spot: 'latest', flash: true, via: 'review' };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('validates ids, command types and optional fields', () => {
    expect(isBridgeCommand(first)).toBe(true);
    expect(isBridgeCommand(latest)).toBe(true);
    expect(isBridgeCommand({ ...latest, grain: 'grain-id' })).toBe(true);
    expect(isBridgeCommand({ ...first, project: 'a'.repeat(128) })).toBe(true);
    for (const id of ['', '-bad', 'a/b', 'a b', 'é', 'a?b', 'a\n', 'a'.repeat(129)]) {
      expect(isBridgeCommand({ ...first, project: id })).toBe(false);
      expect(isBridgeCommand({ ...first, spot: id })).toBe(false);
    }
    for (const grain of ['', '/g', 'g/', 'a/b/c', 'a//b']) {
      expect(isBridgeCommand({ ...latest, grain })).toBe(false);
    }
    for (const command of [null, {}, { ...first, type: 'future' }, { ...first, flash: 'yes' },
      { ...first, via: true }, { ...latest, spot: null }]) expect(isBridgeCommand(command)).toBe(false);
    expect(isBridgePush({ tag: MESSAGE_TAG, v: 3, push: 'command', command: first })).toBe(true);
    expect(isBridgePush({ tag: MESSAGE_TAG, v: 1, push: 'open-files' })).toBe(true);
    expect(isBridgePush({ tag: MESSAGE_TAG, v: 3, push: 'future' })).toBe(false);
  });

  it('validates optional published atlas servers on both focus commands', () => {
    for (const command of [first, latest]) {
      for (const server of ['http://localhost:8000', 'https://lab.example/atlas', 'https://h/' + 'x'.repeat(2038)]) expect(isBridgeCommand({ ...command, server })).toBe(true);
      for (const server of [null, true, '', 'file:///tmp/a', 'javascript:alert(1)', 'https://', 'https://h/ a', 'https://h/\n', 'https://h/' + 'x'.repeat(2040)]) expect(isBridgeCommand({ ...command, server })).toBe(false);
    }
  });

  it('tauri: takes the newest waiting command once on registration and nudges', async () => {
    const target = new EventTarget();
    let waiting: unknown = first;
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd !== COMMANDS.takeCommand) return null;
      const command = waiting;
      waiting = null;
      return command;
    });
    const b = createBridge({
      __LAB_SHELL__: { module: 'grainatlas', v: 3 }, __TAURI_INTERNALS__: { invoke },
      addEventListener: (t, l) => target.addEventListener(t, l as EventListener),
      removeEventListener: (t, l) => target.removeEventListener(t, l as EventListener),
    });
    waiting = latest; // replaces an untaken command
    const handler = vi.fn();
    const stop = b.onCommand(handler);
    await tick();
    expect(invoke).toHaveBeenCalledWith(COMMANDS.takeCommand);
    expect(handler).toHaveBeenCalledExactlyOnceWith(latest);
    target.dispatchEvent(new Event(COMMAND_EVENT));
    await tick();
    expect(handler).toHaveBeenCalledTimes(1);
    waiting = { ...first, spot: 'invalid/id' };
    target.dispatchEvent(new Event(COMMAND_EVENT));
    await tick();
    expect(handler).toHaveBeenCalledTimes(1);
    waiting = first;
    target.dispatchEvent(new Event(COMMAND_EVENT));
    await tick();
    expect(handler).toHaveBeenLastCalledWith(first);
    stop();
    waiting = latest;
    target.dispatchEvent(new Event(COMMAND_EVENT));
    await tick();
    expect(handler).toHaveBeenCalledTimes(2);
    b.onCommand(handler);
    await tick();
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('tauri: a v2 host missing takeCommand silently delivers nothing', async () => {
    const warn = vi.spyOn(console, 'warn');
    const invoke = vi.fn(async () => { throw new Error('command bridge_take_command not found'); });
    const handler = vi.fn();
    createBridge({ __LAB_SHELL__: { module: 'grainatlas', v: 2 }, __TAURI_INTERNALS__: { invoke } }).onCommand(handler);
    await tick();
    expect(handler).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('web: queues before registration, keeps newest, validates and checks the source', async () => {
    const { env, childTarget, origin } = framePair();
    const b = createBridge(env);
    const postMessage = vi.fn();
    env.parent!.postMessage = postMessage;
    const push = (command: unknown, source: unknown = env.parent) => childTarget.dispatchEvent(msgEvent({
      data: { tag: MESSAGE_TAG, v: 3, push: 'command', command }, origin, source,
    }));
    push(first);
    push(latest);
    push({ ...first, project: '../bad' });
    push(first, {});
    const handler = vi.fn();
    const stop = b.onCommand(handler);
    await tick();
    expect(handler).toHaveBeenCalledExactlyOnceWith(latest);
    expect(postMessage).not.toHaveBeenCalled(); // no request or acknowledgement
    push({ ...first, type: 'future' });
    push({ ...first, spot: 12 });
    childTarget.dispatchEvent(msgEvent({ data: { tag: MESSAGE_TAG, v: 3, push: 'open-files' }, origin, source: env.parent }));
    await tick();
    expect(handler).toHaveBeenCalledTimes(1);
    push(first);
    await tick();
    expect(handler).toHaveBeenCalledTimes(2);
    stop();
    push(first);
    push(latest);
    await tick();
    expect(handler).toHaveBeenCalledTimes(2);
    b.onCommand(handler);
    await tick();
    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler).toHaveBeenLastCalledWith(latest);
  });

  it('web: on a v2 shell registration sends nothing and delivers nothing', async () => {
    const { env } = framePair();
    const postMessage = vi.fn();
    env.parent!.postMessage = postMessage;
    const handler = vi.fn();
    createBridge(env).onCommand(handler);
    await tick();
    expect(handler).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('noop: never fires', async () => {
    const handler = vi.fn();
    const stop = createBridge({}).onCommand(handler);
    await tick();
    stop();
    expect(handler).not.toHaveBeenCalled();
  });

  it('host pushCommand posts the current envelope to the requested origin', () => {
    const frame = { postMessage: vi.fn() };
    pushCommand(frame, latest, 'https://lab.example');
    expect(frame.postMessage).toHaveBeenCalledExactlyOnceWith({
      tag: MESSAGE_TAG, v: PROTOCOL_VERSION, push: 'command', command: latest,
    }, 'https://lab.example');
  });
});

describe('spotSelection', () => {
  it('normalises current and legacy selections and preserves shell provenance', () => {
    const base = { project: 'p', spot: 's', name: 'spot 1' };
    expect(spotSelection({ type: 'grainatlas.spot.selected', ...base })).toEqual({
      type: 'lab.spot.selected', ...base, via: 'user',
    });
    expect(spotSelection({ type: 'grainatlas.spot.selected', ...base, via: 'shell' })?.via).toBe('user');
    expect(spotSelection({ type: 'lab.spot.selected', ...base })?.via).toBe('user');
    const shell = { type: 'lab.spot.selected' as const, ...base, grain: 'area/2', area: 'area', via: 'shell' as const };
    expect(spotSelection(shell)).toEqual(shell);
    expect(spotSelection({ ...shell, grain: null })?.grain).toBeNull();
  });

  it('ignores other events, malformed fields and invalid ids', () => {
    const base = { type: 'lab.spot.selected', project: 'p', spot: 's' };
    for (const event of [{ ...base, type: 'other' }, { ...base, project: '' }, { ...base, spot: 'a/b' },
      { ...base, grain: 'a/b/c' }, { ...base, area: '../bad' }, { ...base, via: 'other' },
      { ...base, name: 5 }, { type: 'grainatlas.spot.selected', project: 'p', spot: 'bad/id' }]) {
      expect(spotSelection(event)).toBeNull();
    }
  });
});


describe('resolved theme (v3.1)', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  it('web: remembers pushes before registration, validates source and values, unsubscribes', () => {
    const { env, childTarget, origin } = framePair();
    const b = createBridge(env);
    const push = (theme: unknown, source: unknown = env.parent) => childTarget.dispatchEvent(msgEvent({
      data: { tag: MESSAGE_TAG, v: 3, push: 'theme', theme }, origin, source,
    }));
    expect(b.theme()).toBeNull();
    push('dark');
    const handler = vi.fn();
    const stop = b.onTheme(handler);
    expect(handler).toHaveBeenCalledExactlyOnceWith('dark');
    for (const value of [null, undefined, 'system', 'Dark', true, {}, ' dark']) {
      push(value);
      expect(isBridgePush({ tag: MESSAGE_TAG, v: 3, push: 'theme', theme: value })).toBe(false);
    }
    push('light', {});
    expect(b.theme()).toBe('dark');
    expect(handler).toHaveBeenCalledTimes(1);
    push('light');
    expect(handler).toHaveBeenLastCalledWith('light');
    stop();
    push('dark');
    expect(handler).toHaveBeenCalledTimes(2);
    expect(b.theme()).toBe('dark');
    b.onTheme(handler);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('tauri: reads the marker immediately and receives validated DOM events', async () => {
    const target = new EventTarget();
    const invoke = vi.fn(async () => 'light');
    const b = createBridge({
      __LAB_SHELL__: { module: 'grainatlas', v: 3, theme: 'light' },
      __TAURI_INTERNALS__: { invoke },
      addEventListener: (t, l) => target.addEventListener(t, l as EventListener),
    });
    expect(b.theme()).toBe('light');
    const handler = vi.fn();
    const stop = b.onTheme(handler);
    const event = (theme: unknown) => {
      const e = new Event(THEME_EVENT);
      Object.defineProperty(e, 'detail', { value: { theme } });
      target.dispatchEvent(e);
    };
    event('system');
    event(null);
    expect(handler).toHaveBeenCalledExactlyOnceWith('light');
    event('dark');
    await tick(); // stale command response must not overwrite the later event
    expect(invoke).toHaveBeenCalledWith(COMMANDS.theme);
    expect(b.theme()).toBe('dark');
    expect(handler).toHaveBeenCalledTimes(2);
    stop();
    event('light');
    expect(b.theme()).toBe('light');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('tauri: discovers the current theme via the command without a marker value', async () => {
    const b = createBridge({ __LAB_SHELL__: { module: 'grainatlas', v: 3 },
      __TAURI_INTERNALS__: { invoke: async () => 'dark' } });
    const handler = vi.fn();
    b.onTheme(handler);
    await tick();
    expect(b.theme()).toBe('dark');
    expect(handler).toHaveBeenCalledExactlyOnceWith('dark');
  });

  it('older shells and noop have no theme and never fire', async () => {
    const warn = vi.spyOn(console, 'warn');
    const bridges = [createBridge({}), createBridge(framePair().env), createBridge({
      __LAB_SHELL__: { module: 'grainatlas', v: 3 },
      __TAURI_INTERNALS__: { invoke: async () => { throw new Error('unknown command'); } },
    }), createBridge({
      __LAB_SHELL__: { module: 'grainatlas', v: 3 },
      __TAURI_INTERNALS__: { invoke: async () => 'system' },
    })];
    for (const b of bridges) {
      const handler = vi.fn();
      const stop = b.onTheme(handler);
      await tick();
      expect(b.theme()).toBeNull();
      expect(handler).not.toHaveBeenCalled();
      stop();
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('host pushTheme sends the compatible envelope to the specified origin', () => {
    const frame = { postMessage: vi.fn() };
    pushTheme(frame, 'dark', 'https://lab.example');
    expect(frame.postMessage).toHaveBeenCalledExactlyOnceWith({
      tag: MESSAGE_TAG, v: PROTOCOL_VERSION, push: 'theme', theme: 'dark',
    }, 'https://lab.example');
  });
});

describe('atlas sync (protocol v4)', () => {
  const badIds = ['', '-bad', 'a/b', 'a b', 'a?b', 'é', 'a\n', 'a'.repeat(129), null, 1];
  const badCounts = [-1, 0.5, NaN, Infinity, '1', null, undefined, true];
  const changes = { spots: 0, grains: 2, labels: 3, pixels: false };
  const status = {
    type: ATLAS_EVENTS.status, project: 'p._~-', mount: 'm', name: 'Invented atlas',
    mode: 'view', state: 'checking', revision: 0, atlasVersion: 1, changes,
    syncedAt: '2026-11-12T12:00:00Z',
  };
  const draft = {
    project: 'p', name: 'Invented draft', mount: 'm', baseRevision: 0, changes,
    updatedAt: '2026-11-12T12:00:00Z',
  };
  const synced = {
    type: ATLAS_EVENTS.synced, project: 'p', mount: 'm', revision: 0,
    atlasVersion: 1, changed: changes, at: '2026-11-12T12:00:00Z',
  };
  const commands: BridgeCommand[] = [
    { type: 'open-project', project: 'p' },
    { type: 'set-mode', project: 'p', mode: 'view' },
    { type: 'leave-edit', project: 'p', decision: 'sync' },
    { type: 'sync-draft', project: 'p' },
    { type: 'discard-draft', project: 'p' },
    { type: 'report-status' },
    { type: 'atlas-synced', project: 'p', mount: 'm', revision: 0 },
  ];

  it('validates every new command, ignores extra fields and checks required ids', () => {
    for (const command of commands) {
      expect(isBridgeCommand(command)).toBe(true);
      expect(isBridgeCommand({ ...command, future: { any: true }, flash: null, via: false })).toBe(true);
      if (command.type === 'report-status') continue;
      expect(isBridgeCommand({ ...command, project: 'a'.repeat(128) })).toBe(true);
      for (const project of [...badIds, undefined]) expect(isBridgeCommand({ ...command, project })).toBe(false);
    }
    for (const mount of [...badIds, undefined]) expect(isBridgeCommand({ ...commands[6], mount })).toBe(false);
    for (const revision of badCounts) expect(isBridgeCommand({ ...commands[6], revision })).toBe(false);
    expect(isBridgeCommand({ type: 'future-command' })).toBe(false);
  });

  it('validates open-project server, mode and revision, and all leave decisions', () => {
    const open = commands[0];
    for (const mode of ['view', 'edit']) {
      expect(isBridgeCommand({ ...open, mode, revision: 0 })).toBe(true);
      expect(isBridgeCommand({ ...commands[1], mode })).toBe(true);
    }
    for (const mode of ['VIEW', 'checking', '', null, true]) {
      expect(isBridgeCommand({ ...open, mode })).toBe(false);
      expect(isBridgeCommand({ ...commands[1], mode })).toBe(false);
    }
    expect(isBridgeCommand({ type: 'set-mode', project: 'p' })).toBe(false);
    for (const revision of badCounts.filter((value) => value !== undefined))
      expect(isBridgeCommand({ ...open, revision })).toBe(false);
    for (const server of ['http://localhost:8000', 'https://lab.example/atlas', 'https://h/' + 'x'.repeat(2038)])
      expect(isBridgeCommand({ ...open, server })).toBe(true);
    for (const server of [null, true, '', 'file:///tmp/a', 'javascript:alert(1)', 'https://', 'https://h/ a', 'https://h/\n', 'https://h/' + 'x'.repeat(2040)])
      expect(isBridgeCommand({ ...open, server })).toBe(false);
    for (const decision of ['sync', 'keep-draft', 'discard'])
      expect(isBridgeCommand({ ...commands[2], decision })).toBe(true);
    for (const decision of ['cancel', 'keep', '', null, true, undefined])
      expect(isBridgeCommand({ ...commands[2], decision })).toBe(false);
  });

  it('parses status snapshots, including checking and nullable fields, without extra fields', () => {
    expect(atlasStatus(status)).toEqual(status);
    for (const state of ['checking', 'unregistered', 'in-sync', 'local-changes', 'server-newer', 'both-changed', 'offline'])
      for (const mode of ['view', 'edit']) expect(atlasStatus({ ...status, state, mode })).toEqual({ ...status, state, mode });
    const nullable = { ...status, mount: null, revision: null, atlasVersion: null, changes: null, syncedAt: null };
    expect(atlasStatus(nullable)).toEqual(nullable);
    expect(atlasStatus({ ...status, revision: null })?.revision).toBeNull();
    for (const revision of [0, 1]) expect(atlasStatus({ ...nullable, revision })).toBeNull();
    expect(atlasStatus({ ...status, atlasVersion: undefined, version: 1 })).toBeNull();
    expect(atlasStatus({ ...status, version: 'ignored' })).toEqual(status);
    expect(atlasStatus({ ...status, future: true, changes: { ...changes, future: true } })).toEqual(status);
    for (const field of Object.keys(status)) expect(atlasStatus({ ...status, [field]: undefined })).toBeNull();
    for (const field of ['project', 'mount']) for (const id of badIds.filter((value) => field === 'project' || value !== null))
      expect(atlasStatus({ ...status, [field]: id })).toBeNull();
    for (const field of ['revision', 'atlasVersion']) for (const count of badCounts.filter((value) => value !== null))
      expect(atlasStatus({ ...status, [field]: count })).toBeNull();
    for (const [field, value] of [['type', 'future'], ['mode', 'VIEW'], ['mode', null], ['state', 'syncing'], ['state', null], ['name', null], ['syncedAt', 1]])
      expect(atlasStatus({ ...status, [field as string]: value })).toBeNull();
  });

  it('parses hosted drafts as one bounded snapshot, including empty and nullable values', () => {
    const event = { type: ATLAS_EVENTS.drafts, drafts: [draft] };
    expect(atlasDrafts(event)).toEqual(event);
    expect(atlasDrafts({ ...event, drafts: [] })).toEqual({ ...event, drafts: [] });
    const nullable = { ...draft, mount: null, baseRevision: null };
    expect(atlasDrafts({ ...event, drafts: [nullable] })?.drafts).toEqual([nullable]);
    expect(atlasDrafts({ ...event, future: true, drafts: [{ ...draft, future: true, changes: { ...changes, future: true } }] })).toEqual(event);
    expect(atlasDrafts({ ...event, drafts: Array(500).fill(draft) })?.drafts).toHaveLength(500);
    expect(atlasDrafts({ ...event, drafts: Array(501).fill(draft) })).toBeNull();
    for (const drafts of [undefined, null, {}, [draft, null]]) expect(atlasDrafts({ ...event, drafts })).toBeNull();
    expect(atlasDrafts({ ...event, type: 'future' })).toBeNull();
    for (const field of Object.keys(draft))
      expect(atlasDrafts({ ...event, drafts: [draft, { ...draft, [field]: undefined }] })).toBeNull();
    for (const field of ['project', 'mount']) for (const id of badIds.filter((value) => field === 'project' || value !== null))
      expect(atlasDrafts({ ...event, drafts: [{ ...draft, [field]: id }] })).toBeNull();
    for (const count of badCounts.filter((value) => value !== null))
      expect(atlasDrafts({ ...event, drafts: [{ ...draft, baseRevision: count }] })).toBeNull();
    for (const [field, value] of [['name', null], ['updatedAt', 1]])
      expect(atlasDrafts({ ...event, drafts: [{ ...draft, [field as string]: value }] })).toBeNull();
  });

  it('parses sync notices and rejects malformed ids, revisions and timestamps', () => {
    expect(atlasSynced(synced)).toEqual(synced);
    expect(atlasSynced({ ...synced, atlasVersion: null })?.atlasVersion).toBeNull();
    expect(atlasSynced({ ...synced, atlasVersion: undefined, version: 1 })).toBeNull();
    expect(atlasSynced({ ...synced, version: 'ignored' })).toEqual(synced);
    expect(atlasSynced({ ...synced, future: true, changed: { ...changes, future: true } })).toEqual(synced);
    for (const field of Object.keys(synced)) expect(atlasSynced({ ...synced, [field]: undefined })).toBeNull();
    for (const field of ['project', 'mount']) for (const id of badIds)
      expect(atlasSynced({ ...synced, [field]: id })).toBeNull();
    for (const revision of badCounts) expect(atlasSynced({ ...synced, revision })).toBeNull();
    for (const atlasVersion of badCounts.filter((value) => value !== null)) expect(atlasSynced({ ...synced, atlasVersion })).toBeNull();
    expect(atlasSynced({ ...synced, type: 'future' })).toBeNull();
    expect(atlasSynced({ ...synced, at: null })).toBeNull();
  });

  it('validates changes consistently in all three event parsers', () => {
    const parseChanges = (value: unknown) => [
      atlasStatus({ ...status, changes: value }),
      atlasDrafts({ type: ATLAS_EVENTS.drafts, drafts: [{ ...draft, changes: value }] }),
      atlasSynced({ ...synced, changed: value }),
    ];
    for (const field of ['spots', 'grains', 'labels']) {
      for (const count of badCounts) for (const result of parseChanges({ ...changes, [field]: count })) expect(result).toBeNull();
      for (const result of parseChanges({ ...changes, [field]: 0 })) expect(result).not.toBeNull();
    }
    for (const pixels of [true, false]) for (const result of parseChanges({ ...changes, pixels })) expect(result).not.toBeNull();
    for (const value of [[], {}, 'bad', undefined, { ...changes, pixels: 1 }, { ...changes, pixels: undefined }])
      for (const result of parseChanges(value)) expect(result).toBeNull();
    expect(atlasDrafts({ type: ATLAS_EVENTS.drafts, drafts: [{ ...draft, changes: null }] })).toBeNull();
    expect(atlasSynced({ ...synced, changed: null })).toBeNull();
    for (const parse of [atlasStatus, atlasDrafts, atlasSynced])
      for (const value of [null, undefined, [], true, 'bad', {}]) expect(parse(value)).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  COMMANDS,
  COMMAND_EVENT,
  isBridgeCommand,
  isBridgePush,
  spotSelection,
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
import { createFrameHost, frameName, pushOpenFiles, pushCommand } from '../src/host';

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
    expect(PROTOCOL_VERSION).toBe(3);
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
    const invoke = vi.fn(async () => {
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

  it('host pushCommand posts the v3 envelope to the requested origin', () => {
    const frame = { postMessage: vi.fn() };
    pushCommand(frame, latest, 'https://lab.example');
    expect(frame.postMessage).toHaveBeenCalledExactlyOnceWith({
      tag: MESSAGE_TAG, v: 3, push: 'command', command: latest,
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

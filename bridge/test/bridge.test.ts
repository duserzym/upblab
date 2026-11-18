import { describe, expect, it, vi } from 'vitest';
import {
  COMMANDS,
  COMMAND_EVENT,
  THEME_EVENT,
  isBridgeCommand,
  isBridgePush,
  spotSelection,
  spotAction,
  viewerInset,
  ATLAS_EVENTS,
  atlasStatus,
  atlasDrafts,
  atlasSynced,
  commandResult,
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

it('validates v5.2 inset groups and keeps commands without groups unchanged', () => {
  const command = { type: 'review-spots', projects: { p: ['s'] }, colors: { p: { s: '#123456' } },
    focus: { project: 'p', spot: 's', via: 'review', flash: false } };
  // This is still the complete v5.1 command shape; groups is purely optional.
  expect(isBridgeCommand(command)).toBe(true);
  const group = { name: 'Sample A', color: '#aB12fF', spots: ['s'] };
  expect(isBridgeCommand({ ...command, groups: { p: [group] }, future: true })).toBe(true);
  expect(isBridgeCommand({ ...command, groups: {} })).toBe(true);
  expect(isBridgeCommand({ ...command, groups: { p: [] } })).toBe(true);
  for (const groups of [null, [], 'groups', { 'bad/id': [] }, { p: {} }, { p: null }, { p: [null] }, { p: [[]] }])
    expect(isBridgeCommand({ ...command, groups })).toBe(false);
  for (const name of ['', 'x'.repeat(201), 1, null, undefined])
    expect(isBridgeCommand({ ...command, groups: { p: [{ ...group, name }] } })).toBe(false);
  for (const color of ['red', '123456', '#123', '#1234567', '#gg1234', '#123456\n', 1, null, undefined])
    expect(isBridgeCommand({ ...command, groups: { p: [{ ...group, color }] } })).toBe(false);
  for (const spots of [null, {}, 's', ['bad/id'], [1], [null], undefined])
    expect(isBridgeCommand({ ...command, groups: { p: [{ ...group, spots }] } })).toBe(false);
  expect(isBridgeCommand({ ...command, groups: { p: [{ ...group, name: 'x'.repeat(200), spots: [] }] } })).toBe(true);
  const projects = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`p${i}`, [group]]));
  expect(isBridgeCommand({ ...command, groups: projects })).toBe(true);
  expect(isBridgeCommand({ ...command, groups: { ...projects, extra: [] } })).toBe(false);
  const groups = Array.from({ length: 256 }, () => group);
  expect(isBridgeCommand({ ...command, groups: { p: groups } })).toBe(true);
  expect(isBridgeCommand({ ...command, groups: { p: [...groups, group] } })).toBe(false);
  const spots = Array.from({ length: 10000 }, (_, i) => `s${i}`);
  expect(isBridgeCommand({ ...command, groups: { p: [{ ...group, spots }] } })).toBe(true);
  expect(isBridgeCommand({ ...command, groups: { p: [{ ...group, spots: [...spots, 'extra'] }] } })).toBe(false);
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
    const env: BridgeEnv = { name: frameName('upbdb'), parent, self: {} };
    expect(detectTransport(env)).toBe('postMessage');
  });

  it('is none for a top-level page that happens to have the frame name', () => {
    const env: BridgeEnv = { name: frameName('upbdb') };
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
    expect(await b.open('upbdb://acquisition/x')).toBe(false);
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
    expect(await b.open('upbdb://acquisition/a1')).toBe(true);
    expect(invoke).toHaveBeenCalledWith(COMMANDS.open, { url: 'upbdb://acquisition/a1' });
    expect(await b.token()).toBe('tok');
    await b.notify({ type: 'grainatlas.spot.selected', spot: 's1' });
    expect(invoke).toHaveBeenCalledWith(COMMANDS.notify, { event: { type: 'grainatlas.spot.selected', spot: 's1' } });
  });

  it('turns command failures into false and null', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('not allowed');
    });
    const b = createBridge({ __LAB_SHELL__: { module: 'upbdb', v: 1 }, __TAURI_INTERNALS__: { invoke } });
    expect(await b.open('x://y')).toBe(false);
    expect(await b.token()).toBeNull();
    await expect(b.notify({ type: 't' })).resolves.toBeUndefined();
  });

  it('treats an empty token as signed out', async () => {
    const b = createBridge({
      __LAB_SHELL__: { module: 'upbdb', v: 1 },
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
    name: frameName('upbdb'),
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
        moduleOf: (src) => ((src as unknown) === child ? 'upbdb' : null),
        target: parentTarget as never,
      },
    );
    const b = createBridge(env, { timeoutMs: 200 });
    expect(b.transport).toBe('postMessage');
    expect(b.module).toBe('upbdb');
    expect(await b.open('grainatlas://project/p/spot/s')).toBe(true);
    expect(await b.open('mailto:x@y')).toBe(false);
    expect(await b.token()).toBe('secret');
    await b.notify({ type: 'upbdb.session.viewed', id: 's1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(opened).toEqual(['upbdb grainatlas://project/p/spot/s', 'upbdb mailto:x@y']);
    expect(events).toEqual([{ module: 'upbdb', type: 'upbdb.session.viewed', id: 's1' }]);
    stop();
  });

  it('ignores untrusted origins, so the module times out to its fallback', async () => {
    const { env, parentTarget, child } = framePair('https://evil.example');
    const open = vi.fn(() => true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stop = createFrameHost(
      { open, token: () => 'secret', notify: () => {} },
      { allowedOrigins: () => ['https://lab.example'], moduleOf: () => 'upbdb', target: parentTarget as never },
    );
    const b = createBridge(env, { timeoutMs: 50 });
    expect(await b.token()).toBeNull();
    expect(await b.open('upbdb://session/1')).toBe(false);
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
    expect(PROTOCOL_VERSION).toBe(5);
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
    const b = createBridge({ __LAB_SHELL__: { module: 'upbdb', v: 1 }, __TAURI_INTERNALS__: { invoke } });
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
          const w = module === 'upbdb' ? waiting : null;
          if (take) waiting = null;
          return w;
        },
      },
      { allowedOrigins: () => [origin], moduleOf: (src) => ((src as unknown) === child ? 'upbdb' : null), target: parentTarget as never },
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
      { allowedOrigins: () => [origin], moduleOf: (src) => ((src as unknown) === child ? 'upbdb' : null), target: parentTarget as never },
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

describe('v4 command completion', () => {
  const commands = [
    { type: 'open-project', project: 'p' }, { type: 'set-mode', project: 'p', mode: 'edit' },
    { type: 'leave-edit', project: 'p', decision: 'sync' },
    { type: 'sync-draft', project: 'p' }, { type: 'discard-draft', project: 'p' },
  ];
  it('accepts optional completion ids on all five commands, preserving older commands', () => {
    for (const command of commands) {
      expect(isBridgeCommand(command)).toBe(true);
      for (const id of ['a', '_-A09', 'x'.repeat(64)]) expect(isBridgeCommand({ ...command, id })).toBe(true);
      for (const id of ['', 'x'.repeat(65), 'a.b', 'a/b', 'a b', 'é', 'a\n', null, 1, true, {}])
        expect(isBridgeCommand({ ...command, id })).toBe(false);
    }
  });
  it('normalises successes and failures, ignoring unknown fields', () => {
    for (const command of commands) {
      const success = { type: ATLAS_EVENTS.commandResult, id: '_request-1', command: command.type, ok: true };
      expect(commandResult({ ...success, future: true })).toEqual(success);
      expect(commandResult({ ...success, project: 'p', mount: null, revision: null })).toEqual({ ...success, project: 'p', mount: null, revision: null });
      expect(commandResult({ ...success, mount: 'm', revision: 43 })).toEqual({ ...success, mount: 'm', revision: 43 });
      for (const code of ['offline', 'conflict', 'unauthorized', 'not-found', 'failed']) {
        const failure = { ...success, ok: false, code, error: 'x'.repeat(300) };
        expect(commandResult(failure)).toEqual(failure);
        expect(commandResult({ ...success, ok: false, code })).toEqual({ ...success, ok: false, code });
      }
    }
  });
  it('rejects malformed results and inconsistent ok/code/error fields', () => {
    const result = { type: ATLAS_EVENTS.commandResult, id: 'request-1', command: 'sync-draft', ok: true };
    for (const patch of [
      { type: 'unknown' }, { id: '' }, { id: 'a\n' }, { id: 'x'.repeat(65) }, { id: null }, { command: 'report-status' },
      { command: null }, { ok: 1 }, { ok: undefined }, { ok: false }, { ok: false, code: 'unknown' },
      { ok: false, code: null }, { ok: false, code: 'failed', error: 2 },
      { ok: false, code: 'failed', error: 'x'.repeat(301) }, { code: 'offline' }, { error: '' },
      { project: 'a/b' }, { mount: '' }, { revision: -1 }, { revision: 1.5 }, { revision: '43' },
    ]) expect(commandResult({ ...result, ...patch })).toBeNull();
    for (const event of [null, [], {}, 'result']) expect(commandResult(event)).toBeNull();
  });
  it('requires and normalises bulk confirmation counts only for needs-confirmation', () => {
    const confirm = { retireGrains: 1, grainsTotal: 40, deleteSpots: 12, spotsTotal: 100 };
    for (const command of ['leave-edit', 'sync-draft']) {
      const result = { type: ATLAS_EVENTS.commandResult, id: 'sync-1', command, ok: false, code: 'needs-confirmation', confirm };
      expect(commandResult({ ...result, future: true, confirm: { ...confirm, future: true } })).toEqual(result);
      expect(commandResult({ ...result, confirm: { retireGrains: 0, grainsTotal: 0, deleteSpots: 0, spotsTotal: 0 } })).not.toBeNull();
      expect(commandResult({ ...result, confirm: { retireGrains: 40, grainsTotal: 40, deleteSpots: 100, spotsTotal: 100 } })).not.toBeNull();
      for (const value of [undefined, null, [], {}, 'counts']) expect(commandResult({ ...result, confirm: value })).toBeNull();
      for (const key of Object.keys(confirm)) {
        for (const value of [undefined, null, -1, 1.5, '1', true, NaN, Infinity])
          expect(commandResult({ ...result, confirm: { ...confirm, [key]: value } })).toBeNull();
      }
      expect(commandResult({ ...result, confirm: { ...confirm, retireGrains: 41 } })).toBeNull();
      expect(commandResult({ ...result, confirm: { ...confirm, deleteSpots: 101 } })).toBeNull();
      expect(commandResult({ ...result, ok: true, code: undefined })).toBeNull();
      for (const code of ['offline', 'conflict', 'unauthorized', 'not-found', 'failed'])
        expect(commandResult({ ...result, code })).toBeNull();
    }
  });
});

describe('protocol v5: presentation and spot actions', () => {
  it('accepts set-presentation viewer and editor only', () => {
    expect(isBridgeCommand({ type: 'set-presentation', presentation: 'viewer' })).toBe(true);
    expect(isBridgeCommand({ type: 'set-presentation', presentation: 'editor' })).toBe(true);
    expect(isBridgeCommand({ type: 'set-presentation', presentation: 'edit' })).toBe(false);
    expect(isBridgeCommand({ type: 'set-presentation' })).toBe(false);
  });
  it('normalises spot actions and rejects malformed ones', () => {
    const event = { type: 'lab.spot.action', action: 'edit', project: 'p-1', spot: 's-1', extra: 1 };
    expect(spotAction(event)).toEqual({ type: 'lab.spot.action', action: 'edit', project: 'p-1', spot: 's-1' });
    expect(spotAction({ ...event, action: 'studio' })?.action).toBe('studio');
    expect(spotAction({ ...event, action: 'delete' })).toBeNull();
    expect(spotAction({ ...event, spot: 'a/b' })).toBeNull();
    expect(spotAction({ ...event, type: 'lab.spot.selected' })).toBeNull();
    expect(spotAction(null)).toBeNull();
  });
});

describe('viewer inset (v5.1)', () => {
  it('set-presentation accepts an optional, well-formed inset only', () => {
    expect(isBridgeCommand({ type: 'set-presentation', presentation: 'viewer' })).toBe(true);
    expect(isBridgeCommand({ type: 'set-presentation', presentation: 'viewer', inset: { width: 180, collapsed: false } })).toBe(true);
    for (const inset of [{ width: 80, collapsed: false }, { width: 180.5, collapsed: true }, { width: 5000, collapsed: true }, { width: 180 }, null, 'big'])
      expect(isBridgeCommand({ type: 'set-presentation', presentation: 'viewer', inset })).toBe(false);
  });
  it('normalises the inset report and drops extra fields', () => {
    expect(viewerInset({ type: 'lab.viewer.inset', width: 240, collapsed: true, extra: 1 })).toEqual({ type: 'lab.viewer.inset', width: 240, collapsed: true });
    expect(viewerInset({ type: 'lab.viewer.inset', width: 100, collapsed: true })).toBeNull();
    expect(viewerInset({ type: 'lab.spot.action', width: 240, collapsed: true })).toBeNull();
  });
});

describe('oversight v5.3', () => {
  const state = { viewAs: { username: 'cedar', name: 'Cedar Analyst' }, onBehalf: false };
  it('reads and observes scope through the frame host, ignoring sibling pushes and supporting old hosts', async () => {
    const { pushOversight } = await import('../src/host');
    const { env, parentTarget, childTarget, child, origin } = framePair();
    const stop = createFrameHost({ open: () => true, token: () => 'viewers-own-token', notify: () => {}, oversight: () => state }, {
      allowedOrigins: () => [origin], moduleOf: source => (source as unknown) === child ? 'upbdb' : null, target: parentTarget as never,
    });
    const bridge = createBridge(env, { timeoutMs: 20 }), changed = vi.fn();
    expect(await bridge.oversight()).toEqual(state); expect(await bridge.token()).toBe('viewers-own-token');
    const unsubscribe = bridge.onOversight(changed); expect(changed).toHaveBeenCalledWith(state);
    childTarget.dispatchEvent(msgEvent({ data: { tag: MESSAGE_TAG, v: 5, push: 'oversight', oversight: { viewAs: null, onBehalf: true } }, source: {}, origin }));
    expect(changed).toHaveBeenCalledTimes(1);
    pushOversight(child as unknown as Window, { viewAs: null, onBehalf: true }, origin);
    await vi.waitFor(() => expect(changed).toHaveBeenLastCalledWith({ viewAs: null, onBehalf: true }));
    unsubscribe(); stop(); expect(await createBridge(env, { timeoutMs: 2 }).oversight()).toBeNull();
    const old = createFrameHost({ open: () => true, token: () => null, notify: () => {} }, { allowedOrigins: () => [origin], moduleOf: () => 'upbdb', target: parentTarget as never });
    expect(await createBridge(env, { timeoutMs: 20 }).oversight()).toBeNull(); old();
    expect(await createBridge(undefined).oversight()).toBeNull();
  });
  it('reads desktop state and receives the DOM event; newer pushes win over pending reads', async () => {
    const { OVERSIGHT_EVENT } = await import('../src/protocol');
    const target = new EventTarget(); let finish!: (value: unknown) => void;
    const env: BridgeEnv = { __LAB_SHELL__: { module: 'grainatlas', v: 5, minor: 3 }, __TAURI_INTERNALS__: { invoke: vi.fn(cmd => cmd === COMMANDS.oversight ? new Promise(resolve => finish = resolve) : Promise.resolve(null)) },
      addEventListener: (t, l) => target.addEventListener(t, l as EventListener), removeEventListener: (t, l) => target.removeEventListener(t, l as EventListener) };
    const bridge = createBridge(env), changed = vi.fn(); const read = bridge.oversight();
    target.dispatchEvent(Object.assign(new Event(OVERSIGHT_EVENT), { detail: state })); finish({ viewAs: null, onBehalf: false });
    expect(await read).toEqual(state); const unsubscribe = bridge.onOversight(changed); expect(changed).toHaveBeenCalledWith(state);
    unsubscribe(); target.dispatchEvent(Object.assign(new Event(OVERSIGHT_EVENT), { detail: { viewAs: null, onBehalf: false } })); expect(changed).toHaveBeenCalledTimes(1);
    env.__TAURI_INTERNALS__!.invoke = vi.fn().mockRejectedValue(new Error('unknown command'));
    expect(await createBridge(env).oversight()).toBeNull();
  });
  it('validates state and accepts every older request version', async () => {
    const { isOversightState } = await import('../src/protocol');
    expect(isOversightState(state)).toBe(true); expect(isOversightState({ viewAs: null, onBehalf: false })).toBe(true);
    for (const value of [null, {}, { viewAs: { username: '', name: 'Cedar' }, onBehalf: false }, { viewAs: null, onBehalf: 'yes' }]) expect(isOversightState(value)).toBe(false);
    expect(isBridgePush({ tag: MESSAGE_TAG, v: 5, push: 'oversight', oversight: state })).toBe(true);
    for (const v of [1, 2, 3, 4, 5]) expect(isBridgeRequest({ tag: MESSAGE_TAG, v, id: '1', op: 'token' })).toBe(true);
  });
});

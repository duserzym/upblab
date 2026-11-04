import { describe, expect, it, vi } from 'vitest';
import {
  COMMANDS,
  MESSAGE_TAG,
  OPEN_FILES_EVENT,
  PROTOCOL_VERSION,
  isBridgeRequest,
  type OpenedFiles,
  createBridge,
  detectTransport,
  type BridgeEnv,
} from '../src/index';
import { createFrameHost, frameName, pushOpenFiles } from '../src/host';

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
    expect(PROTOCOL_VERSION).toBe(2);
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

import { describe, expect, it, vi } from 'vitest';
import {
  COMMANDS,
  MESSAGE_TAG,
  PROTOCOL_VERSION,
  createBridge,
  detectTransport,
  type BridgeEnv,
} from '../src/index';
import { createFrameHost, frameName } from '../src/host';

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

// Shell side of the postMessage transport (web delivery and the iframe
// fallback). The shell creates one host for its window and answers requests
// from module iframes whose origin it trusts.

import {
  FRAME_NAME_PREFIX,
  MESSAGE_TAG,
  PROTOCOL_VERSION,
  isBridgeRequest,
  isTheme,
  type Theme,
  type BridgeEvent,
  type BridgeCommand,
  type BridgePush,
  type BridgeResponse,
  type OpenFilesTransfer,
} from './protocol';

export interface FrameHostHandlers {
  /** Route a URL; return false to refuse it. */
  open(url: string, module: string): boolean | Promise<boolean>;
  token(module: string): string | null | Promise<string | null>;
  notify(event: BridgeEvent, module: string): void;
  /**
   * v2: the files waiting for `module`, or null. `take` false: look without
   * taking. Leave it out and modules get null.
   */
  openFiles?(module: string, take: boolean): OpenFilesTransfer | null | Promise<OpenFilesTransfer | null>;
}

export interface FrameHostOptions {
  /** Origins allowed to call the shell. `self` means the shell's own origin. */
  allowedOrigins: () => Iterable<string>;
  /** Resolve the module name of a message source (an iframe's contentWindow). */
  moduleOf: (source: MessageEventSource | null) => string | null;
  /** The window to listen on. Defaults to the global window. */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

/** iframe `name` for a module, read by `detectTransport` inside the iframe. */
export function frameName(module: string): string {
  return FRAME_NAME_PREFIX + module;
}

/** v2: tell a module iframe that files are waiting for it; it answers with an `open-files` request. */
export function pushOpenFiles(frame: Pick<Window, 'postMessage'>, targetOrigin: string): void {
  const msg: BridgePush = { tag: MESSAGE_TAG, v: PROTOCOL_VERSION, push: 'open-files' };
  frame.postMessage(msg, targetOrigin);
}

/** v3: send a command directly to a module iframe; no reply is expected. */
export function pushCommand(frame: Pick<Window, 'postMessage'>, command: BridgeCommand, targetOrigin: string): void {
  const msg: BridgePush = { tag: MESSAGE_TAG, v: PROTOCOL_VERSION, push: 'command', command };
  frame.postMessage(msg, targetOrigin);
}

/** v3.1: publish the resolved theme without navigating the frame. */
export function pushTheme(frame: Pick<Window, 'postMessage'>, theme: Theme, targetOrigin: string): void {
  if (!isTheme(theme)) return;
  const msg: BridgePush = { tag: MESSAGE_TAG, v: PROTOCOL_VERSION, push: 'theme', theme };
  frame.postMessage(msg, targetOrigin);
}

export function createFrameHost(handlers: FrameHostHandlers, opts: FrameHostOptions): () => void {
  const target = opts.target ?? window;

  async function onMessage(ev: MessageEvent) {
    if (!isBridgeRequest(ev.data)) return;
    const allowed = new Set(opts.allowedOrigins());
    if (!allowed.has(ev.origin)) {
      console.warn(`[lab-bridge] refused ${ev.data.op} from untrusted origin ${ev.origin}`);
      return;
    }
    const module = opts.moduleOf(ev.source);
    if (!module) return;
    const req = ev.data;
    const reply = (body: Partial<BridgeResponse>) => {
      const res: BridgeResponse = { tag: MESSAGE_TAG, v: PROTOCOL_VERSION, id: req.id, ok: true, ...body };
      (ev.source as WindowProxy | null)?.postMessage(res, ev.origin);
    };
    try {
      switch (req.op) {
        case 'open':
          reply({ result: typeof req.url === 'string' ? await handlers.open(req.url, module) : false });
          break;
        case 'token':
          reply({ result: await handlers.token(module) });
          break;
        case 'notify':
          if (req.event && typeof req.event.type === 'string') handlers.notify(req.event, module);
          break;
        case 'open-files':
          reply({ result: handlers.openFiles ? await handlers.openFiles(module, req.take !== false) : null });
          break;
      }
    } catch (err) {
      reply({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const listener = (ev: Event) => void onMessage(ev as MessageEvent);
  target.addEventListener('message', listener);
  return () => target.removeEventListener('message', listener);
}

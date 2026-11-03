// Every way a URL reaches the shell:
//   desktop  OS deep links (tauri-plugin-deep-link, plus single-instance on
//            Windows) and module calls through @lab/bridge (Rust re-emits them
//            as EVENTS.open / EVENTS.notify)
//   web      /desk/open?url=… and module iframes posting through @lab/bridge

import { EVENTS, type BridgeEvent } from '@lab/bridge';
import { createFrameHost } from '@lab/bridge/host';
import { isDesktop, logInfo } from './platform';
import { shell } from './shell.svelte';
import { settings } from './settings.svelte';

interface BridgeOpenPayload {
  url: string;
  source: string;
}
interface BridgeNotifyPayload {
  event: BridgeEvent;
  source: string;
}

/** Module iframes register here so the frame host can tell which module posted. */
export const frames = new Map<string, Window>();

export async function listenForLinks(): Promise<void> {
  if (isDesktop) {
    const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
    const { listen } = await import('@tauri-apps/api/event');
    await onOpenUrl((urls) => urls.forEach((u) => void shell.handleLink(u, 'os')));
    await listen<BridgeOpenPayload>(EVENTS.open, (e) => void shell.handleLink(e.payload.url, e.payload.source));
    await listen<BridgeNotifyPayload>(EVENTS.notify, (e) =>
      void logInfo(`[bridge] ${e.payload.source}: ${JSON.stringify(e.payload.event)}`),
    );
    const initial = await getCurrent().catch(() => null);
    initial?.forEach((u) => void shell.handleLink(u, 'os'));
    return;
  }

  createFrameHost(
    {
      open: (url, module) => shell.handleLink(url, module),
      token: () => null, // phase 3: the web delivery uses the laicpmsdb session cookie
      notify: (event, module) => void logInfo(`[bridge] ${module}: ${JSON.stringify(event)}`),
    },
    {
      allowedOrigins: () => {
        const origins = [location.origin];
        try {
          origins.push(new URL(settings.serverUrl).origin);
        } catch {
          /* invalid server URL: only same-origin frames */
        }
        return origins;
      },
      moduleOf: (source) => {
        for (const [name, win] of frames) if (win === source) return name;
        return null;
      },
    },
  );
  const param = new URLSearchParams(location.search).get('url');
  if (param) void shell.handleLink(param, 'page');
}

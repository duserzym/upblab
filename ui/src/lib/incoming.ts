// Every way a URL reaches the shell:
//   desktop  OS deep links (tauri-plugin-deep-link, plus single-instance on
//            Windows) and module calls through @lab/bridge (Rust re-emits them
//            as EVENTS.open / EVENTS.notify)
//   web      /desk/open?url=… and module iframes posting through @lab/bridge

import { EVENTS, type BridgeEvent } from '@lab/bridge';
import { createFrameHost } from '@lab/bridge/host';
import { identity, SIGN_OUT_EVENTS } from './identity.svelte';
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

/** A module event: logged; a sign-out signs the shell out (clears the token for every module). */
export function onModuleEvent(event: BridgeEvent, source: string) {
  void logInfo(`[bridge] ${source}: ${JSON.stringify(event)}`);
  if (SIGN_OUT_EVENTS.includes(event.type) && identity.signedIn) void identity.logout(`${source} signed out`);
}

/** Module iframes register here so the frame host can tell which module posted. */
export const frames = new Map<string, Window>();

export async function listenForLinks(): Promise<void> {
  if (isDesktop) {
    const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
    const { listen } = await import('@tauri-apps/api/event');
    await onOpenUrl((urls) => urls.forEach((u) => void shell.handleLink(u, 'os')));
    await listen<BridgeOpenPayload>(EVENTS.open, (e) => void shell.handleLink(e.payload.url, e.payload.source));
    await listen<BridgeNotifyPayload>(EVENTS.notify, (e) => onModuleEvent(e.payload.event, e.payload.source));
    const initial = await getCurrent().catch(() => null);
    initial?.forEach((u) => void shell.handleLink(u, 'os'));
    return;
  }

  createFrameHost(
    {
      open: (url, module) => shell.handleLink(url, module),
      token: () => identity.frameToken(),
      notify: (event, module) => onModuleEvent(event, module),
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

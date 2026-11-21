// Every way a URL or a file reaches the shell:
//   desktop  OS deep links (tauri-plugin-deep-link, plus single-instance on
//            Windows) and module calls through @lab/bridge (Rust re-emits them
//            as EVENTS.open / EVENTS.notify); files dropped on any webview
//            (shell://drop), opened by Finder (file:// URLs from the deep-link
//            plugin) or by a Windows file association (argv, shell://opened)
//   web      /desk/open?url=… and module iframes posting through @lab/bridge;
//            files dropped on the shell page (App.svelte)

import { oversight } from './oversight.svelte';
import { dispatchSpotAction } from './spot-actions';
import { presentationFor } from './presentation';
import { review } from './review.svelte';
import { atlasSync } from './atlas-sync.svelte';
import { atlasSyncedNotice } from './atlas-refresh';
import { EVENTS, atlasStatus, spotSelection, isBridgeCommand, viewerInset, viewerRegion, type BridgeCommand, type BridgeEvent } from '@lab/bridge';
import { createFrameHost, pushOpenFiles, pushCommand, pushOversight } from '@lab/bridge/host';
import { fileUrlToPath } from './drop';
import { identity, SIGN_OUT_EVENTS } from './identity.svelte';
import { opener } from './opener.svelte';
import { desktopFiles, desktopModules, isDesktop, logInfo, logWarn } from './platform';
import { shell } from './shell.svelte';
import { settings } from './settings.svelte';
import { selection } from './selection.svelte';
import type { ModuleTab } from './links';

interface BridgeOpenPayload {
  url: string;
  source: string;
}
interface BridgeNotifyPayload {
  event: BridgeEvent;
  source: string;
}
/** src-tauri/src/files.rs `DropPayload`. */
interface DropPayload {
  paths: string[];
  over: string;
}
/** src-tauri/src/files.rs `TakenPayload`. */
interface TakenPayload {
  id: string;
  source: string;
  files: number;
  bytes: number;
}

/** Shell events from the host (names in src-tauri/src/files.rs). */
export const FILE_EVENTS = {
  drop: 'shell://drop',
  drag: 'shell://drag',
  opened: 'shell://opened',
  taken: 'lab-bridge://files-taken',
} as const;

/** A module event: logged; a sign-out signs the shell out (clears the token for every module). */
export function onModuleEvent(event: BridgeEvent, source: string) {
  source = source === 'images' ? 'grainatlas' : source === 'sessions' || source === 'people' ? 'upbdb' : source;
  void logInfo(`[bridge] ${source}: ${JSON.stringify(event)}`);
  if (SIGN_OUT_EVENTS.includes(event.type) && identity.signedIn) void identity.logout(`${source} signed out`);
  if (source === 'grainatlas') {
    const synced = atlasSync.receive(event);
    if (atlasStatus(event) && !imagesReportedReady) {
      imagesReportedReady = true;
      void publishImagesPresentation();
    }
    void dispatchSpotAction(event, source).catch(err => shell.note('Images spot action', 'review', String(err), true));
    // v5.1: the viewer cannot write storage, so the shell remembers its inset.
    const region = viewerRegion(event);
    if (region && shell.view === 'review' && settings.reviewSplit) void review.showRegion(region, 'images');
    const inset = viewerInset(event);
    if (inset && settings.loaded) void settings.update({ reviewInset: { width: inset.width, collapsed: inset.collapsed } });
    if (synced) void atlasSyncedNotice(synced).catch(err => logWarn(`[atlas] refresh after a sync notice failed: ${String(err)}`));
  }
  const selected = spotSelection(event);
  if (selected) selection.fromImages = { ...selected, at: Date.now() };
  if (event.type === 'lab.open-files.seen') opener.seen(source, event);
}

/**
 * URLs from the OS: lab links go to the resolver; file:// URLs (macOS hands
 * files opened with the app over this way) are opened as files.
 */
export function routeOsUrls(urls: string[]) {
  const paths: string[] = [];
  for (const u of urls) {
    const path = fileUrlToPath(u);
    if (path) paths.push(path);
    else void shell.handleLink(u, 'os');
  }
  if (paths.length) void opener.openPaths(paths, 'os');
}

async function takeOpened() {
  const paths = await desktopFiles.takeOpened().catch(() => [] as string[]);
  if (paths.length) await opener.openPaths(paths, 'os');
}

/** Mounted module surfaces, including native surfaces retained on hidden tabs. */
export const moduleSurfaces = new Set<ModuleTab>();
/** Module iframes register here so the frame host can tell which module posted. */
export const frames = new Map<string, Window>();
const loadingFrames = new Set<ModuleTab>();
const waitingCommands = new Map<ModuleTab, BridgeCommand>();

let imagesReportedReady = false;

export function publishImagesPresentation(): Promise<boolean> {
  const presentation = presentationFor(shell.view, settings.reviewSplit, 'images');
  if (!presentation) return Promise.resolve(false);
  const inset = settings.reviewInset;
  return sendCommand('images', { type: 'set-presentation', presentation, ...(inset ? { inset: { ...inset } } : {}) }).catch(() => false);
}

/** Reapply after a frame load or native page load, including a menu reload. */
export function moduleReady(tab: ModuleTab): void {
  if (tab !== 'images') return;
  imagesReportedReady = false;
  void publishImagesPresentation();
}

/** Register early for bridge requests, then on load to deliver any waiting command. */
export function registerFrame(tab: ModuleTab, frame: Window, loaded = true): void {
  frames.set(tab, frame);
  if (!loaded) {
    loadingFrames.add(tab);
    return;
  }
  loadingFrames.delete(tab);
  const command = waitingCommands.get(tab);
  if (command) {
    waitingCommands.delete(tab);
    pushCommand(frame, command, '*');
  }
  pushOversight(frame, oversight.state, '*');
  moduleReady(tab);
}

export function unregisterFrame(tab: ModuleTab): void {
  frames.delete(tab);
  loadingFrames.delete(tab);
}

/** Ask a module to focus an object without navigating away from its open project. */
export async function sendCommand(tab: ModuleTab, command: BridgeCommand): Promise<boolean> {
  if (!isBridgeCommand(command)) return false;
  if (tab === 'images' && (['set-mode', 'leave-edit', 'sync-draft', 'discard-draft'].includes(command.type)
    || command.type === 'set-presentation' && command.presentation !== 'viewer'
    || command.type === 'open-project' && command.mode === 'edit')) return false;
  if (!atlasSync.v4 && ['open-project', 'set-mode', 'leave-edit', 'sync-draft', 'discard-draft', 'report-status', 'atlas-synced'].includes(command.type)) return false;
  if (isDesktop) return desktopModules.command(tab, command);
  const frame = frames.get(tab);
  if (!frame || loadingFrames.has(tab)) {
    // Presentation is reapplied on load; it must not replace a pending focus.
    if (command.type !== 'set-presentation') waitingCommands.set(tab, command);
    return false;
  }
  waitingCommands.delete(tab);
  pushCommand(frame, command, '*');
  return true;
}

export async function listenForLinks(): Promise<void> {
  if (isDesktop) {
    const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
    const { listen } = await import('@tauri-apps/api/event');
    await listen<{ id: number }>('shell://quit-request', e => {
      void import('@tauri-apps/api/core').then(({ invoke }) => invoke('quit_answer', { id: e.payload.id, answer: 'go' }));
    });
    await onOpenUrl((urls) => routeOsUrls(urls));
    await listen<BridgeOpenPayload>(EVENTS.open, (e) => void shell.handleLink(e.payload.url, e.payload.source));
    await listen<{ module: ModuleTab }>('lab-bridge://ready', e => moduleReady(e.payload.module));
    await listen<BridgeNotifyPayload>(EVENTS.notify, (e) => onModuleEvent(e.payload.event, e.payload.source));
    await listen<DropPayload>(FILE_EVENTS.drop, (e) => {
      opener.dragging = false;
      void opener.openPaths(e.payload.paths, e.payload.over === 'shell' ? 'drop' : `drop on ${e.payload.over}`);
    });
    await listen<boolean>(FILE_EVENTS.drag, (e) => (opener.dragging = e.payload));
    await listen(FILE_EVENTS.opened, () => void takeOpened());
    await listen<TakenPayload>(FILE_EVENTS.taken, (e) => opener.taken(e.payload.id, e.payload.source, e.payload.files, e.payload.bytes));
    const initial = await getCurrent().catch(() => null);
    if (initial?.length) routeOsUrls(initial);
    await takeOpened();
    return;
  }

  opener.pushFrame = (tab) => {
    const frame = frames.get(tab);
    // A nudge carries nothing; the files go only to a trusted origin's request.
    if (frame) pushOpenFiles(frame, '*');
  };

  createFrameHost(
    {
      open: (url, module) => shell.handleLink(url, module),
      oversight: () => oversight.state,
      token: (module) => identity.frameToken(module),
      notify: (event, module) => onModuleEvent(event, module),
      openFiles: (module, take) => opener.takeWeb(module, take),
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

/** Push to already mounted iframes; new frames can also read the state. */
export function publishOversight() {
  for (const frame of frames.values()) pushOversight(frame, oversight.state, '*');
}

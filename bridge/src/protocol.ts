// Wire protocol shared by the module side (`createBridge`) and the shell side
// (`createFrameHost`, and the Rust host's commands). The shell keeps accepting
// every older version: a version only ever adds operations.
//
//   1  open, token, notify
//   2  open-files: the shell hands the module files the user dropped on the
//      window or opened through the OS (ux-conventions rule 4). A v1 module
//      never asks for them; a v2 module on a v1 shell gets none.
//   3  command: the shell asks a module to show something (focus-spot,
//      focus-grain); lab.spot.selected.

export const PROTOCOL_VERSION = 3;

/** Tag on every postMessage envelope, so unrelated messages are ignored. */
export const MESSAGE_TAG = 'lab-bridge';

/** The shell names each module iframe `lab-shell:<module>` (web delivery). */
export const FRAME_NAME_PREFIX = 'lab-shell:';

/**
 * On desktop the shell injects `window.__LAB_SHELL__ = { module, v }` into each
 * module webview before any page script runs.
 */
export const SHELL_GLOBAL = '__LAB_SHELL__';

/** Tauri commands the desktop shell exposes to module webviews. */
export const COMMANDS = {
  open: 'bridge_open',
  token: 'bridge_token',
  notify: 'bridge_notify',
  /** v2. `{ take?: boolean }` -> `OpenFilesManifest | null`: the files waiting for this webview. */
  openFiles: 'bridge_open_files',
  /** v2. `{ id, index }` -> the bytes of one file of that manifest (an ArrayBuffer). */
  readFile: 'bridge_read_file',
  /** v3. Take and clear the newest command waiting for this webview. */
  takeCommand: 'bridge_take_command',
} as const;

/**
 * v2, desktop: the host dispatches this DOM event on the module's `window`
 * when files are waiting for it (`new CustomEvent(OPEN_FILES_EVENT, { detail:
 * { id } })`). The bridge then asks for them with `COMMANDS.openFiles`.
 */
export const OPEN_FILES_EVENT = 'lab-bridge:open-files';

/** v3: the host dispatches this DOM event on the module window, detail `{ id }`. */
export const COMMAND_EVENT = 'lab-bridge:command';

/** Events the desktop host emits to the shell webview after a module call. */
export const EVENTS = {
  open: 'lab-bridge://open',
  notify: 'lab-bridge://notify',
} as const;

/**
 * Well-known `notify()` types the shell acts on. `signedOut`: the module saw
 * the user sign out (or its token rejected); the shell signs out everywhere
 * and module tabs reload without a token.
 */
export const SHELL_EVENTS = {
  signedOut: 'lab.auth.signed-out',
  spotSelected: 'lab.spot.selected',
} as const;

/** A module event for the shell (timeline entries, status, title changes). */
export interface BridgeEvent {
  /** Namespaced type, e.g. `grainatlas.spot.selected`. */
  type: string;
  [key: string]: unknown;
}

export interface FocusSpotCommand {
  type: 'focus-spot';
  /** grainatlas project id (laicpmsdb atlas_project_id). */
  project: string;
  /** grainatlas spot id (laicpmsdb atlas_spot_id). */
  spot: string;
  flash?: boolean;
  /** Sender, e.g. 'review'. */
  via?: string;
}

export interface FocusGrainCommand {
  type: 'focus-grain';
  project: string;
  /** laicpmsdb grain label (<area_id>/<grain_number>) or grainatlas grain id. */
  grain: string;
  spot?: string;
  flash?: boolean;
  via?: string;
}

export type BridgeCommand = FocusSpotCommand | FocusGrainCommand;

/** The shell also accepts grainatlas.spot.selected ({ project, spot, name }) as via 'user'. */
export interface SpotSelectedEvent extends BridgeEvent {
  type: 'lab.spot.selected';
  project: string;
  spot: string;
  name?: string;
  grain?: string | null;
  area?: string;
  via: 'user' | 'shell';
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const isId = (x: unknown): x is string => typeof x === 'string' && ID.test(x);
const isGrain = (x: unknown): x is string =>
  typeof x === 'string' && x.split('/').length <= 2 && x.split('/').every(isId);

/** Unknown command types are ignored so newer modules and shells can coexist. */
export function isBridgeCommand(x: unknown): x is BridgeCommand {
  if (!x || typeof x !== 'object') return false;
  const c = x as Record<string, unknown>;
  if (!isId(c.project) || (c.flash !== undefined && typeof c.flash !== 'boolean') ||
      (c.via !== undefined && typeof c.via !== 'string')) return false;
  if (c.type === 'focus-spot') return isId(c.spot);
  if (c.type === 'focus-grain') return isGrain(c.grain) && (c.spot === undefined || isId(c.spot));
  return false;
}

/** Normalise current and legacy spot selections; reject malformed ids and fields. */
export function spotSelection(event: BridgeEvent): SpotSelectedEvent | null {
  if (event.type !== SHELL_EVENTS.spotSelected && event.type !== 'grainatlas.spot.selected') return null;
  if (!isId(event.project) || !isId(event.spot) ||
      (event.name !== undefined && typeof event.name !== 'string')) return null;
  if (event.type === 'grainatlas.spot.selected') {
    return { type: SHELL_EVENTS.spotSelected, project: event.project, spot: event.spot,
      ...(event.name === undefined ? {} : { name: event.name }), via: 'user' };
  }
  if ((event.grain !== undefined && event.grain !== null && !isGrain(event.grain)) ||
      (event.area !== undefined && !isId(event.area)) ||
      (event.via !== undefined && event.via !== 'user' && event.via !== 'shell')) return null;
  return { ...event, type: SHELL_EVENTS.spotSelected, project: event.project, spot: event.spot,
    via: event.via ?? 'user' } as SpotSelectedEvent;
}

export type BridgeOp = 'open' | 'token' | 'notify' | 'open-files';

/** What the shell recognised in a drop (it never asks the user). */
export type OpenFilesKind =
  /** grainatlas: a TM4000 package folder (has a `.zag`, or area sub-folders) */
  | 'package'
  /** grainatlas: one area folder (images with their `.txt` sidecars) */
  | 'area'
  /** grainatlas: loose image files */
  | 'images'
  /** grainatlas: a saved `<name>.grainatlas` project folder */
  | 'project'
  /** laicpmsdb: a Qtegra export folder */
  | 'export'
  /** laicpmsdb: zips of an export */
  | 'zip'
  /** laicpmsdb: loose per-spot CSVs */
  | 'csv';

/** One file of an offer, without its bytes. */
export interface OpenFilesEntry {
  /** `/`-separated path inside the dropped folder (or the file name for loose files). */
  path: string;
  size: number;
  /** Milliseconds since the epoch, 0 when unknown. */
  lastModified: number;
  /** MIME type guessed from the extension, '' when unknown. */
  type: string;
}

/** v2: files waiting for a module (desktop: `COMMANDS.openFiles`, bytes read per file). */
export interface OpenFilesManifest {
  /** Offer id, passed back to `COMMANDS.readFile`. */
  id: string;
  kind: OpenFilesKind;
  /** Folder name, zip name or the files' common stem: a name for the set. */
  name: string;
  /** Desktop: the host path that was dropped (folder, zip, or the folder of loose files). */
  path?: string;
  files: OpenFilesEntry[];
}

/** v2, web delivery: the reply to `open-files`, with the files themselves (structured clone). */
export interface OpenFilesTransfer extends Omit<OpenFilesManifest, 'files'> {
  files: { path: string; file: File }[];
}

/**
 * v2, web delivery: the shell posts `{ tag, v, push: 'open-files' }` to a
 * module iframe when files are waiting; the module answers with an
 * `open-files` request. v3 command pushes carry the command directly.
 */
export interface BridgePush {
  tag: typeof MESSAGE_TAG;
  v: number;
  push: 'open-files' | 'command';
  /** v3: a command is delivered directly, without a reply. */
  command?: BridgeCommand;
}

export interface BridgeRequest {
  tag: typeof MESSAGE_TAG;
  v: number;
  id: string;
  op: BridgeOp;
  url?: string;
  event?: BridgeEvent;
  /** `open-files`: false to look without taking (default true). */
  take?: boolean;
}

export interface BridgeResponse {
  tag: typeof MESSAGE_TAG;
  v: number;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface ShellMarker {
  module: string;
  v: number;
}

export function isBridgeRequest(data: unknown): data is BridgeRequest {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    d.tag === MESSAGE_TAG &&
    typeof d.id === 'string' &&
    (d.op === 'open' || d.op === 'token' || d.op === 'notify' || d.op === 'open-files') &&
    !('ok' in d)
  );
}

export function isBridgeResponse(data: unknown): data is BridgeResponse {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return d.tag === MESSAGE_TAG && typeof d.id === 'string' && typeof d.ok === 'boolean';
}

export function isBridgePush(data: unknown): data is BridgePush {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return d.tag === MESSAGE_TAG && (d.push === 'open-files' || d.push === 'command');
}

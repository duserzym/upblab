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
//   3.1 theme: resolved shell theme at load and on every change.
//   4  atlas sync status, hosted drafts, sync notices and edit commands.
//   5  set-presentation (the shell shows a module as a read-only viewer or as
//      its editor) and lab.spot.action (the module asks the shell to open a
//      spot elsewhere: edit in grainatlas, open in Studio). A v4 module never
//      gets set-presentation; a v5 module on a v4 shell stays an editor.

export const PROTOCOL_VERSION = 5;
export const PROTOCOL_MINOR = 0;

export type Theme = 'light' | 'dark';
export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

/** Tag on every postMessage envelope, so unrelated messages are ignored. */
export const MESSAGE_TAG = 'lab-bridge';

/** The shell names each module iframe `lab-shell:<module>` (web delivery). */
export const FRAME_NAME_PREFIX = 'lab-shell:';

/**
 * On desktop the shell injects `window.__LAB_SHELL__ = { module, v, minor, theme }` into each
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
  /** v3.1. The resolved theme, or null on an older shell. */
  theme: 'bridge_theme',
} as const;

/**
 * v2, desktop: the host dispatches this DOM event on the module's `window`
 * when files are waiting for it (`new CustomEvent(OPEN_FILES_EVENT, { detail:
 * { id } })`). The bridge then asks for them with `COMMANDS.openFiles`.
 */
export const OPEN_FILES_EVENT = 'lab-bridge:open-files';

/** v3: the host dispatches this DOM event on the module window, detail `{ id }`. */
export const COMMAND_EVENT = 'lab-bridge:command';

/** v3.1: DOM event on the module window, detail `{ theme: 'light' | 'dark' }`. */
export const THEME_EVENT = 'lab-bridge:theme';

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

/** v4: GrainAtlas snapshots and sync notices, sent through notify(). */
export const ATLAS_EVENTS = {
  status: 'lab.atlas.status',
  drafts: 'lab.atlas.drafts',
  synced: 'lab.atlas.synced',
  commandResult: 'lab.command.result',
  /** v5: the user asked to open a spot in another app (context menu or E / S in the viewer). */
  spotAction: 'lab.spot.action',
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
  /** Published atlas server, an http(s) URL of at most 2048 characters. */
  server?: string;
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
  /** Published atlas server, an http(s) URL of at most 2048 characters. */
  server?: string;
  flash?: boolean;
  via?: string;
}

export interface ReviewSpotsCommand {
  type: 'review-spots';
  /** Each listed atlas shows only these spots. Unlisted atlases keep their full overlays. */
  projects: Record<string, string[]>;
  /** Optional sample colours for visible overlays: project -> atlas spot id -> #rrggbb. */
  colors?: Record<string, Record<string, string>>;
  focus?: Omit<FocusSpotCommand, 'type'>;
}

export type AtlasMode = 'view' | 'edit';
export type AtlasState = 'checking' | 'unregistered' | 'in-sync' | 'local-changes' |
  'server-newer' | 'both-changed' | 'offline';

export interface AtlasChanges {
  spots: number;
  grains: number;
  labels: number;
  pixels: boolean;
}

export interface AtlasStatusEvent extends BridgeEvent {
  type: typeof ATLAS_EVENTS.status;
  project: string;
  mount: string | null;
  name: string;
  mode: AtlasMode;
  state: AtlasState;
  /** Mount content revision; null whenever mount is null. */
  revision: number | null;
  /** Mount's current published bundle (laicpmsdb atlas_version). */
  atlasVersion: number | null;
  changes: AtlasChanges | null;
  syncedAt: string | null;
}

export interface AtlasDraft {
  project: string;
  name: string;
  mount: string | null;
  baseRevision: number | null;
  changes: AtlasChanges;
  updatedAt: string;
}

export interface AtlasDraftsEvent extends BridgeEvent {
  type: typeof ATLAS_EVENTS.drafts;
  drafts: AtlasDraft[];
}

export interface AtlasSyncedEvent extends BridgeEvent {
  type: typeof ATLAS_EVENTS.synced;
  project: string;
  mount: string;
  /** Mount content revision, shared by all its project UUIDs. */
  revision: number;
  atlasVersion: number | null;
  changed: AtlasChanges;
  at: string;
}

export type AtlasCommandName = 'open-project' | 'set-mode' | 'leave-edit' | 'sync-draft' | 'discard-draft';
export type AtlasResultCode = 'offline' | 'conflict' | 'unauthorized' | 'not-found' | 'failed' | 'needs-confirmation';
export interface AtlasSyncConfirmation {
  retireGrains: number;
  grainsTotal: number;
  deleteSpots: number;
  spotsTotal: number;
}
export type CommandResult = {
  type: typeof ATLAS_EVENTS.commandResult;
  id: string;
  command: AtlasCommandName;
  project?: string;
  mount?: string | null;
  revision?: number | null;
} & (
  { ok: true; code?: never; error?: never; confirm?: never } |
  { ok: false; code: Exclude<AtlasResultCode, 'needs-confirmation'>; error?: string; confirm?: never } |
  { ok: false; code: 'needs-confirmation'; error?: string; confirm: AtlasSyncConfirmation }
);

export interface OpenProjectCommand {
  /** Optional completion acknowledgement id (1–64 ASCII letters, digits, _ or -). */
  id?: string;
  type: 'open-project';
  project: string;
  server?: string;
  mode?: AtlasMode;
  revision?: number;
}

export interface SetModeCommand {
  /** Optional completion acknowledgement id (1–64 ASCII letters, digits, _ or -). */
  id?: string;
  type: 'set-mode';
  project: string;
  mode: AtlasMode;
}

export interface LeaveEditCommand {
  /** Optional completion acknowledgement id (1–64 ASCII letters, digits, _ or -). */
  id?: string;
  type: 'leave-edit';
  project: string;
  decision: 'sync' | 'keep-draft' | 'discard';
}

export interface SyncDraftCommand {
  /** Optional completion acknowledgement id (1–64 ASCII letters, digits, _ or -). */
  id?: string;
  type: 'sync-draft';
  project: string;
}

export interface DiscardDraftCommand {
  /** Optional completion acknowledgement id (1–64 ASCII letters, digits, _ or -). */
  id?: string;
  type: 'discard-draft';
  project: string;
}

export interface ReportStatusCommand {
  type: 'report-status';
}

export interface AtlasSyncedCommand {
  type: 'atlas-synced';
  project: string;
  mount: string;
  revision: number;
}

/**
 * v5: how the shell shows the module. `viewer`: no editing chrome and no
 * writes of any kind (stored copies, drafts, journal, sync); pan, zoom, area,
 * legend and spot selection only. `editor`: the full module, as before v5.
 */
export type Presentation = 'viewer' | 'editor';
export interface SetPresentationCommand {
  type: 'set-presentation';
  presentation: Presentation;
}

export type BridgeCommand = FocusSpotCommand | FocusGrainCommand | ReviewSpotsCommand |
  OpenProjectCommand | SetModeCommand | LeaveEditCommand | SyncDraftCommand |
  DiscardDraftCommand | ReportStatusCommand | AtlasSyncedCommand | SetPresentationCommand;

/** v5: `edit` = edit the spot in standalone grainatlas; `studio` = open its analysis in Studio. */
export type SpotActionName = 'edit' | 'studio';
export interface SpotActionEvent extends BridgeEvent {
  type: 'lab.spot.action';
  action: SpotActionName;
  project: string;
  spot: string;
}

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

const isCommandId = (x: unknown): x is string =>
  typeof x === 'string' && x.length >= 1 && x.length <= 64 && !/[^A-Za-z0-9_-]/.test(x);
const isAtlasCommandName = (x: unknown): x is AtlasCommandName =>
  x === 'open-project' || x === 'set-mode' || x === 'leave-edit' || x === 'sync-draft' || x === 'discard-draft';

const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const isId = (x: unknown): x is string => typeof x === 'string' && ID.test(x);
const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
const isAtlasMode = (x: unknown): x is AtlasMode => x === 'view' || x === 'edit';
const isAtlasState = (x: unknown): x is AtlasState =>
  x === 'checking' || x === 'unregistered' || x === 'in-sync' || x === 'local-changes' ||
  x === 'server-newer' || x === 'both-changed' || x === 'offline';
const isRecord = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);
const isGrain = (x: unknown): x is string =>
  typeof x === 'string' && x.split('/').length <= 2 && x.split('/').every(isId);

function isServer(x: unknown): boolean {
  if (typeof x !== 'string' || x.length > 2048 || /[\u0000-\u0020]/.test(x)) return false;
  try {
    const u = new URL(x);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}

/** Unknown command types are ignored so newer modules and shells can coexist. */
export function isBridgeCommand(x: unknown): x is BridgeCommand {
  if (!x || typeof x !== 'object') return false;
  const c = x as Record<string, unknown>;
  if (isAtlasCommandName(c.type) && c.id !== undefined && !isCommandId(c.id)) return false;
  if (c.type === 'report-status') return true;
  if (c.type === 'set-presentation') return c.presentation === 'viewer' || c.presentation === 'editor';
  if (c.type === 'open-project') return isId(c.project) &&
    (c.server === undefined || isServer(c.server)) &&
    (c.mode === undefined || isAtlasMode(c.mode)) &&
    (c.revision === undefined || isCount(c.revision));
  if (c.type === 'set-mode') return isId(c.project) && isAtlasMode(c.mode);
  if (c.type === 'leave-edit') return isId(c.project) &&
    (c.decision === 'sync' || c.decision === 'keep-draft' || c.decision === 'discard');
  if (c.type === 'sync-draft' || c.type === 'discard-draft') return isId(c.project);
  if (c.type === 'atlas-synced') return isId(c.project) && isId(c.mount) && isCount(c.revision);
  if (c.type === 'review-spots') {
    if (!c.projects || typeof c.projects !== 'object' || Array.isArray(c.projects)) return false;
    const projects = Object.entries(c.projects);
    if (projects.length > 64 || !projects.every(([project, spots]) =>
      isId(project) && Array.isArray(spots) && spots.length <= 10000 && spots.every(isId))) return false;
    if (c.colors !== undefined) {
      if (!c.colors || typeof c.colors !== 'object' || Array.isArray(c.colors)) return false;
      const colors = Object.entries(c.colors);
      if (colors.length > 64 || !colors.every(([project, spots]) =>
        isId(project) && !!spots && typeof spots === 'object' && !Array.isArray(spots) &&
        Object.keys(spots).length <= 10000 && Object.entries(spots).every(([spot, color]) =>
          isId(spot) && typeof color === 'string' && color.length === 7 && /^#[0-9a-fA-F]{6}$/.test(color)))) return false;
    }
    return c.focus === undefined || (!!c.focus && typeof c.focus === 'object' &&
      isBridgeCommand({ ...c.focus, type: 'focus-spot' }));
  }
  if ((c.server !== undefined && !isServer(c.server)) || !isId(c.project) || (c.flash !== undefined && typeof c.flash !== 'boolean') ||
      (c.via !== undefined && typeof c.via !== 'string')) return false;
  if (c.type === 'focus-spot') return isId(c.spot);
  if (c.type === 'focus-grain') return isGrain(c.grain) && (c.spot === undefined || isId(c.spot));
  return false;
}

/** v4: completion of an identified command; unknown fields are ignored. */
export function commandResult(event: unknown): CommandResult | null {
  if (!isRecord(event) || event.type !== ATLAS_EVENTS.commandResult || !isCommandId(event.id) ||
      !isAtlasCommandName(event.command) || typeof event.ok !== 'boolean' ||
      (event.project !== undefined && !isId(event.project)) ||
      (event.mount !== undefined && event.mount !== null && !isId(event.mount)) ||
      (event.revision !== undefined && event.revision !== null && !isCount(event.revision))) return null;
  if (event.ok ? event.code !== undefined || event.error !== undefined :
      !['offline', 'conflict', 'unauthorized', 'not-found', 'failed', 'needs-confirmation'].includes(event.code as string) ||
      (event.error !== undefined && (typeof event.error !== 'string' || event.error.length > 300))) return null;
  let confirm: AtlasSyncConfirmation | undefined;
  if (event.code === 'needs-confirmation') {
    const c = event.confirm;
    if (!isRecord(c) || !isCount(c.retireGrains) || !isCount(c.grainsTotal) ||
        !isCount(c.deleteSpots) || !isCount(c.spotsTotal) ||
        c.retireGrains > c.grainsTotal || c.deleteSpots > c.spotsTotal) return null;
    confirm = { retireGrains: c.retireGrains, grainsTotal: c.grainsTotal,
      deleteSpots: c.deleteSpots, spotsTotal: c.spotsTotal };
  } else if (event.confirm !== undefined) return null;
  return { type: ATLAS_EVENTS.commandResult, id: event.id, command: event.command, ok: event.ok,
    ...(confirm === undefined ? {} : { confirm }),
    ...(event.code === undefined ? {} : { code: event.code }),
    ...(event.error === undefined ? {} : { error: event.error }),
    ...(event.project === undefined ? {} : { project: event.project }),
    ...(event.mount === undefined ? {} : { mount: event.mount }),
    ...(event.revision === undefined ? {} : { revision: event.revision }) } as CommandResult;
}

/** v5: normalise a spot action request; anything malformed is null. */
export function spotAction(event: unknown): SpotActionEvent | null {
  if (!isRecord(event) || event.type !== ATLAS_EVENTS.spotAction ||
      (event.action !== 'edit' && event.action !== 'studio') ||
      !isId(event.project) || !isId(event.spot)) return null;
  return { type: ATLAS_EVENTS.spotAction, action: event.action, project: event.project, spot: event.spot };
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

function atlasChanges(value: unknown): AtlasChanges | null {
  if (!isRecord(value) || !isCount(value.spots) || !isCount(value.grains) ||
      !isCount(value.labels) || typeof value.pixels !== 'boolean') return null;
  return { spots: value.spots, grains: value.grains, labels: value.labels, pixels: value.pixels };
}

/** v4: normalise the latest open-project snapshot; unknown fields are ignored. */
export function atlasStatus(event: unknown): AtlasStatusEvent | null {
  if (!isRecord(event) || event.type !== ATLAS_EVENTS.status || !isId(event.project) ||
      (event.mount !== null && !isId(event.mount)) || typeof event.name !== 'string' ||
      !isAtlasMode(event.mode) || !isAtlasState(event.state) ||
      (event.revision !== null && !isCount(event.revision)) ||
      (event.mount === null && event.revision !== null) ||
      (event.atlasVersion !== null && !isCount(event.atlasVersion)) ||
      (event.syncedAt !== null && typeof event.syncedAt !== 'string')) return null;
  const changes = event.changes === null ? null : atlasChanges(event.changes);
  if (event.changes !== null && !changes) return null;
  return { type: ATLAS_EVENTS.status, project: event.project, mount: event.mount,
    name: event.name, mode: event.mode, state: event.state, revision: event.revision,
    atlasVersion: event.atlasVersion, changes, syncedAt: event.syncedAt };
}

/** v4: normalise all tracked hosted drafts, rejecting an invalid or oversized snapshot. */
export function atlasDrafts(event: unknown): AtlasDraftsEvent | null {
  if (!isRecord(event) || event.type !== ATLAS_EVENTS.drafts ||
      !Array.isArray(event.drafts) || event.drafts.length > 500) return null;
  const drafts: AtlasDraft[] = [];
  for (const draft of event.drafts) {
    if (!isRecord(draft) || !isId(draft.project) || typeof draft.name !== 'string' ||
        (draft.mount !== null && !isId(draft.mount)) ||
        (draft.baseRevision !== null && !isCount(draft.baseRevision)) ||
        typeof draft.updatedAt !== 'string') return null;
    const changes = atlasChanges(draft.changes);
    if (!changes) return null;
    drafts.push({ project: draft.project, name: draft.name, mount: draft.mount,
      baseRevision: draft.baseRevision, changes, updatedAt: draft.updatedAt });
  }
  return { type: ATLAS_EVENTS.drafts, drafts };
}

/** v4: normalise a successful sync or update-from-database notice. */
export function atlasSynced(event: unknown): AtlasSyncedEvent | null {
  if (!isRecord(event) || event.type !== ATLAS_EVENTS.synced || !isId(event.project) ||
      !isId(event.mount) || !isCount(event.revision) ||
      (event.atlasVersion !== null && !isCount(event.atlasVersion)) || typeof event.at !== 'string') return null;
  const changed = atlasChanges(event.changed);
  if (!changed) return null;
  return { type: ATLAS_EVENTS.synced, project: event.project, mount: event.mount,
    revision: event.revision, atlasVersion: event.atlasVersion, changed, at: event.at };
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
  push: 'open-files' | 'command' | 'theme';
  /** v3.1: the resolved shell theme. */
  theme?: Theme;
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
  minor?: number;
  theme?: Theme;
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
  return d.tag === MESSAGE_TAG && (d.push === 'open-files' || d.push === 'command' || (d.push === 'theme' && isTheme(d.theme)));
}

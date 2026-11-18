# @lab/bridge

The API a lab module (grainatlas, UPbDB) calls to talk to the UPb Lab
shell. It has no dependencies and works the same whether the module runs in
the desktop shell, in the web shell at `/desk/`, or on its own.

```ts
import { open, token, notify, isHosted, onOpenFiles } from '@lab/bridge';

await open('upbdb://acquisition/2f1c…');  // false when not hosted
await open('upbr://session/2f1c…');            // shell adds server + handoff code, launches Studio
const bearer = await token();                 // null when not hosted or signed out
await notify({ type: 'grainatlas.spot.selected', project, spot });
if (isHosted()) hideOwnSignInButton();
onOpenFiles(({ kind, name, files }) => openSet(name, files)); // protocol v2, below
```

| Where the module runs | Transport | How it is detected |
| --- | --- | --- |
| desktop shell, child webview | Tauri commands `bridge_open`, `bridge_token`, `bridge_notify` | the shell injects `window.__LAB_SHELL__ = { module, v }` |
| web shell, iframe | `postMessage` to `window.parent`, replies matched by id | the iframe is named `lab-shell:<module>` |
| alone | none: `open` resolves `false`, `token` resolves `null`, `notify` does nothing, `onOpenFiles` never fires | neither of the above |

`token()` is the shell's UPbDB sign-in (plan decision 5): the user signs
in once in the shell's tab bar (password, or ORCID / Google through the system
browser) and every module tab gets the same bearer token. On desktop the token
lives in the OS keychain (macOS Keychain, Windows Credential Manager) and is
given only to the bundled grainatlas build and to pages of the configured
UPbDB server; in the web shell it lives in the tab's `sessionStorage`. When
the user signs in or out in the shell, module tabs are reloaded, so read
`token()` at start-up and do not cache it across reloads.

| `notify()` type the shell acts on | Effect |
| --- | --- |
| `lab.auth.signed-out` (`SHELL_EVENTS.signedOut`), also `upbdb.auth.signed-out` | the shell signs out (revokes the token, clears the keychain entry) and reloads every module tab without a token; send it when the user signs out inside the module or the API answers 401 to the shell's token |
| `lab.spot.selected` (`SHELL_EVENTS.spotSelected`), also `grainatlas.spot.selected` | stored as the latest selection for Review (see protocol v3 below) |
| anything else | logged; the Home timeline uses them from roadmap phase 5 |

Plain links work too: in the desktop shell a click on an `<a href="upbdb://…">`
inside a module webview is intercepted and routed like `open()`.

The shell side of the `postMessage` transport is `createFrameHost` from
`@lab/bridge/host`. The wire format is in `src/protocol.ts`
(`PROTOCOL_VERSION` 5, `PROTOCOL_MINOR` 2; version 1 had `open`, `token` and
`notify`, version 2 added `open-files`, version 3 added commands and spot
selection, version 3.1 added theme, version 4 added atlas sync, version 5 the
viewer presentation and spot actions, version 5.1 the viewer's inset, and
version 5.2 Review sample groups in that inset).

## `review-spots`: Review overlays and mount inset

The shell sends `review-spots` to the Images viewer. `projects` maps atlas
project ids to the spot ids whose overlays are shown; unlisted projects keep
their full overlays. Optional `colors` maps project ids to spot ids to `#rrggbb`
Review colours. Optional `focus` has the fields of `focus-spot` except `type`.

In v5.2, optional `groups` maps project ids to ordered arrays of
`{ name, color, spots }`. While Review shows sample groups, the mount inset
outlines their shown atlas spots in each group's Review colour. Without
`groups`, the inset shows the selected spot as before. Older modules ignore
this additive field, and commands without it remain valid.

`projects`, `colors` and `groups` each allow at most 64 valid project ids.
Each project in `groups` allows at most 256 groups; a group name has 1–200
characters, its colour is `#rrggbb`, and its `spots` array contains at most
10000 valid atlas spot ids. Invalid groups reject the whole command.

## `open-files`: files the user opened in the shell (protocol v2)

The shell opens anything (grainatlas `docs/ux-conventions.md` rule 4): a
folder or files dropped anywhere on its window, opened from the Finder or
Explorer, or picked with Home's **Open folder…** / **Open files…**. It decides
by content which module reads them (`ui/src/lib/drop.ts`), shows that tab and
hands the files over. It never asks the user what they dropped, so the module
should not either: open the set like its own drop target would.

```ts
import { onOpenFiles, type OpenedFiles } from '@lab/bridge';

const stop = onOpenFiles(async (set: OpenedFiles) => {
  // set.kind  'package' | 'area' | 'images' | 'project'   (grainatlas)
  //           'export' | 'zip' | 'csv'                     (UPbDB)
  // set.name  folder name, zip name, or the files' common stem
  // set.path  desktop only: the host path (folder, zip, or the loose files' folder)
  // set.files [{ path: '001_HJ-GC1/001_HJ-GC1_0000.jpg', file: File }, …]
});
```

Register the handler once at start-up, before the user can do anything: files
that were waiting while the module loaded are delivered at once, later ones as
they come. Each set is delivered once. `path` is `/`-separated and relative to
the dropped folder (its first segment is the folder name only when several
folders were dropped together); `file` is a real `File` (name, size, type,
lastModified, and `webkitRelativePath` set to `path`), so code written for a
dropped folder or `<input webkitdirectory>` takes it unchanged.

What the module receives:

| Dropped or opened | Tab | `kind` | `files` |
| --- | --- | --- | --- |
| a folder with a `.zag`, or area sub-folders with images | Images | `package` | every file grainatlas reads (its `keep()` rule: no hidden files, `*_stitch.jpg`, office files, PDFs or zips), four levels deep |
| one folder with images in it | Images | `area` | same |
| image files (`jpg`, `jpeg`, `tif`, `tiff`, `png`, `bmp`) | Images | `images` | same |
| a `*.grainatlas` folder | Images | `project` | same |
| a TM4000 `.zag` file (Finder "Open with", Windows association) | Images | `package` | its package folder |
| a folder of CSVs (Qtegra export) | Sessions | `export` | the `.csv` and `.zip` files |
| zip files | Sessions | `zip` | the zips |
| CSV files | Sessions | `csv` | the CSVs |

Images and CSVs in one set: the larger group wins, images on a tie.

How it travels (the module needs none of this; `onOpenFiles` hides it):

- **Desktop.** The host lists the paths and keeps an *offer* for the module's
  webview (`src-tauri/src/files.rs`). It dispatches
  `new CustomEvent('lab-bridge:open-files', { detail: { id } })` on the
  module's `window` (`OPEN_FILES_EVENT`); the bridge invokes
  `bridge_open_files { take: true }` and gets an `OpenFilesManifest`:

  ```json
  {
    "id": "o19a3c…-3",
    "kind": "package",
    "name": "Mount_XS_150X",
    "path": "/Users/…/Mount_XS_150X",
    "files": [
      { "path": "001_HJ-GC1/001_HJ-GC1_0000.jpg", "size": 18234, "lastModified": 1730700000000, "type": "image/jpeg" },
      { "path": "Mount_XS_150X.zag", "size": 412, "lastModified": 1730700000000, "type": "" }
    ]
  }
  ```

  then reads each file's bytes with `bridge_read_file { id, index }` (an
  `ArrayBuffer`, four reads at a time). A webview can read only the files of
  the offer made to it; a new offer replaces the old one.
- **Web (`/desk/`).** The shell has the `File` objects of a drop on its own
  page. It posts `{ tag: 'lab-bridge', v: 2, push: 'open-files' }` to the
  module iframe; the bridge answers with an `open-files` request and the
  reply's `result` is an `OpenFilesTransfer` (the manifest fields, with
  `files: [{ path, file: File }]` passed by structured clone). A drop on the
  module's own iframe never reaches the shell: the module's drop target
  handles it, as today.

In debug builds of the desktop shell, a module that has not taken its files
three seconds after they were offered gets them read from inside its webview
by a small probe, which reports `lab.open-files.seen` to the shell; Home's
Links list then shows how many files and bytes reached the webview. Release
builds say after ten seconds that the module does not read `open-files` yet.

## Protocol v3: commands and spot selection

The shell can ask a module to show a spot or grain without reloading its page.
A module registers `onCommand` once at start-up; it returns an unsubscribe
function. A command already waiting is delivered on registration. Each command
is delivered once, and a newer waiting command replaces an untaken older one.
Standalone, `onCommand` never fires. Unknown command types and invalid payloads
are ignored.

```ts
import { onCommand, notify, SHELL_EVENTS, type BridgeCommand } from '@lab/bridge';

const stop = onCommand(async (command: BridgeCommand) => {
  // focus-spot:  { type, project, spot, flash?: boolean, via?: string, server?: string }
  // focus-grain: { type, project, grain, spot?: string, flash?: boolean, via?: string, server?: string }
  await focus(command);
});
await notify({
  type: SHELL_EVENTS.spotSelected, project, spot, name, grain, area,
  via: 'user', // 'shell' when selected because of a command
});
```

`project` is the grainatlas project id (`atlas_project_id` in UPbDB),
`spot` is its spot id (`atlas_spot_id`), and `grain` is a grainatlas grain id
or the grain label stored by UPbDB (`<area_id>/<grain_number>`). Each id
matches `^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$`; a grain label permits one `/`
between two such parts. `flash` requests a visual flash; `via` names the
sender, for example `'review'`. Both commands optionally carry `server`, an
HTTP or HTTPS URL of at most 2048 characters, so grainatlas can open a
published atlas by id. Older callers may omit it; older modules can ignore it.

For grainatlas, `focus-spot` opens the project if needed (from the recent list
or the published atlas, as a deep link does), selects the spot, centres the
canvas and flashes it when requested. `focus-grain` opens the project if
needed, selects and centres the grain (and the optional spot within it), and
flashes the target when requested. A spot selection caused by either command
emits `lab.spot.selected` with `via: 'shell'`, so a consumer can avoid a
selection loop. These are the module's adoption contract; the bridge only
delivers commands.

`SpotSelectedEvent` carries `{ type: 'lab.spot.selected', project, spot,
name?: string, grain?: string | null, area?: string, via: 'user' | 'shell' }`.
The shell's `spotSelection(event)` helper validates and normalises it (missing
`via` defaults to `'user'`). It also accepts the older
`grainatlas.spot.selected` event with `{ project, spot, name? }`, always as
`via: 'user'`. Invalid ids and unrelated events return `null`.

Desktop wire format:

- The shell calls `module_command { module: 'images' | 'sessions', command }`.
  The host validates and stores the newest command per module webview label,
  even before that webview exists. It returns whether the webview exists.
- If the webview exists, the host evaluates
  `window.dispatchEvent(new CustomEvent('lab-bridge:command', { detail: { id } }))`.
- The module bridge invokes `bridge_take_command` on registration and each
  nudge. It returns the waiting command or `null` and clears it. A module can
  take only its own webview's command. Only the shell may call `module_command`;
  local and configured remote module origins may call `bridge_take_command`.
  Older hosts rejecting the invoke are silently tolerated.

Web wire format:

```ts
// Shell side, from @lab/bridge/host:
pushCommand(frame, command, targetOrigin);
// Posts { tag: 'lab-bridge', v: PROTOCOL_VERSION, push: 'command', command }.
```

The module accepts command pushes only from `window.parent`, validates the
command and delivers it without a request or reply. Before a handler exists,
it retains only the newest valid push. The shell's `sendCommand(tab, command)`
uses this helper on the web and `module_command` on desktop. On the web it
returns `false` if the frame is not ready and holds the newest command until
the frame's next load. Module events travel through the existing `notify`
transport and origin checks.

Compatibility (rows are module versions, columns are shell versions):

| Module / shell | v1 shell | v2 shell | v3 shell |
| --- | --- | --- | --- |
| v1 module | open, token, notify | same | same; ignores commands |
| v2 module | open, token, notify; no files | plus open-files | plus open-files; ignores commands |
| v3 module | open, token, notify; no files or commands | plus open-files; no commands | plus open-files and commands; accepts both spot selection event names |

The shell continues answering older requests without requiring version equality.
A v3 module on an older shell receives no commands; existing operations keep
working. Older shells can receive `lab.spot.selected` as an ordinary `notify`
event but have no selection consumer. The v3 shell accepts both the current
and legacy selection events from modules of any version.

## Protocol v4: atlas sync status, drafts and sync notices

GrainAtlas sends the shell sync status, hosted drafts and successful sync
notices through `notify`. The shell sends commands through the existing
`onCommand` transport. Status and draft events are idempotent snapshots:
the newest received snapshot wins, rather than adding counts to an earlier
snapshot. This section defines the adoption contract. The shell status strip, Home draft list, leave
guard and refresh handlers activate only after a valid v4 event from Images;
older modules keep their existing behavior and receive no v4 commands.

```ts
import { notify, ATLAS_EVENTS, atlasStatus, atlasDrafts, atlasSynced } from '@lab/bridge';

await notify({
  type: ATLAS_EVENTS.status, project, mount, name, mode: 'view',
  state: 'checking', revision: null, atlasVersion: null, changes: null, syncedAt: null,
});
await notify({ type: ATLAS_EVENTS.drafts, drafts });
await notify({
  type: ATLAS_EVENTS.synced, project, mount, revision, atlasVersion,
  changed: { spots: 1, grains: 3, labels: 0, pixels: false }, at, // a one-grain split
});

// Shell notify consumer: each helper returns a normalised typed value or null.
const status = atlasStatus(event);
const hostedDrafts = atlasDrafts(event);
const syncNotice = atlasSynced(event);
```

`project` is the project UUID and `mount` is the UPbDB mount id. Both use
the existing `isId` rule described in v3, rather than a stricter UUID parser.
Counts, revisions and atlas versions are non-negative integers. `name` and timestamp
fields are strings; the parsers do not interpret dates. Changes have
`{ spots: number, grains: number, labels: number, pixels: boolean }`. Unknown
extra fields are ignored, including inside changes and draft entries. Missing
required fields or invalid values reject the whole event.

`GET /v1/atlas/projects/{uuid}` returns `revision`, `atlas_version`,
`mount_id`, `mount_label`, `changed_at`, `changed_by`, `current_project_uuid`
and `superseded`. `revision` is the mount's content revision for spots,
grains and labels; it increases by 1 per sync that changes something. A mount
can carry two project UUIDs, so consumers key refreshes on `mount` + `revision`,
not `project`. In status events, `revision` is null whenever `mount` is null;
the parser rejects a non-null revision without a mount. `atlasVersion` maps
to `atlas_version`, the mount's current published bundle (integer or null).

| GrainAtlas → shell event | Payload and when to send |
| --- | --- |
| `lab.atlas.status` (`ATLAS_EVENTS.status`) | `{ type, project, mount: string \| null, name, mode: 'view' \| 'edit', state, revision: number \| null, atlasVersion: number \| null, changes: AtlasChanges \| null, syncedAt: string \| null }`. Send after open and whenever status changes. `revision` must be null when `mount` is null. `state` is `'checking'`, `'unregistered'`, `'in-sync'`, `'local-changes'`, `'server-newer'`, `'both-changed'` or `'offline'`. `'checking'` means the server lookup is in flight immediately after open. |
| `lab.atlas.drafts` (`ATLAS_EVENTS.drafts`) | `{ type, drafts: [{ project, name, mount: string \| null, baseRevision: number \| null, changes: AtlasChanges, updatedAt: string }] }`, at most 500 entries. Send the full list of every tracked hosted draft with unsynced changes at start-up and whenever it changes, including an empty list when cleared. Standalone app drafts use separate storage and are not reported. |
| `lab.atlas.synced` (`ATLAS_EVENTS.synced`) | `{ type, project, mount, revision: number, atlasVersion: number \| null, changed: AtlasChanges, at: string }`. Send after any successful sync or update-from-database. `mount` and `revision` are required and non-null. `changed` counts the elements this sync wrote (from UPbDB's `SyncOut.applied`): spots created + updated + deleted; grains created + adopted + updated + retired; labels created + updated + retired. A one-grain split reads `{ spots: 1, grains: 3, labels: 0, pixels: false }`. When the same action also publishes new images, a second notice follows with zero counts, `pixels: true` and the new `atlasVersion`; notices are snapshots, newest wins. The shell does not use `changed`: it refreshes on `mount` + `revision`, and on `atlasVersion` for images. |

| Shell → module command | Payload and when to send |
| --- | --- |
| `open-project` | `{ type, id?: string, project, server?: string, mode?: 'view' \| 'edit', revision?: number }`. Open a project, optionally at a revision. `server` follows `focus-spot`: an HTTP or HTTPS URL of at most 2048 characters, with no whitespace or control characters. |
| `set-mode` | `{ type, id?: string, project, mode: 'view' \| 'edit' }`. Request a mode change in the project. |
| `leave-edit` | `{ type, id?: string, project, decision: 'sync' \| 'keep-draft' \| 'discard' }`. Send after the shell's own leave guard has asked the user. The module acts without asking again unless sync needs bulk confirmation, and keeps a one-step undo snapshot in memory after discard. |
| `sync-draft` | `{ type, id?: string, project }`. Sync a hosted draft from the shell Home list. |
| `discard-draft` | `{ type, id?: string, project }`. Discard a hosted draft from Home after confirmation in a shell dialog. |
| `report-status` | `{ type }`. Request that GrainAtlas re-send both `lab.atlas.status` and `lab.atlas.drafts`, for example when a shell consumer needs current snapshots. |
| `atlas-synced` | `{ type, project, mount, revision }`. Forward a successful sync notice to other modules, such as Sessions, so they refresh. Both ids and the non-negative integer revision are required. |

The five commands with optional `id` accept 1–64 ASCII characters from
`[A-Za-z0-9_-]`. Without an id their behavior is unchanged. With an id the
module sends exactly one `lab.command.result` (`ATLAS_EVENTS.commandResult`)
through `notify` after the action has really finished:

```ts
{ type: 'lab.command.result', id,
  command: 'open-project' | 'set-mode' | 'leave-edit' | 'sync-draft' | 'discard-draft',
  ok: boolean, code?: 'offline' | 'conflict' | 'unauthorized' | 'not-found' | 'failed' | 'needs-confirmation',
  error?: string, project?: string, mount?: string | null, revision?: number | null,
  confirm?: { retireGrains: number, grainsTotal: number, deleteSpots: number, spotsTotal: number } }
```

`commandResult(event)` returns a normalised result or null. Failure requires
`code`; success must carry neither `code` nor `error`. The optional user-facing
`error` is at most 300 characters. Project and mount use the existing id rule;
revision is a non-negative integer or null. Unknown fields are ignored.
`confirm` is required with `ok: false, code: 'needs-confirmation'` and forbidden
with any other result. Its four counts are non-negative integers;
`retireGrains <= grainsTotal` and `deleteSpots <= spotsTotal`.

For `leave-edit` with `sync` and for `sync-draft`, success means the server
confirmed the sync and the draft is cleared. For `keep-draft`, it means the
draft is persisted; discard finishes after removal. `open-project` and
`set-mode` finish once the project lands in a state after the B1 server lookup.
An offline lookup is still `ok: true`, with `state: 'offline'` in the status
event. On a conflict (HTTP 409 / “Both changed”), the module opens its own
Review differences, remains in edit, and returns `ok: false, code: 'conflict'`.

UPbDB refuses a sync that retires more than `max(3, 10%)` of a mount's
grains or deletes more than `max(3, 10%)` of its spots unless `confirm_bulk`
follows a user confirmation naming the counts. Grains are only retired;
spots are only deleted. For shell-started syncs (`leave-edit` with `sync`,
including quit, or `sync-draft`), the module returns `needs-confirmation`
with counts learned from a dry run. Nothing has been written and the module
does not prompt over the shell's dialog. The shell closes its own dialog,
cancels leaving or quitting (on desktop, `quit_cancel`), shows Images with
the module surface visible, and sends an identified `set-mode` edit request
for that project, waiting up to 10 s and only logging failure. The module
then immediately shows its own confirmation, holding the sync it started:
Agree syncs with `confirm_bulk`; Cancel keeps the draft and the chip says
"Needs confirmation". The module's own Sync button prompts directly.

Home instead shows the counts and an "Open in Images" button. That button
shows Images and sends the edit request; if the latest status names another
project, it sends `open-project` with the row's project and `mode: 'edit'`.

The shell serialises identified requests to Images, waiting for a matching
result or timeout before sending the next request. Sync waits up to 60 s;
other actions wait up to 10 s. A timeout does not imply cancellation or success:
the draft is kept and any late result cannot complete another request.

The Edit switch, status chip, Sync control and split tool live in the
GrainAtlas module. The shell owns the leave guard and Home draft actions. On
`lab.atlas.synced`, the shell refreshes Review, Home and Sessions by re-reading
the mount and forwards `atlas-synced` to other modules. On window focus it also
re-reads the mount to catch syncs made in the standalone app. Every shell
dialog in this flow hides module surfaces first, as required by UX rule 8
(L3), and restores them when the dialog closes.

On desktop, the quit guard offers Sync and quit, Quit, keep drafts, or Cancel
when GrainAtlas reports unsynced changes or drafts. Quitting never depends on
the UI: the Rust shell waits at most 2 s for the UI to answer, and a second
Cmd+Q quits at once, including while the prompt is open or sync is pending.
Once the UI answers that it is prompting, the user may take as long as needed
to decide. A forced quit loses at most a drag still in progress: GrainAtlas
persists every committed edit at once (each undo checkpoint writes the project
and its sync draft to the webview's storage; a spot move, resize or brush
stroke commits when the pointer is released), so unsynced changes stay as
drafts and appear again on Home and in GrainAtlas. Nothing is written in
read-only view, while a project loads, or while its "Unsaved changes found"
prompt is open.

Protocol v4 retains every v3 operation, including v3.1 theme behavior; it does
not require version equality. Older modules ignore unknown commands and the
shell ignores unknown events. A newer module on an older shell continues
using the operations that shell supports and degrades silently for v4. The
command queue still retains only the newest untaken command per module; no
transport-level queue is introduced; the shell serialises completion requests
above this one-slot transport.

### Open in GrainAtlas (standalone)

The shell launches the installed standalone app with arguments. There is no
new URL scheme; `grainatlas://` stays with UPb Lab. On macOS:

```text
open -n -b org.grainatlas.desktop --args --project <project-uuid> --server <base-url> --code <one-time-code> [--revision <n>]
```

GrainAtlas uses `tauri-plugin-single-instance`, keyed per `--profile`, to
forward argv to a running instance. The shell never passes `--profile`. The
running instance opens or focuses that project, using its own draft if it
holds one and saying so in its status chip. The forwarding process exits as
soon as it hands over argv.

As for Studio, the code comes from `POST /v1/auth/handoff`. It is single-use
and short-lived, is exchanged at `POST /v1/auth/exchange` before anything else,
is never stored, and is redacted in both apps' logs. It is visible in the
process list only for the seconds the launching process lives. Never pass a
bearer token on the command line. GrainAtlas checks `--server` against its
configured server; a different server asks the user first, and nothing is
fetched before the yes.

On macOS the shell looks for the bundle id through LaunchServices and in
`/Applications` and `~/Applications`. If absent, the button says
"GrainAtlas is not installed (looked in /Applications and ~/Applications)".

On Windows (from the GrainAtlas config, not verified on a Windows machine),
start `grainatlas-desktop.exe` with the same arguments. Find it through
`InstallLocation` under
`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\grainatlas`
(NSIS, current-user install), then `%LOCALAPPDATA%\grainatlas`, then
`Program Files\grainatlas` (MSI). Single-instance forwarding works the same
on Windows. The shell implements this launch contract in
`src-tauri/src/grainatlas_app.rs`; the UI mints the handoff code and enables
the button only after Images advertises v4.

## Protocol v5: viewer presentation and spot actions

The shell can show a module as a read-only viewer (UPb Lab's Review tab) or as
its editor (UPb Lab's Images tab, or any shell older than v5):

```ts
{ type: 'set-presentation', presentation: 'viewer' | 'editor' }
```

In `viewer` the module hides all editing chrome and writes nothing: no stored
copies, drafts, journal entries, saves or sync calls. Pan, zoom, fit, area,
legend, scale bar and spot selection (`lab.spot.selected`) stay. A module that
never receives the command stays an editor; a v4 module ignores it.

A viewer can ask the shell to open a spot elsewhere (its right-click menu, or
E and S):

```ts
await notify({ type: 'lab.spot.action', action: 'edit' | 'studio', project, spot });
```

`edit` opens the spot in standalone grainatlas; `studio` opens its analysis in
UPbRPy Studio. The shell validates it with `spotAction()`; malformed events are
ignored, and a v4 shell ignores the type.

## Protocol v5.1: the viewer's mount inset

The viewer presentation shows a small locator inset of the whole mount. The
viewer never writes storage, so the shell remembers the inset for the user:

- `set-presentation` may carry `inset: { width, collapsed }` (`ViewerInset`;
  `width` an integer in CSS px, 120 to 1200). The viewer applies it; without
  it the viewer keeps its in-memory state, so an older shell gives a
  session-only inset.
- After the user resizes, collapses or expands the inset, the viewer sends
  `notify({ type: 'lab.viewer.inset', width, collapsed })`
  (`ATLAS_EVENTS.viewerInset`, normalised by `viewerInset()`). It does not
  send one when it applies a received inset. An older shell ignores the event.

## Adopting the bridge in a module

`@lab/bridge` is not on npm yet. Until it is, depend on it from a checkout
(`"@lab/bridge": "file:../upblab/bridge"`, after `make setup` here builds
`bridge/dist/`) or vendor the tarball from `pnpm --filter @lab/bridge pack`.

### Both modules

- Ask `isHosted()` before `window.__TAURI_INTERNALS__`. Tauri injects
  `__TAURI_INTERNALS__` into every webview, including module webviews in the
  shell, so its presence does not mean "my own desktop app": only the bridge
  commands are allowed there, not the module's own Tauri commands.
- Keep relative asset paths (`base: './'`) and route by hash or query string.
- Use `theme()` and `onTheme(handler)` (protocol v3.1) for the shell's resolved
  `light` or `dark` theme. `onTheme` immediately delivers the current value if
  known, then every change; it returns an unsubscribe. `theme()` returns null
  when standalone or on an older shell. The shell defaults to System and
  follows OS changes live. While hosted, the shell's theme wins over a module's
  stored choice. Fallback order: bridge message, host-written `data-theme` on
  `<html>`, then `?theme=light|dark` at load. Never reload to apply a theme.
  See [the theme contract](../docs/bridge-theme.md) for both transports and
  compatibility with older builds.
- Leave `Ctrl/⌘ 1–4`, `Ctrl/⌘ ,` and `Ctrl/⌘ R` to the shell.
- Links to other modules: `open('upbdb://…')` or a plain
  `<a href="grainatlas://…">`. Never `location.href = '<other module URL>'`.

### grainatlas

- Read `?server=<base>&project=<id>&spot=<id>` from `location.search` at
  start-up and open that project and spot: the shell routes
  `grainatlas://project/<id>[/spot/<id>]` to
  `modules/grainatlas/index.html?server=<upbdb base URL>&project=<id>[&spot=<id>]`.
  Open the project from the recent list, else the published atlas from
  `<server>/atlas/projects/<id>/` with `token()` (docs/WORKFLOW.md section 6).
  Home's "Open images" on a mount's current atlas uses this link.
- When hosted, use the web build's file paths (`<input type=file
  webkitdirectory>`, drag-drop): grainatlas's own Tauri commands do not exist
  in the shell.
- In the desktop shell the bundled build shares the shell's origin
  (`tauri://localhost`, Windows `http://tauri.localhost`), so its
  `localStorage` and IndexedDB live next to the shell's: prefix keys with
  `grainatlas.`.
- Publish the static web build as a release asset (`.tar.gz` or `.zip`,
  `index.html` at the top or in one top-level folder) and give its URL and
  SHA-256 to `modules.lock.json`.
- Phase 2: on a spot click, `open('upbdb://acquisition/<id>')` for the
  acquisition whose label equals the spot name (looked up in UPbDB).
- **`open-files` (to adopt).** When hosted, register `onOpenFiles` at
  start-up and pass the set to the same code as the Open screen:
  `openFiles(set.name, set.files)` (`{ path, file }` is grainatlas's
  `PackageFile`). `kind` is a hint (`package`, `area`, `images`, `project`);
  keep detecting with `Session::open_source` and ask for a scale once when
  the images carry none (rule 5). In the desktop shell, every drop on the
  window, including one on grainatlas's own drop zone, arrives this way:
  the shell's webviews keep Tauri's drag-and-drop handler, which hands the
  host paths instead of HTML5 `drop` events, so `fromDrop()` does not fire
  there.

### UPbDB

- Keep the hash routes the resolver targets: `#/acquisitions/<id>`,
  `#/sessions/<id>`, `#/samples/<id>`, `#/mounts/<id>`, `#/search?label=`,
  and `#/ingest?path=<folder>` (the ingest dialog with the folder prefilled;
  the shell resolves `upbdb://mount/<id>` and `upbdb://ingest?path=`
  to them).
- **`open-files` (to adopt).** The shell sends a Qtegra export folder, zip or
  CSVs to `#/ingest?path=<host path>` (desktop) or `#/ingest` (web) and
  offers the files at the same time. On that route, register `onOpenFiles`
  and pass `set.files.map((f) => f.file)` to the ingest dialog's `classify()`
  (`ui/src/lib/drop.ts`, with `set.name` as the folder name), then
  `POST /v1/sessions/ingest` as for a drop: the dialog shows the suggested
  session key and material and the user confirms the upload. `kind` is
  `export`, `zip` or `csv`; `path` is the host folder, worth showing, and
  usable by a server on the same computer ("This computer" mode), but the
  bytes in `files` work with any server. The desktop shell loads the ingest
  route first and then nudges nothing: the new page takes the files when its
  bridge starts, so register the handler on page load.
- Turn spot references into `grainatlas://project/<id>/spot/<id>` links and
  reduction actions into `upbr://session/<id>` (and `upbr://run/<id>`) links.
  Hosted, `open()` them without a `code`: the shell mints the one-time
  handoff code with its own sign-in, adds `server` and launches UPbRPy
  Studio. Standalone in a browser, build the full
  `upbr://session/<id>?server=<base>&code=<code>` from `POST /v1/auth/handoff`
  and let the OS open Studio.
- When hosted, `token()` returns the shell's bearer token once the user has
  signed in to the shell, and `null` otherwise; keep the own sign-in screen for
  the `null` case and hide it (and the own Sign out) while the token comes
  from the shell. A Sign out inside the page should `notify({ type:
  'lab.auth.signed-out' })` so the shell signs out too.
- The shell's ORCID and Google sign-in opens
  `<server>/v1/auth/<provider>/start?next=upbdb://auth/callback`; UPbDB
  (since ff8c070) redirects to `upbdb://auth/callback?code=<one-time code>`,
  or `?error=<slug>` when the sign-in failed. The shell exchanges the code at
  `POST /v1/auth/exchange`, shows the error in its sign-in dialog, and accepts
  a callback only within ten minutes of starting that sign-in.
- For the web delivery (`/desk/`), send `X-Frame-Options: SAMEORIGIN` (or CSP
  `frame-ancestors 'self'`) on `/app/` and `/atlas/` instead of `DENY`, and
  serve the shell build at `/desk/` and the grainatlas build at `/atlas/`.
  The desktop shell does not need this: it uses native webviews.

### Oversight (protocol 5.3)

`await oversight()` reads `{ viewAs: { username, name } | null, onBehalf: boolean }`.
It resolves to `null` standalone or on an older shell. `onOversight(handler)`
receives the current state when known and subsequent changes; it returns an
unsubscribe function. The shell answers the `oversight` read operation (desktop
`bridge_oversight`) and publishes `oversight` pushes (desktop DOM event
`lab-bridge:oversight`, state in `detail`). Older modules ignore these additions.

View-as uses the viewer's own token from `token()`. Modules must apply `as=` to
reads, disable write controls while `viewAs` is non-null, and never send a write
with `as=`. `onBehalf` describes the shell's single confirmed operation; it is
not transferable consent for a module write. Each module obtains its own
per-operation confirmation before sending `X-UPbDB-Oversight: on-behalf`.

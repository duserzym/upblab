# @lab/bridge

The API a lab module (grainatlas, laicpmsdb) calls to talk to the UPb Studio
shell. It has no dependencies and works the same whether the module runs in
the desktop shell, in the web shell at `/desk/`, or on its own.

```ts
import { open, token, notify, isHosted, onOpenFiles } from '@lab/bridge';

await open('laicpmsdb://acquisition/2f1c…');  // false when not hosted
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

`token()` is the shell's laicpmsdb sign-in (plan decision 5): the user signs
in once in the shell's tab bar (password, or ORCID / Google through the system
browser) and every module tab gets the same bearer token. On desktop the token
lives in the OS keychain (macOS Keychain, Windows Credential Manager) and is
given only to the bundled grainatlas build and to pages of the configured
laicpmsdb server; in the web shell it lives in the tab's `sessionStorage`. When
the user signs in or out in the shell, module tabs are reloaded, so read
`token()` at start-up and do not cache it across reloads.

| `notify()` type the shell acts on | Effect |
| --- | --- |
| `lab.auth.signed-out` (`SHELL_EVENTS.signedOut`), also `laicpmsdb.auth.signed-out` | the shell signs out (revokes the token, clears the keychain entry) and reloads every module tab without a token; send it when the user signs out inside the module or the API answers 401 to the shell's token |
| `lab.spot.selected` (`SHELL_EVENTS.spotSelected`), also `grainatlas.spot.selected` | stored as the latest selection for Review (see protocol v3 below) |
| anything else | logged; the Home timeline uses them from roadmap phase 5 |

Plain links work too: in the desktop shell a click on an `<a href="laicpmsdb://…">`
inside a module webview is intercepted and routed like `open()`.

The shell side of the `postMessage` transport is `createFrameHost` from
`@lab/bridge/host`. The wire format is in `src/protocol.ts`
(`PROTOCOL_VERSION` 3; version 1 had `open`, `token` and `notify`, version 2
added `open-files`, and version 3 adds commands and spot selection).

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
  //           'export' | 'zip' | 'csv'                     (laicpmsdb)
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
  // focus-spot:  { type, project, spot, flash?: boolean, via?: string }
  // focus-grain: { type, project, grain, spot?: string, flash?: boolean, via?: string }
  await focus(command);
});
await notify({
  type: SHELL_EVENTS.spotSelected, project, spot, name, grain, area,
  via: 'user', // 'shell' when selected because of a command
});
```

`project` is the grainatlas project id (`atlas_project_id` in laicpmsdb),
`spot` is its spot id (`atlas_spot_id`), and `grain` is a grainatlas grain id
or the grain label stored by laicpmsdb (`<area_id>/<grain_number>`). Each id
matches `^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$`; a grain label permits one `/`
between two such parts. `flash` requests a visual flash; `via` names the
sender, for example `'review'`.

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
// Posts { tag: 'lab-bridge', v: 3, push: 'command', command }.
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

## Adopting the bridge in a module

`@lab/bridge` is not on npm yet. Until it is, depend on it from a checkout
(`"@lab/bridge": "file:../upbstudio/bridge"`, after `make setup` here builds
`bridge/dist/`) or vendor the tarball from `pnpm --filter @lab/bridge pack`.

### Both modules

- Ask `isHosted()` before `window.__TAURI_INTERNALS__`. Tauri injects
  `__TAURI_INTERNALS__` into every webview, including module webviews in the
  shell, so its presence does not mean "my own desktop app": only the bridge
  commands are allowed there, not the module's own Tauri commands.
- Keep relative asset paths (`base: './'`) and route by hash or query string.
- Read `?theme=light|dark` from `location.search` at start-up: the shell
  passes its effective theme (light by default; Dark and System are the
  user's choice) on every module URL it loads, and it wins over the module's
  own stored choice while present (grainatlas `docs/ux-conventions.md`
  rule 1). With nothing passed and nothing chosen, follow the system. The
  value is set at load: a change in the shell reaches the module the next
  time it loads.
- Leave `Ctrl/⌘ 1–4`, `Ctrl/⌘ ,` and `Ctrl/⌘ R` to the shell.
- Links to other modules: `open('laicpmsdb://…')` or a plain
  `<a href="grainatlas://…">`. Never `location.href = '<other module URL>'`.

### grainatlas

- Read `?server=<base>&project=<id>&spot=<id>` from `location.search` at
  start-up and open that project and spot: the shell routes
  `grainatlas://project/<id>[/spot/<id>]` to
  `modules/grainatlas/index.html?server=<laicpmsdb base URL>&project=<id>[&spot=<id>]`.
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
- Phase 2: on a spot click, `open('laicpmsdb://acquisition/<id>')` for the
  acquisition whose label equals the spot name (looked up in laicpmsdb).
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

### laicpmsdb

- Keep the hash routes the resolver targets: `#/acquisitions/<id>`,
  `#/sessions/<id>`, `#/samples/<id>`, `#/mounts/<id>`, `#/search?label=`,
  and `#/ingest?path=<folder>` (the ingest dialog with the folder prefilled;
  the shell resolves `laicpmsdb://mount/<id>` and `laicpmsdb://ingest?path=`
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
  `<server>/v1/auth/<provider>/start?next=laicpmsdb://auth/callback`; laicpmsdb
  (since ff8c070) redirects to `laicpmsdb://auth/callback?code=<one-time code>`,
  or `?error=<slug>` when the sign-in failed. The shell exchanges the code at
  `POST /v1/auth/exchange`, shows the error in its sign-in dialog, and accepts
  a callback only within ten minutes of starting that sign-in.
- For the web delivery (`/desk/`), send `X-Frame-Options: SAMEORIGIN` (or CSP
  `frame-ancestors 'self'`) on `/app/` and `/atlas/` instead of `DENY`, and
  serve the shell build at `/desk/` and the grainatlas build at `/atlas/`.
  The desktop shell does not need this: it uses native webviews.

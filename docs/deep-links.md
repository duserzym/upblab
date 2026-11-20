# Links between modules

Cross-module navigation uses URLs (plan section 4.4). UPb Lab registers
three schemes with the operating system and routes them to a tab or an app:

| Link | Opens |
| --- | --- |
| `upbdb://acquisition/<id>` | Sessions tab, `<server>/app/#/acquisitions/<id>` |
| `upbdb://session/<id>` | Sessions tab, `<server>/app/#/sessions/<id>` |
| `upbdb://sample/<id>` | Sessions tab, `<server>/app/#/samples/<id>` |
| `upbdb://mount/<id>` | Sessions tab, `<server>/app/#/mounts/<id>` (the mount page with its atlas view) |
| `upbdb://ingest?path=<folder>` | Sessions tab, `<server>/app/#/ingest?path=<folder>` (the ingest dialog, folder prefilled; desktop) |
| `upbdb://search?label=<label>` | Sessions tab, `<server>/app/#/search?label=<label>` |
| `upbdb://auth/callback?code=<code>`, `?error=<slug>` | completes the shell's ORCID or Google sign-in, or shows why it failed (only one the shell started in the last ten minutes, only from the OS) |
| `grainatlas://project/<id>` | standalone grainatlas on that project (desktop); the hosted build `<server>/atlas/?project=<id>` in a new browser tab (web) |
| `grainatlas://project/<id>/spot/<id>` | the same, with that spot selected and centred |
| `upbr://session/<id>?server=&code=` | launches UPbRPy Studio in database mode (`--open "<link>"`); without `code`, the shell mints one with its sign-in (`POST /v1/auth/handoff`) and adds its `server` (docs/WORKFLOW.md section 4); the Reduce tab shows the result, or install instructions when Studio is missing |
| `upbr://run/<id>?server=` | the same, for the project of a reduction run |
| `upbr://session/<id>?…&acquisition=<id>&via=upblab`, `upbr://run/<id>?…` | the same, opening at one analysis with its raw sweep (Openers section below) |
| `upbdb://run/<id>` | Review, scoped to the run's session and showing that run (sent by Studio after a submission) |
| `https://…`, `http://…` | the system browser |

Query links pass on only their one known parameter, re-encoded. One-time
codes are replaced by `…` in the link list and the log. Ids are UUIDs or other URL-safe slugs (`[A-Za-z0-9][A-Za-z0-9._~-]*`).
Anything else, including other schemes, other paths and ids with `/`, `?` or
`..`, is refused and logged (shell log file and the Home tab's link list).
The resolver is `ui/src/lib/links.ts`; its tests are the specification.

## Where links come from

- **The OS.** A click on a link in an email, a notebook or a browser. The
  installers register the schemes: on macOS through `CFBundleURLTypes` in the
  app's `Info.plist`, on Windows through registry entries written by the MSI
  and NSIS installers. A second launch on Windows hands its URL to the running
  instance (single-instance plugin) and exits.
- **A module.** `await open(url)` from `@lab/bridge`, or a plain
  `<a href="upbdb://…">`: in the desktop shell the host cancels the
  navigation and forwards the URL.
- **You.** The link box on the Home tab, handy for testing.
- **Opened files.** A Qtegra export dropped on the window, opened from the
  Finder or Explorer, or picked with Home's Open buttons becomes
  `upbdb://ingest?path=<folder>` (desktop). Image folders, `.grainatlas`
  folders and `.gaproj` files are handed to standalone grainatlas
  (`open -b org.grainatlas.desktop <paths>` on macOS, the paths as arguments
  on Windows); on the web the page asks you to open grainatlas in a new
  browser tab and drop them there. Session files reach UPbDB through
  `@lab/bridge` `open-files` (bridge/README.md); `ui/src/lib/drop.ts`
  decides where.
- **The web delivery.** `/desk/open?url=<encoded link>`.

## Web delivery

Except on the shell development ports described below, the shell served by
UPbDB at `/desk/` always uses the page's own origin
(`location.origin`) for its database server. Stored server URLs and the
desktop default are ignored, including before settings load. Web Settings
shows this server read-only. This keeps tests and scratch servers from ever
reaching the working service at `localhost:8000`.

On the shell's own development ports (`localhost` or `127.0.0.1`, port 1420
or 1431), the page origin is the shell, not UPbDB. Pass `?server=<url>`
explicitly to select a server, or leave it out to show the normal no-server
states. The override must be an HTTP or HTTPS URL; an invalid override also
leaves no server configured. This applies to every path on those ports,
including `/desk/` and `/desk/open`. Other web origins use the page origin
and ignore the override. Web delivery never falls back to a stored URL or
`http://localhost:8000`. Desktop server selection is unchanged.

## Trying a link

macOS (a built app; Launch Services learns the schemes once the `.app` has
been opened or copied to `/Applications`):

```bash
open 'upbdb://session/2f1c9a4e-6b1d-4c3e-9f7a-0d8e5b6c7a91'
```

Windows (after installing the `.msi` or `.exe`, or while `make dev` runs,
which registers the schemes for the current user):

```bash
start upbdb://session/2f1c9a4e-6b1d-4c3e-9f7a-0d8e5b6c7a91
```

On macOS `make dev` runs an unbundled binary, so the OS cannot deliver links to
it; use the Home tab's link box instead.

## Module installers

`grainatlas://` stays registered to UPb Lab, which opens standalone
grainatlas (grainatlas.app registers no scheme of its own).
Standalone GrainAtlas is launched with arguments, as described below.
UPbRPy Studio's installer registers `upbr`; when both Studio and UPb Lab are
installed, the OS picks one handler for that scheme. UPb Lab routes an
`upbr://` link to Studio, adding a handoff code. Studio can also open the link
itself, asking for a sign-in if the link has no code.

## Open in GrainAtlas (standalone)

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
on Windows. The shell implements the launcher in
`src-tauri/src/grainatlas_app.rs`. Its UI mints the one-time handoff code.


## Shell to module: commands (bridge v3)

The shell uses `focus-spot` and `focus-grain` commands to select and centre an
object inside an already loaded module without reloading its page. Modules
register `onCommand` at start-up and emit `lab.spot.selected` with `via: 'shell'`
for spot selections caused by a command. The shell also accepts the legacy
`grainatlas.spot.selected` event as `via: 'user'`.

See [Protocol v3: commands and spot selection](../bridge/README.md#protocol-v3-commands-and-spot-selection)
for ids, API, desktop and web wire formats, and version compatibility.

## Openers: editing in grainatlas and UPbRPy Studio (2026-11-13)

UPb Lab is the upload and review portal. Editing images, spots and grains
happens in standalone grainatlas; reducing and inspecting raw sweeps happens
in UPbRPy Studio. Review and Home open them in context with **Edit in
grainatlas** and **Open in Studio**. This section is the contract. It only
adds optional arguments and one new link; every existing link and launch
command line keeps working, and an app that does not know an addition
ignores it (checked against grainatlas `tauri/src-tauri/src/launch.rs` and
UPbRPy `GUI/launch.py` as of 2026-11-13).

### UPb Lab to grainatlas

The standalone launch above gains two optional arguments:

```text
open -n -b org.grainatlas.desktop --args --project <atlas project uuid> --server <base-url> --code <one-time-code> [--revision <n>] [--spot <atlas spot uuid> | --grain <atlas grain uuid>]
```

- `--project` names the mount's published atlas project (one project per
  mount). `--spot` is `physical_spot.atlas_spot_id`; `--grain` is
  `grain.atlas_grain_id`. Both are grainatlas's own UUIDs. At most one of
  them is passed; the shell passes `--spot` whenever a spot is selected.
- grainatlas opens the project signed in through the code, then selects
  and centres the spot or grain, as the bridge `focus-spot` and
  `focus-grain` commands do in the embedded module.
- Opening something already open switches to it: single-instance
  forwarding hands the arguments to the running app, which shows the
  project's existing tab (one tab per project, earlier tabs kept) and
  focuses the object. It never opens a second copy of a project.
- Today's grainatlas ignores `--spot` and `--grain` (unknown flags and
  their values are skipped) and opens or focuses the project.
- Web delivery opens the hosted grainatlas build in a new browser tab at
  `<server>/atlas/?project=<id>[&spot=<id>]`. A mount without a published
  atlas has no Edit button. When the desktop app is missing, UPb Lab shows
  where to install it; there is no in-window fallback since the Images tab
  was removed (2026-11-14).

### UPb Lab to Studio

`upbr://session/<id>` and `upbr://run/<id>` gain two optional query
parameters:

| Parameter | Meaning |
| --- | --- |
| `acquisition=<acquisition uuid>` | open at this analysis (the session manifest maps it to its label) with its raw sweep shown |
| `via=upblab` | the link was sent by UPb Lab; Studio reports a submission back (below) |

Example: `upbr://run/<run>?server=<base-url>&code=<code>&acquisition=<acq>&via=upblab`.
`server` and `code` keep their meaning. The shell sends `run` when the spot
has a reduction run and `session` otherwise. Today's Studio ignores unknown
query parameters and opens the session or run. Opening a session or run
whose project is already open in Studio raises that window and selects the
analysis instead of fetching the bundle again.

### Coming back

The database is the channel; neither app has to reach UPb Lab for the
shell to stay current.

- grainatlas: every sync raises the project's revision
  (`GET /v1/atlas/projects/<id>`, `revision`). The embedded module also sends
  `lab.atlas.synced` over the bridge.
- Studio: a submission adds a run to `GET /v1/sessions/<id>/reductions`.

After an opener, UPb Lab watches what it opened: when its window gains
focus, and every 20 s while it is visible, for two hours after the last
open. A new revision reloads Review and the mount's Home card; a new run
reloads Review if it shows that session and the session's Home card. The
selected spot stays selected (Review rows are keyed by acquisition).

One link is added so Studio can bring Review forward after a submission:

| Link | Opens |
| --- | --- |
| `upbdb://run/<run uuid>` | Review, scoped to the run's session (`GET /v1/runs/<id>`), showing that run, keeping the selected spot when it is in the session |

Studio opens it through the operating system after **Submit to database**
succeeds, only for a project opened by a link carrying `via=upblab`.
grainatlas does not send a link after a sync: it would pull UPb Lab to the
front in the middle of editing.

## Notices from the standalone apps (2026-11-14)

Standalone grainatlas and UPbRPy Studio tell UPb Lab that the database
changed by leaving a small JSON file in UPb Lab's data folder. Writing a file
never launches or focuses UPb Lab, works the same on macOS and Windows, and
needs no running UPb Lab.

| Sender | When | File |
| --- | --- | --- |
| grainatlas (desktop, standalone only) | after a sync that applied something, including a partial sync, and after a publish | `inbox/atlas-synced/<mount_id>.json` |
| UPbRPy Studio | after a successful `POST /v1/sessions/{id}/runs/import` | `inbox/run-submitted/<session_id>.json` |

The folder is Tauri's app data directory for `edu.umn.upbstudio`:
`~/Library/Application Support/edu.umn.upbstudio/` on macOS,
`%APPDATA%\edu.umn.upbstudio\` on Windows. Senders create the subfolders,
write a temp file in the same folder and rename it, and overwrite the
previous file for the same mount or session, so the folder does not grow.

```json
{"v":1,"type":"lab.atlas.synced","mount_id":"<uuid>","project_uuid":"<uuid>","revision":12,"server":"http://localhost:8000","at":"<ISO time>","source":"grainatlas-standalone"}
{"v":1,"type":"lab.run.submitted","session_id":"<uuid>","run_id":"<uuid>","server":"http://localhost:8000","at":"<ISO time>","source":"studio"}
```

UPb Lab (`src-tauri/src/inbox.rs`, `ui/src/lib/app-watch.svelte.ts`) takes
the files every 5 s while its window is visible and on focus, and deletes
each one. Files that are not `v: 1`, have the wrong `type` for their folder,
carry an id with characters outside `[A-Za-z0-9._~-]` or are larger than
4 KB are deleted unread; `*.tmp` files are left for the sender. A notice for
another server is ignored. A notice is only a reason to look now: UPb Lab
re-reads `/v1/atlas/projects/<id>` or `/v1/sessions/<id>/reductions` and
refreshes Home and Review when something changed. It never uses the revision
or run id in the file.

The fallback is a poll every 60 s while the window is visible (paused when
hidden, run again on focus): one request per open mount or session. That
means each app UPb Lab opened in the last two hours, plus Review's current
scope (a mount's atlas project, or a session's runs and the atlas projects of
its rows, at most 8). An item whose request fails waits 10 minutes before the
next try. Studio also keeps opening `upbdb://run/<id>` after a submit,
which brings Review to that run on purpose.

## TIMS batches

`upbdb://tims/batch/<id>` opens the shell's TIMS tab on that batch. It uses
the configured server and current account. The id is a URL-safe batch identifier
(a UUID on the server); extra path segments and route-changing characters are
refused. Review's Open batch action uses the same shell navigation.

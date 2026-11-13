# Links between modules

Cross-module navigation uses URLs (plan section 4.4). UPb Lab registers
three schemes with the operating system and routes them to a tab:

| Link | Opens |
| --- | --- |
| `laicpmsdb://acquisition/<id>` | Sessions tab, `<server>/app/#/acquisitions/<id>` |
| `laicpmsdb://session/<id>` | Sessions tab, `<server>/app/#/sessions/<id>` |
| `laicpmsdb://sample/<id>` | Sessions tab, `<server>/app/#/samples/<id>` |
| `laicpmsdb://mount/<id>` | Sessions tab, `<server>/app/#/mounts/<id>` (the mount page with its atlas view) |
| `laicpmsdb://ingest?path=<folder>` | Sessions tab, `<server>/app/#/ingest?path=<folder>` (the ingest dialog, folder prefilled; desktop) |
| `laicpmsdb://search?label=<label>` | Sessions tab, `<server>/app/#/search?label=<label>` |
| `laicpmsdb://auth/callback?code=<code>`, `?error=<slug>` | completes the shell's ORCID or Google sign-in, or shows why it failed (only one the shell started in the last ten minutes, only from the OS) |
| `grainatlas://project/<id>` | Images tab, grainatlas build `index.html?server=<laicpmsdb>&project=<id>` |
| `grainatlas://project/<id>/spot/<id>` | Images tab, `index.html?server=<laicpmsdb>&project=<id>&spot=<id>` |
| `upbr://session/<id>?server=&code=` | launches UPbRPy Studio in database mode (`--open "<link>"`); without `code`, the shell mints one with its sign-in (`POST /v1/auth/handoff`) and adds its `server` (docs/WORKFLOW.md section 4); the Reduce tab shows the result, or install instructions when Studio is missing |
| `upbr://run/<id>?server=` | the same, for the project of a reduction run |
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
  `<a href="laicpmsdb://…">`: in the desktop shell the host cancels the
  navigation and forwards the URL.
- **You.** The link box on the Home tab, handy for testing.
- **Opened files.** A Qtegra export dropped on the window, opened from the
  Finder or Explorer, or picked with Home's Open buttons becomes
  `laicpmsdb://ingest?path=<folder>` (desktop); image folders go to the
  Images tab. The files themselves reach the module through `@lab/bridge`
  `open-files` (bridge/README.md); `ui/src/lib/drop.ts` decides where.
- **The web delivery.** `/desk/open?url=<encoded link>`.

## Trying a link

macOS (a built app; Launch Services learns the schemes once the `.app` has
been opened or copied to `/Applications`):

```bash
open 'laicpmsdb://session/2f1c9a4e-6b1d-4c3e-9f7a-0d8e5b6c7a91'
```

Windows (after installing the `.msi` or `.exe`, or while `make dev` runs,
which registers the schemes for the current user):

```bash
start laicpmsdb://session/2f1c9a4e-6b1d-4c3e-9f7a-0d8e5b6c7a91
```

On macOS `make dev` runs an unbundled binary, so the OS cannot deliver links to
it; use the Home tab's link box instead.

## Module installers

`grainatlas://` stays registered to UPb Lab and opens its Images tab.
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
on Windows. This section records the launch contract; bridge v4 does not
implement the launcher.


## Shell to module: commands (bridge v3)

The shell uses `focus-spot` and `focus-grain` commands to select and centre an
object inside an already loaded module without reloading its page. Modules
register `onCommand` at start-up and emit `lab.spot.selected` with `via: 'shell'`
for spot selections caused by a command. The shell also accepts the legacy
`grainatlas.spot.selected` event as `via: 'user'`.

See [Protocol v3: commands and spot selection](../bridge/README.md#protocol-v3-commands-and-spot-selection)
for ids, API, desktop and web wire formats, and version compatibility.

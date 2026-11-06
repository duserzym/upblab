# Links between modules

Cross-module navigation uses URLs (plan section 4.4). UPb Studio registers
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

Per the cross-platform contract, the module apps' own installers register only
their own scheme (grainatlas desktop registers `grainatlas`, UPbRPy Studio
registers `upbr`). When both are installed, the OS picks one handler per
scheme; UPb Studio routes a `grainatlas://` link to its Images tab and a
`upbr://` link to Studio (adding a handoff code), while the standalone app
opens it itself (Studio then asks for a sign-in if the link has no code).


## Shell to module: commands (bridge v3)

The shell uses `focus-spot` and `focus-grain` commands to select and centre an
object inside an already loaded module without reloading its page. Modules
register `onCommand` at start-up and emit `lab.spot.selected` with `via: 'shell'`
for spot selections caused by a command. The shell also accepts the legacy
`grainatlas.spot.selected` event as `via: 'user'`.

See [Protocol v3: commands and spot selection](../bridge/README.md#protocol-v3-commands-and-spot-selection)
for ids, API, desktop and web wire formats, and version compatibility.

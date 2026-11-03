# Links between modules

Every cross-module action is a URL (plan section 4.4). UPb Studio registers
three schemes with the operating system and routes them to a tab:

| Link | Opens |
| --- | --- |
| `laicpmsdb://acquisition/<id>` | Sessions tab, `<server>/app/#/acquisitions/<id>` |
| `laicpmsdb://session/<id>` | Sessions tab, `<server>/app/#/sessions/<id>` |
| `laicpmsdb://sample/<id>` | Sessions tab, `<server>/app/#/samples/<id>` |
| `grainatlas://project/<id>` | Images tab, grainatlas build `index.html?project=<id>` |
| `grainatlas://project/<id>/spot/<id>` | Images tab, `index.html?project=<id>&spot=<id>` |
| `upbr://session/<id>` | Reduce tab; launches UPbRPy Studio with the link as its argument |
| `https://…`, `http://…` | the system browser |

Ids are UUIDs or other URL-safe slugs (`[A-Za-z0-9][A-Za-z0-9._~-]*`).
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
their own scheme (grainatlas desktop registers `grainatlas`). When both are
installed, the OS picks one handler per scheme; UPb Studio routes a
`grainatlas://` link to its Images tab, the standalone grainatlas app opens it
itself.

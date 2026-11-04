# @lab/bridge

The API a lab module (grainatlas, laicpmsdb) calls to talk to the UPb Studio
shell. It has no dependencies and works the same whether the module runs in
the desktop shell, in the web shell at `/desk/`, or on its own.

```ts
import { open, token, notify, isHosted } from '@lab/bridge';

await open('laicpmsdb://acquisition/2f1c…');  // false when not hosted
await open('upbr://session/2f1c…');            // shell adds server + handoff code, launches Studio
const bearer = await token();                 // null when not hosted or signed out
await notify({ type: 'grainatlas.spot.selected', project, spot });
if (isHosted()) hideOwnSignInButton();
```

| Where the module runs | Transport | How it is detected |
| --- | --- | --- |
| desktop shell, child webview | Tauri commands `bridge_open`, `bridge_token`, `bridge_notify` | the shell injects `window.__LAB_SHELL__ = { module, v }` |
| web shell, iframe | `postMessage` to `window.parent`, replies matched by id | the iframe is named `lab-shell:<module>` |
| alone | none: `open` resolves `false`, `token` resolves `null`, `notify` does nothing | neither of the above |

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
| anything else | logged; the Home timeline uses them from roadmap phase 5 |

Plain links work too: in the desktop shell a click on an `<a href="laicpmsdb://…">`
inside a module webview is intercepted and routed like `open()`.

The shell side of the `postMessage` transport is `createFrameHost` from
`@lab/bridge/host`. The wire format is in `src/protocol.ts` (`PROTOCOL_VERSION` 1).

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

### laicpmsdb

- Keep the hash routes the resolver targets: `#/acquisitions/<id>`,
  `#/sessions/<id>`, `#/samples/<id>`, `#/mounts/<id>`, `#/search?label=`,
  and `#/ingest?path=<folder>` (the ingest dialog with the folder prefilled;
  the shell resolves `laicpmsdb://mount/<id>` and `laicpmsdb://ingest?path=`
  to them).
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
  `<server>/v1/auth/<provider>/start?next=laicpmsdb://auth/callback`; the
  service has to accept that `next` (a fixed app callback, like
  `upbr://auth/callback` for Studio) and redirect to
  `laicpmsdb://auth/callback#/auth/callback?code=<one-time code>` (or with the
  code in the query). The shell exchanges the code at `POST /v1/auth/exchange`
  and accepts a callback only within ten minutes of starting that sign-in.
- For the web delivery (`/desk/`), send `X-Frame-Options: SAMEORIGIN` (or CSP
  `frame-ancestors 'self'`) on `/app/` and `/atlas/` instead of `DENY`, and
  serve the shell build at `/desk/` and the grainatlas build at `/atlas/`.
  The desktop shell does not need this: it uses native webviews.

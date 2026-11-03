# @lab/bridge

The API a lab module (grainatlas, laicpmsdb) calls to talk to the UPb Studio
shell. It has no dependencies and works the same whether the module runs in
the desktop shell, in the web shell at `/desk/`, or on its own.

```ts
import { open, token, notify, isHosted } from '@lab/bridge';

await open('laicpmsdb://acquisition/2f1c…');  // false when not hosted
const bearer = await token();                 // null when not hosted or signed out
await notify({ type: 'grainatlas.spot.selected', project, spot });
if (isHosted()) hideOwnSignInButton();
```

| Where the module runs | Transport | How it is detected |
| --- | --- | --- |
| desktop shell, child webview | Tauri commands `bridge_open`, `bridge_token`, `bridge_notify` | the shell injects `window.__LAB_SHELL__ = { module, v }` |
| web shell, iframe | `postMessage` to `window.parent`, replies matched by id | the iframe is named `lab-shell:<module>` |
| alone | none: `open` resolves `false`, `token` resolves `null`, `notify` does nothing | neither of the above |

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
- Leave `Ctrl/⌘ 1–4`, `Ctrl/⌘ ,` and `Ctrl/⌘ R` to the shell.
- Links to other modules: `open('laicpmsdb://…')` or a plain
  `<a href="grainatlas://…">`. Never `location.href = '<other module URL>'`.

### grainatlas

- Read `?project=<id>&spot=<id>` from `location.search` at start-up and open
  that project and spot: the shell routes `grainatlas://project/<id>/spot/<id>`
  to `modules/grainatlas/index.html?project=<id>&spot=<id>`.
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
  `#/sessions/<id>`, `#/samples/<id>`.
- Turn spot references into `grainatlas://project/<id>/spot/<id>` links and
  reduction actions into `upbr://session/<id>` links.
- When hosted, `token()` will return the shell's bearer token from roadmap
  phase 3; until then it resolves `null` and laicpmsdb keeps its own sign-in.
- For the web delivery (`/desk/`), send `X-Frame-Options: SAMEORIGIN` (or CSP
  `frame-ancestors 'self'`) on `/app/` and `/atlas/` instead of `DENY`, and
  serve the shell build at `/desk/` and the grainatlas build at `/atlas/`.
  The desktop shell does not need this: it uses native webviews.

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

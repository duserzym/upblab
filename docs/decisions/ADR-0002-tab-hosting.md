# ADR-0002: module tabs are native child webviews on desktop, iframes on the web

Date: 2026-11-03. Status: accepted.

## Context

Plan section 4.3 asks for one webview per module tab on desktop (Tauri 2
multi-webview) so a slow module never blocks the shell, with one webview plus
iframes as the fallback (risk table: multi-webview is behind Tauri's
`unstable` feature). The web delivery at `/desk/` can only use iframes.

Checked on 2026-11-03 with tauri 2.12.5, wry 0.57.1, tauri-cli 2.11.4 on
macOS 26 (arm64):

- `Window::add_child`, `Webview::set_bounds`, `show`, `hide`, `navigate`,
  `reload`, `on_navigation`, `on_new_window` and `initialization_script` all
  work with the `unstable` feature; the laicpmsdb `/app/` page loads in a
  child webview and keeps its state while hidden.
- laicpmsdb answers with `X-Frame-Options: DENY` (Django's clickjacking
  middleware). An iframe in the desktop shell (origin `tauri://localhost`)
  cannot show it without a laicpmsdb change; a child webview is a top-level
  page and is not affected.

## Decision

Desktop: one window `main` with the shell webview `shell` (auto-resized to the
window) and one native child webview per module tab, `module-images` and
`module-sessions`, created on first use and hidden, not destroyed, when the
user switches tabs.

- The shell page owns layout. `ModuleSurface.svelte` measures the content
  area under the tab bar (CSS pixels = logical pixels) and calls
  `module_open` / `module_bounds` / `module_hide`; a `ResizeObserver` keeps
  the child in place when the window resizes.
- Native webviews always paint above the shell page, so shell overlays must
  hide the module webview first (`shell.overlay`).
  See [UX conventions, rule 8](../ux-conventions.md) for the layering contract.
- Tab shortcuts are native menu accelerators (`src-tauri/src/menu.rs`):
  keystrokes go to the focused webview, so page-level shortcuts in the shell
  stop working as soon as the user clicks into a module.
- Each module webview gets `window.__LAB_SHELL__ = { module, v: 1 }` before
  any page script, which is how `@lab/bridge` picks its Tauri transport.
  Navigations to `laicpmsdb:`, `grainatlas:` and `upbr:` inside a module are
  cancelled and forwarded to the shell's resolver; `target=_blank` web links
  open in the system browser.
- Capabilities: the `shell` webview has the shell commands and plugins;
  module webviews have only `bridge_open`, `bridge_token`, `bridge_notify`.
  The laicpmsdb origin is remote, so the host grants those three to the
  configured server origin at runtime (`CapabilityBuilder`), scoped to the
  `module-sessions` webview.

Web (`/desk/`, later): the same `ModuleSurface` renders an iframe named
`lab-shell:<module>`, and `@lab/bridge` uses `postMessage`. The shell answers
through `createFrameHost` from `@lab/bridge/host`, accepting only its own
origin and the configured server origin.

## macOS title-bar inset

On macOS the window's content view extends under the title bar and WKWebView
insets the shell page's viewport below it, but child webviews are positioned
against the full content view, so a child placed at the shell's `y = 48`
landed one title-bar height (about 32 pt) too high, over the tab bar. The
shell sends `window.innerHeight` with every bounds call and the host adds
`inner_size().height - innerHeight` to `y` on macOS only. If a later wry fixes
the positioning, that difference becomes 0 and the correction is a no-op.
Windows positions children in the client area; this is unverified there until
the CI build is run on a Windows machine.

## Consequences

- A slow or crashed module page cannot freeze the shell, and module state
  survives tab switches.
- The shell depends on Tauri's `unstable` multi-webview API; a Tauri upgrade
  must be smoke-tested on both OS. The fallback (iframes, as on the web) needs
  laicpmsdb to send `X-Frame-Options: SAMEORIGIN` or a CSP `frame-ancestors`
  that includes the shell's origin.
- The web delivery needs that header change anyway, for `/app/` and `/atlas/`
  framed by `/desk/` on the same origin.

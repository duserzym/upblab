# Hosted module theme

Bridge protocol 3.1 adds live theme delivery. `PROTOCOL_VERSION` stays numeric
`3`; `PROTOCOL_MINOR` is `1`. Older shells and modules continue to work.

The shell defaults to System, resolves `prefers-color-scheme: dark`, and
always writes `data-theme="light"` or `data-theme="dark"` on its own `<html>`.
A viewer can choose System, Light or Dark in Settings. An explicit choice
sets `themeChosen: true`; older settings without that flag migrate to System
because older builds saved their Light default with every unrelated save.
OS changes while on System and explicit changes apply to every loaded tab
without navigation or reload. The shell never sends `system` to modules.

## Module API

```ts
import { theme, onTheme } from '@lab/bridge';

// null until known, or when standalone / hosted by an older shell.
const initial = theme();
if (initial) applyTheme(initial);
const unsubscribe = onTheme(applyTheme);
// onTheme calls at once if known, then on each change.
// Call unsubscribe() when the subscriber is removed.
```

Accept only the exact strings `light` and `dark`. While hosted, the shell's
resolved theme takes precedence over the module's stored preference. Applying
it must update the module's tokens, chrome and plots without discarding work.

Fallback order:

1. Bridge theme messages (`theme()` / `onTheme()`).
2. The host's `data-theme` attribute on `<html>`. Older modules can watch it
   with a MutationObserver, distinguishing host writes from their own writes.
3. `?theme=light|dark` in `location.search` at load, before any hash route.

If none is available, use the module's own preference. Hosted modules with no
explicit preference follow the operating system. Do not persist a host theme
as the viewer's standalone preference or write it into project data.

## Web transport

The shell sends this push to the module iframe's origin on load and whenever
the resolved theme changes:

```ts
{ tag: 'lab-bridge', v: 3, push: 'theme', theme: 'dark' }
```

`pushTheme(frame, theme, targetOrigin)` in `@lab/bridge/host` sends it.
The bridge checks that the sender is its parent and validates the theme.
For same-origin iframes, the shell also writes the attribute through
`contentDocument`. Access to cross-origin documents is caught; bridge pushes
cover those frames. Every new module URL contains the current `?theme=`.
A theme-only change never changes the loaded iframe URL.

## Tauri transport

The shell calls `module_theme({ theme: 'light' | 'dark' })` at startup and on
changes. The host stores the value and evaluates one script in each existing
module webview, including hidden ones. The script writes the attribute and
then dispatches:

```ts
window.dispatchEvent(new CustomEvent('lab-bridge:theme', {
  detail: { theme: 'dark' },
}));
```

`THEME_EVENT` exports that name. `COMMANDS.theme` names `bridge_theme`, a
module-callable command that returns the stored resolved theme. The bridge
reads it once and listens for events; an event newer than the pending command
reply wins. Missing commands in older hosts silently leave `theme()` null.
Only the shell capability allows publishing; module capabilities allow reading.

New webviews receive `window.__LAB_SHELL__` with `{ module, v: 3, minor: 1,
theme }` before page scripts. The initialization script writes the attribute
immediately if `<html>` exists, otherwise a MutationObserver writes it as soon
as the element appears. The page-load hook refreshes from current host state
on later reloads and navigation too, since an initialization script is fixed
when its webview is created.

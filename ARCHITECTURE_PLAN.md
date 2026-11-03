# isobench: the unified shell for the lab workflow

**Status:** plan and roadmap, 2026-11-03. The repository name is provisional
until the owner picks one; everything below uses `isobench` and is renamed
with one search and replace.

## 1. Purpose

isobench is the one application a lab member opens. It hosts the workflow
modules as tabs, carries identity and settings between them, and turns a click
in one module into the right view in another:

| Tab | Module | Built as | How the shell hosts it |
| --- | --- | --- | --- |
| Images | grainatlas | static web build (Svelte + wasm) and Tauri app | bundled static assets in a webview |
| Sessions | laicpmsdb | Django service with a Svelte web build at `/app/` | webview pointed at the configured laicpmsdb server |
| Reduce | UPbRPy Studio | native PySide6 + pyqtgraph desktop app | launched as an external application with a hand-off file and `upbr://` link; not embedded |
| Home | isobench itself | Svelte | timeline across modules, search, recent items, settings |

The shell owns no scientific data and no algorithms. Everything it shows is
produced by a module; everything it stores is configuration and the link
graph between module objects.

## 2. Decisions

1. **Tauri 2 shell, same stack as the modules.** Rust host, Svelte 5 +
   TypeScript front end, the glass design tokens from `laicpmsdb/ui/src/app.css`.
   macOS arm64 and Windows x86-64 are both first-class from the first release;
   CI builds and smoke-tests both on every push (GitHub Actions matrix).
2. **Modules are hosted, not forked.** The shell bundles a pinned release of
   the grainatlas web build and points at a laicpmsdb server URL. It never
   copies module source. Module versions are pinned in `modules.lock.json`
   (name, version, release URL, SHA-256) and updated by a script.
3. **One Svelte shell page, two deliveries.** The same shell UI runs inside
   Tauri (desktop) and as a page served by laicpmsdb at `/desk/` (web), where
   the Images tab loads the grainatlas static build that laicpmsdb also serves
   at `/atlas/`. Users without the desktop app get the same tabs in a browser.
4. **Links are URLs.** Every cross-module action is a URL with a registered
   scheme: `laicpmsdb://acquisition/<uuid>`, `grainatlas://project/<uuid>/spot/<uuid>`,
   `upbr://session/<uuid>`. The shell registers all three schemes on both
   operating systems (Tauri deep-link plugin), resolves them to a tab and a
   route, and exposes the same resolver to the web delivery as path routes
   (`/desk/open?url=...`). Modules never talk to each other directly; they
   post a URL to the shell (`window.postMessage` in the browser, a Tauri event
   on desktop) and the shell routes it.
5. **One identity.** The shell signs in to laicpmsdb once (password or Google)
   and passes the bearer token to module webviews through the shell bridge;
   tokens live in the OS keychain (macOS Keychain, Windows Credential Manager)
   on desktop and in the laicpmsdb session cookie on the web.
6. **The link graph is stored in laicpmsdb, not in the shell.** A grainatlas
   spot becomes a `physical_spot` row; an acquisition label equals the spot
   name. The shell's "open the data for this spot" is a query against
   laicpmsdb, so the link survives reinstalling the shell.
7. **UPbRPy Studio stays native.** Its roadmap keeps it a PySide6 application.
   The shell launches it with a session export and a `upbr://` URL and
   receives reduction bundles back through laicpmsdb's import. Embedding is
   revisited only if Studio grows a web front end.
8. **Open source, MIT**, code only in git, no telemetry, offline-capable for
   the Images tab and read-only cached views of the Sessions tab.

## 3. Cross-platform contract (applies to the shell and both modules)

Required because the two modules were planned on a Mac and must behave the
same on Windows:

| Concern | Rule |
| --- | --- |
| Webview | WKWebView on macOS, WebView2 on Windows. Modules use only features both support: no File System Access API (grainatlas desktop reads files through Tauri commands, the web build through `<input type=file webkitdirectory>` and drag-drop), OPFS only behind a feature check, `backdrop-filter` with a solid fallback |
| Paths | modules exchange paths as UTF-8 strings with forward slashes and resolve them with the host's path library; NAS locations are configured as a mount root per OS (`/Volumes/lab` vs `L:\`) with the same relative layout under it |
| Fonts and DPI | UI scales with device pixel ratio; print layouts specify sizes in millimetres and are tested on both OS print paths |
| Deep links | all three schemes registered by the shell installer on both OS; modules' own installers register only their own scheme |
| Processes | the shell launches Studio by its installed path (macOS `.app`, Windows `.exe`) found through a settings entry with auto-detection |
| Line endings and encodings | instrument files are read by explicit encoding (TM4000 sidecars are UTF-16LE, Qtegra CSV is UTF-8 with CRLF); never rely on the OS default |
| Builds | GitHub Actions matrix `macos-latest` (arm64) and `windows-latest`; artifacts `.dmg` (notarised when a Developer ID is available) and `.msi` plus `.exe` (NSIS); unsigned builds documented with the SmartScreen and Gatekeeper steps |
| Tests | Playwright smoke test of the shell on both OS: sign in to a local laicpmsdb, open the Images tab, place a spot, follow its link to the Sessions tab |

## 4. Architecture

### 4.1 Components

| Component | Technology | Responsibility |
| --- | --- | --- |
| `src-tauri/` | Rust, Tauri 2, plugins deep-link, shell, store, updater, keychain | window, tabs as webviews, scheme registration, token storage, launching Studio, auto-update |
| `ui/` | Svelte 5, TypeScript, Vite | tab bar, Home (cross-module timeline, search, recents), Settings, the link resolver, the bridge API given to module webviews |
| `bridge/` | TypeScript package published to the modules | the tiny API a module calls: `bridge.open(url)`, `bridge.token()`, `bridge.notify(event)`, with a no-op fallback when a module runs alone |
| `modules.lock.json` and `scripts/` | JSON, Node | pinning and fetching module releases into `ui/public/modules/` |
| `deploy/` | Django URL config snippet, nginx example | serving the web delivery at `/desk/` and `/atlas/` from laicpmsdb |

### 4.2 Repository layout

```text
isobench/
  src-tauri/            Tauri host (Rust)
  ui/                   shell UI (Svelte)
  bridge/               @lab/bridge package used by grainatlas and laicpmsdb
  scripts/              fetch-modules, bump-module, release
  modules.lock.json
  deploy/
  docs/decisions/
  ARCHITECTURE_PLAN.md
```

### 4.3 Tabs

Desktop: one window, a tab bar in the shell webview, and one child webview
per module tab (Tauri 2 multi-webview), so a slow module never blocks the
shell. Web: the shell page with one `iframe` per module tab, same bridge over
`postMessage`. Tab state (open project, current route) is saved per user.

### 4.4 Link resolution

```text
module --bridge.open(url)--> shell resolver
  laicpmsdb://acquisition/<id>     -> Sessions tab, route /app/acquisitions/<id>
  laicpmsdb://session/<id>         -> Sessions tab, route /app/sessions/<id>
  grainatlas://project/<id>/spot/<id> -> Images tab, route /atlas/?project=<id>&spot=<id>
  upbr://session/<id>              -> launch Studio with the export of that session
  https://... (external)           -> system browser
```

Unknown schemes are refused and logged. The OS hands the same URLs to the
shell when a user clicks one in an email or a notebook.

### 4.5 Home tab

A cross-module timeline: laicpmsdb's `timeline_event` view plus local
grainatlas project activity, filtered by the signed-in account; a search box
over samples, sessions, spots and projects; recent items; module status
(server reachable, Studio found, module versions).

## 5. Roadmap

| Phase | Scope | Done when |
| --- | --- | --- |
| 0 | repository, plan, ADRs, CI matrix skeleton | this document committed; a Tauri "hello" window builds on macOS and Windows in CI |
| 1 | shell UI and tabs | tab bar, Home placeholder, Settings (server URL, Studio path, theme); Sessions tab shows a configured laicpmsdb; Images tab shows a bundled grainatlas build fetched by `modules.lock.json` |
| 2 | bridge and links | `@lab/bridge` published and adopted by grainatlas and laicpmsdb; scheme registration on both OS; a spot click in Images opens the acquisition in Sessions |
| 3 | identity | single sign-in, token in keychain, token handed to module webviews; web delivery at `/desk/` using the laicpmsdb session |
| 4 | Studio hand-off | launch UPbRPy Studio with a session export; receive the reduction bundle through laicpmsdb; status shown on Home |
| 5 | Home | cross-module timeline, search, recents, module status |
| 6 | release | signed or documented installers for macOS and Windows, auto-update from GitHub Releases, Playwright smoke test on both OS |

Phases 1 and 2 need grainatlas phase 3 (its web build) and laicpmsdb's
existing `/app/`; phase 4 needs laicpmsdb's UPbRPy export and import (its
phase 4). Phase 0 can start now.

## 6. Verification

- CI matrix builds the shell on macOS and Windows on every push.
- A link round trip test: create a spot in a grainatlas fixture project,
  sync it to a local laicpmsdb, ingest a fixture session whose label equals
  the spot name, click the spot, assert the Sessions tab shows that
  acquisition.
- Module pinning test: `modules.lock.json` hashes match the fetched builds.

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| Tauri multi-webview is still marked unstable | fall back to one webview with iframes (the web delivery already works that way) |
| WebView2 missing on a lab Windows machine | the installer bundles the evergreen bootstrapper |
| Module release drift | the shell pins versions and shows a mismatch warning; modules keep the bridge backward compatible |
| Studio not installed | the Reduce tab shows install instructions and still accepts exported bundles through laicpmsdb |

# UPb Studio (`upbstudio`): the unified shell for the lab workflow

**Status:** plan and roadmap, 2026-11-03. Display name UPb Studio, repository and
package name `upbstudio`, chosen 2026-11-03. The reduction module's own GUI
keeps its name UPbRPy Studio; inside UPb Studio it appears as the Reduce tab.

## 1. Purpose

UPb Studio is the one application a lab member opens. It hosts the workflow
modules as tabs, carries identity and settings between them, and turns a click
in one module into the right view in another:

| Tab | Module | Built as | How the shell hosts it |
| --- | --- | --- | --- |
| Images | grainatlas | static web build (Svelte + wasm) and Tauri app | bundled static assets in a webview |
| Sessions | laicpmsdb | Django service with a Svelte web build at `/app/` | webview pointed at the configured laicpmsdb server, or at the instance the shell starts on this computer (ADR-0003) |
| Reduce | UPbRPy Studio | native PySide6 + pyqtgraph desktop app | launched as an external application with a hand-off file and `upbr://` link; not embedded |
| Home | the shell itself | Svelte | timeline across modules, search, recent items, settings |

The shell owns no scientific data and no algorithms. Everything it shows is
produced by a module; everything it stores is configuration and the link
graph between module objects.

## 2. Decisions

1. **Tauri 2 shell, same stack as the modules.** Rust host, Svelte 5 +
   TypeScript front end, the glass design tokens from `laicpmsdb/ui/src/app.css`.
   macOS arm64 and Windows x86-64 are both first-class from the first release;
   CI builds and smoke-tests both on every push (GitHub Actions matrix).
2. **Modules are hosted, not forked.** The shell bundles a pinned release of
   the grainatlas web build and either points at a laicpmsdb server URL or
   starts the pinned laicpmsdb service bundle locally (decision 9). It never
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
9. **A release is a double-click application.** In "This computer" mode the
   shell bundles PostgreSQL 17 (`postgresql_embedded`) and a relocatable
   Python runtime carrying the laicpmsdb service, starts both on launch,
   waits for the service's health check, and stops both on quit. "Lab
   server" mode is the URL as before. The same service bundle runs headless
   on the lab server. ADR-0003 has the details, the first-run wizard and the
   rejected alternatives (Docker, a separate server app, PyInstaller, SQLite).
10. **The workflow is a chain of bundles, and the shell only routes.**
    `docs/WORKFLOW.md` (v1, 2026-11-03) is the cross-repository contract:
    register samples and mounts in laicpmsdb; image and place spots in
    grainatlas, which publishes an *atlas bundle* to the mount; run the laser
    with spot names as labels; upload the session; open it in UPbRPy Studio
    in *database mode* through `upbr://session/<id>?server=&code=`; reduce
    locally; submit the *reduction bundle* back; results become attributes
    on acquisitions and spots and show up on the images, the timeline and
    Home. Files are the boundary at every step and standalone use of
    grainatlas and Studio stays first class. The shell's parts are the
    handoff code in its identity phase, the `upbr://` launch, and Home.

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
| `src-tauri/src/local_service/` and `src-tauri/resources/` | Rust (`postgresql_embedded`), bundled PostgreSQL 17 and the laicpmsdb service bundle | "This computer" mode: data directory, ports, process supervision, health check, logs (ADR-0003) |

### 4.2 Repository layout

```text
upbstudio/
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
  laicpmsdb://mount/<id>           -> Sessions tab, the mount page with its atlas view
  laicpmsdb://ingest?path=...      -> Sessions tab, the ingest dialog (desktop only)
  upbr://session/<id>?server=&code= -> launch Studio in database mode (docs/WORKFLOW.md section 4)
  upbr://run/<id>?server=          -> launch Studio on the project of that run
  https://... (external)           -> system browser
```

Unknown schemes are refused and logged. The OS hands the same URLs to the
shell when a user clicks one in an email or a notebook.

### 4.5 Local service mode

```text
launch ──> initdb once ──> postgres 127.0.0.1:55432 (or next free) ──> migrate ──> serve 127.0.0.1:8000 (or next free)
           (UTF-8, C locale)  direct child, no Unix socket                         health GET /v1/health ok
                                                                                     ──> Sessions tab = http://127.0.0.1:<port>/app/
quit ───> stop service (SIGTERM, then SIGKILL) ──> pg_ctl stop -m fast
killed ─> watchdog (macOS) or job object (Windows) does the same; next start
          stops leftovers found through postmaster.pid and service.pid
```

PostgreSQL 17.11.0 is embedded at build time (`postgresql_embedded`,
`bundled`; version pinned in `src-tauri/.cargo/config.toml`) and unpacked
once into the app's local data folder, next to the data directory
`laicpmsdb/pg/`; `PG_BIN` replaces it in development. The service is the
pinned bundle in `src-tauri/resources/laicpmsdb-service/`, run as
`python -m laicpmsdb_service serve`; until laicpmsdb publishes it, a
laicpmsdb checkout runs through `manage.py` (development fallback). Data
root `~/laicpmsdb` by default, first staff account created by the first-run
wizard, demo data optional. Interface with laicpmsdb:
[docs/service-bundle-contract.md](docs/service-bundle-contract.md); files and
logs: [docs/installing.md](docs/installing.md); sizes and rejected
alternatives: ADR-0003.

### 4.6 Home tab

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
| 2b | local service (double-click release); shell side done 2026-11-03, waits for the laicpmsdb bundle | laicpmsdb publishes the per-OS service bundle with `laicpmsdb serve`, `bootstrap` and `/v1/health`; the shell bundles PostgreSQL 17 and the service, first-run wizard, start and stop with the app, no orphan processes after a forced kill; a clean macOS and a clean Windows machine show demo data in the Sessions tab within 30 s of a double-click |
| 3 | identity | single sign-in, token in keychain, token handed to module webviews; the Studio handoff code (`POST /v1/auth/handoff`) minted on demand; web delivery at `/desk/` using the laicpmsdb session |
| 4 | Studio hand-off | `upbr://session/<id>?server=&code=` resolved to the installed Studio (`upbrpy-gui --open <url>`), Studio found by auto-detection or Settings; `upbr://run/<id>`; a session's reduction status (runs, preferred) and the latest published atlas on Home; end-to-end test on the fixture session per `docs/WORKFLOW.md` |
| 5 | Home | cross-module timeline, search, recents, module status |
| 6 | release | signed or documented installers for macOS and Windows, auto-update from GitHub Releases, Playwright smoke test on both OS |

Phases 1 and 2 need grainatlas phase 3 (its web build) and laicpmsdb's
existing `/app/`; phase 2b needs the service entry points listed in
ADR-0003 on the laicpmsdb side; phase 4 needs laicpmsdb's UPbRPy export and import (its
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
| Bundled PostgreSQL refuses to start (locale, port, stale pid, antivirus on Windows) | `initdb` with explicit UTF-8 and C locale, free-port probing, `pg_ctl` pid handling, the log tail surfaced in the first-run screen; "Lab server" mode as the fallback |
| Installer size with Python, pyarrow and PostgreSQL (150 to 200 MB) | accepted; the service bundle is pinned and downloaded once per version, and Studio's PySide6 stays an opt-in flavour |

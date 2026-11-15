# UPb Lab (`upblab`): the unified shell for the lab workflow

**Status:** plan and roadmap, 2026-11-03. Display name UPb Lab, renamed
2026-11-06 to distinguish the shell from UPbRPy Studio. Repository renamed `upblab` on 2026-11-06; the internal
package name remains `upbstudio`. The reduction module's own GUI
keeps its name UPbRPy Studio; inside UPb Lab it appears as the Reduce tab.

## 1. Purpose

UPb Lab is the one application a lab member opens. It hosts the workflow
modules as tabs, carries identity and settings between them, and turns a click
in one module into the right view in another:

| Tab | Module | Built as | How the shell hosts it |
| --- | --- | --- | --- |
| Sessions | UPbDB | Django service with a Svelte web build at `/app/` | webview pointed at the configured UPbDB server, or at the instance the shell starts on this computer (ADR-0003) |
| Review | the shell itself | Svelte + uPlot | stored session or mount results, plots and image selection; the SEM pane is the bundled grainatlas build as a read-only viewer |
| Reduce | UPbRPy Studio | native PySide6 + pyqtgraph desktop app | launched as an external application with a hand-off file and `upbr://` link; not embedded |
| Home | the shell itself | Svelte | timeline across modules, search, recent items, settings; uploads hand image sets to standalone grainatlas |

Update 2026-11-14 (stage 4): the Images tab was removed. Editing images,
grains and spots happens only in standalone grainatlas (desktop) or the
hosted grainatlas build in its own browser tab (web), opened in context by
**Edit in grainatlas** and by uploads. The bundled grainatlas build stays,
as Review's read-only SEM viewer. Notices and polling: `docs/deep-links.md`.

The shell owns no scientific data and performs no data reduction. Everything it shows is
produced by a module; everything it stores is configuration and the link
graph between module objects.

## 2. Decisions

1. **Tauri 2 shell, same stack as the modules.** Rust host, Svelte 5 +
   TypeScript front end, the glass design tokens from `upbdb/ui/src/app.css`.
   macOS arm64 and Windows x86-64 are both first-class from the first release;
   CI builds and smoke-tests both on every push (GitHub Actions matrix).
2. **Modules are hosted, not forked.** The shell bundles a pinned release of
   the grainatlas web build and either points at a UPbDB server URL or
   starts the pinned UPbDB service bundle locally (decision 9). It never
   copies module source. Module versions are pinned in `modules.lock.json`
   (name, version, release URL, SHA-256) and updated by a script.
3. **One Svelte shell page, two deliveries.** The same shell UI runs inside
   Tauri (desktop) and as a page served by UPbDB at `/desk/` (web), where
   Review's SEM viewer loads the grainatlas static build that UPbDB also
   serves at `/atlas/`, and Edit in grainatlas opens that build in a new tab. Users without the desktop app get the same tabs in a browser.
4. **Links are URLs.** Every cross-module action is a URL with a registered
   scheme: `upbdb://acquisition/<uuid>`, `grainatlas://project/<uuid>/spot/<uuid>`,
   `upbr://session/<uuid>`. The shell registers all three schemes on both
   operating systems (Tauri deep-link plugin), resolves them to a tab and a
   route, and exposes the same resolver to the web delivery as path routes
   (`/desk/open?url=...`). Modules never talk to each other directly; they
   post a URL to the shell (`window.postMessage` in the browser, a Tauri event
   on desktop) and the shell routes it.
5. **One identity.** The shell signs in to UPbDB once (password or Google)
   and passes the bearer token to module webviews through the shell bridge;
   tokens live in the OS keychain (macOS Keychain, Windows Credential Manager)
   on desktop and in the UPbDB session cookie on the web.
6. **The link graph is stored in UPbDB, not in the shell.** A grainatlas
   spot becomes a `physical_spot` row; an acquisition label equals the spot
   name. The shell's "open the data for this spot" is a query against
   UPbDB, so the link survives reinstalling the shell.
7. **UPbRPy Studio stays native.** Its roadmap keeps it a PySide6 application.
   The shell launches it with a session export and a `upbr://` URL and
   receives reduction bundles back through UPbDB's import. Embedding is
   revisited only if Studio grows a web front end.
8. **Open source, MIT**, code only in git, no telemetry, offline-capable for
   Review's image viewer and read-only cached views of the Sessions tab.
9. **A release is a double-click application.** In "This computer" mode the
   shell bundles PostgreSQL 17 (`postgresql_embedded`) and a relocatable
   Python runtime carrying the UPbDB service, starts both on launch,
   waits for the service's health check, and stops both on quit. "Lab
   server" mode is the URL as before. The same service bundle runs headless
   on the lab server. ADR-0003 has the details, the first-run wizard and the
   rejected alternatives (Docker, a separate server app, PyInstaller, SQLite).
10. **The workflow is a chain of bundles, and the shell only routes.**
    `docs/WORKFLOW.md` (v1.1, 2026-11-06) is the cross-repository contract:
    register samples and mounts in UPbDB; image and place spots in
    grainatlas, which publishes an *atlas bundle* to the mount; run the laser
    with spot names as labels; upload the session; open it in UPbRPy Studio
    in *database mode* through `upbr://session/<id>?server=&code=`; reduce
    locally; submit the *reduction bundle* back; results become attributes
    on acquisitions and spots and show up on the images, the timeline and
    Home. Files are the boundary at every step and standalone use of
    grainatlas and Studio stays first class. The shell's parts are the
    handoff code in its identity phase, the `upbr://` launch, Home and the Review tab.

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
| Tests | Playwright smoke test of the shell on both OS: sign in to a local UPbDB, open the Images tab, place a spot, follow its link to the Sessions tab |

## 4. Architecture

### 4.1 Components

| Component | Technology | Responsibility |
| --- | --- | --- |
| `src-tauri/` | Rust, Tauri 2, plugins deep-link, shell, store, updater, keychain | window, tabs as webviews, scheme registration, token storage, launching Studio, auto-update |
| `ui/` | Svelte 5, TypeScript, Vite | tab bar, Home (cross-module timeline, search, recents), Settings, the link resolver, the bridge API given to module webviews |
| `bridge/` | TypeScript package published to the modules | the tiny API a module calls: `bridge.open(url)`, `bridge.token()`, `bridge.notify(event)`, with a no-op fallback when a module runs alone |
| `modules.lock.json` and `scripts/` | JSON, Node | pinning and fetching module releases into `ui/public/modules/` |
| `deploy/` | Django URL config snippet, nginx example | serving the web delivery at `/desk/` and `/atlas/` from UPbDB |
| `src-tauri/src/local_service/` and `src-tauri/resources/` | Rust (`postgresql_embedded`), bundled PostgreSQL 17 and the UPbDB service bundle | "This computer" mode: data directory, ports, process supervision, health check, logs (ADR-0003) |

### 4.2 Repository layout

```text
upblab/
  src-tauri/            Tauri host (Rust)
  ui/                   shell UI (Svelte)
  bridge/               @lab/bridge package used by grainatlas and UPbDB
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

Review is the third tab, between Sessions and Reduce (Ctrl/⌘ 1–4 since the
Images tab was removed on 2026-11-14). It
reads stored UPbDB results, draws display geometry and links selections
both ways through protocol v3 commands and spot notifications. It has no
reduction or editing controls. At 1440 CSS px or more the remembered **Side
by side** choice shows the grainatlas viewer as Review's SEM pane. Review uses a
compact tree with plots above details. The viewer's ModuleSurface stays
mounted; native bounds follow ResizeObserver, and the
web iframe resizes. Below 1440 CSS px Review returns to three columns and
the viewer hides. Dialogs hide the module surface as on the other tabs.

### 4.4 Link resolution

```text
module --bridge.open(url)--> shell resolver
  upbdb://acquisition/<id>     -> Sessions tab, route /app/acquisitions/<id>
  upbdb://session/<id>         -> Sessions tab, route /app/sessions/<id>
  grainatlas://project/<id>/spot/<id> -> standalone grainatlas (desktop) or /atlas/?project=<id>&spot=<id> in a new tab (web)
  upbdb://mount/<id>           -> Sessions tab, the mount page with its atlas view
  upbdb://ingest?path=...      -> Sessions tab, the ingest dialog (desktop only)
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
`upbdb/pg/`; `PG_BIN` replaces it in development. The service is the
pinned bundle in `src-tauri/resources/upbdb-service/`, run as
`python -m upbdb_service serve`; until UPbDB publishes it, a
UPbDB checkout runs through `manage.py` (development fallback). Data
root `~/upbdb` by default, first staff account created by the first-run
wizard, demo data optional. Interface with UPbDB:
[docs/service-bundle-contract.md](docs/service-bundle-contract.md); files and
logs: [docs/installing.md](docs/installing.md); sizes and rejected
alternatives: ADR-0003.

### 4.6 Home tab

A cross-module timeline: UPbDB's `timeline_event` view plus local
grainatlas project activity, filtered by the signed-in account; a search box
over samples, sessions, spots and projects; recent items; module status
(server reachable, Studio found, module versions).

## 5. Roadmap

| Phase | Scope | Done when |
| --- | --- | --- |
| 0 | repository, plan, ADRs, CI matrix skeleton | this document committed; a Tauri "hello" window builds on macOS and Windows in CI |
| 1 | shell UI and tabs | tab bar, Home placeholder, Settings (server URL, Studio path, theme); Sessions tab shows a configured UPbDB; Images tab shows a bundled grainatlas build fetched by `modules.lock.json` |
| 2 | bridge and links | `@lab/bridge` published and adopted by grainatlas and UPbDB; scheme registration on both OS; a spot click in Images opens the acquisition in Sessions |
| 2b | local service (double-click release); shell side done 2026-11-03, waits for the UPbDB bundle | UPbDB publishes the per-OS service bundle with `upbdb serve`, `bootstrap` and `/v1/health`; the shell bundles PostgreSQL 17 and the service, first-run wizard, start and stop with the app, no orphan processes after a forced kill; a clean macOS and a clean Windows machine show demo data in the Sessions tab within 30 s of a double-click |
| 3 | identity; shell side done 2026-11-03 | single sign-in, token in keychain, token handed to module webviews; the Studio handoff code (`POST /v1/auth/handoff`) minted on demand; web delivery at `/desk/` using the UPbDB session. Done: password sign-in, ORCID/Google through the system browser and `upbdb://auth/callback`, keychain per server, `bridge_token` to the bundled build and the server's pages, `lab.auth.signed-out`, the wizard's account signed in, handoff minting; the web delivery signs in itself and keeps the token in `sessionStorage`. UPbDB accepts `next=upbdb://auth/callback` since ff8c070 (code or `?error=` in the query). Waits for: a run with a configured ORCID or Google client; grainatlas calling `token()` beyond its publish dialog; a Windows run |
| 4 | Studio hand-off; shell side done 2026-11-03 | `upbr://session/<id>?server=&code=` resolved to the installed Studio (`upbrpy-gui --open <url>`), Studio found by auto-detection or Settings; `upbr://run/<id>`; a session's reduction status (runs, preferred) and the latest published atlas on Home; end-to-end test on the fixture session per `docs/WORKFLOW.md`. Done: detection (Settings, `/Applications`, LaunchServices, the Windows registry, a development checkout), launch per OS (docs/installing.md), install instructions when missing, `upbdb://mount/` and `ingest?path=` routes, Home's sessions, runs and atlases. Waits for: Studio's database mode redeeming the code (its `[database]` extra), a published atlas to show, then the end-to-end test |
| 5 | Home | cross-module timeline, search, recents, module status |
| 5b Review | stored results by session/run or mount; sample/grain tree, Concordia, geochemistry, REE, depth profiles, details; bidirectional image selection and optional split | invented fixtures cover loading and selection; Chromium and WebKit fit 1440 × 900 and 1280 × 800, split only at 1440 CSS px or more; a result focuses its published atlas spot and an image selection returns to its result without an echo; real app round trip verified by the supervisor |
| 6 | release | signed or documented installers for macOS and Windows, auto-update from GitHub Releases, Playwright smoke test on both OS |

Phases 1 and 2 need grainatlas phase 3 (its web build) and UPbDB's
existing `/app/`; phase 2b needs the service entry points listed in
ADR-0003 on the UPbDB side; phase 4 needs UPbDB's UPbRPy export and import (its
phase 4). Phase 0 can start now.

## 6. Verification

- CI matrix builds the shell on macOS and Windows on every push.
- A link round trip test: create a spot in a grainatlas fixture project,
  sync it to a local UPbDB, ingest a fixture session whose label equals
  the spot name, click the spot, assert the Sessions tab shows that
  acquisition.
- Module pinning test: `modules.lock.json` hashes match the fetched builds.

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| Tauri multi-webview is still marked unstable | fall back to one webview with iframes (the web delivery already works that way) |
| WebView2 missing on a lab Windows machine | the installer bundles the evergreen bootstrapper |
| Module release drift | the shell pins versions and shows a mismatch warning; modules keep the bridge backward compatible |
| Studio not installed | the Reduce tab shows install instructions and still accepts exported bundles through UPbDB |
| Bundled PostgreSQL refuses to start (locale, port, stale pid, antivirus on Windows) | `initdb` with explicit UTF-8 and C locale, free-port probing, `pg_ctl` pid handling, the log tail surfaced in the first-run screen; "Lab server" mode as the fallback |
| Installer size with Python, pyarrow and PostgreSQL (150 to 200 MB) | accepted; the service bundle is pinned and downloaded once per version, and Studio's PySide6 stays an opt-in flavour |

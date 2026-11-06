# UPb Studio

The unified desktop and web shell for the lab's LA-ICP-MS workflow: one window
with tabs for grain images ([grainatlas](../grainatlas)), sessions and data
([laicpmsdb](../laicpmsdb)) and reduction (UPbRPy Studio), with one sign-in and
links between them, so a click on a spot in an image opens that spot's raw
sweep and reduced result.

| Tab | Module | Hosted as |
| --- | --- | --- |
| Home | the shell | a tiled board: action tiles (Open folder, Open files, Upload LA-ICP-MS session, Upload image set; anything dropped on the window goes to the right tab by itself), module status, then Sessions, Mounts and Atlases as searchable, sortable card grids (spot-count bar by acquisition kind and run status dot per session; grain and spot counts, atlas badge and thumbnail per mount), link box and log |
| Images | grainatlas | pinned static build bundled into the app (`modules.lock.json`) |
| Sessions | laicpmsdb | `/app/` in a native webview, from a lab server or from the laicpmsdb the app runs on this computer |
| Review | the shell | stored results by session or mount with sample chips; Concordia, a multi-panel geochemistry board with mineral presets, depth profiles and spot details linked to Images |
| Reduce | UPbRPy Studio | launched as its own application with a `upbr://` link and a one-time sign-in code |

Status: roadmap phases 0 and 1 done, phase 2b (ADR-0003, "This computer"
mode) implemented on the shell side: the app bundles PostgreSQL 17, runs
laicpmsdb on this machine, and a first-run wizard chooses between that and a
lab server. Until laicpmsdb publishes its service bundle
([docs/service-bundle-contract.md](docs/service-bundle-contract.md)),
"This computer" runs a laicpmsdb checkout, so it works in development builds
and release builds offer only "Lab server". Phases 3 and 4 on the shell side
(2026-11-03): one sign-in in the tab bar (password, ORCID or Google), the
token in the OS keychain and handed to the module tabs through `@lab/bridge`;
`upbr://session/<id>` and `upbr://run/<id>` launch UPbRPy Studio with a
handoff code minted on demand; Home lists sessions, runs and atlases
([docs/installing.md](docs/installing.md#signing-in)). UX conventions
(2026-11-04, [docs/ux-conventions.md](docs/ux-conventions.md)): System theme by
default, with Light and Dark choices; every tab follows live without reloading
([theme bridge](docs/bridge-theme.md)); open anything: a folder or files dropped
on the window, opened from the Finder or Explorer, or picked on Home go to Images or Sessions by content
and reach the module through `@lab/bridge` `open-files` (protocol v2); every
screen fits 1280 × 800, checked in Chromium and WebKit; the window reopens
where it was left, fitted to the screen. Plan and roadmap:
[ARCHITECTURE_PLAN.md](ARCHITECTURE_PLAN.md).

The lab workflow and the hand-offs between the apps are in [docs/WORKFLOW.md](docs/WORKFLOW.md).

## Upload

Home's **Upload LA-ICP-MS session…** sends a Rich CSV, per-spot export
folder, zip, or a Rich CSV and its per-spot folder to the ingest dialog in
Sessions. Confirm the ingest there, then return Home to see the session and
open it in Sessions or reduce it in UPbRPy Studio. **Review** becomes available
when a complete reduction run has been submitted. Home checks for the session
and reduction every 5 s for up to 10 minutes while the upload card is open.
Dismiss stops the watch.

**Upload image set…** sends an SEM package or `.grainatlas` project folder
to Images. On desktop, a project is offered first, then its saved package
folder if that path exists. On the web, grainatlas asks which package to open.
Publish the atlas to its mount with grainatlas's **Publish** button, then use
Home's **Review mount**. The shell lists and routes files; the modules read them.
On macOS the session picker accepts files and folders together; Windows and
Linux collect folders and files in consecutive native dialogs. Web Home has
separate folder and file inputs. **Open folder…**, **Open files…** and drops
continue to choose a module by content. An explicit upload button refuses a
set intended for the other module with a line saying what it accepts.

## Review

Review reads laicpmsdb's stored results by session and run, or by mount,
including spots not measured yet. A compact scope bar picks the session or
mount and run; sample chips (one per sample, with its plot colour and spot
count) show one sample on click and toggle with Cmd/Ctrl-click, with All and
Clear. Below it are three columns: the sample and grain list, the plots and the
spot details; both side columns collapse.

The plots are Concordia ellipses, stored depth profiles and a geochemistry
board: biplot panels in a 2 x 2 grid, 3 x 2 when the board is 880 px wide or
more (1440 px windows). Each axis opens a chip picker grouped as dates,
concentrations, ratios, REE anomalies, thermometers and other, with a log
toggle. **Presets** fills the board for zircon (Th/U, U and Th, Ce/Ce* vs
Eu/Eu*, Ti-in-zircon T, Yb/Gd and Hf vs date, U/Yb vs Nb/Yb and vs Y after
Grimes et al. 2015, (Sm/La)N vs La after Hoskin 2005, REE pattern), apatite,
rutile, titanite or monazite; panels can be added (up to 12), removed and
maximized. Hovering a spot marks it in every panel, the Concordia and the list.

Plots read stored values. For geochemistry the shell may also normalise stored
concentrations to CI chondrite, divide two stored values (U/Yb, (Sm/La)N) and
form Eu/Eu*, Ce/Ce* and the sum of REE + Y; such axes say "from stored ppm", a
stored column of the same name wins, and thermometers are shown only when
stored. Selecting a result focuses its image spot; selecting a spot in Images
selects its result. **Show in Images**, Enter or a double-click opens Images.
At widths of 1440 CSS px or more, **Side by side** shows the existing Images
surface beside Review. Scope, split choice and each mineral's board are
remembered. Home links each reduced session and mount to Review. Tabs use
Ctrl/⌘ 1–5, with Review fourth and Reduce fifth.

![Review geochemistry board, 1440 x 900](docs/screenshots/after_review_geochemistry_light_1440x900.png)

## Quick start

Needs Node 20+, pnpm (`corepack enable`), Rust stable and the Tauri CLI
(`cargo install tauri-cli --version '^2.11' --locked`). On macOS also the
Xcode command line tools; on Windows the MSVC build tools and WebView2 (both
usually present).

```bash
make setup
```

```bash
make test
```

`make test` ends with `make e2e`: Playwright walks every shell screen at
1440 × 900 and 1280 × 800 in Chromium and WebKit (`ui/tests/sizes.spec.ts`,
with a stand-in for the Tauri host); `make setup` installs the two browsers.

An opt-in check, not part of `make test`, runs against a running laicpmsdb with the demo
data and the real keychain (signs in, reads, mints and redeems a handoff code,
signs out):

```bash
UPBSTUDIO_LIVE_SERVER=http://127.0.0.1:8000 cargo test --manifest-path src-tauri/Cargo.toml live_ -- --ignored
```

```bash
make dev
```

`make dev` opens the window with hot reload. The first launch shows the
first-run wizard:

- **This computer**: UPb Studio starts its bundled PostgreSQL 17 (port 55432,
  or the next free one; never 5432) and the laicpmsdb checkout at
  `../laicpmsdb` (the `local` of `laicpmsdb-service` in `modules.lock.json`;
  run `make venv` and `make ui` there once) on port 8000 or the next free
  one, creates your first account and optionally loads the demo sessions.
  Both stop when the app quits. The first `cargo build` downloads the pinned
  PostgreSQL archive (13 MB on macOS) into `~/.theseus/postgresql/`.
- **Lab server**: a laicpmsdb URL, e.g. `http://localhost:8000` for
  `make dev` in the laicpmsdb repository; then **Sign in** in the tab bar
  (the demo accounts are in laicpmsdb's `.env.example`).

To launch UPbRPy Studio from a checkout instead of an installed app, set
Settings → UPbRPy Studio → UPbRPy checkout (it runs `python -m GUI --open
<link>` with the checkout's `.venv`). macOS cannot deliver `upbr://` or
`laicpmsdb://` links from the OS to `make dev`; use the Home link box, or the
built app (`make build`) for ORCID/Google sign-in, whose callback is such a
link.

Settings switches between them later. To use another PostgreSQL 17 instead
of the bundled one during development (for example if the archive cannot be
downloaded), point `PG_BIN` at its `bin` folder, in the environment
(`PG_BIN=/opt/homebrew/opt/postgresql@17/bin make dev`) or in Settings. To see
the wizard again, set `"mode": ""` in `settings.json`
([docs/installing.md](docs/installing.md) lists the files).

```bash
make build
```

builds the release app and installers into `src-tauri/target/release/bundle/`
(`.app` and `.dmg` on macOS, `.msi` and NSIS `.exe` on Windows). They are
unsigned; [docs/installing.md](docs/installing.md) covers the Gatekeeper and
SmartScreen steps.

CI (`.github/workflows/build.yml`, macOS and Windows) runs only on `v*` tags
and by hand. Tag builds create a draft release with installers and signed
updates; publish the draft to make it available in the app. Manual runs
(`gh workflow run build`) keep installers as workflow artifacts for 14 days.

Without `make` (Windows PowerShell): `pnpm install`, `pnpm --filter @lab/bridge build`,
`node scripts/fetch-modules.mjs`, then `cargo tauri dev` or `cargo tauri build`.

### The laicpmsdb service bundle

`make fetch-modules` also unpacks the laicpmsdb service bundle pinned for the
build platform in `modules.lock.json` into `src-tauri/resources/laicpmsdb-service/`,
which the installers ship. Its URLs are empty until laicpmsdb publishes the
bundle, so the folder holds only a README and the start-up log says the
build has no bundled service.

### grainatlas in the Images tab

`make fetch-modules` installs the builds pinned in `modules.lock.json` into
`ui/public/modules/`, checking each release archive's SHA-256. grainatlas has
no release yet, so the lock points at its local development build
(`../grainatlas/ui/dist`); build that in the grainatlas repository, run
`make fetch-modules` here and restart `make dev`.

## Updates

The header chip shows the version and whether an update is available or ready.
Click it for **Settings > Updates**, including this build's module versions,
**Check now**, automatic downloads and the **Stable / Beta** channel choice.
When a download is ready, **Restart to update** installs it.

The owner configures signing once (generates the key, writes the public key
and sets the GitHub secret), then checks the version copies:

```bash
pnpm updater:setup
make check-version
```

Back up `~/.tauri/upbstudio-updater.key`. See
[docs/in-app-updates.md](docs/in-app-updates.md) for setup and releases.

## Layout

```text
src-tauri/        Rust host: window (geometry), module webviews, deep links, dropped and opened
                  files (files.rs), probe, auth (sign-in, keychain, handoff), Studio detection
                  and launch, local_service/ (PostgreSQL and laicpmsdb on this computer)
ui/               shell page (Svelte 5): tab bar, Home, Settings, link resolver, drop routing;
                  tests/ the screen-size check
bridge/           @lab/bridge, the API grainatlas and laicpmsdb call to talk to the shell
scripts/          fetch-modules (pinning)
modules.lock.json pinned module builds and the laicpmsdb service bundle
docs/             decisions (ADRs), cross-platform contract, deep links, installing
```

## Documents

- [docs/cross-platform-contract.md](docs/cross-platform-contract.md): rules every module follows on macOS and Windows
- [docs/service-bundle-contract.md](docs/service-bundle-contract.md): what the laicpmsdb service bundle provides and how the shell runs it
- [docs/installing.md](docs/installing.md): installing, opening files and folders with UPb Studio, the two modes, data and log locations
- [docs/deep-links.md](docs/deep-links.md): the `laicpmsdb://`, `grainatlas://` and `upbr://` links
- [docs/ux-conventions.md](docs/ux-conventions.md): where the shell follows the lab's UX rules (source: grainatlas `docs/ux-conventions.md`)
- [bridge/README.md](bridge/README.md): `@lab/bridge` for module authors
- [docs/decisions/](docs/decisions/): ADR-0001 hosting pinned builds, ADR-0002 tab hosting, ADR-0003 local service mode

## Credits

The app icon's zircon is a Pupin S2 habit projected from the STL models of
[Mineral Habit Matrix](https://github.com/duserzym/mineral-habit-matrix).

License: MIT.

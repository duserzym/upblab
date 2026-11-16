# Developing UPb Lab

Formerly UPb Studio; renamed 2026-11-06 to distinguish this workflow shell
from the separate UPbRPy Studio reduction app. The repository is `upblab`. The executable, app identifier and stored settings
retain their existing `upbstudio` names so existing data, sign-in credentials
and links continue to work.

The unified desktop and web shell for the lab's LA-ICP-MS workflow: Home,
Sessions, Review and Reduce, with one sign-in and links between stored
results and image spots. [GrainAtlas](https://github.com/duserzym/grainatlas)
and UPbRPy Studio run as separate desktop applications. On the web,
GrainAtlas’s hosted build opens in a new tab. Inside UPb Lab, GrainAtlas
appears only as Review’s read-only SEM images panel.

| Tab | Module | Hosted as |
| --- | --- | --- |
| Home | the shell | a tiled board: action tiles (Open folder, Open files, Upload LA-ICP-MS session, Upload image set; anything dropped on the window goes to Sessions or standalone GrainAtlas by content), module status, then Sessions, Mounts and Atlases as searchable, sortable card grids (spot-count bar by acquisition kind and run status dot per session; grain and spot counts, atlas badge and thumbnail per mount), link box and log |
| Sessions | UPbDB | `/app/` in a native webview, from a lab server or from the UPbDB the app runs on this computer |
| Review | the shell | stored results by session or mount with sample chips; Concordia, a multi-panel geochemistry board with mineral presets, depth profiles and spot details linked to the optional SEM images panel, a pinned GrainAtlas build bundled into the app (`modules.lock.json`) in a read-only viewer presentation |
| Reduce | UPbRPy Studio | launched as its own application with a `upbr://` link and a one-time sign-in code |
| People & access | UPbDB | `/app/#/people` in its own module webview, after Reduce, for accounts allowed to manage people |

People & access is visible only while signed in and online, as decided by
UPbDB’s `can_manage_people` account field (falling back to `is_lab_staff`
on older servers). UPbDB enforces access to the page and its management
API. This tab has no numbered shortcut and is never restored on restart;
losing permission while viewing it returns to Home.

Status: roadmap phases 0 and 1 done, phase 2b (ADR-0003, "This computer"
mode) implemented on the shell side: the app bundles PostgreSQL 17, runs
UPbDB on this machine, and a first-run wizard chooses between that and a
lab server. Until UPbDB publishes its service bundle
([docs/service-bundle-contract.md](service-bundle-contract.md)),
"This computer" runs a UPbDB checkout, so it works in development builds
and release builds offer only "Lab server". Phases 3 and 4 on the shell side
(2026-11-03): one sign-in, the token in the OS keychain and handed to the
module tabs through `@lab/bridge`;
`upbr://session/<id>` and `upbr://run/<id>` launch UPbRPy Studio with a
handoff code minted on demand; Home lists sessions, runs and atlases
([docs/installing.md](installing.md#signing-in)). Since 2026-11-15, desktop
**Sign in…** opens UPbDB’s connect page in the browser. Use ORCID or a lab
account, then **Sign UPb Lab in** to return to the app. Other methods depend
on the server; the web shell retains its password form. UX conventions
(2026-11-04, [docs/ux-conventions.md](ux-conventions.md)): System theme by
default, with Light and Dark choices; every tab follows live without reloading
([theme bridge](bridge-theme.md)); open anything: a folder or files dropped
on the window, opened from the Finder or Explorer, or picked on Home go to
standalone GrainAtlas or Sessions by content. Session files reach UPbDB
through `@lab/bridge` `open-files` (protocol v2); every
screen fits 1280 × 800, checked in Chromium and WebKit; the window reopens
where it was left, fitted to the screen. Plan and roadmap:
[ARCHITECTURE_PLAN.md](../ARCHITECTURE_PLAN.md).

The lab workflow and the hand-offs between the apps are in [docs/WORKFLOW.md](WORKFLOW.md).

## Upload

Home's **Upload LA-ICP-MS session…** sends a Rich CSV, per-spot export
folder, zip, or a Rich CSV and its per-spot folder to the ingest dialog in
Sessions. Confirm the ingest there, then return Home to see the session and
open it in Sessions or reduce it in UPbRPy Studio. **Review** becomes available
when a complete reduction run has been submitted. Home checks for the session
and reduction every 5 s for up to 10 minutes while the upload card is open.
Dismiss stops the watch.

**Upload image set…** opens standalone GrainAtlas on desktop. Opened or
dropped image folders, `.grainatlas` folders and `.gaproj` files also go to
that app. On the web, the hosted GrainAtlas build opens in a new tab and
asks which package to open.
Publish the atlas to its mount with grainatlas's **Publish** button, then use
Home’s **Review** action on the mount card. The shell lists and routes files; the modules read them.
On macOS the session picker accepts files and folders together; Windows and
Linux collect folders and files in consecutive native dialogs. Web Home has
separate folder and file inputs. **Open folder…**, **Open files…** and drops
continue to choose a module by content. An explicit upload button refuses a
set intended for the other module with a line saying what it accepts.

## Review

Review reads UPbDB's stored results by session and run, or by mount,
including spots not measured yet. A compact scope bar picks the session or
mount and run; sample chips (one per sample, with its plot colour and spot
count) toggle visibility on click, toggle a range with Shift-click, and show
only that sample with Alt/Option-click or its **only** button. **All**,
**None**, **Samples** and **Standards** control groups. The Spots, Age & plots,
Spot metadata and optional SEM images panels can be moved, resized and
maximised; layout presets restore a useful arrangement.

The plots are Concordia ellipses, stored depth profiles and a geochemistry
board: biplot panels in a 2 x 2 grid, 3 x 2 when the board is 880 px wide or
more (1440 px windows). Each axis opens a chip picker grouped as dates,
concentrations, ratios, REE anomalies, thermometers and other, with a log
toggle. **Presets** fills the board for zircon (Th/U, U and Th, Ce/Ce* vs
Eu/Eu*, Ti-in-zircon T, Yb/Gd and Hf vs date, U/Yb vs Nb/Yb and vs Y,
(Sm/La)N vs La, REE pattern), apatite,
rutile, titanite or monazite; panels can be added (up to 12), removed and
maximized. Hovering a spot marks it in every panel, the Concordia and the list.

Plots read stored values. For geochemistry the shell may also normalise stored
concentrations to CI chondrite, divide two stored values (U/Yb, (Sm/La)N) and
form Eu/Eu*, Ce/Ce* and the sum of REE + Y; such axes say "from stored ppm", a
stored column of the same name wins, and thermometers are shown only when
stored. **SEM images** shows the published atlas beside Review using the
bundled GrainAtlas build in a read-only viewer presentation. Selecting a
result focuses its image spot; selecting a linked spot in that panel selects
its result. With sample groups shown and no single spot picked, the mount
map inset outlines the shown samples in their Review colours and counts
them in its header; picking a spot returns the inset to that spot.
**Edit in grainatlas** opens standalone GrainAtlas on desktop, or its hosted
build in a new tab on the web. Scope, split choice and each mineral’s board
are remembered. Home links each reduced session and mount to Review.
Tabs use Ctrl/Cmd 1–4: Home, Sessions, Review and Reduce.

## Quick start

Use `make quick` for checks affected by a change, and `make check` for the
full check before a build or install or after a risky change. See
[testing.md](testing.md) for the current test tiers and build timings.

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

An opt-in check, not part of `make test`, runs against a running UPbDB with the demo
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

- **This computer**: When you first open Sessions or Review, UPb Lab starts
  PostgreSQL 17 (port 55432 or the next free port, never 5432) and UPbDB
  (port 8000 or the next free port). It creates your first account and can load
  the demo sessions. Both services stop when the app quits. For development, run
  `make venv` and `make ui` in `../upbdb`, the local checkout for
  `upbdb-service` in `modules.lock.json`. The first `cargo build` downloads
  the pinned PostgreSQL archive (13 MB on macOS) into `~/.theseus/postgresql/`.
- **Lab server**: a UPbDB URL, e.g. `http://localhost:8000` for
  `make dev` in the UPbDB repository; open **Sign in** in the tab bar, then
  **Sign in…** in the dialog to open UPbDB’s browser page (the demo accounts
  are in UPbDB’s `.env.example`).

To launch UPbRPy Studio from a checkout instead of an installed app, set
Settings → UPbRPy Studio → UPbRPy checkout (it runs `python -m GUI --open
<link>` with the checkout's `.venv`). macOS cannot deliver `upbr://` or
`upbdb://` links from the OS to `make dev`; use the Home link box, or the
built app (`make build`) for desktop browser sign-in, whose callback is an
app link.

Settings switches between them later. To use another PostgreSQL 17 instead
of the bundled one during development (for example if the archive cannot be
downloaded), point `PG_BIN` at its `bin` folder, in the environment
(`PG_BIN=/opt/homebrew/opt/postgresql@17/bin make dev`) or in Settings. To see
the wizard again, set `"mode": ""` in `settings.json`
([docs/installing.md](installing.md) lists the files).

```bash
make build
```

builds the release app and installers (`.app` and `.dmg` on macOS, `.msi`
and NSIS `.exe` on Windows). Local macOS builds use the shared release target
in [testing.md](testing.md#release-build); the command prints the installer
directory. `make build RELEASE_TARGET=` uses
`src-tauri/target/release/bundle/`, as CI does. On a Mac with the lab’s
code-signing certificate, the Makefile uses it so keychain access survives
rebuilds. Other macOS builds use ad-hoc signing. Downloads are not notarized;
[installing.md](installing.md) covers Gatekeeper and SmartScreen.

CI (`.github/workflows/build.yml`, macOS and Windows) runs only on `v*` tags
and by hand. Tag builds create a draft release with installers and signed
updates; publish the draft to make it available in the app. Manual runs
(`gh workflow run build`) keep installers as workflow artifacts for 14 days.

Without `make` (Windows PowerShell): `pnpm install`, `pnpm --filter @lab/bridge build`,
`node scripts/fetch-modules.mjs`, then `cargo tauri dev` or `cargo tauri build`.

### The UPbDB service bundle

`make fetch-modules` also unpacks the UPbDB service bundle pinned for the
build platform in `modules.lock.json` into `src-tauri/resources/upbdb-service/`,
which the installers ship. Its URLs are empty until UPbDB publishes the
bundle, so the folder holds only a README and the start-up log says the
build has no bundled service.

### GrainAtlas in Review’s SEM images panel

`make fetch-modules` installs the builds pinned in `modules.lock.json` into
`ui/public/modules/`, checking each release archive's SHA-256. Review uses
this bundled GrainAtlas build only as a read-only viewer; editing opens the
standalone app. GrainAtlas has no release yet, so the lock points at its local development build
(`../grainatlas/ui/dist`); build that in the grainatlas repository, run
`make fetch-modules` here and restart `make dev`. For a local build,
`ui/public/modules/manifest.json` records the commit of the checkout it was
copied from and whether that checkout had uncommitted changes; Settings,
Updates, "In this build" shows it (for example `local build of f9ca787`), so a
bundle says which grainatlas it carries. To bundle a build from another
checkout (a clean worktree), build the shell from an upblab checkout whose
sibling `grainatlas` folder (a symlink is fine) is that checkout.

## Updates

The header update button opens a status popover. **Settings > Updates**
includes this build’s module versions, **Check now**, automatic downloads and the **Stable / Beta** channel choice.
When a download is ready, **Restart to update** installs it.

The owner configures signing once (generates the key, writes the public key
and sets the GitHub secret), then checks the version copies:

```bash
pnpm updater:setup
make check-version
```

Back up `~/.tauri/upbstudio-updater.key`. See
[docs/in-app-updates.md](in-app-updates.md) for setup and releases.

## Layout

```text
src-tauri/        Rust host: window (geometry), module webviews, deep links, dropped and opened
                  files (files.rs), probe, auth (sign-in, keychain, handoff), Studio detection
                  and launch, local_service/ (PostgreSQL and UPbDB on this computer)
ui/               shell page (Svelte 5): tab bar, Home, Settings, link resolver, drop routing;
                  tests/ the screen-size check
bridge/           @lab/bridge, the API grainatlas and UPbDB call to talk to the shell
scripts/          fetch-modules (pinning)
modules.lock.json pinned module builds and the UPbDB service bundle
docs/             decisions (ADRs), cross-platform contract, deep links, installing
```

## Documents

- [User manual](https://duserzym.github.io/upblab/): install and screen guides
- [testing.md](testing.md): test tiers and build output locations
- [docs/cross-platform-contract.md](cross-platform-contract.md): rules every module follows on macOS and Windows
- [docs/service-bundle-contract.md](service-bundle-contract.md): what the UPbDB service bundle provides and how the shell runs it
- [docs/installing.md](installing.md): installing, opening files and folders with UPb Lab, the two modes, data and log locations
- [docs/deep-links.md](deep-links.md): the `upbdb://`, `grainatlas://` and `upbr://` links
- [docs/ux-conventions.md](ux-conventions.md): where the shell follows the lab's UX rules (source: grainatlas `docs/ux-conventions.md`)
- [bridge/README.md](../bridge/README.md): `@lab/bridge` for module authors
- [docs/decisions/](decisions/): ADR-0001 hosting pinned builds, ADR-0002 tab hosting, ADR-0003 local service mode

## Credits

The app icon’s zircon is an S2 habit projected from the STL models of
[Mineral Habit Matrix](https://github.com/duserzym/mineral-habit-matrix).

License: MIT.

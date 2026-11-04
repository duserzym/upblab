# UPb Studio

The unified desktop and web shell for the lab's LA-ICP-MS workflow: one window
with tabs for grain images ([grainatlas](../grainatlas)), sessions and data
([laicpmsdb](../laicpmsdb)) and reduction (UPbRPy Studio), with one sign-in and
links between them, so a click on a spot in an image opens that spot's raw
sweep and reduced result.

| Tab | Module | Hosted as |
| --- | --- | --- |
| Home | the shell | module status, link box and log (timeline and search later) |
| Images | grainatlas | pinned static build bundled into the app (`modules.lock.json`) |
| Sessions | laicpmsdb | `/app/` in a native webview, from a lab server or from the laicpmsdb the app runs on this computer |
| Reduce | UPbRPy Studio | launched as its own application |

Status: roadmap phases 0 and 1 done, phase 2b (ADR-0003, "This computer"
mode) implemented on the shell side: the app bundles PostgreSQL 17, runs
laicpmsdb on this machine, and a first-run wizard chooses between that and a
lab server. Until laicpmsdb publishes its service bundle
([docs/service-bundle-contract.md](docs/service-bundle-contract.md)),
"This computer" runs a laicpmsdb checkout, so it works in development builds
and release builds offer only "Lab server". Plan and roadmap:
[ARCHITECTURE_PLAN.md](ARCHITECTURE_PLAN.md).

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
  `make dev` in the laicpmsdb repository.

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

CI (`.github/workflows/build.yml`, macOS and Windows): until the first
release it runs only on `v*` tags and by hand, not on push or pull requests.
Run it with `gh workflow run build`; the installers are kept as workflow
artifacts for 14 days.

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

## Layout

```text
src-tauri/        Rust host: window, module webviews, deep links, probe, Studio launch,
                  local_service/ (PostgreSQL and laicpmsdb on this computer)
ui/               shell page (Svelte 5): tab bar, Home, Settings, link resolver
bridge/           @lab/bridge, the API grainatlas and laicpmsdb call to talk to the shell
scripts/          fetch-modules (pinning)
modules.lock.json pinned module builds and the laicpmsdb service bundle
docs/             decisions (ADRs), cross-platform contract, deep links, installing
```

## Documents

- [docs/cross-platform-contract.md](docs/cross-platform-contract.md): rules every module follows on macOS and Windows
- [docs/service-bundle-contract.md](docs/service-bundle-contract.md): what the laicpmsdb service bundle provides and how the shell runs it
- [docs/installing.md](docs/installing.md): installing, the two modes, data and log locations
- [docs/deep-links.md](docs/deep-links.md): the `laicpmsdb://`, `grainatlas://` and `upbr://` links
- [bridge/README.md](bridge/README.md): `@lab/bridge` for module authors
- [docs/decisions/](docs/decisions/): ADR-0001 hosting pinned builds, ADR-0002 tab hosting, ADR-0003 local service mode

## Credits

The app icon's zircon is a Pupin S2 habit projected from the STL models of
[Mineral Habit Matrix](https://github.com/duserzym/mineral-habit-matrix).

License: MIT.

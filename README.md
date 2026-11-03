# UPb Studio

The unified desktop and web shell for the lab's LA-ICP-MS workflow: one window
with tabs for grain images ([grainatlas](../grainmap)), sessions and data
([laicpmsdb](../laicpmsdb)) and reduction (UPbRPy Studio), with one sign-in and
links between them, so a click on a spot in an image opens that spot's raw
sweep and reduced result.

| Tab | Module | Hosted as |
| --- | --- | --- |
| Home | the shell | module status, link box and log (timeline and search later) |
| Images | grainatlas | pinned static build bundled into the app (`modules.lock.json`) |
| Sessions | laicpmsdb | the configured server's `/app/` in a native webview |
| Reduce | UPbRPy Studio | launched as its own application |

Status: roadmap phase 0 done and phase 1 partly: the shell, tabs, settings,
link resolver, `@lab/bridge` and the CI matrix work; the Images tab shows a
placeholder until grainatlas publishes a web build. Plan and roadmap:
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

`make dev` opens the window with hot reload. The Sessions tab shows laicpmsdb
from `http://localhost:8000/app/` (change it in Settings); start it with
`make dev` in the laicpmsdb repository, otherwise the tab says the server is
unreachable and keeps retrying.

```bash
make build
```

builds the release app and installers into `src-tauri/target/release/bundle/`
(`.app` and `.dmg` on macOS, `.msi` and NSIS `.exe` on Windows). They are
unsigned; [docs/installing.md](docs/installing.md) covers the Gatekeeper and
SmartScreen steps.

Without `make` (Windows PowerShell): `pnpm install`, `pnpm --filter @lab/bridge build`,
`node scripts/fetch-modules.mjs`, then `cargo tauri dev` or `cargo tauri build`.

### grainatlas in the Images tab

`make fetch-modules` installs the builds pinned in `modules.lock.json` into
`ui/public/modules/`, checking each release archive's SHA-256. grainatlas has
no release yet, so the lock points at its local development build
(`../grainmap/ui/dist`); build that in the grainmap repository, run
`make fetch-modules` here and restart `make dev`.

## Layout

```text
src-tauri/        Rust host: window, module webviews, deep links, probe, Studio launch
ui/               shell page (Svelte 5): tab bar, Home, Settings, link resolver
bridge/           @lab/bridge, the API grainatlas and laicpmsdb call to talk to the shell
scripts/          fetch-modules (pinning)
modules.lock.json pinned module builds
docs/             decisions (ADRs), cross-platform contract, deep links, installing
```

## Documents

- [docs/cross-platform-contract.md](docs/cross-platform-contract.md): rules every module follows on macOS and Windows
- [docs/deep-links.md](docs/deep-links.md): the `laicpmsdb://`, `grainatlas://` and `upbr://` links
- [bridge/README.md](bridge/README.md): `@lab/bridge` for module authors
- [docs/decisions/](docs/decisions/): ADR-0001 hosting pinned builds, ADR-0002 tab hosting

License: MIT.

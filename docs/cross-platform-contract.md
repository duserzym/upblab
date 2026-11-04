# Cross-platform contract

Applies to UPb Studio and to the modules it hosts (grainatlas, laicpmsdb, and
UPbRPy Studio where relevant). macOS (arm64) and Windows (x86-64) are both
first-class: a feature that works on only one of them is not done. Module
repositories link here instead of copying the rules.

Source: `ARCHITECTURE_PLAN.md` section 3 (2026-11-03). Change the rules there
and here together.

| Concern | Rule |
| --- | --- |
| Webview | WKWebView on macOS, WebView2 on Windows. Modules use only features both support: no File System Access API (grainatlas desktop reads files through Tauri commands, the web build through `<input type=file webkitdirectory>` and drag-drop), OPFS only behind a feature check, `backdrop-filter` with a solid fallback |
| Paths | modules exchange paths as UTF-8 strings with forward slashes and resolve them with the host's path library; NAS locations are configured as a mount root per OS (`/Volumes/lab` vs `L:\`) with the same relative layout under it |
| Fonts and DPI | UI scales with device pixel ratio; print layouts specify sizes in millimetres and are tested on both OS print paths |
| Deep links | all three schemes (`laicpmsdb`, `grainatlas`, `upbr`) registered by the shell installer on both OS; modules' own installers register only their own scheme |
| Processes | the shell launches Studio by its installed path (macOS `.app`, Windows `.exe`) found through a settings entry with auto-detection |
| Line endings and encodings | instrument files are read by explicit encoding (TM4000 sidecars are UTF-16LE, Qtegra CSV is UTF-8 with CRLF); never rely on the OS default |
| Builds | GitHub Actions matrix `macos-latest` (arm64) and `windows-latest`; artifacts `.dmg` (notarised when a Developer ID is available) and `.msi` plus `.exe` (NSIS); unsigned builds documented with the SmartScreen and Gatekeeper steps |
| Tests | Playwright smoke test of the shell on both OS: sign in to a local laicpmsdb, open the Images tab, place a spot, follow its link to the Sessions tab |

## How UPb Studio meets it today

| Concern | Where |
| --- | --- |
| Webview | the shell page uses `-webkit-backdrop-filter` with an `@supports` solid fallback (tokens from laicpmsdb); module tabs are native child webviews on both OS (ADR-0002) |
| Deep links | `plugins.deep-link.desktop.schemes` in `src-tauri/tauri.conf.json`; single-instance forwarding on Windows; see [deep-links.md](deep-links.md) |
| Processes | `src-tauri/src/studio.rs`: Settings path, else `/Applications` and `~/Applications` on macOS, `%LOCALAPPDATA%\Programs` and `%ProgramFiles%` on Windows |
| Local service (ADR-0003) | `src-tauri/src/local_service/`: PostgreSQL and laicpmsdb as children tied to the shell (process group plus watchdog on macOS, job object and no console window on Windows), loopback only, forward-slash paths in the environment; the bundle layout per OS is in [service-bundle-contract.md](service-bundle-contract.md) |
| Builds | `.github/workflows/build.yml`; unsigned-install steps in [installing.md](installing.md) |
| Tests | unit tests run on both OS in CI; the Playwright smoke test is roadmap phase 6 |

## Notes for module authors

- **Being hosted.** In the desktop shell a module page is a top-level page in
  its own webview, not an iframe; in the web shell (`/desk/`) it is an
  iframe. Use [`@lab/bridge`](../bridge/README.md) for anything that talks to
  the shell, and keep the page working when `isHosted()` is false.
- **Framing.** For the web shell, laicpmsdb must allow its own origin to frame
  `/app/` and `/atlas/` (`X-Frame-Options: SAMEORIGIN` or CSP
  `frame-ancestors 'self'`); it currently sends `DENY`.
- **Hash routing or query strings** keep module builds working under
  `tauri://localhost/…` (macOS), `http://tauri.localhost/…` (Windows), `/app/`
  and `file://` alike; use relative asset paths (`base: './'` in Vite).
- **Keyboard shortcuts.** Inside the desktop shell, `Ctrl/⌘ 1–4`, `Ctrl/⌘ ,`
  and `Ctrl/⌘ R` belong to the shell's menu; do not bind them in a module.

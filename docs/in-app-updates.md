# In-app updates

Every app of the lab workflow updates itself the way repohub and CodexBar do:
a quiet check in the background, a download when allowed, and one "Update
ready, restart now" action. The update icon is always visible in the header,
and a click checks for updates and opens a popover. The last section describes the
UPb Lab implementation.

## Mechanism (Tauri apps)

- `tauri-plugin-updater` 2 reads a `latest.json` from GitHub Releases, compares
  the version with the running build, downloads the signed update bundle and
  verifies its minisign signature against the public key compiled into
  `tauri.conf.json` (`plugins.updater.pubkey`). An update that does not verify
  is refused.
- The app's own Rust commands (`update_check`, `update_download`,
  `update_install`, `update_status`) wrap the plugin, so the web page never
  needs the plugin's JavaScript permissions. `update_install` installs the
  downloaded bytes and restarts the app.
- The page checks 8 seconds after launch and every 6 hours. With
  "Download updates automatically" on (the default), an available update is
  downloaded quietly and the icon gains a dot when ready. With it off, the
  icon gains a dot when an update is available and the popover offers Download.
- Every app follows the latest stable release at
  `https://github.com/<owner>/<repo>/releases/latest/download/latest.json`.
  Stored Beta preferences are removed silently; there is no channel selector.
- Hosted inside UPb Lab (the `@lab/bridge` transport is `tauri` or
  `postMessage`), a module never runs its own updater: the shell updates
  itself and the modules it pins in `modules.lock.json`. The module's update button is hidden
  there; the shell's own Updates panel lists the module versions.
- The static web build (no Tauri) shows the update icon but cannot update
  itself; the popover explains that its server supplies the version.

## What the user sees

- **Check for updates**: a circular arrow beside the account and Settings
  buttons. The tooltip and popover show the current version. Clicking checks
  immediately and opens an anchored popover with the result and any Download,
  Restart to update or download-page action. A running check or download is
  reused. The arrow rotates while busy unless reduced motion is preferred.
  An accent dot marks an available or ready update, including unsupported
  installs with a known release. A standards warning uses a warning-coloured
  dot and adds its message to the popover. Escape, an outside click or a
  second button click closes it. The Update settings link opens Settings >
  Updates. Bundled module versions appear here when the manifest is present.
- **Settings > Updates**: current version, the last check time and result,
  **Check now**, **Download** (when automatic downloads are off), **Restart to
  update** (when the download is done), "Download updates automatically",
  and a link to the release notes for the available or ready version.
- Available and ready updates show the manifest's plain-text notes below the
  state line, clamped to 4 lines, in both the popover and Settings. Release
  notes opens that version's GitHub release in the system browser.
- After an upgrade or manual reinstall, a "What's new in vX.Y.Z" card near
  the update button shows the bundled notes once. The fallback is notes saved
  before installing that version, then "Updated to vX.Y.Z." First installs
  only record the version. Close with ✕ or Escape; focus returns to the
  update button. The popover's "What's new" link reopens the card.
- The update check is one GET of `latest.json`. No telemetry.

## Releasing

1. Write `release-notes/<version>.md` at the repository root. Use plain text
   or at most 5 short `- ` bullets, at most 600 characters, with no headings.
   Describe what changes for lab users. The UI bundles the running version's
   file at build time, including for manual reinstalls.
2. Refresh the embedded GrainAtlas module: build `../grainatlas` (`make ui-build`
   on its current main), then run `node scripts/fetch-modules.mjs --prefer local`
   and check that `ui/public/modules/manifest.json` records that grainatlas
   commit with `dirty: false`. The Tauri build does not refresh it on its own,
   so skipping this step ships whatever module was copied last.
3. Build with the signing key set (keep it private):

   ```bash
   TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/upblab-updater.key)" cargo tauri build --config src-tauri/tauri.release.conf.json
   ```

4. Generate the feed and upload copies from the signed artifacts:

   ```bash
   node scripts/release-feed.mjs --darwin-aarch64 "path/to/UPb Lab.app.tar.gz" --dmg "path/to/UPb Lab_0.1.3_aarch64.dmg" --assets-dir release-assets --out release-assets/latest.json
   ```

   The version defaults to `src-tauri/tauri.conf.json`; `--version X.Y.Z`
   overrides it. Add `--windows-x86_64 "path/to/UPb Lab-setup.exe"` when available.
   Each updater artifact needs its `.sig` beside it. `--assets-dir DIR`
   defaults to the folder containing `--out`. The script copies the archives
   and signatures there, replacing spaces in `productName` with `-` for the
   filename stem. For UPb Lab, the upload names are
   `UPb-Lab_<version>_aarch64.app.tar.gz` and
   `UPb-Lab_<version>_x64-setup.exe`, each with a matching `.sig`.
   With `--dmg PATH`, it also copies the disk image as
   `UPb-Lab_<version>_aarch64.dmg`.

   The script refuses missing,
   empty or oversized notes, an empty pubkey, mismatched key ids, and failed
   artifact or global minisign signatures. It verifies the copied updater
   files locally before writing `latest.json`. Every final upload filename,
   including the feed filename, must contain no spaces and use only ASCII
   letters, digits, `.`, `_` and `-`. The feed URLs use the safe names without
   percent-encoding; GitHub renames uploaded assets containing spaces, which
   would otherwise break the updater URLs. No new dependencies are needed.
5. Upload exactly the files printed under `Files to upload` to the matching
   `v<version>` GitHub release: the safe-named updater archives and `.sig`
   files, `latest.json`, and the safe-named disk image when `--dmg` was supplied.
   Include `--dmg` when preparing a macOS release so the list includes it.
   Publish as a stable release; installed
   copies see it on their next check. Keep the versions and the release tag
   consistent (`make check-version`).

The existing release workflow runs only for `v*` tags or manual dispatch.
Manual workflow runs keep build artifacts without publishing a release.

## One-time setup per repository (the owner does this)

1. Generate the signing key and write the public key into `tauri.conf.json`:

   ```bash
   node scripts/setup-updater.mjs
   ```

   The private key lands in `~/.tauri/<app>-updater.key` (back it up: losing
   it means installed copies cannot verify future updates). The script writes
   the public key into `src-tauri/tauri.conf.json`. It refuses to replace a
   non-empty pubkey unless `--force` is supplied.
2. Store the private key as the repository secret `TAURI_SIGNING_PRIVATE_KEY`
   (the script does it with `gh secret set` when `gh` is signed in; otherwise
   paste the file's contents in GitHub > Settings > Secrets and variables >
   Actions). The key has no password, so `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
   stays unset.
3. Nothing else: GitHub Releases is the only hosting the updater needs, and
   the default `GITHUB_TOKEN` can publish releases in the same repository.

## Checks in the repository

- Unit tests cover version comparison, stable-only feed selection, the update state
  machine, friendly errors, notes fallback and the button presentation. Node
  tests generate temporary Ed25519 keys to check both minisign signatures and
  reject changed artifacts, signatures, comments and key ids.
- Browser tests check the ready panel and the ready, available and up-to-date
  popover at 1440 x 900 and 1280 x 800, light and dark. Button tests also
  cover 1512 x 982 and the minimum 1024 x 640 window. The page honours
  `?update-preview=idle|checking|ready|available|downloading|error|none|unsupported`
  outside Tauri. Manual checks restore the scenario after 600 ms; checking
  stays busy indefinitely and downloading continues without another check.
- With `SCREENSHOTS=1`, browser tests save screenshots of the icon, popover
  and panel to their configured output directory. The button tests write
  `check-updates-idle.png` and `check-updates-available.png` at 1512 x 982;
  `SHOT_DIR` overrides their output directory.

## UPb Lab specifics

- Tauri project: `src-tauri/`. Updater code: `src-tauri/src/updater.rs`; page
  side `ui/src/lib/updates.ts` (pure logic, `updates.test.ts` next to it),
  `ui/src/lib/updater.svelte.ts` (scheduler and Tauri calls),
  `ui/src/lib/versions.ts` (what the build contains),
  `ui/src/components/CheckUpdatesButton.svelte` and the Updates panel in
  `ui/src/routes/Settings.svelte`.
- The app command ACL requires `permissions/updates.toml` and
  `capabilities/updates.json` under `src-tauri/`, scoped only to the shell
  webview. No updater plugin JavaScript permissions are granted.
- The icon sits beside the version chip in the header bar, right of the tabs.
  On the desktop the module webviews cover the content area, so opening the
  popover hides those views through the same overlay flag as the account dialog.
- Settings > Updates also lists what this build contains: the grainatlas web
  build pinned in `modules.lock.json` (release or local build), the UPbDB
  service bundle, and the UPbRPy Studio found on this computer. The modules
  update with UPb Lab; UPbRPy Studio updates itself from its own Settings.
- Version copies that must agree: `package.json`, `ui/package.json`,
  `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`; `make check-version`
  compares them and the workflow refuses a tag that does not match.
- Signing key: `~/.tauri/upblab-updater.key`; setup script
  `scripts/setup-updater.mjs` (`pnpm updater:setup`).
- Release workflow: `.github/workflows/build.yml` (macOS arm64 `.dmg`, Windows
  `.msi` and NSIS `-setup.exe`, the signed update bundles and `latest.json`,
  attached to a draft release of the tag). Publish the draft on GitHub and the
  updater endpoint starts serving it.
- Update endpoint: `https://github.com/duserzym/upblab/releases/latest/download/latest.json`.
- Settings: the automatic-download switch, last check, last seen version and
  notes saved before installation are
  shell settings (`settings.json` in the app's config folder on the desktop,
  `localStorage['upbstudio.settings']` on the web).

# In-app updates

Every app of the lab workflow updates itself the way repohub and CodexBar do:
a quiet check in the background, a download when allowed, and one "Update
ready, restart now" action. The version chip is always visible in the header,
and a click there opens the Updates panel. The last section describes the
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
  downloaded quietly and the chip turns into "Update ready, restart". With it
  off, the chip says "Update available" and the panel offers Download.
- Channels: **Stable** reads `https://github.com/<owner>/<repo>/releases/latest/download/latest.json`,
  which GitHub resolves to the newest published, non-pre-release release.
  **Beta** lists the repository's releases through the GitHub API, skips
  drafts, and takes `latest.json` from the newest release, pre-releases
  included. A tag like `v0.4.0-beta.1` becomes a pre-release and only the Beta
  channel receives it.
- Hosted inside UPb Lab (the `@lab/bridge` transport is `tauri` or
  `postMessage`), a module never runs its own updater: the shell updates
  itself and the modules it pins in `modules.lock.json`. The chip is hidden
  there; the shell's own Updates panel lists the module versions.
- The static web build (no Tauri) shows the version chip but cannot update
  itself; the panel says so and links to the releases page.

## What the user sees

- **Version chip**: a small pill in the header of the window on
  every screen: `v1.2.3`. It becomes `Update available` or
  `Update ready, restart` with a dot when there is something to do, shows a
  spinner while checking or downloading, and `Check failed` after an error.
  Clicking it opens Settings > Updates.
- **Settings > Updates**: current version, the last check time and result,
  **Check now**, **Download** (when automatic downloads are off), **Restart to
  update** (when the download is done), "Download updates automatically",
  the channel (Stable / Beta), and a link to the release notes.
- Nothing is sent anywhere: the check is one GET of `latest.json` (and the
  releases list on Beta). No telemetry.

## Release flow

1. Bump the version (the version copies must agree; see the repository section),
   commit and push.
2. Tag `vX.Y.Z` (or `vX.Y.Z-beta.N` for the Beta channel) and push the tag.
3. The release workflow (`v*` tags and manual dispatch only, never on push)
   builds the installers, signs the update bundles with the private key from
   the `TAURI_SIGNING_PRIVATE_KEY` secret, and creates a draft GitHub Release
   with the installers, the signed bundles (`.app.tar.gz` + `.sig` on macOS,
   `.exe`/`.msi` + `.sig` on Windows) and `latest.json`.
4. Publish the draft release. Installed copies see the new version at their
   next check.

A manual run (`gh workflow run <name>`) builds the same artifacts and keeps
them as workflow artifacts without publishing a release; it is the dry run.

## One-time setup per repository (the owner does this)

1. Generate the signing key and write the public key into `tauri.conf.json`:

   ```bash
   node scripts/setup-updater.mjs
   ```

   The private key lands in `~/.tauri/<app>-updater.key` (back it up: losing
   it means installed copies cannot verify future updates). The script writes
   the public key into `src-tauri/tauri.conf.json`; commit that change.
2. Store the private key as the repository secret `TAURI_SIGNING_PRIVATE_KEY`
   (the script does it with `gh secret set` when `gh` is signed in; otherwise
   paste the file's contents in GitHub > Settings > Secrets and variables >
   Actions). The key has no password, so `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
   stays unset.
3. Nothing else: GitHub Releases is the only hosting the updater needs, and
   the default `GITHUB_TOKEN` can publish releases in the same repository.

## Checks in the repository

- Unit tests cover version comparison, channel selection and the update state
  machine (`updates.test.*`).
- Browser tests check the ready panel and the ready, available and up-to-date
  chip at 1440 x 900 and 1280 x 800, light and dark. The page honours
  `?update-preview=ready|available|downloading|error|none|unsupported` outside
  Tauri.
- With `SCREENSHOTS=1`, browser tests save screenshots of the chip and panel
  in `docs/screenshots/`.

## UPb Lab specifics

- Tauri project: `src-tauri/`. Updater code: `src-tauri/src/updater.rs`; page
  side `ui/src/lib/updates.ts` (pure logic, `updates.test.ts` next to it),
  `ui/src/lib/updater.svelte.ts` (scheduler and Tauri calls),
  `ui/src/lib/versions.ts` (what the build contains),
  `ui/src/components/VersionChip.svelte` and the Updates panel in
  `ui/src/routes/Settings.svelte`.
- The app command ACL requires `permissions/updates.toml` and
  `capabilities/updates.json` under `src-tauri/`, scoped only to the shell
  webview. No updater plugin JavaScript permissions are granted.
- The chip sits in the header bar, right of the tabs: on the desktop the
  module webviews cover the content area, so a bottom-right chip on the shell
  page would be hidden under them.
- Settings > Updates also lists what this build contains: the grainatlas web
  build pinned in `modules.lock.json` (release or local build), the laicpmsdb
  service bundle, and the UPbRPy Studio found on this computer. The modules
  update with UPb Lab; UPbRPy Studio updates itself from its own Settings.
- Version copies that must agree: `package.json`, `ui/package.json`,
  `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`; `make check-version`
  compares them and the workflow refuses a tag that does not match.
- Signing key: `~/.tauri/upbstudio-updater.key`; setup script
  `scripts/setup-updater.mjs` (`pnpm updater:setup`).
- Release workflow: `.github/workflows/build.yml` (macOS arm64 `.dmg`, Windows
  `.msi` and NSIS `-setup.exe`, the signed update bundles and `latest.json`,
  attached to a draft release of the tag). Publish the draft on GitHub and the
  updater endpoint starts serving it.
- Update endpoint: `https://github.com/duserzym/upblab/releases/latest/download/latest.json`.
- Settings: the channel, the automatic-download switch and the last check are
  shell settings (`settings.json` in the app's config folder on the desktop,
  `localStorage['upbstudio.settings']` on the web).

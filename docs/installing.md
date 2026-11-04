# Installing UPb Studio

Until the lab has an Apple Developer ID and a Windows code-signing certificate,
UPb Studio installers are **unsigned** (macOS builds are ad-hoc signed only).
Both operating systems warn before the first launch. The steps below are the
expected, one-time way past those warnings; they do not lower security for
other apps.

Download the installer for your system from the latest successful run of the
[build workflow](../.github/workflows/build.yml) (Actions tab → build → the
run → *Artifacts*): `upbstudio-macos-arm64` holds the `.dmg`,
`upbstudio-windows-x64` holds the `.msi` and the NSIS `-setup.exe`. Each
artifact downloads as a `.zip`; unzip it first.

## macOS (Apple Silicon)

1. Open `UPb Studio_<version>_aarch64.dmg` and drag **UPb Studio** to
   **Applications**.
2. Open UPb Studio from Applications. macOS says it *cannot verify the
   developer* (Gatekeeper). Click **Done** (or **Cancel**).
3. Open **System Settings → Privacy & Security**, scroll to *Security*, and
   click **Open Anyway** next to "UPb Studio was blocked". Confirm with your
   password or Touch ID, then **Open**.

From then on it opens normally. If macOS instead says the app *is damaged and
can't be opened*, the download kept its quarantine flag on a build without the
ad-hoc signature; clear it once in Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/UPb Studio.app"
```

Launch Services learns the `laicpmsdb://`, `grainatlas://` and `upbr://`
links after the first launch from Applications.

## Windows (x86-64)

Use either installer:

- `UPb Studio_<version>_x64_en-US.msi`: per-machine install, needs
  administrator rights.
- `UPb Studio_<version>_x64-setup.exe` (NSIS): per-user install into
  `%LOCALAPPDATA%\Programs`, no administrator rights.

1. Double-click the installer. Microsoft Defender SmartScreen shows
   *Windows protected your PC*.
2. Click **More info**, check that the app is *UPb Studio* and the publisher
   *Unknown publisher*, then click **Run anyway**.
3. If the browser blocked the download first (Edge: *isn't commonly
   downloaded*), open the downloads list, choose **…  → Keep → Show more →
   Keep anyway**.
4. If Windows still refuses to run the file, right-click it → **Properties**,
   tick **Unblock** at the bottom of the *General* tab, **OK**, and run it
   again.

The installers bundle the WebView2 bootstrapper, so machines without the
WebView2 runtime get it installed (this needs internet access once). They
also register the three link schemes.

## After installing

- First run (planned, roadmap phase 2b): choose **This computer** to let
  UPb Studio run its own laicpmsdb and PostgreSQL on this machine, or **Lab
  server** to use a URL. Until that phase ships, the Sessions tab needs a
  running laicpmsdb (`make dev` in its checkout, or the lab server URL).
- Settings (gear icon or Ctrl/⌘ ,): set the laicpmsdb server URL (default
  `http://localhost:8000`) and, if UPbRPy Studio is not in its usual place,
  its path.
- Logs: macOS `~/Library/Logs/edu.umn.upbstudio/upbstudio.log`, Windows
  `%LOCALAPPDATA%\edu.umn.upbstudio\logs\upbstudio.log`.

## Building it yourself

See the quick start in the [README](../README.md): `make setup`, then
`make build`. The installers land in `src-tauri/target/release/bundle/`.

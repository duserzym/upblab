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

## After installing: the first run

The first launch asks where laicpmsdb, the Sessions tab, should live. Settings
(gear icon or Ctrl/⌘ ,) changes it later.

- **This computer**: UPb Studio runs its own laicpmsdb and PostgreSQL 17 on
  this machine. Choose the data root (default `~/laicpmsdb`, the same layout
  as the lab NAS), create your account (user name, email and a password of
  your choice; it is the first administrator of this laicpmsdb), and
  optionally load the demo sessions. Both programs start when UPb Studio
  opens (a few seconds) and stop when it quits; they listen on 127.0.0.1
  only. If the start fails, the screen shows the end of the log with
  **Retry** and **Use a lab server instead**.
  The wizard signs UPb Studio in with that account.
- **Lab server**: the URL of the lab's laicpmsdb (e.g.
  `https://laicpmsdb.example.edu`); then sign in with **Sign in** in the tab
  bar.

## Signing in

UPb Studio signs in to laicpmsdb once, with **Sign in** at the right of the
tab bar: a user name and password, or **Sign in with ORCID** / **with
Google** when the server offers them (your web browser opens, and returns to
UPb Studio through a `laicpmsdb://auth/callback` link). The Sessions and
Images tabs and UPbRPy Studio use that sign-in; the button then shows your
name, and clicking it shows the account and **Sign out**. The token is kept
in the system keychain, one entry per server under `edu.umn.upbstudio`
(macOS: Keychain Access, kind "application password"; Windows: Credential
Manager → Windows Credentials), never in `settings.json`; the local instance's
entry is named `this-computer`. Signing out revokes it on the server and
removes the entry. A development build re-signed by each `cargo build` may
make macOS ask once to allow keychain access.

## Reducing a session in UPbRPy Studio

**Reduce** on Home (or *Reduce in UPbRPy Studio* in the Sessions tab) opens
the session in UPbRPy Studio in database mode: UPb Studio asks laicpmsdb for a
one-time, five-minute code with your sign-in and launches Studio with
`upbr://session/<id>?server=<server>&code=<code>` (docs/WORKFLOW.md section 4).
A `upbr://` link clicked elsewhere (an email, a notebook) arrives the same way.

| How Studio is found | Launch command |
| --- | --- |
| Settings → UPbRPy Studio → Path, a macOS `.app` | `open -n -a "<path>" --args --open "<link>"` |
| Settings path, a Windows `.exe` | `"<path>" --open "<link>"` |
| macOS: `/Applications` or `~/Applications/UPbRPy Studio.app` | `open -n -a "<path>" --args --open "<link>"` |
| macOS: elsewhere, registered as `org.upbrpy.studio` | `open -n -b org.upbrpy.studio --args --open "<link>"` |
| Windows: the registry (App Paths, Studio's uninstall entry, its `upbr` handler), `%LOCALAPPDATA%\Programs\UPbRPy Studio\`, `%ProgramFiles%\UPbRPy Studio\` | `"<exe>" --open "<link>"` |
| Development: Settings → UPbRPy checkout | `<checkout>/.venv/bin/python -m GUI --open "<link>"` (Windows `.venv\Scripts\pythonw.exe`), in the checkout |

Home, Settings and the Reduce tab show whether Studio was found and the
command; `upbstudio.log` records each launch with the code replaced by `…`.
Without Studio, the Reduce tab shows how to install it and the link to open
in Studio by hand. Both UPb Studio and UPbRPy Studio register `upbr://`;
whichever the system picks, the link works (Studio alone asks you to sign in).

Release builds include "This computer" only once laicpmsdb publishes its
service bundle (`docs/service-bundle-contract.md`); until then the option is
greyed out and the log says so at start-up.

On Windows, run UPb Studio as your normal user, not with *Run as
administrator*: PostgreSQL refuses to start under an administrator token.

## Where things are

| What | macOS | Windows |
| --- | --- | --- |
| Settings (`settings.json`: mode, server URL, data root, paths) | `~/Library/Application Support/edu.umn.upbstudio/` | `%APPDATA%\edu.umn.upbstudio\` |
| Generated database passwords and secret key (`local-service.json`) | same folder as settings | same folder as settings |
| PostgreSQL data directory (This computer) | `~/Library/Application Support/edu.umn.upbstudio/laicpmsdb/pg/` | `%LOCALAPPDATA%\edu.umn.upbstudio\laicpmsdb\pg\` |
| Unpacked PostgreSQL binaries | `…/laicpmsdb/postgresql/<version>/` next to `pg/` | same, under `%LOCALAPPDATA%` |
| laicpmsdb data root (raw files, attachments, exports) | `~/laicpmsdb` unless changed in the wizard or Settings | `%USERPROFILE%\laicpmsdb` unless changed |
| Logs | `~/Library/Logs/edu.umn.upbstudio/` | `%LOCALAPPDATA%\edu.umn.upbstudio\logs\` |
| laicpmsdb sign-in token | Keychain, service `edu.umn.upbstudio`, account = server URL or `this-computer` | Credential Manager, `this-computer.edu.umn.upbstudio` or `<server URL>.edu.umn.upbstudio` |

The log folder holds `upbstudio.log` (the shell), `postgres.log` and
`laicpmsdb.log` (This computer mode); Settings → **Logs** shows their ends and
opens the folder. A log over 10 MB is rotated to `.1` when the program starts.

Back up the PostgreSQL data directory and the data root together (with UPb
Studio closed). Deleting `local-service.json` makes the database unreachable,
because its password is lost: move `laicpmsdb/pg` aside to start over.

UPbRPy Studio: if it is not in its usual place, set its path in Settings (see
*Reducing a session* above).

## Building it yourself

See the quick start in the [README](../README.md): `make setup`, then
`make build`. The installers land in `src-tauri/target/release/bundle/`.

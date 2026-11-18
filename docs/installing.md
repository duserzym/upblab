# Installing UPb Lab

Installers are distributed through the [Releases page](https://github.com/duserzym/upblab/releases).
Use the macOS `.dmg` or Windows `.msi` / `-setup.exe` there; if none is listed
yet, follow [Building it yourself](#building-it-yourself). Later versions
install from inside UPb Lab: open the update button in the header or
Settings > Updates, then Check now and Restart to update when ready.

Downloads are not notarized with an Apple Developer ID, and Windows
installers are unsigned. A local macOS build uses the lab’s code-signing
certificate when available; other macOS builds use ad-hoc signing.
Both operating systems warn before the first launch. The steps below are the
expected, one-time way past those warnings; they do not lower security for
other apps.

Manual test builds are also available from the latest successful run of the
[build workflow](../.github/workflows/build.yml) (Actions tab → build → the
run → *Artifacts*): `upbstudio-macos-arm64` holds the `.dmg`,
`upbstudio-windows-x64` holds the `.msi` and the NSIS `-setup.exe`. Each
artifact downloads as a `.zip`; unzip it first.

## macOS (Apple Silicon)

1. Open `UPb Lab_<version>_aarch64.dmg` and drag **UPb Lab** to
   **Applications**.
2. Open UPb Lab from Applications. macOS says it *cannot verify the
   developer* (Gatekeeper). Click **Done** (or **Cancel**).
3. Open **System Settings → Privacy & Security**, scroll to *Security*, and
   click **Open Anyway** next to "UPb Lab was blocked". Confirm with your
   password or Touch ID, then **Open**.

From then on it opens normally. If macOS instead says the app *is damaged and
can't be opened*, the download kept its quarantine flag on a build without the
ad-hoc signature; clear it once in Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/UPb Lab.app"
```

Launch Services learns the `upbdb://`, `grainatlas://` and `upbr://`
links after the first launch from Applications.

## Windows (x86-64)

Use either installer:

- `UPb Lab_<version>_x64_en-US.msi`: per-machine install, needs
  administrator rights.
- `UPb Lab_<version>_x64-setup.exe` (NSIS): per-user install into
  `%LOCALAPPDATA%\Programs`, no administrator rights.

1. Double-click the installer. Microsoft Defender SmartScreen shows
   *Windows protected your PC*.
2. Click **More info**, check that the app is *UPb Lab* and the publisher
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

## Opening files and folders with UPb Lab

UPb Lab opens anything the lab's modules read and decides where it goes
by content, without asking (grainatlas `docs/ux-conventions.md` rule 4): a
TM4000 package, an area folder, image files, a `.grainatlas` folder or a
`.gaproj` file open standalone **GrainAtlas**; a Qtegra export folder, its zip
or its CSVs open the ingest page in
**Sessions**. Inside the app, drop them anywhere on the window or use **Open
folder…** / **Open files…** on Home. **Upload image set** and **Edit in
grainatlas** also open standalone GrainAtlas; on the web, its hosted build
opens in a new tab. Inside UPb Lab, GrainAtlas appears only as Review’s
read-only **SEM images** panel. From the system:

| | macOS | Windows |
| --- | --- | --- |
| A TM4000 `.zag` file (opens its package folder) | Finder → right-click → **Open With → UPb Lab**, or drag it onto the Dock icon | Explorer → right-click → **Open with → UPb Lab** (both installers register `.zag`) |
| A folder (package, area, export, `.grainatlas`) | drag it onto UPb Lab in the Dock (the app declares folders as a document type) | Explorer → right-click the folder → **Open in UPb Lab** (NSIS installer only; `src-tauri/windows/hooks.nsh`) |
| Image files, CSVs, zips | **Open With → Other… → UPb Lab**, or the Dock icon | **Open with → Choose another app → UPb Lab** |

Windows cannot associate a folder by its extension, which is why folders get
the Explorer verb instead; the per-machine MSI does not add it (use the NSIS
installer, or drop the folder on the window). The associations are declared
in `bundle.fileAssociations` in `src-tauri/tauri.conf.json` with the
*Alternate* rank, so UPb Lab never takes over a type another app already
opens by default. macOS learns them on the first launch from Applications,
like the link schemes.

## After installing: the first run

The first launch asks where UPbDB, the Sessions tab, should live. Settings
(gear icon or Ctrl/⌘ ,) changes it later.

- **This computer**: UPb Lab runs its own UPbDB and PostgreSQL 17 on
  this machine. Choose the data root (default `~/upbdb`, the same layout
  as the lab NAS), create your account (user name, email and a password of
  your choice; it is the first administrator of this UPbDB), and
  optionally load the demo sessions. After setup, both programs start when Sessions or Review is opened
  (a few seconds) and stop when UPb Lab quits; they listen on 127.0.0.1
  only. If the start fails, the screen shows the end of the log with
  **Retry** and **Use a lab server instead**.
  The wizard signs UPb Lab in with that account.
- **Lab server**: the URL of the lab's UPbDB (e.g.
  `https://upbdb.example.edu`); select **Continue**, then **Sign in** in the
  tab bar and **Sign in…** in the dialog.

## Signing in

On the desktop, open **Sign in** at the right of the tab bar, then select
**Sign in…**. This single button opens UPbDB’s sign-in page in your browser.
Use ORCID or your lab account; the page may offer other methods enabled by
that server. After signing in, choose **Sign UPb Lab in** and allow the
browser to open UPb Lab. The browser returns through a
`upbdb://auth/callback` link tied to the sign-in started in the app.

Sessions, Review’s SEM images viewer and UPbRPy Studio use that sign-in. The account
button then shows your name; clicking it shows your account and **Sign out**.
The web shell retains its user name and password form, plus the provider
buttons offered by the server.

The token is kept in the system keychain, one entry per server under `edu.umn.upbstudio`
(macOS: Keychain Access, kind "application password"; Windows: Credential
Manager → Windows Credentials), never in `settings.json`; the local instance's
entry is named `this-computer`. Signing out revokes it on the server and
removes the entry. A development build re-signed by each `cargo build` may
make macOS ask once to allow keychain access.

## Outside the lab network

To reach the lab desktop server from outside the lab network, install
[Tailscale](https://tailscale.com/download) and ask the lab manager to share
the lab server with you. Connect Tailscale, then enter the address they give
you under **Lab server**. If the server cannot be reached, check Tailscale
and the server address before trying to sign in again.

## Reducing a session in UPbRPy Studio

**Reduce** on Home (or *Reduce in UPbRPy Studio* in the Sessions tab) opens
the session in UPbRPy Studio in database mode: UPb Lab asks UPbDB for a
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
in Studio by hand. Both UPb Lab and UPbRPy Studio register `upbr://`;
whichever the system picks, the link works (Studio alone asks you to sign in).

Release builds include "This computer" only once UPbDB publishes its
service bundle (`docs/service-bundle-contract.md`); until then the option is
greyed out and the log says so at start-up.

On Windows, run UPb Lab as your normal user, not with *Run as
administrator*: PostgreSQL refuses to start under an administrator token.

## Where things are

| What | macOS | Windows |
| --- | --- | --- |
| Settings (`settings.json`: mode, server URL, data root, paths) | `~/Library/Application Support/edu.umn.upbstudio/` | `%APPDATA%\edu.umn.upbstudio\` |
| Generated database passwords and secret key (`local-service.json`) | same folder as settings | same folder as settings |
| Window size and position (`window.json`; Settings → Reset layout forgets it) | same folder as settings | same folder as settings |
| PostgreSQL data directory (This computer) | `~/Library/Application Support/edu.umn.upbstudio/upbdb/pg/` | `%LOCALAPPDATA%\edu.umn.upbstudio\upbdb\pg\` |
| Unpacked PostgreSQL binaries | `…/upbdb/postgresql/<version>/` next to `pg/` | same, under `%LOCALAPPDATA%` |
| UPbDB data root (raw files, attachments, exports) | `~/upbdb` unless changed in the wizard or Settings | `%USERPROFILE%\upbdb` unless changed |
| Logs | `~/Library/Logs/edu.umn.upbstudio/` | `%LOCALAPPDATA%\edu.umn.upbstudio\logs\` |
| UPbDB sign-in token | Keychain, service `edu.umn.upbstudio`, account = server URL or `this-computer` | Credential Manager, `this-computer.edu.umn.upbstudio` or `<server URL>.edu.umn.upbstudio` |

The log folder holds `upbstudio.log` (the shell), `postgres.log` and
`upbdb.log` (This computer mode); Settings → **Logs** shows their ends and
opens the folder. A log over 10 MB is rotated to `.1` when the program starts.

Back up the PostgreSQL data directory and the data root together (with UPb Lab closed). Deleting `local-service.json` makes the database unreachable,
because its password is lost: move `upbdb/pg` aside to start over.

UPbRPy Studio: if it is not in its usual place, set its path in Settings (see
*Reducing a session* above).

## Building it yourself

See the quick start in [Developing UPb Lab](developing.md#quick-start):
`make setup`, then `make build`. The command prints the installer directory.
Local macOS builds use a shared release target; other builds use
`src-tauri/target/release/bundle/` ([build details](testing.md#release-build)).

## When the server is down

The desktop app keeps a copy of server JSON you viewed, separated by server
and account. Home and Review show those saved sessions, stored results and
mount information when the server cannot answer. A small bar gives the oldest
saved time currently shown, in local time, and retries while the window is
visible. Your stored sign-in and account name remain available. Sessions and
People & access need UPbDB's own page, so they show an inline note while down.
Atlas images still need their server files; the saved copy covers JSON, not
image tiles or raw files. Results and depth profiles you never viewed may be
unavailable offline; recent-session saving includes results, not depth profiles.

After a live Home load, UPb Lab saves reads for the 20 newest sessions and
20 newest mounts in the background, plus the last Review scope, at most once
per 10 minutes. Settings → Saved on this computer shows the size and dates,
**Save recent data now**, and **Forget saved data**. Signing out or a revoked
sign-in removes that server/account's saved copy. The copy is limited to
1 GB, with individual bodies above 64 MB skipped and least recently used
entries removed first. The token stays in the system keychain.

Home also lists local LA-ICP-MS bundles from `~/UPbRPy/sessions/` (or
`UPBRPY_SESSION_CACHE`). **Open in UPbRPy Studio** opens the bundle directly,
without the server. Matching server sessions carry a **Local copy** mark.
Only manifest headers and acquisition counts are read; raw files are not read.
Up to 500 folders are listed; superseded copies and external symlinks are skipped.

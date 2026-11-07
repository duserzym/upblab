# ADR-0003: UPb Lab starts a local laicpmsdb service ("This computer" mode)

**Status:** accepted, 2026-11-03.

## Context

A release of the lab workflow must be a double-click application. Today the
shell assumes a laicpmsdb server is already running at a URL, and running one
means `make db-start && make dev` in a checkout with PostgreSQL 17, Python,
Node and a sibling UPbRPy clone. That is fine for development and for the lab
server, and unusable for a visitor's laptop or an instrument PC.

laicpmsdb cannot be reduced to a static build: it is a Django service over
PostgreSQL, and the schema relies on `jsonb`, materialised views, full-text
search and row-level security, so SQLite is not an option (laicpmsdb plan,
section 4.4). grainatlas needs nothing: its web build runs inside the shell,
and UPbRPy Studio is launched, not embedded (ADR-0001 of this repository).

## Decision

UPb Lab gets two ways to reach laicpmsdb, chosen on first run and
changeable in Settings:

- **Lab server**: a URL, as today.
- **This computer**: the shell owns the life cycle of a laicpmsdb instance
  on the local machine. It ships the service and a PostgreSQL 17 as bundled
  resources, starts both when the app opens, and stops both when it quits.

### What is bundled

| Piece | Source | Where it comes from at build time |
| --- | --- | --- |
| PostgreSQL 17 | portable binaries through the `postgresql_embedded` crate (theseus-rs builds; macOS arm64 and Windows x86-64), `bundled` feature so no download happens at run time | pinned version in `src-tauri/Cargo.toml` |
| laicpmsdb service | a relocatable Python 3.12 runtime (python-build-standalone) with the `laicpmsdb` wheel, UPbRPy and all dependencies installed, plus the `ui/dist` build the service serves at `/app/` | laicpmsdb's CI publishes `laicpmsdb-service-<version>-<os>-<arch>.tar.gz` with a SHA-256; `modules.lock.json` pins it like the grainatlas web build and `scripts/fetch-modules.mjs` unpacks it into `src-tauri/resources/laicpmsdb/` |

The whole installer is expected to grow by roughly 150 to 200 MB (pyarrow and
PostgreSQL account for most of it). That is accepted for a scientific desktop
application.

### Life cycle

1. On launch in "This computer" mode the shell ensures the PostgreSQL data
   directory exists under the app data folder (`initdb` on first run, UTF-8,
   a `laicpmsdb` role with a generated password kept in the Tauri store),
   starts PostgreSQL bound to `127.0.0.1` on a free port, then starts the
   service with `laicpmsdb serve` bound to `127.0.0.1` on a free port
   (8000 when free), passing `DATABASE_URL`, `LAICPMSDB_DATA_ROOT` and the
   secret key through the environment.
2. `laicpmsdb serve` runs `migrate` first, then serves with a production
   server that works on both operating systems (waitress; uvicorn is the
   alternative), and exposes `GET /v1/health`. The shell waits for the
   health check (up to 60 s, with the log tail shown on failure) and only
   then points the Sessions tab at the local URL.
3. On quit the shell stops the service, then PostgreSQL (`pg_ctl stop -m
   fast`). Children are tied to the shell process (a job object on Windows,
   process group plus SIGTERM then SIGKILL on macOS) so a crashed shell
   leaves no orphan; on the next start a stale `postmaster.pid` is handled
   by `pg_ctl` before `start`.
4. Logs go next to the shell's own log (`docs/installing.md`), one file each
   for PostgreSQL and the service.
5. On an update that carries a new service version the shell runs the
   migrations again (forward only). PostgreSQL stays on major version 17; a
   future major upgrade is an explicit `pg_upgrade` step and is out of scope.

### First run

A short wizard: choose the mode; in "This computer" mode choose the data
root (default `~/laicpmsdb`, the same layout the NAS uses), create the first
staff account with a password of the user's choice, and optionally load the
demo sessions. Release builds never create the development demo accounts
unless the user asks for the demo data.

### Headless use of the same bundle

The service bundle is also a plain command-line install: `laicpmsdb serve`
with an external `DATABASE_URL` is what the lab server runs under systemd or
compose. One artifact serves both the desktop and the server.

### UPbRPy Studio

The bundled Python runtime already carries UPbRPy (laicpmsdb depends on it),
so Studio's PySide6 front end could be installed into the same runtime and
the Reduce tab could launch it from there instead of looking for a separate
install. That adds about 200 MB. It is left as an opt-in build flavour and
is not part of this decision.

## Alternatives rejected

- **Docker Desktop**: needs an administrator install and a running daemon;
  not a double-click experience, and not allowed on some instrument PCs.
- **A separate "laicpmsdb Server" application** the user starts first: two
  installs and a sequence to remember. The headless bundle above covers the
  lab-server case without it.
- **PyInstaller or PyOxidizer one-file executable**: slow start-up from
  temporary extraction, fragile with Django's app discovery and pyarrow's
  native libraries; a relocatable runtime folder is simpler to debug.
- **Rewriting the service in Rust** so the shell needs no Python: far more
  work than the whole shell, and laicpmsdb's plan already keeps Python for
  the service.
- **SQLite for the desktop**: ruled out by the schema (see Context).

## Consequences

- laicpmsdb must add: the `laicpmsdb serve` entry point (migrate, then
  serve), `GET /v1/health`, a non-interactive `laicpmsdb bootstrap` that
  creates the first staff account from arguments, loopback binding by
  default, and a CI job that builds and publishes the per-OS service bundle
  with its SHA-256.
- The shell must add: the `postgresql_embedded` dependency and bundled
  binaries, the process supervisor, the first-run wizard, the Settings
  switch between modes, a second entry in `modules.lock.json`, and the
  install documentation for the data location and logs.
- Roadmap: this is phase 2b in `ARCHITECTURE_PLAN.md`, between the bridge
  work and identity, because a release without it is not usable outside the
  lab network.
- Verification: on a clean macOS and a clean Windows machine, install,
  double-click, and see the Sessions tab with demo data in under 30 s; quit
  and relaunch keeps the data; after a forced kill of the shell no
  `postgres` process survives and the next launch succeeds.

## Implementation notes (2026-11-03)

The shell side is in `src-tauri/src/local_service/`; the interface laicpmsdb
implements is [docs/service-bundle-contract.md](../service-bundle-contract.md).
Where it differs from the text above: the bundle is unpacked into
`src-tauri/resources/laicpmsdb-service/` and pinned per platform; the
postmaster runs as a direct child of the shell (not daemonised by
`pg_ctl start`) so the process group and job object cover it, with
`pg_ctl stop -m fast` to stop it; PostgreSQL prefers port 55432 so a
developer's own cluster on 5432 is never touched; the database lives in the
*local* app data folder (`%LOCALAPPDATA%` on Windows, not the roaming one);
on macOS a watchdog copy of the shell binary stops the children after a
forced kill, since macOS has no equivalent of a job object.


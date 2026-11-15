# UPbDB service bundle contract

**Status:** v1, 2026-11-03. Implements ADR-0003 ("This computer" mode) and
`ARCHITECTURE_PLAN.md` decision 9. The UPbDB repository builds the bundle;
UPb Lab (this repository) runs it. Both sides follow this page; change it
here first and bump the version line.

UPb Lab already implements its side, including a development fallback that
runs a UPbDB checkout until the bundle exists (last section).

## 1. Bundle layout

One folder per operating system, named `upbdb-service/`:

```text
upbdb-service/
  VERSION                 one line: the UPbDB version, e.g. 0.4.0 (no "v")
  python/                 relocatable CPython 3.12 from python-build-standalone
    bin/python3           interpreter on macOS
    python.exe            interpreter on Windows
    lib/python3.12/site-packages/   (macOS)  or  Lib/site-packages/  (Windows)
      upbdb_service/  the Django project package, with __main__.py
      apps/, ingest/      the rest of UPbDB
      upbrpy/ ...         UPbRPy and every other dependency, installed
  ui/                     optional: the built Svelte UI, if not inside the package
```

- The runtime is relocatable: it works from any folder, including paths with
  spaces and non-ASCII characters (`C:/Users/Zoë Smith/AppData/...`,
  `/Applications/UPb Lab.app/Contents/Resources/...`). No absolute paths
  of the build machine may remain in scripts, `.pth` files or `sysconfig`.
- The bundle is read-only at run time. Nothing is written inside it
  (`PYTHONDONTWRITEBYTECODE` is set by the shell; ship precompiled `.pyc`
  if start-up time needs it). Writable state lives in the database and the
  data root only.
- The built UI that `/app/` serves is part of the bundle; the service finds
  it relative to its own package, not through the repository layout.
- macOS: every Mach-O file must keep a valid ad-hoc signature after
  relocation (python-build-standalone's are), so Gatekeeper and the hardened
  runtime of a signed UPb Lab accept them.

UPb Lab ships the folder as a Tauri resource at
`<resources>/upbdb-service/` (`Contents/Resources/upbdb-service/` in
the macOS app, next to `upbstudio.exe` on Windows).

## 2. Commands

The shell runs `<python> -m upbdb_service <command> [options]` with the
working directory set to the data root and the environment from section 3.
`<python>` is `python/bin/python3` (macOS) or `python/python.exe` (Windows).
Arguments never carry secrets.

| Command | Does | Exit status |
| --- | --- | --- |
| `serve --host 127.0.0.1 --port N` | runs the migrations (`migrate --no-input`, forward only), then serves `/v1/`, `/app/` and `/admin/` (with its static files) on `host:port` with a production WSGI server that works on both OS (waitress). Runs in the foreground until SIGTERM (macOS) or process termination (Windows); finishes the request in flight and exits 0 on SIGTERM. Refuses a host other than a loopback address unless `--allow-remote` is given (headless lab-server use). | 0 after SIGTERM; non-zero if migrations fail or the port is taken, with the reason on stderr |
| `bootstrap --username U --password-file F --email E` | creates the first account as lab staff (`is_lab_staff`), Django staff and superuser, with the password read from file `F` (UTF-8, one line, trailing newline stripped; the file is the shell's, the command must not delete it). Does nothing if any account already exists. Runs the migrations first if needed. Password validators apply; a refused password is an error. | 0 when created **or** when an account already existed (prints which); non-zero on a refused password or other error, reason on stderr |
| `load-demo` | the demo data set (`manage.py load_demo` today), idempotent. Creates the documented throwaway demo accounts; the shell only runs it when the user ticks "Load demo data". | 0 on success |
| `--version` | prints the version from `VERSION` | 0 |

The commands must also be usable headless on the lab server (`serve
--allow-remote` behind a reverse proxy, with an external `DATABASE_URL`).

## 3. Environment set by the shell

| Variable | Value in "This computer" mode |
| --- | --- |
| `DATABASE_URL` | `postgres://upbdb:<generated>@127.0.0.1:<pg port>/upbdb` (the shell's own PostgreSQL 17; role `upbdb` has `LOGIN CREATEDB CREATEROLE` and owns database `upbdb`, as in UPbDB's `make db-start`) |
| `UPBDB_DATA_ROOT` | the data root chosen in the first-run wizard, default `~/upbdb` expanded, forward slashes |
| `DJANGO_SECRET_KEY` | 64 random hex characters, generated once per installation and kept in the shell's store |
| `DJANGO_DEBUG` | `0` |
| `DJANGO_ALLOWED_HOSTS` | `127.0.0.1,localhost` |
| `UPBDB_CORS_ORIGINS` | `tauri://localhost,http://tauri.localhost` |
| `UPBDB_REGISTRATION` | `closed` (one person's machine; the wizard creates the account) |
| `PYTHONDONTWRITEBYTECODE` | `1` |
| `PYTHONUNBUFFERED` | `1` (log lines reach `upbdb.log` as they happen) |
| `PYTHONUTF8` | `1` (UTF-8 I/O on Windows whatever the code page) |

The service must take every setting from the environment and must not read a
`.env` file when `DATABASE_URL` is already set (the bundle has no repository
around it; the development fallback below has one, and the variables above
take precedence there because `load_dotenv` does not override).

stdout and stderr go to `upbdb.log` in the shell's log folder; write
logs there, not to files of your own.

## 4. Health

`GET http://127.0.0.1:N/v1/health` answers, without authentication:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"status": "ok", "version": "0.4.0", "database": "ok"}
```

- `version` equals `VERSION`.
- `database` is `ok` after a successful `SELECT 1` and the migrations are
  applied; otherwise answer 503 with `"status": "starting"` or
  `"status": "error"` and a `"detail"` string.
- The shell polls every 500 ms for up to 60 s after starting `serve` and
  points the Sessions tab at `http://127.0.0.1:N/app/` only after a 200 whose
  body has `"status": "ok"`.

## 5. Release asset and pinning

- UPbDB's CI publishes, per release, one archive per platform:
  `upbdb-service-<version>-macos-arm64.tar.gz` and
  `upbdb-service-<version>-windows-x64.tar.gz`, each with
  `<archive>.sha256` beside it (`<hex>  <filename>`). The archive holds the
  `upbdb-service/` folder at its top level.
- UPb Lab pins it as the `upbdb-service` entry in `modules.lock.json`
  with one `url` and `sha256` per platform (`platforms.macos-arm64`,
  `platforms.windows-x64`); `scripts/fetch-modules.mjs` downloads the one for
  the build machine, checks the SHA-256 and unpacks it into
  `src-tauri/resources/upbdb-service/`. A build without it is a "Lab
  server only" build and says so in its log.

## 6. Life cycle (what the shell does)

1. Start PostgreSQL (bundled 17.x, `127.0.0.1`, a free port, no Unix socket),
   ensure role and database.
2. Run `serve` on port 8000 if free, else the next free port up to 8099,
   else any free port.
3. Poll health (section 4). On failure, show the tail of `upbdb.log`.
4. First run only: `bootstrap`, then `load-demo` if asked.
5. On quit: stop `serve` (SIGTERM, SIGKILL after 5 s; on Windows the process
   is terminated), then PostgreSQL (`pg_ctl stop -m fast`). If the shell
   itself is killed, a watchdog (macOS) or job object (Windows) does the same.

## 7. Development fallback (until the bundle exists)

When no bundle is in the resources folder, the shell runs a UPbDB
checkout configured in Settings ("UPbDB checkout", default `../upbdb`
next to the UPb Lab checkout in development builds). It needs
`.venv/bin/python` (Windows `.venv/Scripts/python.exe`) and
`service/manage.py`, i.e. `make venv` and `make ui` done in that checkout.
The working directory is `<checkout>/service` and the mapping is:

| Contract | Development fallback |
| --- | --- |
| `serve --host 127.0.0.1 --port N` | `manage.py migrate --no-input`, then `manage.py runserver 127.0.0.1:N --noreload` |
| `bootstrap --username U --password-file F --email E` | `manage.py createsuperuser --no-input` with `DJANGO_SUPERUSER_USERNAME`, `DJANGO_SUPERUSER_EMAIL` and `DJANGO_SUPERUSER_PASSWORD` in the environment (the password is read from the same temporary file by the shell, never put in argv); "That username is already taken" counts as success |
| `load-demo` | `manage.py load_demo` |
| health `GET /v1/health` | `GET /v1/docs` returning 200 |

Differences to keep in mind: `runserver` with `DJANGO_DEBUG=0` does not serve
`/admin/` static files, and `createsuperuser` does not set `is_lab_staff`
(a superuser already sees everything under the sharing rule).

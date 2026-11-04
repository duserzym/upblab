//! The local PostgreSQL 17 (ADR-0003, life cycle 1 and 3).
//!
//! Binaries: the theseus-rs build embedded by `postgresql_embedded`'s
//! `bundled` feature, unpacked once into `<app local data>/laicpmsdb/postgresql/<version>/`.
//! A `PG_BIN` override (environment, or Settings) points at another
//! PostgreSQL 17 `bin` folder instead, e.g. Homebrew's
//! `/opt/homebrew/opt/postgresql@17/bin`, for development.
//!
//! The crate is used only to install the binaries; initdb, start and stop are
//! done here so the cluster gets a C locale, TCP on 127.0.0.1 only, no Unix
//! socket, and a postmaster that is our direct child (process group on
//! macOS, job object on Windows) rather than one daemonised by `pg_ctl start`.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use super::pidfile::{assess_postmaster, PostmasterState};
use super::process::{self, OsProbe};

pub const SUPERUSER: &str = "postgres";
pub const ROLE: &str = "laicpmsdb";
pub const DATABASE: &str = "laicpmsdb";
/// Data directories of another major version need pg_upgrade (out of scope).
pub const MAJOR: &str = "17";

#[derive(Debug, Clone)]
pub struct Binaries {
    pub bin_dir: PathBuf,
    /// "bundled 17.11.0" or "PG_BIN /opt/homebrew/…".
    pub source: String,
}

pub fn exe(bin_dir: &Path, name: &str) -> PathBuf {
    bin_dir.join(if cfg!(windows) { format!("{name}.exe") } else { name.to_string() })
}

/// The PostgreSQL version embedded at build time (POSTGRESQL_VERSION in
/// src-tauri/.cargo/config.toml).
pub fn bundled_version() -> &'static str {
    option_env!("POSTGRESQL_VERSION").map(|v| v.trim_start_matches('=')).unwrap_or("17")
}

/// Environment for every PostgreSQL program: a fixed C locale (macOS's
/// postmaster refuses to start with some LANG values unless LC_ALL is set)
/// and no stray PG* variables from the user's shell.
fn pg_command(bin_dir: &Path, name: &str) -> Command {
    let mut cmd = process::command(exe(bin_dir, name));
    for (k, _) in std::env::vars_os() {
        if k.to_string_lossy().starts_with("PG") {
            cmd.env_remove(k);
        }
    }
    cmd.env("LC_ALL", "C").env("LANG", "C");
    cmd
}

/// Does `postgres --version` output name major version 17? Builds append
/// their own suffix: "postgres (PostgreSQL) 17.11 (Homebrew)".
fn is_major(version_output: &str) -> bool {
    version_output.split_whitespace().any(|w| w == MAJOR || w.starts_with(&format!("{MAJOR}.")))
}

/// Find or install the binaries. `override_dir` (PG_BIN) wins.
pub async fn ensure_binaries(install_root: &Path, override_dir: Option<&Path>) -> Result<Binaries, String> {
    if let Some(dir) = override_dir {
        let postgres = exe(dir, "postgres");
        if !postgres.is_file() {
            return Err(format!("PG_BIN {} has no {}", dir.display(), postgres.display()));
        }
        let out = Command::new(&postgres).arg("--version").output().map_err(|e| e.to_string())?;
        let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !is_major(&v) {
            return Err(format!("PG_BIN must be PostgreSQL {MAJOR}, {} says {v:?}", postgres.display()));
        }
        return Ok(Binaries { bin_dir: dir.to_path_buf(), source: format!("PG_BIN {}", dir.display()) });
    }

    // postgresql_embedded's setup() installs, then runs its own initdb unless
    // `data_dir/postgresql.conf` exists. We want only the install, so point it
    // at a marker folder that looks initialised.
    let marker = install_root.join(".install-only");
    std::fs::create_dir_all(&marker).map_err(|e| format!("{}: {e}", marker.display()))?;
    let conf = marker.join("postgresql.conf");
    if !conf.exists() {
        std::fs::write(&conf, "# marker: lets postgresql_embedded install without initdb\n")
            .map_err(|e| e.to_string())?;
    }
    let settings = postgresql_embedded::Settings {
        installation_dir: install_root.to_path_buf(),
        data_dir: marker.clone(),
        password_file: marker.join("unused.pwfile"),
        temporary: false,
        host: "127.0.0.1".into(),
        ..postgresql_embedded::Settings::default()
    };
    let mut pg = postgresql_embedded::PostgreSQL::new(settings);
    pg.setup().await.map_err(|e| format!("could not unpack the bundled PostgreSQL: {e}"))?;
    let bin_dir = pg.settings().binary_dir();
    if !exe(&bin_dir, "postgres").is_file() {
        return Err(format!("bundled PostgreSQL missing at {}", bin_dir.display()));
    }
    Ok(Binaries { bin_dir, source: format!("bundled {}", bundled_version()) })
}

fn run(cmd: &mut Command, what: &str, log: &Path) -> Result<(), String> {
    process::log_to(cmd, log).map_err(|e| format!("{}: {e}", log.display()))?;
    let status = cmd.status().map_err(|e| format!("could not run {what}: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{what} failed ({status}); see postgres.log"))
    }
}

/// A file only this user can read, for passwords handed to a child.
pub fn write_secret_file(path: &Path, secret: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path)?;
    f.write_all(secret.as_bytes())?;
    f.write_all(b"\n")
}

/// `initdb` once: UTF-8, C locale, SCRAM passwords, superuser `postgres`.
/// Runs into `<data>.initdb` and renames on success, so a failed or
/// interrupted initdb never leaves a half-made data directory behind.
pub fn ensure_initialised(bins: &Binaries, data_dir: &Path, superuser_password: &str, log: &Path) -> Result<bool, String> {
    let version_file = data_dir.join("PG_VERSION");
    if version_file.exists() {
        let v = std::fs::read_to_string(&version_file).unwrap_or_default();
        if v.trim() != MAJOR {
            return Err(format!(
                "{} holds a PostgreSQL {} cluster; UPb Studio runs {MAJOR}. Upgrading needs pg_upgrade.",
                data_dir.display(),
                v.trim()
            ));
        }
        return Ok(false);
    }
    let parent = data_dir.parent().ok_or("data directory has no parent")?;
    std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    let staging = data_dir.with_extension("initdb");
    let _ = std::fs::remove_dir_all(&staging);
    let pwfile = parent.join(".initdb-pw");
    write_secret_file(&pwfile, superuser_password).map_err(|e| e.to_string())?;
    let mut cmd = pg_command(&bins.bin_dir, "initdb");
    cmd.arg("-D")
        .arg(&staging)
        .args(["-U", SUPERUSER, "-A", "scram-sha-256", "-E", "UTF8", "--locale=C", "--pwfile"])
        .arg(&pwfile);
    let result = run(&mut cmd, "initdb", log);
    let _ = std::fs::remove_file(&pwfile);
    result?;
    std::fs::rename(&staging, data_dir).map_err(|e| format!("could not move the new cluster into place: {e}"))?;
    Ok(true)
}

/// Deal with `postmaster.pid` before a start: stop an orphaned postmaster of
/// this data directory (left by a crashed shell whose guard did not run),
/// remove a stale file. Returns a line for the log.
pub fn clear_previous(bins: &Binaries, data_dir: &Path, log: &Path) -> Option<String> {
    let pid_path = data_dir.join("postmaster.pid");
    let text = std::fs::read_to_string(&pid_path).ok();
    match assess_postmaster(text.as_deref(), data_dir, &OsProbe) {
        PostmasterState::Absent => None,
        PostmasterState::Stale => {
            let _ = std::fs::remove_file(&pid_path);
            Some(format!("removed a stale {}", pid_path.display()))
        }
        PostmasterState::Orphan { pid } => {
            let mut cmd = pg_command(&bins.bin_dir, "pg_ctl");
            cmd.args(["stop", "-m", "fast", "-w", "-t", "30", "-D"]).arg(data_dir);
            if run(&mut cmd, "pg_ctl stop", log).is_err() && process::pid_alive(pid) {
                process::kill_pid(pid);
                std::thread::sleep(Duration::from_millis(500));
                let _ = std::fs::remove_file(&pid_path);
            }
            Some(format!("stopped PostgreSQL pid {pid} left running by a previous UPb Studio"))
        }
    }
}

/// Start the postmaster as our child, TCP on 127.0.0.1:`port` only.
pub fn start(bins: &Binaries, data_dir: &Path, port: u16, log: &Path) -> Result<Child, String> {
    let mut cmd = pg_command(&bins.bin_dir, "postgres");
    cmd.arg("-D")
        .arg(data_dir)
        .arg("-p")
        .arg(port.to_string())
        .args(["-c", "listen_addresses=127.0.0.1", "-c", "unix_socket_directories=", "-c", "logging_collector=off"]);
    process::log_to(&mut cmd, log).map_err(|e| e.to_string())?;
    process::spawn(&mut cmd).map_err(|e| format!("could not start PostgreSQL: {e}"))
}

/// Wait until the server accepts connections (`pg_isready`), failing early
/// if the postmaster exits or `cancelled` turns true.
pub fn wait_ready(
    bins: &Binaries,
    port: u16,
    child: &mut Child,
    timeout: Duration,
    cancelled: &dyn Fn() -> bool,
) -> Result<(), String> {
    let until = Instant::now() + timeout;
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("PostgreSQL exited during start-up ({status}); see postgres.log"));
        }
        let ok = pg_command(&bins.bin_dir, "pg_isready")
            .args(["-q", "-h", "127.0.0.1", "-p", &port.to_string(), "-t", "2"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            return Ok(());
        }
        if cancelled() {
            return Err("cancelled".into());
        }
        if Instant::now() > until {
            return Err(format!("PostgreSQL did not accept connections within {} s", timeout.as_secs()));
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

/// SQL that creates role and database if missing and (re)sets the role's
/// password. Fed to psql on stdin, never on the command line.
pub fn bootstrap_sql(role_password: &str) -> String {
    let pw = role_password.replace('\'', "''");
    format!(
        "SET client_min_messages = warning;\n\
         DO $$ BEGIN\n\
           IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{ROLE}') THEN\n\
             CREATE ROLE {ROLE} LOGIN CREATEDB CREATEROLE;\n\
           END IF;\n\
         END $$;\n\
         ALTER ROLE {ROLE} WITH LOGIN CREATEDB CREATEROLE PASSWORD '{pw}';\n\
         SELECT 'CREATE DATABASE {DATABASE} OWNER {ROLE} ENCODING ''UTF8'' TEMPLATE template0'\n\
           WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '{DATABASE}')\\gexec\n"
    )
}

pub fn ensure_database(bins: &Binaries, port: u16, superuser_password: &str, role_password: &str, log: &Path) -> Result<(), String> {
    use std::io::Write;
    let mut cmd = pg_command(&bins.bin_dir, "psql");
    cmd.args(["-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", &port.to_string(), "-U", SUPERUSER, "-d", "postgres", "-f", "-"])
        .env("PGPASSWORD", superuser_password)
        .stdin(Stdio::piped());
    process::log_to(&mut cmd, log).map_err(|e| e.to_string())?;
    let mut child = cmd.spawn().map_err(|e| format!("could not run psql: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(bootstrap_sql(role_password).as_bytes()).map_err(|e| e.to_string())?;
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("could not create the laicpmsdb role and database ({status}); see postgres.log"))
    }
}

/// `pg_ctl stop -m fast`, then make sure the child is gone.
pub fn stop(bins: &Binaries, data_dir: &Path, child: &mut Child, log: &Path) {
    if matches!(child.try_wait(), Ok(Some(_))) {
        return;
    }
    let mut cmd = pg_command(&bins.bin_dir, "pg_ctl");
    cmd.args(["stop", "-m", "fast", "-w", "-t", "20", "-D"]).arg(data_dir);
    let _ = run(&mut cmd, "pg_ctl stop", log);
    if !process::wait_timeout(child, Duration::from_secs(5)) {
        log::warn!("PostgreSQL did not stop in time; killing it");
        process::terminate(child, Duration::from_secs(2));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sql_quotes_the_password_and_creates_only_when_missing() {
        let sql = bootstrap_sql("a'b");
        assert!(sql.contains("PASSWORD 'a''b'"));
        assert!(sql.contains("IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'laicpmsdb')"));
        assert!(sql.contains("CREATE ROLE laicpmsdb LOGIN CREATEDB CREATEROLE"));
        assert!(sql.contains("WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'laicpmsdb')\\gexec"));
    }

    #[test]
    fn executables_get_the_platform_suffix() {
        let p = exe(Path::new("bin"), "pg_ctl");
        assert_eq!(p.file_name().unwrap().to_string_lossy(), if cfg!(windows) { "pg_ctl.exe" } else { "pg_ctl" });
    }

    #[test]
    fn version_check_accepts_vendor_suffixes() {
        assert!(is_major("postgres (PostgreSQL) 17.11"));
        assert!(is_major("postgres (PostgreSQL) 17.11 (Homebrew)"));
        assert!(is_major("postgres (PostgreSQL) 17.2 (Postgres.app)"));
        assert!(!is_major("postgres (PostgreSQL) 16.4"));
        assert!(!is_major("postgres (PostgreSQL) 170.1"));
    }

    #[test]
    fn bundled_version_is_17() {
        assert!(bundled_version().starts_with("17"), "{}", bundled_version());
    }

    #[cfg(unix)]
    #[test]
    fn secret_files_are_private() {
        use std::os::unix::fs::PermissionsExt;
        let p = std::env::temp_dir().join(format!("upbstudio-secret-{}", std::process::id()));
        write_secret_file(&p, "s3cret").unwrap();
        assert_eq!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "s3cret\n");
        std::fs::remove_file(&p).unwrap();
    }

    /// The real thing with the bundled binaries in a temporary folder:
    /// unpack, initdb, start on a free port, role and database, stop, and a
    /// second start that finds a stale pid file. Slow (unpacks ~100 MB), so
    /// opt-in: `cargo test -- --ignored bundled_cluster`.
    #[test]
    #[ignore]
    fn bundled_cluster_round_trip() {
        let root = std::env::temp_dir().join(format!("upbstudio-pg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let log = root.join("postgres.log");
        let bins = tauri::async_runtime::block_on(ensure_binaries(&root.join("postgresql"), None)).unwrap();
        assert!(bins.source.starts_with("bundled 17"));
        let data = root.join("pg");
        assert!(ensure_initialised(&bins, &data, "su-pw", &log).unwrap());
        assert!(!ensure_initialised(&bins, &data, "su-pw", &log).unwrap(), "second call is a no-op");
        let port = super::super::ports::pick(56000, 56099).unwrap();
        let mut child = start(&bins, &data, port, &log).unwrap();
        wait_ready(&bins, port, &mut child, Duration::from_secs(30), &|| false).unwrap();
        ensure_database(&bins, port, "su-pw", "role-pw", &log).unwrap();
        ensure_database(&bins, port, "su-pw", "role-pw2", &log).unwrap();
        // The role can log in to its database with the new password.
        let ok = pg_command(&bins.bin_dir, "psql")
            .args(["-X", "-tAc", "select current_user", "-h", "127.0.0.1", "-p", &port.to_string(), "-U", ROLE, "-d", DATABASE])
            .env("PGPASSWORD", "role-pw2")
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&ok.stdout).trim(), "laicpmsdb", "{}", String::from_utf8_lossy(&ok.stderr));
        // A running postmaster on this directory is an orphan for the next start.
        assert!(clear_previous(&bins, &data, &log).unwrap().contains("stopped PostgreSQL"));
        let _ = child.wait();
        // Simulate a crash leftover: a pid file whose process is gone.
        std::fs::write(data.join("postmaster.pid"), format!("999999\n{}\n0\n{port}\n", data.display())).unwrap();
        assert!(clear_previous(&bins, &data, &log).unwrap().contains("stale"));
        let mut child = start(&bins, &data, port, &log).unwrap();
        wait_ready(&bins, port, &mut child, Duration::from_secs(30), &|| false).unwrap();
        stop(&bins, &data, &mut child, &log);
        assert!(!data.join("postmaster.pid").exists());
        std::fs::remove_dir_all(&root).unwrap();
    }
}

//! What the pid files in the local database folder say before a start.
//!
//! Two files matter:
//! - `pg/postmaster.pid`, written by PostgreSQL. After a crash or a forced
//!   kill it can be stale (the process is gone, or its PID now belongs to an
//!   unrelated process), or it can belong to a postmaster that outlived a
//!   previous UPb Lab (an orphan to stop before starting again).
//! - `shell.pid`, written by UPb Lab while it owns the database. A live
//!   UPb Lab holding it (a release app and a development build share the
//!   app-data folder) must not have its PostgreSQL stopped by a second one.
//!
//! - `service.pid`, the UPbDB service (leader of its own process group
//!   on macOS). Normally the watchdog or job object stops the service with
//!   the shell; if both were killed, the next start stops the leftover.
//!
//! The decisions are pure functions over the file contents and a process
//! probe, so they are tested without real processes.

use std::path::Path;

/// Ask the OS about a PID. Implemented in `process.rs` for real processes.
pub trait ProcessProbe {
    fn alive(&self, pid: u32) -> bool;
    /// Lower-case executable name of `pid`, if it can be read.
    fn name(&self, pid: u32) -> Option<String>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Postmaster {
    pub pid: u32,
    pub data_dir: String,
    pub port: Option<u16>,
}

/// `postmaster.pid`: line 1 PID, line 2 data directory, line 4 port.
pub fn parse_postmaster(text: &str) -> Option<Postmaster> {
    let mut lines = text.lines();
    let pid = lines.next()?.trim().parse::<u32>().ok().filter(|p| *p > 0)?;
    let data_dir = lines.next()?.trim().to_string();
    let _start = lines.next();
    let port = lines.next().and_then(|l| l.trim().parse::<u16>().ok());
    Some(Postmaster { pid, data_dir, port })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PostmasterState {
    /// No pid file: start normally.
    Absent,
    /// A postmaster for this data directory is still running: stop it
    /// (`pg_ctl stop -m fast`), then start.
    Orphan { pid: u32 },
    /// The pid file is left over (process gone, PID reused by something
    /// else, unreadable file): remove it, then start.
    Stale,
}

fn same_dir(a: &str, b: &Path) -> bool {
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_string();
    let b_str = b.to_string_lossy();
    if norm(a) == norm(&b_str) {
        return true;
    }
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => cfg!(windows) && norm(a).eq_ignore_ascii_case(&norm(&b_str)),
    }
}

fn is_postgres(name: &str) -> bool {
    let n = name.rsplit(['/', '\\']).next().unwrap_or(name);
    n == "postgres" || n == "postgres.exe"
}

pub fn assess_postmaster(text: Option<&str>, data_dir: &Path, probe: &dyn ProcessProbe) -> PostmasterState {
    let Some(text) = text else { return PostmasterState::Absent };
    let Some(pm) = parse_postmaster(text) else { return PostmasterState::Stale };
    if !probe.alive(pm.pid) {
        return PostmasterState::Stale;
    }
    // Alive: only ours if it is a postgres process serving this directory.
    // A PID reused by an unrelated process (or by another cluster's
    // postmaster, such as a developer's own on port 5432) is left alone.
    let postgres = probe.name(pm.pid).is_some_and(|n| is_postgres(&n));
    if postgres && same_dir(&pm.data_dir, data_dir) {
        PostmasterState::Orphan { pid: pm.pid }
    } else {
        PostmasterState::Stale
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OwnerState {
    /// Nobody (or a dead or unrelated process) holds the database.
    Free,
    /// This process already holds it.
    Ours,
    /// Another running UPb Lab holds it.
    Held { pid: u32 },
}

fn is_shell(name: &str) -> bool {
    let n = name.rsplit(['/', '\\']).next().unwrap_or(name);
    n == "upbstudio" || n == "upbstudio.exe"
}

pub fn assess_owner(text: Option<&str>, me: u32, probe: &dyn ProcessProbe) -> OwnerState {
    let Some(pid) = text.and_then(|t| t.trim().parse::<u32>().ok()) else { return OwnerState::Free };
    if pid == me {
        return OwnerState::Ours;
    }
    if probe.alive(pid) && probe.name(pid).is_some_and(|n| is_shell(&n)) {
        OwnerState::Held { pid }
    } else {
        OwnerState::Free
    }
}

/// A service left running by a previous shell: alive and a Python process.
pub fn assess_service(text: Option<&str>, probe: &dyn ProcessProbe) -> Option<u32> {
    let pid = text?.trim().parse::<u32>().ok().filter(|p| *p > 1)?;
    let python = probe.name(pid).is_some_and(|n| {
        let n = n.rsplit(['/', '\\']).next().unwrap_or(&n).to_string();
        n.starts_with("python")
    });
    (probe.alive(pid) && python).then_some(pid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::path::PathBuf;

    #[derive(Default)]
    struct Fake(HashMap<u32, &'static str>);
    impl ProcessProbe for Fake {
        fn alive(&self, pid: u32) -> bool {
            self.0.contains_key(&pid)
        }
        fn name(&self, pid: u32) -> Option<String> {
            self.0.get(&pid).map(|s| s.to_string())
        }
    }
    fn probe(entries: &[(u32, &'static str)]) -> Fake {
        Fake(entries.iter().copied().collect())
    }

    const DIR: &str = "/Users/x/Library/Application Support/edu.umn.upbstudio/upbdb/pg";

    fn pidfile(pid: u32, dir: &str) -> String {
        format!("{pid}\n{dir}\n1762200000\n55432\n\n127.0.0.1\n  1234567  65536\nready   \n")
    }

    #[test]
    fn parses_the_postmaster_pid_file() {
        let pm = parse_postmaster(&pidfile(4242, DIR)).unwrap();
        assert_eq!(pm, Postmaster { pid: 4242, data_dir: DIR.into(), port: Some(55432) });
        assert!(parse_postmaster("").is_none());
        assert!(parse_postmaster("not a pid\n/x\n").is_none());
        assert!(parse_postmaster("0\n/x\n").is_none());
        // A file cut short by a crash still yields the PID and directory.
        assert_eq!(parse_postmaster("17\n/x").unwrap().port, None);
    }

    #[test]
    fn no_pid_file_means_a_clean_start() {
        assert_eq!(assess_postmaster(None, Path::new(DIR), &probe(&[])), PostmasterState::Absent);
    }

    #[test]
    fn dead_pid_is_stale() {
        let text = pidfile(4242, DIR);
        assert_eq!(assess_postmaster(Some(&text), Path::new(DIR), &probe(&[])), PostmasterState::Stale);
    }

    #[test]
    fn garbage_is_stale() {
        assert_eq!(assess_postmaster(Some("\0\0\0"), Path::new(DIR), &probe(&[])), PostmasterState::Stale);
    }

    #[test]
    fn live_postgres_on_this_directory_is_an_orphan() {
        let text = pidfile(4242, DIR);
        let p = probe(&[(4242, "postgres")]);
        assert_eq!(assess_postmaster(Some(&text), Path::new(DIR), &p), PostmasterState::Orphan { pid: 4242 });
        let p = probe(&[(4242, "/opt/homebrew/opt/postgresql@17/bin/postgres")]);
        assert_eq!(assess_postmaster(Some(&text), Path::new(DIR), &p), PostmasterState::Orphan { pid: 4242 });
    }

    #[test]
    fn windows_paths_compare_by_slashes_and_case() {
        let text = pidfile(9, "C:/Users/Zoë/AppData/Local/edu.umn.upbstudio/upbdb/pg");
        let dir = PathBuf::from("c:\\Users\\Zoë\\AppData\\Local\\edu.umn.upbstudio\\upbdb\\pg\\");
        let p = probe(&[(9, "postgres.exe")]);
        let expected = if cfg!(windows) { PostmasterState::Orphan { pid: 9 } } else { PostmasterState::Stale };
        assert_eq!(assess_postmaster(Some(&text), &dir, &p), expected);
        // Same case, different separators: equal everywhere.
        let dir = PathBuf::from("C:\\Users\\Zoë\\AppData\\Local\\edu.umn.upbstudio\\upbdb\\pg");
        assert_eq!(assess_postmaster(Some(&text), &dir, &p), PostmasterState::Orphan { pid: 9 });
    }

    #[test]
    fn reused_pid_is_never_killed() {
        let text = pidfile(4242, DIR);
        // An unrelated process got the PID.
        let p = probe(&[(4242, "Safari")]);
        assert_eq!(assess_postmaster(Some(&text), Path::new(DIR), &p), PostmasterState::Stale);
        // Another cluster's postmaster (e.g. the developer's on 5432) got it.
        let other = pidfile(4242, "/Users/x/upbdb/pg");
        let p = probe(&[(4242, "postgres")]);
        assert_eq!(assess_postmaster(Some(&other), Path::new(DIR), &p), PostmasterState::Stale);
        // Name unknown (no permission): leave it.
        struct NoName;
        impl ProcessProbe for NoName {
            fn alive(&self, _: u32) -> bool {
                true
            }
            fn name(&self, _: u32) -> Option<String> {
                None
            }
        }
        assert_eq!(assess_postmaster(Some(&text), Path::new(DIR), &NoName), PostmasterState::Stale);
    }

    #[test]
    fn owner_lock() {
        assert_eq!(assess_owner(None, 10, &probe(&[])), OwnerState::Free);
        assert_eq!(assess_owner(Some("garbage"), 10, &probe(&[])), OwnerState::Free);
        assert_eq!(assess_owner(Some("10\n"), 10, &probe(&[(10, "upbstudio")])), OwnerState::Ours);
        // A crashed shell: PID gone.
        assert_eq!(assess_owner(Some("11"), 10, &probe(&[])), OwnerState::Free);
        // PID reused by something else.
        assert_eq!(assess_owner(Some("11"), 10, &probe(&[(11, "zsh")])), OwnerState::Free);
        // Another UPb Lab (release app and dev build share the folder).
        assert_eq!(
            assess_owner(Some("11"), 10, &probe(&[(11, "/Applications/UPb Lab.app/Contents/MacOS/upbstudio")])),
            OwnerState::Held { pid: 11 }
        );
        assert_eq!(assess_owner(Some("11"), 10, &probe(&[(11, "upbstudio.exe")])), OwnerState::Held { pid: 11 });
    }

    #[test]
    fn leftover_service() {
        assert_eq!(assess_service(None, &probe(&[])), None);
        assert_eq!(assess_service(Some("42"), &probe(&[])), None, "gone");
        assert_eq!(assess_service(Some("42"), &probe(&[(42, "zsh")])), None, "PID reused");
        assert_eq!(
            assess_service(Some("42"), &probe(&[(42, "/opt/homebrew/cellar/python@3.14/3.14.6/frameworks/python.framework/versions/3.14/resources/python.app/contents/macos/python")])),
            Some(42)
        );
        assert_eq!(assess_service(Some("42\n"), &probe(&[(42, "c:\\app\\upbdb-service\\python\\python.exe")])), Some(42));
        assert_eq!(assess_service(Some("1"), &probe(&[(1, "python")])), None, "never init");
    }
}

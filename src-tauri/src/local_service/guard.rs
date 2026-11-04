//! Watchdog for a killed shell (macOS and other Unix).
//!
//! macOS has no "kill my children when I die" switch. So the shell starts a
//! copy of its own binary with `--local-service-guard`, in a process group of
//! its own, and keeps the write end of the guard's stdin. The shell tells it
//! what to stop (`pg <pid>`, `svc <pgid>`) and what it already stopped
//! (`forget pg`, `forget svc`). When the shell exits for any reason,
//! `kill -9` included, the kernel closes the pipe, the guard reads EOF and
//! stops what is still registered: the service group with SIGTERM then
//! SIGKILL, PostgreSQL with SIGINT (fast shutdown), then SIGQUIT, then
//! SIGKILL. On Windows the job object in `process.rs` does this instead.

pub const GUARD_ARG: &str = "--local-service-guard";

/// Called first thing in `main`: if this process is a guard, run it and exit.
pub fn run_if_requested() {
    let mut args = std::env::args_os().skip(1);
    if args.next().is_some_and(|a| a == GUARD_ARG) {
        #[cfg(unix)]
        unix::run();
        std::process::exit(0);
    }
}

#[cfg(unix)]
pub use unix::Guard;

#[cfg(not(unix))]
pub struct Guard;

#[cfg(not(unix))]
impl Guard {
    pub fn start() -> Option<Self> {
        None
    }
    pub fn watch_postgres(&mut self, _pid: u32) {}
    pub fn watch_service(&mut self, _pgid: u32) {}
    pub fn forget_postgres(&mut self) {}
    pub fn forget_service(&mut self) {}
}

#[cfg(unix)]
mod unix {
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Child, ChildStdin, Command, Stdio};
    use std::time::{Duration, Instant};

    use super::GUARD_ARG;

    pub struct Guard {
        child: Child,
        stdin: ChildStdin,
    }

    impl Guard {
        pub fn start() -> Option<Self> {
            use std::os::unix::process::CommandExt;
            let exe = std::env::current_exe().ok()?;
            let mut child = Command::new(exe)
                .arg(GUARD_ARG)
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .process_group(0)
                .spawn()
                .map_err(|e| log::warn!("could not start the local-service guard: {e}"))
                .ok()?;
            let stdin = child.stdin.take()?;
            Some(Self { child, stdin })
        }

        fn send(&mut self, line: &str) {
            if let Err(e) = writeln!(self.stdin, "{line}").and_then(|_| self.stdin.flush()) {
                log::warn!("local-service guard did not take {line:?}: {e}");
            }
        }

        pub fn watch_postgres(&mut self, pid: u32) {
            self.send(&format!("pg {pid}"));
        }
        pub fn watch_service(&mut self, pgid: u32) {
            self.send(&format!("svc {pgid}"));
        }
        pub fn forget_postgres(&mut self) {
            self.send("forget pg");
        }
        pub fn forget_service(&mut self) {
            self.send("forget svc");
        }
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            // Closing stdin with nothing registered makes the guard exit.
            let _ = self.child.try_wait();
        }
    }

    fn exists(target: libc::pid_t) -> bool {
        unsafe { libc::kill(target, 0) == 0 }
    }

    /// Send `sig` to `target` (a PID, or a negative process group) and wait
    /// up to `wait` for it to go away.
    fn signal_and_wait(target: libc::pid_t, sig: libc::c_int, wait: Duration) -> bool {
        unsafe { libc::kill(target, sig) };
        let until = Instant::now() + wait;
        while Instant::now() < until {
            if !exists(target) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        !exists(target)
    }

    pub fn run() {
        // The shell's Ctrl-C or a hang-up must not stop the guard early.
        unsafe {
            libc::signal(libc::SIGINT, libc::SIG_IGN);
            libc::signal(libc::SIGHUP, libc::SIG_IGN);
        }
        let mut pg: Option<libc::pid_t> = None;
        let mut svc: Option<libc::pid_t> = None;
        let stdin = std::io::stdin();
        for line in BufReader::new(stdin.lock()).lines() {
            let Ok(line) = line else { break };
            let mut parts = line.split_whitespace();
            match (parts.next(), parts.next()) {
                (Some("pg"), Some(n)) => pg = n.parse().ok(),
                (Some("svc"), Some(n)) => svc = n.parse().ok(),
                (Some("forget"), Some("pg")) => pg = None,
                (Some("forget"), Some("svc")) => svc = None,
                _ => {}
            }
        }
        // EOF: the shell is gone. Service first (it holds connections).
        if let Some(pgid) = svc.filter(|p| *p > 1) {
            if !signal_and_wait(-pgid, libc::SIGTERM, Duration::from_secs(5)) {
                signal_and_wait(-pgid, libc::SIGKILL, Duration::from_secs(2));
            }
        }
        if let Some(pid) = pg.filter(|p| *p > 1) {
            if !signal_and_wait(pid, libc::SIGINT, Duration::from_secs(20))
                && !signal_and_wait(pid, libc::SIGQUIT, Duration::from_secs(5))
            {
                signal_and_wait(pid, libc::SIGKILL, Duration::from_secs(2));
            }
        }
    }
}

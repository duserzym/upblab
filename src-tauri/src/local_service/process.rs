//! Child processes that must not outlive the shell (ADR-0003, life cycle 3).
//!
//! - Every child gets its own process group on macOS, so a Ctrl-C in the
//!   terminal of `cargo tauri dev` reaches only the shell, and stopping the
//!   service signals its whole group. A watchdog process (`guard.rs`) stops
//!   them if the shell is killed.
//! - On Windows every child is assigned to a job object with
//!   KILL_ON_JOB_CLOSE: the job handle closes when the shell exits for any
//!   reason, including TerminateProcess, and Windows kills the children.
//!   Children are started without a console window (CREATE_NO_WINDOW).

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use super::pidfile::ProcessProbe;

/// A command whose child gets its own process group (Unix) or no console
/// window (Windows).
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut cmd = Command::new(program);
    cmd.stdin(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Spawn and tie the child to the shell's lifetime (Windows job object).
pub fn spawn(cmd: &mut Command) -> std::io::Result<Child> {
    let child = cmd.spawn()?;
    #[cfg(windows)]
    job::assign(&child);
    Ok(child)
}

/// Log files rotate once they pass this size (one `.1` generation is kept).
const ROTATE_AT: u64 = 10 * 1024 * 1024;

pub fn open_log(path: &Path) -> std::io::Result<File> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    if std::fs::metadata(path).map(|m| m.len() > ROTATE_AT).unwrap_or(false) {
        let mut old = path.as_os_str().to_owned();
        old.push(".1");
        let _ = std::fs::rename(path, PathBuf::from(old));
    }
    OpenOptions::new().create(true).append(true).open(path)
}

/// stdout and stderr of a child, both appended to `log`.
pub fn log_to(cmd: &mut Command, log: &Path) -> std::io::Result<()> {
    let file = open_log(log)?;
    cmd.stdout(Stdio::from(file.try_clone()?)).stderr(Stdio::from(file));
    Ok(())
}

/// The last `lines` lines of a log file (lossy UTF-8; reads at most 256 KiB).
pub fn tail(path: &Path, lines: usize) -> String {
    let Ok(mut f) = File::open(path) else { return String::new() };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let start = len.saturating_sub(256 * 1024);
    if f.seek(SeekFrom::Start(start)).is_err() {
        return String::new();
    }
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf);
    let all: Vec<&str> = text.lines().collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

/// Wait for a child up to `timeout`; true if it exited.
pub fn wait_timeout(child: &mut Child, timeout: Duration) -> bool {
    let until = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) if Instant::now() < until => std::thread::sleep(Duration::from_millis(100)),
            Ok(None) => return false,
            Err(_) => return true,
        }
    }
}

/// Stop a child and everything in its process group: SIGTERM, then SIGKILL
/// after `grace` (macOS); TerminateProcess on Windows.
pub fn terminate(child: &mut Child, grace: Duration) {
    if matches!(child.try_wait(), Ok(Some(_))) {
        return;
    }
    #[cfg(unix)]
    {
        let pgid = child.id() as libc::pid_t;
        unsafe { libc::kill(-pgid, libc::SIGTERM) };
        if wait_timeout(child, grace) {
            // The leader is gone; make sure nothing else in its group stays.
            unsafe { libc::kill(-pgid, libc::SIGKILL) };
            return;
        }
        unsafe { libc::kill(-pgid, libc::SIGKILL) };
    }
    #[cfg(not(unix))]
    let _ = grace;
    let _ = child.kill();
    let _ = child.wait();
}

/// The real process table.
pub struct OsProbe;

impl ProcessProbe for OsProbe {
    fn alive(&self, pid: u32) -> bool {
        pid_alive(pid)
    }
    fn name(&self, pid: u32) -> Option<String> {
        process_name(pid)
    }
}

#[cfg(unix)]
pub fn pid_alive(pid: u32) -> bool {
    if pid == 0 || pid > i32::MAX as u32 {
        return false;
    }
    let r = unsafe { libc::kill(pid as libc::pid_t, 0) };
    r == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(unix)]
pub fn process_name(pid: u32) -> Option<String> {
    // `comm` is the executable path on macOS and the short name on Linux.
    let out = Command::new("ps").args(["-p", &pid.to_string(), "-o", "comm="]).output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_lowercase();
    (!s.is_empty()).then_some(s)
}

#[cfg(windows)]
pub fn pid_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return false;
        }
        let mut code = 0u32;
        let ok = GetExitCodeProcess(h, &mut code) != 0;
        CloseHandle(h);
        ok && code == STILL_ACTIVE as u32
    }
}

#[cfg(windows)]
pub fn process_name(pid: u32) -> Option<String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return None;
        }
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len) != 0;
        CloseHandle(h);
        ok.then(|| String::from_utf16_lossy(&buf[..len as usize]).to_lowercase())
    }
}

/// Stop a process that is not our child, with its process group on macOS
/// (a service left by a previous shell): SIGTERM, then SIGKILL after `grace`.
pub fn kill_tree(pid: u32, grace: Duration) {
    #[cfg(unix)]
    {
        let pg = -(pid as libc::pid_t);
        unsafe { libc::kill(pg, libc::SIGTERM) };
        let until = Instant::now() + grace;
        while Instant::now() < until && unsafe { libc::kill(pg, 0) } == 0 {
            std::thread::sleep(Duration::from_millis(100));
        }
        unsafe { libc::kill(pg, libc::SIGKILL) };
    }
    #[cfg(not(unix))]
    {
        let _ = grace;
        kill_pid(pid);
    }
}

/// Signal a process that is not our child (an orphaned postmaster).
pub fn kill_pid(pid: u32) {
    #[cfg(unix)]
    unsafe {
        libc::kill(pid as libc::pid_t, libc::SIGKILL);
    }
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
        let h = OpenProcess(PROCESS_TERMINATE, 0, pid);
        if !h.is_null() {
            TerminateProcess(h, 1);
            CloseHandle(h);
        }
    }
}

#[cfg(windows)]
mod job {
    //! One job object for all local-service children, created on first use
    //! and never closed by us: Windows closes it when the shell exits.
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use std::sync::OnceLock;

    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    struct Job(HANDLE);
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    static JOB: OnceLock<Option<Job>> = OnceLock::new();

    fn job() -> Option<&'static Job> {
        JOB.get_or_init(|| unsafe {
            let h = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if h.is_null() {
                log::warn!("could not create a job object: {}", std::io::Error::last_os_error());
                return None;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                h,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                log::warn!("could not configure the job object: {}", std::io::Error::last_os_error());
            }
            Some(Job(h))
        })
        .as_ref()
    }

    pub fn assign(child: &Child) {
        let Some(job) = job() else { return };
        let ok = unsafe { AssignProcessToJobObject(job.0, child.as_raw_handle() as HANDLE) };
        if ok == 0 {
            log::warn!("could not tie pid {} to the shell: {}", child.id(), std::io::Error::last_os_error());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn this_process_is_alive_and_named() {
        let me = std::process::id();
        assert!(pid_alive(me));
        assert!(process_name(me).is_some());
        assert!(!pid_alive(0));
    }

    #[test]
    fn tail_returns_the_last_lines() {
        let dir = std::env::temp_dir().join(format!("upbstudio-tail-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("x.log");
        std::fs::write(&p, (1..=50).map(|i| format!("line {i}\n")).collect::<String>()).unwrap();
        assert_eq!(tail(&p, 2), "line 49\nline 50");
        assert_eq!(tail(&dir.join("missing.log"), 5), "");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn terminate_stops_the_whole_group() {
        // A shell that starts a grandchild in the same group, then waits.
        let mut cmd = command("/bin/sh");
        cmd.args(["-c", "sleep 30 & wait"]);
        let mut child = spawn(&mut cmd).unwrap();
        std::thread::sleep(Duration::from_millis(200));
        let pgid = child.id() as libc::pid_t;
        terminate(&mut child, Duration::from_secs(2));
        std::thread::sleep(Duration::from_millis(100));
        let r = unsafe { libc::kill(-pgid, 0) };
        assert_eq!(r, -1, "process group {pgid} still has members");
    }
}

//! UPbRPy Studio stays a native application (plan decision 7). The shell
//! finds it and launches it with a `upbr://` link (docs/WORKFLOW.md section 4):
//!
//! | How Studio is found | Launch command |
//! | --- | --- |
//! | Settings path, macOS `.app` | `open -n -a "<path>" --args --open "<url>"` |
//! | Settings path, an executable (Windows `.exe`) | `"<path>" --open "<url>"` |
//! | macOS, registered with LaunchServices (`org.upbrpy.studio`) | `open -n -b org.upbrpy.studio --args --open "<url>"` |
//! | macOS, `/Applications` or `~/Applications` | `open -n -a "<path>" --args --open "<url>"` |
//! | Windows, the registry (App Paths, Uninstall entry, or the `upbr` handler when it is Studio's) or `%LOCALAPPDATA%\Programs`, `%ProgramFiles%` | `"<exe>" --open "<url>"` |
//! | Development: the UPbRPy checkout from Settings | `<checkout>/.venv/bin/python -m GUI --open "<url>"` (Windows `.venv\Scripts\pythonw.exe`), cwd the checkout |
//!
//! `open -n` starts a new Studio process even when one runs: `open --args`
//! does not reach a running app, and Studio's own single-instance hand-off
//! (a local socket, UPbRPy docs/lab_workflow_integration.md) passes the URL
//! to the running window.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

/// Name used by UPbRPy's PyInstaller spec (packaging/UPbRPyStudio.spec).
const APP_NAME: &str = "UPbRPy Studio";
/// `bundle_identifier` in the same spec.
pub const BUNDLE_ID: &str = "org.upbrpy.studio";

/// What Settings say about Studio (both optional).
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioConfig {
    /// The installed app: `.app` (macOS) or `.exe` (Windows).
    #[serde(default)]
    pub path: Option<String>,
    /// Development fallback: a UPbRPy checkout (with `.venv`) run as `python -m GUI`.
    #[serde(default)]
    pub checkout: Option<String>,
}

impl StudioConfig {
    fn path(&self) -> Option<PathBuf> {
        self.path.as_deref().map(str::trim).filter(|p| !p.is_empty()).map(PathBuf::from)
    }
    fn checkout(&self) -> Option<PathBuf> {
        self.checkout.as_deref().map(str::trim).filter(|p| !p.is_empty()).map(PathBuf::from)
    }
}

#[derive(Debug, Clone, PartialEq)]
enum Launcher {
    /// macOS: an `.app` by path.
    MacApp(PathBuf),
    /// macOS: by bundle identifier through LaunchServices (path for display).
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    MacBundle(PathBuf),
    /// An executable (Windows `.exe`, or a binary).
    Exe(PathBuf),
    /// `python -m GUI` in a UPbRPy checkout.
    Checkout { python: PathBuf, dir: PathBuf },
}

impl Launcher {
    fn kind(&self) -> &'static str {
        match self {
            Launcher::Checkout { .. } => "checkout",
            _ => "installed",
        }
    }

    fn path(&self) -> &Path {
        match self {
            Launcher::MacApp(p) | Launcher::MacBundle(p) | Launcher::Exe(p) => p,
            Launcher::Checkout { dir, .. } => dir,
        }
    }

    /// Program and arguments.
    fn argv(&self, url: Option<&str>) -> (PathBuf, Vec<String>) {
        let open_args = |mut v: Vec<String>| {
            if let Some(u) = url {
                v.extend(["--args".into(), "--open".into(), u.into()]);
            }
            v
        };
        let tail = || url.map(|u| vec!["--open".to_string(), u.to_string()]).unwrap_or_default();
        match self {
            Launcher::MacApp(app) => (
                "/usr/bin/open".into(),
                open_args(vec!["-n".into(), "-a".into(), app.to_string_lossy().into_owned()]),
            ),
            Launcher::MacBundle(_) => ("/usr/bin/open".into(), open_args(vec!["-n".into(), "-b".into(), BUNDLE_ID.into()])),
            Launcher::Exe(exe) => (exe.clone(), tail()),
            Launcher::Checkout { python, .. } => {
                let mut v = vec!["-m".to_string(), "GUI".to_string()];
                v.extend(tail());
                (python.clone(), v)
            }
        }
    }

    /// The command as one would type it, for the log and the Reduce tab.
    fn describe(&self, url: Option<&str>) -> String {
        let (prog, args) = self.argv(url);
        let mut out = quote(&prog.to_string_lossy());
        for a in args {
            out.push(' ');
            out.push_str(&quote(&a));
        }
        if let Launcher::Checkout { dir, .. } = self {
            out = format!("(cd {} && {out})", quote(&dir.to_string_lossy()));
        }
        out
    }

    fn command(&self, url: Option<&str>) -> Command {
        let (prog, args) = self.argv(url);
        let mut cmd = Command::new(prog);
        cmd.args(args);
        match self {
            Launcher::Checkout { dir, .. } => {
                cmd.current_dir(dir);
            }
            Launcher::Exe(exe) => {
                if let Some(dir) = exe.parent() {
                    cmd.current_dir(dir);
                }
            }
            _ => {}
        }
        detach(&mut cmd);
        cmd
    }
}

/// Studio outlives the shell: its own process group (Unix), no console and
/// its own group (Windows).
fn detach(cmd: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
}

/// Quote for display (POSIX style; Windows paths read fine with double quotes too).
fn quote(s: &str) -> String {
    if !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_./:=@%+,".contains(c)) {
        s.to_string()
    } else {
        format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
    }
}

fn candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if cfg!(target_os = "macos") {
        out.push(PathBuf::from(format!("/Applications/{APP_NAME}.app")));
        if let Some(home) = std::env::var_os("HOME") {
            out.push(PathBuf::from(home).join("Applications").join(format!("{APP_NAME}.app")));
        }
    } else if cfg!(windows) {
        let exe = format!("{APP_NAME}.exe");
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            out.push(PathBuf::from(local).join("Programs").join(APP_NAME).join(&exe));
        }
        for var in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(dir) = std::env::var_os(var) {
                out.push(PathBuf::from(dir).join(APP_NAME).join(&exe));
            }
        }
    } else if let Some(home) = std::env::var_os("HOME") {
        out.push(PathBuf::from(home).join(".local/bin").join(APP_NAME));
    }
    out
}

/// macOS: ask Spotlight / LaunchServices where `org.upbrpy.studio` is.
#[cfg(target_os = "macos")]
fn find_by_bundle_id() -> Option<PathBuf> {
    let out = Command::new("/usr/bin/mdfind").arg(format!("kMDItemCFBundleIdentifier == '{BUNDLE_ID}'")).output().ok()?;
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(PathBuf::from)
        .find(|p| p.extension().is_some_and(|e| e == "app") && p.exists())
}

// ------------------------------------------------------- Windows registry

#[cfg_attr(not(windows), allow(dead_code))]
/// One value line of `reg query` output: `    Name    REG_SZ    Data`.
fn parse_reg_values(output: &str) -> Vec<(String, String)> {
    output
        .lines()
        .filter_map(|line| {
            let line = line.trim_end();
            if !line.starts_with("    ") {
                return None;
            }
            let rest = line.trim_start();
            let (pos, ty) = ["REG_EXPAND_SZ", "REG_SZ"].iter().find_map(|t| rest.find(&format!("    {t}    ")).map(|p| (p, *t)))?;
            let name = rest[..pos].trim().to_string();
            let data = rest[pos + 4 + ty.len() + 4..].trim().to_string();
            Some((name, data))
        })
        .collect()
}

#[cfg_attr(not(windows), allow(dead_code))]
/// The executable at the start of a command line or a `DisplayIcon` value:
/// `"C:\…\UPbRPy Studio.exe" --open "%1"` or `C:\…\UPbRPy Studio.exe,0`.
fn exe_from_command(cmd: &str) -> Option<PathBuf> {
    let cmd = cmd.trim();
    let path = if let Some(rest) = cmd.strip_prefix('"') {
        rest.split('"').next()?
    } else {
        let end = cmd.to_ascii_lowercase().find(".exe").map(|i| i + 4).unwrap_or(cmd.len());
        &cmd[..end]
    };
    let path = path.split(',').next()?.trim();
    (!path.is_empty() && path.to_ascii_lowercase().ends_with(".exe")).then(|| PathBuf::from(path))
}

#[cfg_attr(not(windows), allow(dead_code))]
/// Paths the registry suggests, most specific first. `reg` is `reg query`.
fn registry_candidates(reg: &dyn Fn(&[&str]) -> Option<String>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let exe = format!("{APP_NAME}.exe");
    for root in ["HKCU", "HKLM"] {
        let key = format!(r"{root}\Software\Microsoft\Windows\CurrentVersion\App Paths\{exe}");
        if let Some(o) = reg(&[&key, "/ve"]) {
            out.extend(parse_reg_values(&o).into_iter().filter_map(|(_, d)| exe_from_command(&d)));
        }
    }
    for root in ["HKCU", "HKLM"] {
        let key = format!(r"{root}\Software\Microsoft\Windows\CurrentVersion\Uninstall");
        if let Some(o) = reg(&[&key, "/s", "/f", APP_NAME, "/d"]) {
            // Search hits print the matching key, then its values; read the whole key.
            for k in o.lines().filter(|l| l.starts_with("HKEY_")) {
                if let Some(vals) = reg(&[k.trim()]) {
                    let vals = parse_reg_values(&vals);
                    if let Some((_, dir)) = vals.iter().find(|(n, _)| n == "InstallLocation") {
                        out.push(PathBuf::from(dir.trim_matches('"')).join(&exe));
                    }
                    if let Some((_, icon)) = vals.iter().find(|(n, _)| n == "DisplayIcon") {
                        out.extend(exe_from_command(icon));
                    }
                }
            }
        }
    }
    // Studio's installer registers upbr:// too; use it when it points at Studio, not at us.
    if let Some(o) = reg(&[r"HKCU\Software\Classes\upbr\shell\open\command", "/ve"]) {
        out.extend(
            parse_reg_values(&o)
                .into_iter()
                .filter_map(|(_, d)| exe_from_command(&d))
                .filter(|p| p.to_string_lossy().to_ascii_lowercase().contains("upbrpy")),
        );
    }
    out
}

#[cfg(windows)]
fn reg_query(args: &[&str]) -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = Command::new("reg").arg("query").args(args).creation_flags(CREATE_NO_WINDOW).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// The Python of a UPbRPy checkout: its `.venv`, else the one on PATH.
fn checkout_python(dir: &Path) -> PathBuf {
    let venv: &[&str] = if cfg!(windows) { &[r".venv\Scripts\pythonw.exe", r".venv\Scripts\python.exe"] } else { &[".venv/bin/python"] };
    venv.iter()
        .map(|p| dir.join(p))
        .find(|p| p.exists())
        .unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "pythonw" } else { "python3" }))
}

fn is_checkout(dir: &Path) -> bool {
    dir.join("GUI").join("__main__.py").is_file()
}

fn from_path(p: PathBuf) -> Launcher {
    if cfg!(target_os = "macos") && p.extension().is_some_and(|e| e == "app") {
        Launcher::MacApp(p)
    } else {
        Launcher::Exe(p)
    }
}

/// Settings path, then the installed app, then the development checkout.
fn find(config: &StudioConfig) -> Result<Launcher, String> {
    if let Some(p) = config.path() {
        if p.exists() {
            return Ok(from_path(p));
        }
        // A wrong Settings path is reported, unless a checkout is configured.
        if config.checkout().is_none() {
            return Err(format!("{} does not exist (Settings)", p.display()));
        }
    } else {
        #[cfg(windows)]
        if let Some(p) = registry_candidates(&reg_query).into_iter().find(|p| p.is_file()) {
            return Ok(Launcher::Exe(p));
        }
        if let Some(p) = candidates().into_iter().find(|p| p.exists()) {
            return Ok(from_path(p));
        }
        #[cfg(target_os = "macos")]
        if let Some(p) = find_by_bundle_id() {
            return Ok(Launcher::MacBundle(p));
        }
    }
    if let Some(dir) = config.checkout() {
        if is_checkout(&dir) {
            return Ok(Launcher::Checkout { python: checkout_python(&dir), dir });
        }
        return Err(format!("{} is not a UPbRPy checkout (no GUI/__main__.py)", dir.display()));
    }
    Err("UPbRPy Studio is not installed".into())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioStatus {
    found: bool,
    /// `installed` or `checkout`.
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<&'static str>,
    /// The app, executable or checkout folder.
    path: Option<String>,
    /// How it is launched, e.g. `open -n -b org.upbrpy.studio --args --open <url>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[tauri::command]
pub async fn studio_status(config: Option<StudioConfig>) -> StudioStatus {
    let config = config.unwrap_or_default();
    let found = tauri::async_runtime::spawn_blocking(move || find(&config)).await.map_err(|e| e.to_string()).and_then(|r| r);
    match found {
        Ok(l) => StudioStatus {
            found: true,
            kind: Some(l.kind()),
            path: Some(l.path().to_string_lossy().into_owned()),
            command: Some(l.describe(Some("<url>"))),
            error: None,
        },
        Err(e) => StudioStatus { found: false, kind: None, path: None, command: None, error: Some(e) },
    }
}

#[derive(Debug, Serialize)]
pub struct Launched {
    /// The command line, with any one-time code replaced by `…`.
    command: String,
}

/// Replace `code=<value>` so one-time codes stay out of logs.
fn redact(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find("code=") {
        out.push_str(&rest[..i + 5]);
        out.push('…');
        rest = &rest[i + 5..];
        let end = rest.find(|c: char| c == '&' || c == '#' || c == '"' || c.is_whitespace()).unwrap_or(rest.len());
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

#[tauri::command]
pub async fn studio_launch(config: Option<StudioConfig>, url: Option<String>) -> Result<Launched, String> {
    if let Some(u) = &url {
        if !u.starts_with("upbr://") || u.len() > 4096 || u.chars().any(char::is_control) {
            return Err(format!("Studio only takes upbr:// links, not {:?}", redact(u)));
        }
    }
    let config = config.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let launcher = find(&config)?;
        let shown = redact(&launcher.describe(url.as_deref()));
        let mut child = launcher.command(url.as_deref()).spawn().map_err(|e| format!("could not run {shown}: {e}"))?;
        // Reap it when it exits (`open` returns at once; Studio itself runs on).
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        log::info!("launched UPbRPy Studio: {shown}");
        Ok(Launched { command: shown })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(path: Option<&str>, checkout: Option<&str>) -> StudioConfig {
        StudioConfig { path: path.map(Into::into), checkout: checkout.map(Into::into) }
    }

    #[test]
    fn configured_path_that_is_missing_is_reported() {
        let err = find(&cfg(Some("/definitely/not/here.app"), None)).unwrap_err();
        assert!(err.contains("/definitely/not/here.app"));
    }

    #[test]
    fn configured_executable_wins() {
        let exe = std::env::current_exe().unwrap();
        let l = find(&cfg(Some(&exe.to_string_lossy()), None)).unwrap();
        assert_eq!(l, Launcher::Exe(exe));
        assert_eq!(l.kind(), "installed");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn launch_refuses_other_links() {
        let exe = std::env::current_exe().unwrap();
        let err = studio_launch(Some(cfg(Some(&exe.to_string_lossy()), None)), Some("https://example.com".into())).await.unwrap_err();
        assert!(err.contains("upbr://"));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn launch_refuses_missing_path() {
        assert!(studio_launch(Some(cfg(Some("/definitely/not/here"), None)), None).await.is_err());
    }

    #[test]
    fn checkout_fallback_runs_python_m_gui() {
        let dir = std::env::temp_dir().join(format!("upbstudio-upbrpy-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("GUI")).unwrap();
        std::fs::write(dir.join("GUI").join("__main__.py"), "").unwrap();
        // A Settings path that is gone falls through to the checkout.
        let l = find(&cfg(Some("/definitely/not/here.app"), Some(&dir.to_string_lossy()))).unwrap();
        assert_eq!(l.kind(), "checkout");
        assert_eq!(l.path(), dir.as_path());
        let (_, args) = l.argv(Some("upbr://session/x"));
        assert_eq!(args, ["-m", "GUI", "--open", "upbr://session/x"]);
        assert!(l.describe(Some("upbr://session/x")).contains("-m GUI --open upbr://session/x"));
        let err = find(&cfg(Some("/definitely/not/here.app"), Some("/definitely/not/a/checkout"))).unwrap_err();
        assert!(err.contains("not a UPbRPy checkout"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn macos_commands_use_open_with_args() {
        let url = Some("upbr://session/s?server=http://h&code=c");
        let (prog, args) = Launcher::MacBundle("/Applications/UPbRPy Studio.app".into()).argv(url);
        assert_eq!(prog, PathBuf::from("/usr/bin/open"));
        assert_eq!(args, ["-n", "-b", BUNDLE_ID, "--args", "--open", "upbr://session/s?server=http://h&code=c"]);
        let (_, args) = Launcher::MacApp("/Applications/UPbRPy Studio.app".into()).argv(None);
        assert_eq!(args, ["-n", "-a", "/Applications/UPbRPy Studio.app"]);
    }

    #[test]
    fn windows_exe_gets_open_url() {
        let (prog, args) = Launcher::Exe(r"C:\Program Files\UPbRPy Studio\UPbRPy Studio.exe".into()).argv(Some("upbr://run/r"));
        assert!(prog.to_string_lossy().ends_with("UPbRPy Studio.exe"));
        assert_eq!(args, ["--open", "upbr://run/r"]);
    }

    #[test]
    fn codes_are_redacted() {
        assert_eq!(redact("x --open \"upbr://session/s?server=h&code=SECRET\""), "x --open \"upbr://session/s?server=h&code=…\"");
        assert_eq!(redact("upbr://session/s?code=A&server=h"), "upbr://session/s?code=…&server=h");
        assert_eq!(redact("no code here"), "no code here");
    }

    #[test]
    fn reg_query_output_is_parsed() {
        let out = "\r\nHKEY_CURRENT_USER\\Software\\Classes\\upbr\\shell\\open\\command\r\n    (Default)    REG_SZ    \"C:\\Users\\a\\AppData\\Local\\Programs\\UPbRPy Studio\\UPbRPy Studio.exe\" --open \"%1\"\r\n\r\n";
        let vals = parse_reg_values(out);
        assert_eq!(vals.len(), 1);
        assert_eq!(vals[0].0, "(Default)");
        assert_eq!(
            exe_from_command(&vals[0].1).unwrap(),
            PathBuf::from(r"C:\Users\a\AppData\Local\Programs\UPbRPy Studio\UPbRPy Studio.exe")
        );
        assert_eq!(exe_from_command(r"C:\Apps\UPbRPy Studio\UPbRPy Studio.exe,0").unwrap(), PathBuf::from(r"C:\Apps\UPbRPy Studio\UPbRPy Studio.exe"));
        assert!(exe_from_command("rundll32 something").is_none());
    }

    #[test]
    fn registry_candidates_read_app_paths_uninstall_and_scheme() {
        let reg = |args: &[&str]| -> Option<String> {
            let key = args[0];
            if key.starts_with(r"HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths") {
                Some(format!("\r\n{key}\r\n    (Default)    REG_SZ    C:\\A\\UPbRPy Studio.exe\r\n"))
            } else if key == r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall" {
                Some("\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\UPbRPy Studio\r\n    DisplayName    REG_SZ    UPbRPy Studio\r\n\r\nEnd of search: 1 match(es) found.\r\n".into())
            } else if key.ends_with(r"Uninstall\UPbRPy Studio") {
                Some(format!("\r\n{key}\r\n    DisplayName    REG_SZ    UPbRPy Studio\r\n    InstallLocation    REG_SZ    \"C:\\B\"\r\n    DisplayIcon    REG_SZ    C:\\B\\UPbRPy Studio.exe,0\r\n"))
            } else if key.contains(r"Classes\upbr") {
                // The shell's own handler is skipped.
                Some(format!("\r\n{key}\r\n    (Default)    REG_SZ    \"C:\\Program Files\\UPb Lab\\upbstudio.exe\" \"%1\"\r\n"))
            } else {
                None
            }
        };
        let c = registry_candidates(&reg);
        assert_eq!(
            c,
            vec![
                PathBuf::from(r"C:\A\UPbRPy Studio.exe"),
                PathBuf::from(r"C:\B").join("UPbRPy Studio.exe"),
                PathBuf::from(r"C:\B\UPbRPy Studio.exe"),
            ]
        );
    }

    #[test]
    fn candidates_are_platform_specific() {
        let c = candidates();
        if cfg!(target_os = "macos") {
            assert!(c[0].to_string_lossy().ends_with("UPbRPy Studio.app"));
        }
        if cfg!(windows) {
            assert!(c.iter().all(|p| p.to_string_lossy().ends_with("UPbRPy Studio.exe")));
        }
    }
}

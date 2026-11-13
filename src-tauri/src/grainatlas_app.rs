//! Standalone GrainAtlas handoff. Only the shell capability can launch it.
use std::path::PathBuf;
use std::process::Command;

const BUNDLE: &str = "org.grainatlas.desktop";
const EXE: &str = "grainatlas-desktop.exe";
const MAC_MISSING: &str =
    "GrainAtlas is not installed (looked in /Applications and ~/Applications)";
const WINDOWS_MISSING: &str = "GrainAtlas is not installed (looked in HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\grainatlas InstallLocation, %LOCALAPPDATA%\\grainatlas and %ProgramFiles%\\grainatlas)";

#[derive(Clone, Copy)]
#[cfg_attr(not(test), allow(dead_code))]
enum Os {
    Mac,
    Windows,
    Linux,
}

/// Inject discovery and existence probes so precedence is testable on every OS.
fn lookup(
    os: Os,
    bundle: impl FnOnce() -> Option<PathBuf>,
    registry: impl FnOnce() -> Option<PathBuf>,
    env: impl Fn(&str) -> Option<PathBuf>,
    exists: impl Fn(&PathBuf) -> bool,
) -> Result<PathBuf, String> {
    match os {
        Os::Mac => {
            if let Some(path) = bundle().filter(&exists) {
                return Ok(path);
            }
            let mut paths = vec![PathBuf::from("/Applications/grainatlas.app")];
            if let Some(home) = env("HOME") {
                paths.push(home.join("Applications/grainatlas.app"));
            }
            paths.into_iter().find(exists).ok_or(MAC_MISSING.into())
        }
        Os::Windows => {
            let mut paths = Vec::new();
            if let Some(dir) = registry() {
                paths.push(dir.join(EXE));
            }
            for key in ["LOCALAPPDATA", "ProgramFiles"] {
                if let Some(dir) = env(key) {
                    paths.push(dir.join("grainatlas").join(EXE));
                }
            }
            paths.into_iter().find(exists).ok_or(WINDOWS_MISSING.into())
        }
        Os::Linux => Err("Opening standalone GrainAtlas is not supported on Linux".into()),
    }
}

fn argv(
    os: Os,
    path: PathBuf,
    project: &str,
    server: &str,
    code: &str,
    revision: Option<u64>,
) -> Result<(PathBuf, Vec<String>), String> {
    let (program, mut args) = match os {
        Os::Mac => (
            PathBuf::from("/usr/bin/open"),
            vec!["-n".into(), "-b".into(), BUNDLE.into(), "--args".into()],
        ),
        Os::Windows => (path, Vec::new()),
        Os::Linux => return Err("Opening standalone GrainAtlas is not supported on Linux".into()),
    };
    args.extend([
        "--project".into(),
        project.into(),
        "--server".into(),
        server.into(),
        "--code".into(),
        code.into(),
    ]);
    if let Some(revision) = revision {
        args.extend(["--revision".into(), revision.to_string()]);
    }
    Ok((program, args))
}

#[cfg(target_os = "macos")]
fn bundle_path() -> Option<PathBuf> {
    let output = Command::new("/usr/bin/mdfind")
        .arg(format!("kMDItemCFBundleIdentifier == '{BUNDLE}'"))
        .output()
        .ok()?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(PathBuf::from)
        .find(|path| path.extension().is_some_and(|ext| ext == "app") && path.exists())
}
#[cfg(not(target_os = "macos"))]
fn bundle_path() -> Option<PathBuf> {
    None
}

#[cfg_attr(not(windows), allow(dead_code))]
fn install_location(output: &str) -> Option<PathBuf> {
    output.lines().find_map(|line| {
        let rest = line.trim().strip_prefix("InstallLocation")?.trim_start();
        let value = rest.strip_prefix("REG_SZ")?.trim().trim_matches('"');
        (!value.is_empty()).then(|| PathBuf::from(value))
    })
}
#[cfg(windows)]
fn registry_path() -> Option<PathBuf> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let output = Command::new("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\grainatlas",
            "/v",
            "InstallLocation",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| install_location(&String::from_utf8_lossy(&output.stdout)))?
}
#[cfg(not(windows))]
fn registry_path() -> Option<PathBuf> {
    None
}

#[tauri::command]
pub async fn grainatlas_launch(
    project: String,
    server: String,
    code: String,
    revision: Option<u64>,
) -> Result<(), String> {
    // Reject invalid input without echoing it: the one-time code is never logged.
    if project.is_empty()
        || project.len() > 128
        || !project.as_bytes()[0].is_ascii_alphanumeric()
        || !project
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._~-".contains(c))
    {
        return Err("Invalid GrainAtlas project id".into());
    }
    let url = url::Url::parse(&server).map_err(|_| "Invalid GrainAtlas server URL")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || server.len() > 2048
        || server.chars().any(char::is_whitespace)
        || server.chars().any(char::is_control)
    {
        return Err("Invalid GrainAtlas server URL".into());
    }
    if code.is_empty() || code.len() > 4096 || code.chars().any(char::is_control) {
        return Err("Invalid GrainAtlas handoff code".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let os = if cfg!(target_os = "macos") {
            Os::Mac
        } else if cfg!(windows) {
            Os::Windows
        } else {
            Os::Linux
        };
        let path = lookup(
            os,
            bundle_path,
            registry_path,
            |key| std::env::var_os(key).map(PathBuf::from),
            |p| {
                if cfg!(windows) {
                    p.is_file()
                } else {
                    p.exists()
                }
            },
        )?;
        let (program, args) = argv(os, path, &project, &server, &code, revision)?;
        // Do not format argv at all: this also protects codes containing spaces.
        let mut command = Command::new(program);
        command.args(args);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0000_0008 | 0x0000_0200 | 0x0800_0000);
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("Could not launch GrainAtlas: {e}"))?;
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        log::info!("launched standalone GrainAtlas");
        Ok(())
    })
    .await
    .map_err(|_| "GrainAtlas launcher failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn arguments_per_os() {
        let (program, args) = argv(
            Os::Mac,
            "app".into(),
            "p",
            "https://lab",
            "secret",
            Some(41),
        )
        .unwrap();
        assert_eq!(program, PathBuf::from("/usr/bin/open"));
        assert_eq!(
            args,
            [
                "-n",
                "-b",
                BUNDLE,
                "--args",
                "--project",
                "p",
                "--server",
                "https://lab",
                "--code",
                "secret",
                "--revision",
                "41"
            ]
        );
        let (program, args) =
            argv(Os::Windows, EXE.into(), "p", "https://lab", "secret", None).unwrap();
        assert_eq!(program, PathBuf::from(EXE));
        assert_eq!(
            args,
            [
                "--project",
                "p",
                "--server",
                "https://lab",
                "--code",
                "secret"
            ]
        );
        assert!(argv(Os::Linux, "app".into(), "p", "https://lab", "secret", None).is_err());
    }

    #[test]
    fn lookup_order_and_missing_errors() {
        let seen = RefCell::new(Vec::new());
        let result = lookup(
            Os::Mac,
            || Some("/bundle/app.app".into()),
            || None,
            |_| Some("/home/demo".into()),
            |p| {
                seen.borrow_mut().push(p.clone());
                false
            },
        );
        assert_eq!(result.unwrap_err(), MAC_MISSING);
        assert_eq!(
            *seen.borrow(),
            vec![
                PathBuf::from("/bundle/app.app"),
                "/Applications/grainatlas.app".into(),
                "/home/demo/Applications/grainatlas.app".into()
            ]
        );
        seen.borrow_mut().clear();
        let result = lookup(
            Os::Windows,
            || None,
            || Some("registry".into()),
            |key| Some(key.into()),
            |p| {
                seen.borrow_mut().push(p.clone());
                false
            },
        );
        assert_eq!(result.unwrap_err(), WINDOWS_MISSING);
        assert_eq!(
            *seen.borrow(),
            vec![
                PathBuf::from("registry").join(EXE),
                PathBuf::from("LOCALAPPDATA").join("grainatlas").join(EXE),
                PathBuf::from("ProgramFiles").join("grainatlas").join(EXE)
            ]
        );
        let result = lookup(
            Os::Mac,
            || Some("bundle".into()),
            || panic!("not Windows"),
            |_| panic!("bundle wins"),
            |_| true,
        );
        assert_eq!(result.unwrap(), PathBuf::from("bundle"));
        let result = lookup(
            Os::Windows,
            || panic!("not Mac"),
            || Some("registry".into()),
            |_| None,
            |_| true,
        );
        assert_eq!(result.unwrap(), PathBuf::from("registry").join(EXE));
        assert!(lookup(Os::Linux, || None, || None, |_| None, |_| false)
            .unwrap_err()
            .contains("not supported"));
    }

    #[test]
    fn registry_value_and_code_redaction() {
        assert_eq!(
            install_location("    InstallLocation    REG_SZ    C:\\Apps\\grainatlas\r\n"),
            Some(PathBuf::from(r"C:\Apps\grainatlas"))
        );
        assert_eq!(
            crate::studio::redact("app --code SECRET --revision 3"),
            "app --code … --revision 3"
        );
        assert_eq!(
            crate::studio::redact("url?code=SECRET&x=1"),
            "url?code=…&x=1"
        );
    }
}

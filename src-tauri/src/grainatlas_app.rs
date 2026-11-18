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

fn validate_id(id: &str, kind: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || !id.as_bytes()[0].is_ascii_alphanumeric()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._~-".contains(c))
    {
        return Err(format!("Invalid GrainAtlas {kind} id"));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)] // Mirrors the optional standalone command-line arguments.
fn argv(
    os: Os,
    path: PathBuf,
    project: &str,
    server: &str,
    code: &str,
    revision: Option<u64>,
    spot: Option<&str>,
    grain: Option<&str>,
) -> Result<(PathBuf, Vec<String>), String> {
    validate_id(project, "project")?;
    if let Some(id) = spot {
        validate_id(id, "spot")?;
    }
    if let Some(id) = grain {
        validate_id(id, "grain")?;
    }
    let (program, mut args) = match os {
        Os::Mac => (
            PathBuf::from("/usr/bin/open"),
            vec!["-n".into(), "-b".into(), BUNDLE.into(), "--args".into()],
        ),
        Os::Windows => (path, Vec::new()),
        Os::Linux => return Err("Opening standalone GrainAtlas is not supported on Linux".into()),
    };
    args.extend(["--project".into(), project.into()]);
    if !server.is_empty() {
        args.extend([
            "--server".into(),
            server.into(),
            "--code".into(),
            code.into(),
        ]);
    }
    if let Some(revision) = revision {
        args.extend(["--revision".into(), revision.to_string()]);
    }
    if let Some(id) = spot {
        args.extend(["--spot".into(), id.into()]);
    } else if let Some(id) = grain {
        args.extend(["--grain".into(), id.into()]);
    }
    Ok((program, args))
}

/// Keep paths as separate arguments. LaunchServices delivers them to an existing app.
fn paths_argv(
    os: Os,
    executable: PathBuf,
    paths: Vec<String>,
    exists: impl Fn(&std::path::Path) -> bool,
) -> Result<(PathBuf, Vec<String>), String> {
    if paths.is_empty()
        || paths.iter().any(|p| {
            let path = std::path::Path::new(p);
            p.chars().any(char::is_control) || !path.is_absolute() || !exists(path)
        })
    {
        return Err(
            "GrainAtlas paths must be absolute, exist and contain no control characters".into(),
        );
    }
    let (program, mut args) = match os {
        Os::Mac => (
            PathBuf::from("/usr/bin/open"),
            vec!["-b".into(), BUNDLE.into()],
        ),
        Os::Windows => (executable, Vec::new()),
        Os::Linux => return Err("Opening standalone GrainAtlas is not supported on Linux".into()),
    };
    args.extend(paths);
    Ok((program, args))
}

#[tauri::command]
pub async fn grainatlas_open_paths(paths: Vec<String>) -> Result<(), String> {
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
        let (program, args) = paths_argv(os, path, paths, |p| p.exists())?;
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
            .map_err(|e| format!("Could not open GrainAtlas paths: {e}"))?;
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        Ok(())
    })
    .await
    .map_err(|_| "GrainAtlas launcher failed".to_string())?
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
    identity: tauri::State<'_, crate::auth::Identity>,
    project: String,
    server: Option<String>,
    code: Option<String>,
    revision: Option<u64>,
    spot: Option<String>,
    grain: Option<String>,
) -> Result<(), String> {
    // Reject invalid input without echoing it: the one-time code is never logged.
    validate_id(&project, "project")?;
    if let Some(id) = &spot {
        validate_id(id, "spot")?;
    }
    if let Some(id) = &grain {
        validate_id(id, "grain")?;
    }
    if let Some(server) = &server {
        identity.guard_grainatlas(server)?;
        let url = url::Url::parse(server).map_err(|_| "Invalid GrainAtlas server URL")?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || server.len() > 2048
            || server.chars().any(|c| c.is_whitespace() || c.is_control())
        {
            return Err("Invalid GrainAtlas server URL".into());
        }
        let code = code.as_deref().ok_or("Invalid GrainAtlas handoff code")?;
        if code.is_empty() || code.len() > 4096 || code.chars().any(char::is_control) {
            return Err("Invalid GrainAtlas handoff code".into());
        }
    } else if code.is_some() {
        return Err("GrainAtlas code requires a server".into());
    }
    let server = server.unwrap_or_default();
    let code = code.unwrap_or_default();
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
        let (program, args) = argv(
            os,
            path,
            &project,
            &server,
            &code,
            revision,
            spot.as_deref(),
            grain.as_deref(),
        )?;
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
    fn path_arguments_and_validation() {
        let paths = vec![std::env::temp_dir()
            .join("image set.gaproj")
            .to_string_lossy()
            .into_owned()];
        let (program, args) = paths_argv(Os::Mac, "app".into(), paths.clone(), |_| true).unwrap();
        assert_eq!(program, PathBuf::from("/usr/bin/open"));
        assert_eq!(&args[..2], ["-b", BUNDLE]);
        assert_eq!(&args[2..], paths);
        let (program, args) = paths_argv(Os::Windows, EXE.into(), paths.clone(), |_| true).unwrap();
        assert_eq!(program, PathBuf::from(EXE));
        assert_eq!(args, paths);
        for bad in [
            vec![],
            vec!["relative.gaproj".into()],
            vec![format!("{}\n", paths[0])],
        ] {
            assert!(paths_argv(Os::Mac, "app".into(), bad, |_| true).is_err());
        }
        assert!(paths_argv(Os::Mac, "app".into(), paths.clone(), |_| false).is_err());
        assert!(paths_argv(Os::Linux, "app".into(), paths, |_| true).is_err());
    }

    #[test]
    fn local_mode_has_no_credentials() {
        for os in [Os::Mac, Os::Windows] {
            let (_, args) = argv(os, "app".into(), "p", "", "", None, None, None).unwrap();
            assert!(args.ends_with(&["--project".into(), "p".into()]));
            assert!(!args.iter().any(|a| a == "--server" || a == "--code"));
        }
    }
    #[test]
    fn arguments_per_os() {
        let (program, args) = argv(
            Os::Mac,
            "app".into(),
            "p",
            "https://lab",
            "secret",
            Some(41),
            None,
            None,
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
        let (program, args) = argv(
            Os::Windows,
            EXE.into(),
            "p",
            "https://lab",
            "secret",
            None,
            None,
            None,
        )
        .unwrap();
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
        assert!(argv(
            Os::Linux,
            "app".into(),
            "p",
            "https://lab",
            "secret",
            None,
            None,
            None
        )
        .is_err());
    }

    #[test]
    fn focus_arguments_and_validation() {
        for os in [Os::Mac, Os::Windows] {
            let (_, args) = argv(
                os,
                "app".into(),
                "p",
                "https://lab",
                "code",
                None,
                Some("s"),
                Some("g"),
            )
            .unwrap();
            assert_eq!(&args[args.len() - 2..], ["--spot", "s"]);
            assert!(!args.iter().any(|a| a == "--grain"));
            let (_, args) = argv(
                os,
                "app".into(),
                "p",
                "https://lab",
                "code",
                None,
                None,
                Some("g"),
            )
            .unwrap();
            assert_eq!(&args[args.len() - 2..], ["--grain", "g"]);
            for bad in ["", "../x", "-bad", "a b", &"a".repeat(129)] {
                assert!(argv(
                    os,
                    "app".into(),
                    "p",
                    "https://lab",
                    "code",
                    None,
                    Some(bad),
                    None
                )
                .is_err());
                assert!(argv(
                    os,
                    "app".into(),
                    "p",
                    "https://lab",
                    "code",
                    None,
                    None,
                    Some(bad)
                )
                .is_err());
            }
            assert!(validate_id(&"a".repeat(128), "spot").is_ok());
        }
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

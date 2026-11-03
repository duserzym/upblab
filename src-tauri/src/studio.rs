//! UPbRPy Studio stays a native application (plan decision 7): the shell finds
//! it by a configured path or the usual install locations and launches it,
//! passing a `upbr://` link as its argument. The session-export hand-off file
//! is roadmap phase 4.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

/// Name used by UPbRPy's PyInstaller spec (packaging/UPbRPyStudio.spec).
const APP_NAME: &str = "UPbRPy Studio";

#[derive(Debug, Serialize)]
pub struct StudioStatus {
    path: Option<String>,
    found: bool,
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

fn detect() -> Option<PathBuf> {
    candidates().into_iter().find(|p| p.exists())
}

#[tauri::command]
pub fn studio_status(configured: Option<String>) -> StudioStatus {
    if let Some(path) = configured.filter(|p| !p.trim().is_empty()) {
        let found = Path::new(path.trim()).exists();
        return StudioStatus { path: Some(path.trim().to_string()), found };
    }
    let path = detect();
    StudioStatus { found: path.is_some(), path: path.map(|p| p.to_string_lossy().into_owned()) }
}

#[tauri::command]
pub fn studio_launch(path: String, url: Option<String>) -> Result<(), String> {
    let path = PathBuf::from(path.trim());
    if !path.exists() {
        return Err(format!("{} does not exist", path.display()));
    }
    if let Some(u) = &url {
        if !u.starts_with("upbr://") {
            return Err(format!("Studio only takes upbr:// links, not {u:?}"));
        }
    }
    let mut cmd = if cfg!(target_os = "macos") && path.extension().is_some_and(|e| e == "app") {
        // `open -a` starts the bundle like Finder does; --args reaches argv on a fresh launch.
        let mut c = Command::new("/usr/bin/open");
        c.arg("-a").arg(&path);
        if let Some(u) = &url {
            c.arg("--args").arg(u);
        }
        c
    } else {
        let mut c = Command::new(&path);
        if let Some(u) = &url {
            c.arg(u);
        }
        if let Some(dir) = path.parent() {
            c.current_dir(dir);
        }
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| format!("could not start {}: {e}", path.display()))?;
    log::info!("launched UPbRPy Studio at {}{}", path.display(), url.map(|u| format!(" with {u}")).unwrap_or_default());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configured_path_wins() {
        let s = studio_status(Some("/definitely/not/here.app".into()));
        assert_eq!(s.path.as_deref(), Some("/definitely/not/here.app"));
        assert!(!s.found);
    }

    #[test]
    fn launch_refuses_other_links() {
        let exe = std::env::current_exe().unwrap();
        let err = studio_launch(exe.to_string_lossy().into(), Some("https://example.com".into())).unwrap_err();
        assert!(err.contains("upbr://"));
    }

    #[test]
    fn launch_refuses_missing_path() {
        assert!(studio_launch("/definitely/not/here".into(), None).is_err());
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

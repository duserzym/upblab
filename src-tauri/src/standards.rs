//! Compare the shared standards checkout with GitHub without changing its files.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::local_service::process;

const UPSTREAM_REF: &str = "refs/upb-standards/checked";

#[derive(Serialize)]
pub(crate) struct StandardsStatus {
    message: String,
    warning: bool,
    changed: BTreeSet<String>,
}

fn git(path: &Path, args: &[&str]) -> Option<String> {
    let mut command = process::command("git");
    command
        .args(["--no-optional-locks", "-C"])
        .arg(path)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("GH_PROMPT_DISABLED", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = process::spawn(&mut command).ok()?;
    // Drain stdout while Git is running, including for a large list of files.
    let stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || std::io::read_to_string(stdout));
    if !process::wait_timeout(&mut child, Duration::from_secs(12)) {
        process::terminate(&mut child, Duration::from_millis(200));
        return None;
    }
    child
        .wait()
        .ok()?
        .success()
        .then(|| reader.join().ok()?.ok())?
}

fn changed_files(path: &Path, base: &str) -> Option<BTreeSet<String>> {
    let diff = git(
        path,
        &[
            "diff",
            "--no-renames",
            "--name-only",
            "-z",
            base,
            "--",
            "*.toml",
        ],
    )?;
    let untracked = git(
        path,
        &[
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            "*.toml",
        ],
    )?;
    Some(
        diff.split('\0')
            .chain(untracked.split('\0'))
            .filter(|name| !name.is_empty())
            .map(str::to_owned)
            .collect(),
    )
}

fn check(path: &Path) -> StandardsStatus {
    if !path.join(".git").exists() {
        return StandardsStatus {
            message: format!("Shared standards checkout is missing. {}", path.display()),
            warning: false,
            changed: BTreeSet::new(),
        };
    }

    let upstream = git(
        path,
        &[
            "fetch",
            "--quiet",
            "--no-tags",
            "--no-prune",
            "--no-write-fetch-head",
            "--no-auto-maintenance",
            "--refmap=",
            "origin",
            &format!("+refs/heads/main:{UPSTREAM_REF}"),
        ],
    )
    .and_then(|_| git(path, &["rev-parse", UPSTREAM_REF]));

    let cached = upstream
        .is_none()
        .then(|| git(path, &["rev-parse", "--verify", UPSTREAM_REF]))
        .flatten();
    let base = upstream
        .as_deref()
        .or(cached.as_deref())
        .map(str::trim)
        .unwrap_or("HEAD");
    let Some(changed) = changed_files(path, base) else {
        return StandardsStatus {
            message: "Warning: the shared standards checkout could not be compared.".into(),
            warning: true,
            changed: BTreeSet::new(),
        };
    };
    let warning = !changed.is_empty();
    let target = if upstream.is_some() {
        "GitHub main"
    } else if cached.is_some() {
        "the last checked GitHub revision"
    } else {
        "the local Git revision"
    };
    let mut message = if warning {
        format!(
            "Warning: {} standards TOML file(s) differ from {target}.",
            changed.len()
        )
    } else {
        String::new()
    };
    if upstream.is_none() {
        if warning {
            message.push(' ');
        }
        message
            .push_str("GitHub standards check unavailable. Check your connection and Git access.");
    } else if !warning {
        message.push_str("Standards match GitHub main.");
    }
    StandardsStatus {
        message,
        warning,
        changed,
    }
}

#[tauri::command]
pub(crate) async fn standards_check(app: AppHandle) -> Result<StandardsStatus, String> {
    let path = match std::env::var_os("UPB_STANDARDS_DIR").filter(|path| !path.is_empty()) {
        Some(path) => PathBuf::from(path),
        None => app
            .path()
            .home_dir()
            .map_err(|error| error.to_string())?
            .join("UPbRPy")
            .join("upb-standards"),
    };
    tauri::async_runtime::spawn_blocking(move || check(&path))
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_local_toml_edits_when_github_is_unavailable() {
        let path = std::env::temp_dir().join(format!(
            "upblab-standards-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        std::fs::create_dir(&path).unwrap();
        git(&path, &["init", "-b", "main"]).expect("initialize standards fixture");
        std::fs::write(path.join("library.toml"), "version = 1\n").unwrap();
        git(&path, &["add", "library.toml"]).expect("stage standards fixture");
        git(
            &path,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "-m",
                "Fixture",
            ],
        )
        .expect("commit standards fixture");
        assert!(!check(&path).warning);

        std::fs::write(path.join("library.toml"), "version = 2\n").unwrap();
        std::fs::write(path.join("README.md"), "Notes\n").unwrap();
        let status = check(&path);
        std::fs::remove_dir_all(path).unwrap();
        assert!(status.warning);
        assert_eq!(status.changed, BTreeSet::from(["library.toml".into()]));
        assert!(status
            .message
            .contains("GitHub standards check unavailable"));
    }
}

//! Inspect Studio bundle manifests only. Never open raw data or project contents.
use chrono::{DateTime, SecondsFormat, Utc};
use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
pub struct LocalSession {
    pub path: String,
    pub key: String,
    pub id: Option<String>,
    pub material: Option<String>,
    pub kind: Option<String>,
    pub started_at: Option<String>,
    pub acquisitions: usize,
    pub has_project: bool,
    pub modified: String,
}
pub(crate) fn root() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("UPBRPY_SESSION_CACHE").filter(|p| !p.is_empty()) {
        let path = PathBuf::from(path);
        if let Ok(tail) = path.strip_prefix("~") {
            let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                .ok_or("home directory is unavailable")?;
            return Ok(PathBuf::from(home).join(tail));
        }
        return Ok(path);
    }
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .ok_or("home directory is unavailable")?;
    Ok(PathBuf::from(home).join("UPbRPy/sessions"))
}
pub(crate) fn validated(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("local session root: {e}"))?;
    let folder = path
        .canonicalize()
        .map_err(|e| format!("local session folder: {e}"))?;
    if folder.parent() != Some(root.as_path()) || !folder.is_dir() {
        return Err(
            "Only a session folder directly inside the local sessions directory can be opened."
                .into(),
        );
    }
    Ok(folder)
}
fn inspect(root: &Path, folder: &Path) -> Option<LocalSession> {
    let folder = validated(root, folder).ok()?;
    let manifest = folder.join("session_manifest.toml").canonicalize().ok()?;
    if manifest.parent() != Some(folder.as_path()) {
        return None;
    }
    let file = fs::File::open(&manifest).ok()?;
    let modified: DateTime<Utc> = file.metadata().ok()?.modified().ok()?.into();
    let mut header = String::new();
    let mut acquisitions = 0;
    let mut in_header = true;
    for line in BufReader::new(file).lines() {
        let line = line.ok()?;
        if line.trim().split('#').next()?.trim() == "[[acquisition]]" {
            acquisitions += 1;
            in_header = false;
        }
        if in_header {
            if header.len() + line.len() > 256 * 1024 {
                return None;
            }
            header.push_str(&line);
            header.push('\n');
        }
    }
    let doc: toml::Value = toml::from_str(&header).ok()?;
    // Studio also reads the older UPbDB spelling, and its earliest manifests
    // omitted the format marker. Keep those local bundles visible as well.
    if let Some(format) = doc.get("format") {
        if !matches!(
            format.as_str()?,
            "laicpmsdb-session-bundle" | "upbdb-session-bundle"
        ) {
            return None;
        }
    }
    let session = doc.get("session")?.as_table()?;
    let str_field = |name: &str| {
        session
            .get(name)
            .and_then(toml::Value::as_str)
            .map(str::to_owned)
    };
    let key = str_field("key")?;
    let project = folder.join(format!("{key}.upbr"));
    let has_project = project
        .canonicalize()
        .ok()
        .is_some_and(|p| p.parent() == Some(folder.as_path()) && p.is_file());
    Some(LocalSession {
        path: folder.to_string_lossy().into_owned(),
        key,
        id: str_field("id"),
        material: str_field("material"),
        kind: str_field("kind"),
        started_at: str_field("started_at").or_else(|| {
            session
                .get("started_at")
                .and_then(toml::Value::as_datetime)
                .map(ToString::to_string)
        }),
        acquisitions,
        has_project,
        modified: modified.to_rfc3339_opts(SecondsFormat::Secs, true),
    })
}
fn list(root: &Path) -> Result<Vec<LocalSession>, String> {
    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("Could not list local sessions: {e}")),
    };
    let mut sessions: Vec<_> = entries
        .flatten()
        .filter(|e| {
            !e.file_name().to_string_lossy().contains(".superseded-")
                && e.file_type().is_ok_and(|t| t.is_dir())
        })
        .take(500)
        .filter_map(|e| inspect(root, &e.path()))
        .collect();
    sessions.sort_by(|a, b| {
        b.started_at
            .cmp(&a.started_at)
            .then_with(|| b.modified.cmp(&a.modified))
    });
    Ok(sessions)
}
#[tauri::command]
pub async fn local_sessions() -> Result<Vec<LocalSession>, String> {
    tauri::async_runtime::spawn_blocking(|| list(&root()?))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn bundle(root: &Path, key: &str) -> PathBuf {
        let folder = root.join(key);
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("session_manifest.toml"), format!("format = 'laicpmsdb-session-bundle'\n[session]\nid = 'invented-id'\nkey = '{key}'\nmaterial = 'zircon'\nstarted_at = '2026-11-17T12:00:00Z'\n[[acquisition]]\ninvalid acquisition TOML is deliberately not parsed\n[[acquisition]] # next\n")).unwrap();
        folder
    }
    #[test]
    fn local_sessions_reads_header_counts_and_skips_old_copies() {
        let dir = tempfile::tempdir().unwrap();
        let folder = bundle(dir.path(), "invented");
        fs::write(folder.join("invented.upbr"), b"not read").unwrap();
        bundle(dir.path(), "invented.superseded-old");
        let rows = list(dir.path()).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].acquisitions, 2);
        assert!(rows[0].has_project);
        assert_eq!(rows[0].id.as_deref(), Some("invented-id"));
    }
    #[test]
    fn local_sessions_supports_studios_older_manifest_format() {
        let dir = tempfile::tempdir().unwrap();
        let folder = bundle(dir.path(), "older");
        let manifest = folder.join("session_manifest.toml");
        let source = fs::read_to_string(&manifest).unwrap();
        fs::write(
            &manifest,
            source.replace("laicpmsdb-session-bundle", "upbdb-session-bundle"),
        )
        .unwrap();
        assert_eq!(list(dir.path()).unwrap().len(), 1);
        fs::write(
            &manifest,
            source.lines().skip(1).collect::<Vec<_>>().join("\n"),
        )
        .unwrap();
        assert_eq!(list(dir.path()).unwrap().len(), 1);
        fs::write(
            &manifest,
            source.replace("laicpmsdb-session-bundle", "unrelated-format"),
        )
        .unwrap();
        assert!(list(dir.path()).unwrap().is_empty());
    }
    #[test]
    fn local_sessions_caps_folders_and_rejects_outside_and_nested_paths() {
        let dir = tempfile::tempdir().unwrap();
        for n in 0..503 {
            bundle(dir.path(), &format!("s{n}"));
        }
        assert_eq!(list(dir.path()).unwrap().len(), 500);
        assert!(validated(dir.path(), &dir.path().join("s0")).is_ok());
        assert!(validated(dir.path(), dir.path()).is_err());
        let outside = tempfile::tempdir().unwrap();
        assert!(validated(dir.path(), outside.path()).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn local_sessions_never_follows_external_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let folder = bundle(outside.path(), "external");
        std::os::unix::fs::symlink(&folder, dir.path().join("external")).unwrap();
        assert!(list(dir.path()).unwrap().is_empty());
        assert!(validated(dir.path(), &dir.path().join("external")).is_err());
        let own = bundle(dir.path(), "own");
        fs::remove_file(own.join("session_manifest.toml")).unwrap();
        std::os::unix::fs::symlink(
            folder.join("session_manifest.toml"),
            own.join("session_manifest.toml"),
        )
        .unwrap();
        assert!(list(dir.path()).unwrap().is_empty());
    }
}

//! Notices from the standalone apps (grainatlas after a sync or publish,
//! UPbRPy Studio after a submit). Each app writes one small JSON file per mount
//! or session into `<app data dir>/inbox/<kind>/`, by temp file plus rename,
//! and never launches or focuses UPb Lab. The page takes the files every few
//! seconds while visible; a notice only says "check now": the page re-reads the
//! server and never trusts the revision or ids beyond looking them up.
use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, Manager, Runtime};

const KINDS: [(&str, &str); 2] = [
    ("atlas-synced", "lab.atlas.synced"),
    ("run-submitted", "lab.run.submitted"),
];
const MAX_BYTES: u64 = 4096;
const MAX_FILES: usize = 64;

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "type")]
pub enum Notice {
    #[serde(rename = "lab.atlas.synced")]
    AtlasSynced {
        mount: String,
        project: String,
        server: String,
    },
    #[serde(rename = "lab.run.submitted")]
    RunSubmitted {
        session: String,
        run: Option<String>,
        server: String,
    },
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id.as_bytes()[0].is_ascii_alphanumeric()
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._~-".contains(&c))
}

fn text<'a>(value: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(serde_json::Value::as_str)
}

/// Parse one file's bytes; anything unexpected is None (the file is still removed).
pub fn parse(kind: &str, bytes: &[u8]) -> Option<Notice> {
    let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    if value.get("v").and_then(serde_json::Value::as_u64) != Some(1) {
        return None;
    }
    let expected = KINDS.iter().find(|(dir, _)| *dir == kind)?.1;
    if text(&value, "type") != Some(expected) {
        return None;
    }
    let server = text(&value, "server")?;
    if server.len() > 2048 || !(server.starts_with("http://") || server.starts_with("https://")) {
        return None;
    }
    let server = server.to_owned();
    match kind {
        "atlas-synced" => {
            let mount = text(&value, "mount_id").filter(|id| valid_id(id))?;
            let project = text(&value, "project_uuid").filter(|id| valid_id(id))?;
            Some(Notice::AtlasSynced {
                mount: mount.into(),
                project: project.into(),
                server,
            })
        }
        _ => {
            let session = text(&value, "session_id").filter(|id| valid_id(id))?;
            let run = match value.get("run_id") {
                None | Some(serde_json::Value::Null) => None,
                Some(_) => Some(text(&value, "run_id").filter(|id| valid_id(id))?.to_owned()),
            };
            Some(Notice::RunSubmitted {
                session: session.into(),
                run,
                server,
            })
        }
    }
}

/// Read and remove every finished notice file under `root` (temp files are left alone).
pub fn take_from(root: &Path) -> Vec<Notice> {
    let mut out = Vec::new();
    for (kind, _) in KINDS {
        let Ok(entries) = std::fs::read_dir(root.join(kind)) else {
            continue;
        };
        for entry in entries.flatten().take(MAX_FILES) {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Ok(meta) = std::fs::symlink_metadata(&path) else {
                continue;
            };
            if !meta.is_file() {
                continue;
            }
            let notice = if meta.len() <= MAX_BYTES {
                std::fs::read(&path)
                    .ok()
                    .and_then(|bytes| parse(kind, &bytes))
            } else {
                None
            };
            let _ = std::fs::remove_file(&path);
            out.extend(notice);
        }
    }
    out
}

#[tauri::command]
pub fn inbox_take<R: Runtime>(app: AppHandle<R>) -> Vec<Notice> {
    match app.path().app_data_dir() {
        Ok(dir) => take_from(&dir.join("inbox")),
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_both_kinds_and_rejects_the_rest() {
        let atlas = br#"{"v":1,"type":"lab.atlas.synced","mount_id":"m-1","project_uuid":"p-1","revision":4,"server":"http://localhost:8000","at":"2026-11-14T10:00:00Z","source":"grainatlas-standalone"}"#;
        assert_eq!(
            parse("atlas-synced", atlas),
            Some(Notice::AtlasSynced {
                mount: "m-1".into(),
                project: "p-1".into(),
                server: "http://localhost:8000".into()
            })
        );
        let run = br#"{"v":1,"type":"lab.run.submitted","session_id":"s-1","run_id":"r-1","server":"https://db.test/","source":"studio"}"#;
        assert_eq!(
            parse("run-submitted", run),
            Some(Notice::RunSubmitted {
                session: "s-1".into(),
                run: Some("r-1".into()),
                server: "https://db.test/".into()
            })
        );
        for bad in [
            &br#"{"v":2,"type":"lab.atlas.synced","mount_id":"m","project_uuid":"p","server":"http://x"}"#[..],
            br#"{"v":1,"type":"lab.run.submitted","mount_id":"m","project_uuid":"p","server":"http://x"}"#,
            br#"{"v":1,"type":"lab.atlas.synced","mount_id":"../m","project_uuid":"p","server":"http://x"}"#,
            br#"{"v":1,"type":"lab.atlas.synced","mount_id":"m","project_uuid":"p","server":"file:///x"}"#,
            b"not json",
        ] {
            assert_eq!(parse("atlas-synced", bad), None);
        }
        assert_eq!(parse("run-submitted", br#"{"v":1,"type":"lab.run.submitted","session_id":"s","run_id":"a/b","server":"http://x"}"#), None);
    }

    #[test]
    fn takes_and_removes_files_but_leaves_temp_files() {
        let root = std::env::temp_dir().join(format!("upblab-inbox-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("atlas-synced")).unwrap();
        std::fs::create_dir_all(root.join("run-submitted")).unwrap();
        std::fs::write(root.join("atlas-synced/m-1.json"), br#"{"v":1,"type":"lab.atlas.synced","mount_id":"m-1","project_uuid":"p-1","server":"http://localhost:8000"}"#).unwrap();
        std::fs::write(root.join("atlas-synced/m-2.json"), b"garbage").unwrap();
        std::fs::write(root.join("atlas-synced/m-3.json"), vec![b' '; 5000]).unwrap();
        std::fs::write(root.join("atlas-synced/m-4.json.tmp"), b"{}").unwrap();
        std::fs::write(root.join("run-submitted/s-1.json"), br#"{"v":1,"type":"lab.run.submitted","session_id":"s-1","server":"http://localhost:8000"}"#).unwrap();
        let notices = take_from(&root);
        assert_eq!(notices.len(), 2);
        assert!(notices.contains(&Notice::RunSubmitted {
            session: "s-1".into(),
            run: None,
            server: "http://localhost:8000".into()
        }));
        let left: Vec<_> = std::fs::read_dir(root.join("atlas-synced"))
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .collect();
        assert_eq!(left, vec![std::ffi::OsString::from("m-4.json.tmp")]);
        assert!(take_from(&root).is_empty());
        assert!(take_from(&root.join("missing")).is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
}

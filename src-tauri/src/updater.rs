//! Signed updates, downloaded in the background and installed on request.
use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct UpdateState(Mutex<Pending>);

#[derive(Default)]
struct Pending {
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
    pub ready: bool,
}

#[derive(Clone, Serialize)]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

fn info(update: &Update, ready: bool) -> UpdateInfo {
    UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
        date: update.date.map(|date| date.to_string()),
        ready,
    }
}

#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    state: State<'_, UpdateState>,
    endpoint: String,
) -> Result<Option<UpdateInfo>, String> {
    // An empty key is valid at startup, but cannot verify a download.
    let config = app.config().plugins.0.get("updater");
    if config
        .and_then(|c| c.get("pubkey"))
        .and_then(|k| k.as_str())
        .is_none_or(|k| k.trim().is_empty())
    {
        return Err("Updater public key is not configured".into());
    }
    let url = Url::parse(&endpoint).map_err(|e| e.to_string())?;
    let update = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let mut pending = state.0.lock().map_err(|e| e.to_string())?;
    // A manual check still reaches the server; keep verified bytes only for the same release.
    let same = pending
        .update
        .as_ref()
        .zip(update.as_ref())
        .is_some_and(|(a, b)| {
            a.version == b.version && a.signature == b.signature && a.download_url == b.download_url
        });
    if !same {
        pending.bytes = None;
    }
    let out = update.as_ref().map(|u| info(u, pending.bytes.is_some()));
    pending.update = update;
    Ok(out)
}

#[tauri::command]
pub async fn update_download(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<UpdateInfo, String> {
    if !update_supported() {
        return Err("Install UPb Studio before downloading updates".into());
    }
    let update = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .update
        .clone()
        .ok_or("No update available")?;
    let mut downloaded = 0;
    let bytes = update
        .download(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = app.emit("update-progress", Progress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    let mut pending = state.0.lock().map_err(|e| e.to_string())?;
    if pending.update.as_ref().is_none_or(|u| {
        u.version != update.version
            || u.signature != update.signature
            || u.download_url != update.download_url
    }) {
        return Err("Update changed during download; check again".into());
    }
    pending.bytes = Some(bytes);
    Ok(info(&update, true))
}

#[tauri::command]
pub async fn update_install(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
    if !update_supported() {
        return Err("Install UPb Studio before updating".into());
    }
    let pending = state.0.lock().map_err(|e| e.to_string())?;
    let update = pending.update.as_ref().ok_or("No update downloaded")?;
    // Keep the verified bytes on failure so installation can be retried.
    let bytes = pending.bytes.as_ref().ok_or("No update downloaded")?;
    update.install(bytes).map_err(|e| e.to_string())?;
    drop(pending);
    app.restart();
}

#[tauri::command]
pub fn update_status(state: State<'_, UpdateState>) -> Option<UpdateInfo> {
    let pending = state.0.lock().ok()?;
    pending
        .update
        .as_ref()
        .map(|u| info(u, pending.bytes.is_some()))
}

#[tauri::command]
pub fn update_supported() -> bool {
    #[cfg(target_os = "macos")]
    {
        true
    }
    #[cfg(target_os = "windows")]
    {
        let Ok(executable) = std::env::current_exe() else {
            return false;
        };
        if executable
            .parent()
            .is_some_and(|dir| dir.join("uninstall.exe").is_file())
        {
            return true;
        }
        // MSI has no adjacent uninstaller. Accept its usual install locations too.
        let mut roots: Vec<std::path::PathBuf> =
            ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"]
                .into_iter()
                .filter_map(std::env::var_os)
                .map(Into::into)
                .collect();
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            roots.push(std::path::PathBuf::from(local).join("Programs"));
        }
        windows_install_path(&executable, &roots)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

// Windows paths are case insensitive; require a directory boundary, not just a prefix.
#[cfg(any(windows, test))]
fn windows_install_path(executable: &std::path::Path, roots: &[std::path::PathBuf]) -> bool {
    let normalize =
        |path: &std::path::Path| path.to_string_lossy().replace('\\', "/").to_lowercase();
    let executable = normalize(executable);
    roots.iter().any(|root| {
        let root = normalize(root);
        !root.is_empty() && executable.starts_with(&format!("{}/", root.trim_end_matches('/')))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    #[test]
    fn windows_installs_and_portable_copies() {
        let roots = [
            PathBuf::from(r"C:\Program Files"),
            PathBuf::from(r"C:\Users\lab\AppData\Local\Programs"),
        ];
        for path in [
            r"c:\PROGRAM FILES\UPb Studio\upbstudio.exe",
            r"C:\Users\lab\AppData\Local\Programs\UPb Studio\upbstudio.exe",
        ] {
            assert!(windows_install_path(Path::new(path), &roots));
        }
        for path in [
            r"C:\Downloads\upbstudio.exe",
            r"C:\Program Files portable\upbstudio.exe",
            r"C:\Users\lab\AppData\Local\Temp\upbstudio.exe",
        ] {
            assert!(!windows_install_path(Path::new(path), &roots));
        }
    }
}

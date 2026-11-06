//! "Open anything" at the shell level (ux-conventions rule 4): folders and
//! files dropped on the window, opened through the OS (Finder "Open with",
//! the Dock icon, a Windows file association or folder verb) or picked with
//! Home's Open buttons.
//!
//! The host only lists and reads files. The shell page decides where a set
//! goes (`ui/src/lib/drop.ts`, by content, never asking), then makes an
//! *offer* to that module's webview: a manifest of names and sizes the module
//! takes with `bridge_open_files` and reads file by file with
//! `bridge_read_file` (@lab/bridge protocol v2, `open-files`). A module
//! webview cannot read host paths itself, and only ever reads the files of the
//! offer made to it.

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, DragDropEvent, Emitter, EventTarget, Manager, Runtime, State, Webview, WebviewEvent};

use crate::bridge::module_name;
use crate::SHELL_WEBVIEW;

/// Folder depth walked below a dropped folder (a TM4000 package is two deep).
const MAX_DEPTH: usize = 4;
/// Files listed per scan; more is not something a lab module opens at once.
const MAX_ENTRIES: usize = 20_000;
/// Largest single file handed to a module.
const MAX_FILE: u64 = 2 << 30;
/// Scans kept for a later offer (the shell offers right after scanning).
const KEEP_SCANS: usize = 4;

/// Kinds a module may be told (bridge/src/protocol.ts `OpenFilesKind`).
const KINDS: [&str; 7] = ["package", "area", "images", "project", "export", "zip", "csv"];

/// Shell events (names mirrored in ui/src/lib/incoming.ts).
pub const EVENT_DROP: &str = "shell://drop";
pub const EVENT_DRAG: &str = "shell://drag";
pub const EVENT_OPENED: &str = "shell://opened";
pub const EVENT_TAKEN: &str = "lab-bridge://files-taken";
/// DOM event dispatched in a module webview when files wait for it
/// (bridge/src/protocol.ts `OPEN_FILES_EVENT`).
const OPEN_FILES_EVENT: &str = "lab-bridge:open-files";

struct Entry {
    abs: PathBuf,
    root: usize,
    rel: String,
    size: u64,
    modified: u64,
}

struct Scan {
    id: String,
    entries: Vec<Entry>,
}

struct OfferFile {
    abs: PathBuf,
    path: String,
    size: u64,
    modified: u64,
}

struct Offer {
    id: String,
    kind: String,
    name: String,
    path: Option<String>,
    files: Vec<OfferFile>,
    taken: bool,
}

#[derive(Default)]
pub struct Files {
    scans: Mutex<Vec<Scan>>,
    /// Webview label -> the latest offer to it (a new drop replaces the old one).
    offers: Mutex<HashMap<String, Offer>>,
    /// Paths the OS asked us to open (argv on Windows) before the shell asked for them.
    opened: Mutex<Vec<String>>,
    counter: AtomicU64,
}

impl Files {
    fn next_id(&self, prefix: &str) -> String {
        let n = self.counter.fetch_add(1, Ordering::Relaxed) + 1;
        let t = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        format!("{prefix}{t:x}-{n}")
    }
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Root {
    pub path: String,
    pub name: String,
    pub dir: bool,
}

#[derive(Debug, Serialize)]
pub struct Listed {
    root: usize,
    rel: String,
    size: u64,
}

#[derive(Serialize)]
pub struct ScanOut {
    scan: String,
    roots: Vec<Root>,
    entries: Vec<Listed>,
    truncated: bool,
    /// Paths that do not exist or could not be read.
    missing: Vec<String>,
}

#[derive(Deserialize)]
pub struct OfferPick {
    index: usize,
    path: String,
}

#[derive(Serialize)]
pub struct OfferOut {
    id: String,
    files: usize,
    bytes: u64,
    /// Whether the module's webview exists and was told.
    nudged: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    path: String,
    size: u64,
    last_modified: u64,
    #[serde(rename = "type")]
    mime: &'static str,
}

#[derive(Serialize)]
pub struct Manifest {
    id: String,
    kind: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    files: Vec<ManifestEntry>,
}

fn modified_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn hidden(name: &str) -> bool {
    name.starts_with('.') || name.eq_ignore_ascii_case("Thumbs.db") || name.eq_ignore_ascii_case("desktop.ini")
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string_lossy().into_owned())
}

/// List the files under `paths`: each file itself, each folder walked
/// `MAX_DEPTH` deep. Hidden files and symbolic links inside folders are
/// skipped. Returns the roots, the entries sorted by root and path, the
/// paths that could not be read, and whether the listing was cut short.
fn walk(paths: &[PathBuf]) -> (Vec<Root>, Vec<Entry>, Vec<String>, bool) {
    let mut roots = Vec::new();
    let mut entries = Vec::new();
    let mut missing = Vec::new();
    let mut truncated = false;
    for path in paths {
        let Ok(meta) = std::fs::metadata(path) else {
            missing.push(path.to_string_lossy().into_owned());
            continue;
        };
        let root = roots.len();
        roots.push(Root { path: path.to_string_lossy().into_owned(), name: file_name(path), dir: meta.is_dir() });
        if meta.is_file() {
            if entries.len() >= MAX_ENTRIES {
                truncated = true;
                continue;
            }
            entries.push(Entry { abs: path.clone(), root, rel: file_name(path), size: meta.len(), modified: modified_ms(&meta) });
            continue;
        }
        let mut stack = vec![(path.clone(), String::new(), 0usize)];
        while let Some((dir, prefix, depth)) = stack.pop() {
            let Ok(read) = std::fs::read_dir(&dir) else {
                missing.push(dir.to_string_lossy().into_owned());
                continue;
            };
            for item in read.flatten() {
                let name = item.file_name().to_string_lossy().into_owned();
                if hidden(&name) {
                    continue;
                }
                let Ok(meta) = std::fs::symlink_metadata(item.path()) else { continue };
                let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
                if meta.is_dir() {
                    if depth + 1 <= MAX_DEPTH {
                        stack.push((item.path(), rel, depth + 1));
                    }
                } else if meta.is_file() {
                    if entries.len() >= MAX_ENTRIES {
                        truncated = true;
                        break;
                    }
                    entries.push(Entry { abs: item.path(), root, rel, size: meta.len(), modified: modified_ms(&meta) });
                }
            }
        }
    }
    entries.sort_by(|a, b| (a.root, &a.rel).cmp(&(b.root, &b.rel)));
    (roots, entries, missing, truncated)
}

/// MIME type from the extension, for the `File` the module gets.
fn mime(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "tif" | "tiff" => "image/tiff",
        "bmp" => "image/bmp",
        "txt" | "ini" => "text/plain",
        "xml" => "application/xml",
        "csv" => "text/csv",
        "json" => "application/json",
        "zip" => "application/zip",
        _ => "",
    }
}

/// A path a module sees: relative, `/`-separated, no `..`.
fn safe_rel(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 1024
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.contains(':')
        && path.split('/').all(|s| !s.is_empty() && s != "." && s != "..")
}

/// Paths in a command line that name existing files or folders (Windows file
/// associations and the folder verb pass them as arguments). Flags and URLs
/// are left to the deep-link plugin.
pub fn paths_in_args<I: IntoIterator<Item = OsString>>(args: I) -> Vec<String> {
    args.into_iter()
        .filter_map(|a| {
            let s = a.to_string_lossy().into_owned();
            if s.starts_with('-') || s.contains("://") {
                return None;
            }
            Path::new(&s).exists().then_some(s)
        })
        .collect()
}

/// Remember paths from the OS and tell the shell (it takes them with `files_take_opened`).
pub fn push_opened<R: Runtime>(app: &AppHandle<R>, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    log::info!("asked to open {} path(s): {:?}", paths.len(), paths);
    let state = app.state::<Files>();
    if let Ok(mut opened) = state.opened.lock() {
        opened.extend(paths);
    }
    let _ = app.emit_to(EventTarget::webview(SHELL_WEBVIEW), EVENT_OPENED, ());
}

#[derive(Clone, Serialize)]
struct DropPayload {
    paths: Vec<String>,
    /// The module whose area received the drop, or `shell`.
    over: String,
}

/// Every webview keeps Tauri's drag-and-drop handler, so a drop anywhere in
/// the window (tab bar, Home, a module tab) arrives here with host paths and
/// goes to the shell's router.
pub fn on_webview_event<R: Runtime>(webview: &Webview<R>, event: &WebviewEvent) {
    let WebviewEvent::DragDrop(drag) = event else { return };
    let app = webview.app_handle();
    let shell = EventTarget::webview(SHELL_WEBVIEW);
    match drag {
        DragDropEvent::Enter { .. } => {
            let _ = app.emit_to(shell, EVENT_DRAG, true);
        }
        DragDropEvent::Leave => {
            let _ = app.emit_to(shell, EVENT_DRAG, false);
        }
        DragDropEvent::Drop { paths, .. } => {
            let _ = app.emit_to(shell.clone(), EVENT_DRAG, false);
            let paths: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
            log::info!("dropped on {}: {:?}", module_name(webview.label()), paths);
            let over = if webview.label() == SHELL_WEBVIEW { "shell".into() } else { module_name(webview.label()).to_string() };
            let _ = app.emit_to(shell, EVENT_DROP, DropPayload { paths, over });
        }
        _ => {}
    }
}

/// Debug builds only: if a module has not taken its files three seconds after
/// the nudge or after its page loaded (it does not read `open-files` yet),
/// read them anyway from inside its webview and report what arrived, so the
/// log shows the files reached it.
pub fn probe_script() -> &'static str {
    if !cfg!(debug_assertions) {
        return "";
    }
    r#"
(() => {
  const inv = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
  if (!inv) return;
  const probe = () => setTimeout(async () => {
    try {
      const m = await inv('bridge_open_files', { take: false });
      if (!m) return;
      let bytes = 0;
      for (let i = 0; i < m.files.length; i++) {
        const b = await inv('bridge_read_file', { id: m.id, index: i });
        bytes += b.byteLength ?? b.length ?? 0;
      }
      await inv('bridge_notify', { event: { type: 'lab.open-files.seen', id: m.id, kind: m.kind, name: m.name, files: m.files.length, bytes, first: m.files[0] && m.files[0].path } });
    } catch (err) {
      console.warn('[lab-shell] open-files probe', err);
    }
  }, 3000);
  window.addEventListener('lab-bridge:open-files', probe);
  window.addEventListener('load', probe);
})();
"#
}

pub(crate) fn module_label(module: &str) -> Result<&'static str, String> {
    match module {
        "images" => Ok("module-images"),
        "sessions" => Ok("module-sessions"),
        other => Err(format!("unknown module tab {other:?}")),
    }
}

/// Shell: list what was dropped or opened.
#[tauri::command]
pub async fn files_scan(state: State<'_, Files>, paths: Vec<String>) -> Result<ScanOut, String> {
    if paths.is_empty() || paths.len() > 1000 {
        return Err("nothing to open".into());
    }
    let bufs: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    let (roots, entries, missing, truncated) = tauri::async_runtime::spawn_blocking(move || walk(&bufs))
        .await
        .map_err(|e| e.to_string())?;
    let id = state.next_id("s");
    let listed = entries.iter().map(|e| Listed { root: e.root, rel: e.rel.clone(), size: e.size }).collect();
    let mut scans = state.scans.lock().map_err(|e| e.to_string())?;
    scans.push(Scan { id: id.clone(), entries });
    let excess = scans.len().saturating_sub(KEEP_SCANS);
    scans.drain(..excess);
    Ok(ScanOut { scan: id, roots, entries: listed, truncated, missing })
}

/// Shell: offer files of a scan to a module tab, replacing any earlier offer.
/// `nudge`: tell the module's webview now, if it exists; the shell passes
/// false when it is about to load a new page there (laicpmsdb's ingest
/// route), which takes the files when its bridge starts.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn files_offer<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, Files>,
    scan: String,
    module: String,
    files: Vec<OfferPick>,
    kind: String,
    name: String,
    path: Option<String>,
    nudge: Option<bool>,
) -> Result<OfferOut, String> {
    let label = module_label(&module)?;
    if !KINDS.contains(&kind.as_str()) {
        return Err(format!("unknown kind {kind:?}"));
    }
    if files.is_empty() {
        return Err("no files to offer".into());
    }
    let scans = state.scans.lock().map_err(|e| e.to_string())?;
    let found = scans.iter().find(|s| s.id == scan).ok_or("scan expired; drop the files again")?;
    let mut picked = Vec::with_capacity(files.len());
    for f in &files {
        let e = found.entries.get(f.index).ok_or("file index out of range")?;
        if !safe_rel(&f.path) {
            return Err(format!("invalid file path {:?}", f.path));
        }
        picked.push(OfferFile { abs: e.abs.clone(), path: f.path.clone(), size: e.size, modified: e.modified });
    }
    drop(scans);
    let id = state.next_id("o");
    let bytes = picked.iter().map(|f| f.size).sum();
    let count = picked.len();
    let name: String = name.chars().filter(|c| !c.is_control()).take(200).collect();
    log::info!("open-files {id}: {count} file(s), {bytes} bytes, {kind} {name:?} offered to {}", module_name(label));
    state.offers.lock().map_err(|e| e.to_string())?.insert(
        label.to_string(),
        Offer { id: id.clone(), kind, name, path, files: picked, taken: false },
    );
    let nudged = match app.get_webview(label).filter(|_| nudge.unwrap_or(true)) {
        Some(wv) => {
            let js = format!("window.dispatchEvent(new CustomEvent({OPEN_FILES_EVENT:?}, {{ detail: {{ id: {id:?} }} }}));");
            wv.eval(js).is_ok()
        }
        None => false,
    };
    Ok(OfferOut { id, files: count, bytes, nudged })
}

/// Shell: paths the OS asked to open since the last call.
#[tauri::command]
pub fn files_take_opened(state: State<'_, Files>) -> Vec<String> {
    state.opened.lock().map(|mut o| std::mem::take(&mut *o)).unwrap_or_default()
}

#[derive(Clone, Serialize)]
struct TakenPayload<'a> {
    id: &'a str,
    source: &'a str,
    files: usize,
    bytes: u64,
}

/// Module (protocol v2): the files waiting for this webview, or null.
/// `take` (default true) marks them taken, so they are delivered once; the
/// bytes stay readable until the next offer replaces them.
#[tauri::command]
pub fn bridge_open_files<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, Files>,
    webview: Webview<R>,
    take: Option<bool>,
) -> Result<Option<Manifest>, String> {
    let mut offers = state.offers.lock().map_err(|e| e.to_string())?;
    let Some(offer) = offers.get_mut(webview.label()) else { return Ok(None) };
    if offer.taken {
        return Ok(None);
    }
    let take = take.unwrap_or(true);
    if take {
        offer.taken = true;
        let bytes = offer.files.iter().map(|f| f.size).sum();
        let source = module_name(webview.label());
        log::info!("open-files {}: taken by {source}", offer.id);
        let _ = app.emit_to(
            EventTarget::webview(SHELL_WEBVIEW),
            EVENT_TAKEN,
            TakenPayload { id: &offer.id, source, files: offer.files.len(), bytes },
        );
    }
    Ok(Some(Manifest {
        id: offer.id.clone(),
        kind: offer.kind.clone(),
        name: offer.name.clone(),
        path: offer.path.clone(),
        files: offer
            .files
            .iter()
            .map(|f| ManifestEntry { path: f.path.clone(), size: f.size, last_modified: f.modified, mime: mime(&f.path) })
            .collect(),
    }))
}

/// Module (protocol v2): the bytes of one file of the offer made to this webview.
#[tauri::command]
pub async fn bridge_read_file<R: Runtime>(
    state: State<'_, Files>,
    webview: Webview<R>,
    id: String,
    index: usize,
) -> Result<tauri::ipc::Response, String> {
    let abs = {
        let offers = state.offers.lock().map_err(|e| e.to_string())?;
        let offer = offers.get(webview.label()).filter(|o| o.id == id).ok_or("no such offer for this module")?;
        let file = offer.files.get(index).ok_or("file index out of range")?;
        if file.size > MAX_FILE {
            return Err(format!("{} is too large to hand over", file.path));
        }
        file.abs.clone()
    };
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(&abs))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("could not read the file: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("upbstudio-files-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn walks_folders_and_files_skipping_hidden() {
        let dir = tmp("walk");
        let pkg = dir.join("Mount_XS_150X");
        fs::create_dir_all(pkg.join("001_HJ-GC1")).unwrap();
        fs::write(pkg.join("Mount_XS_150X.zag"), "z").unwrap();
        fs::write(pkg.join(".DS_Store"), "x").unwrap();
        fs::write(pkg.join("001_HJ-GC1/001_HJ-GC1_0000.jpg"), "jpg").unwrap();
        fs::write(pkg.join("001_HJ-GC1/001_HJ-GC1_0000.txt"), "t").unwrap();
        let loose = dir.join("a.csv");
        fs::write(&loose, "1,2").unwrap();
        let (roots, entries, missing, truncated) = walk(&[pkg.clone(), loose, dir.join("nope")]);
        assert_eq!(roots.len(), 2);
        assert_eq!(roots[0].name, "Mount_XS_150X");
        assert!(roots[0].dir);
        assert!(!roots[1].dir);
        let rels: Vec<_> = entries.iter().map(|e| (e.root, e.rel.as_str())).collect();
        assert_eq!(
            rels,
            vec![
                (0, "001_HJ-GC1/001_HJ-GC1_0000.jpg"),
                (0, "001_HJ-GC1/001_HJ-GC1_0000.txt"),
                (0, "Mount_XS_150X.zag"),
                (1, "a.csv"),
            ]
        );
        assert_eq!(entries[0].size, 3);
        assert_eq!(missing.len(), 1);
        assert!(!truncated);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn depth_is_limited() {
        let dir = tmp("depth");
        let deep = dir.join("a/b/c/d/e/f");
        fs::create_dir_all(&deep).unwrap();
        fs::write(dir.join("a/b/c/d/x.jpg"), "1").unwrap();
        fs::write(deep.join("y.jpg"), "1").unwrap();
        let (_, entries, _, _) = walk(&[dir.join("a")]);
        let rels: Vec<_> = entries.iter().map(|e| e.rel.as_str()).collect();
        assert_eq!(rels, vec!["b/c/d/x.jpg"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn module_paths_are_relative_and_tame() {
        assert!(safe_rel("001_HJ-GC1/001_HJ-GC1_0000.jpg"));
        assert!(safe_rel("a.csv"));
        assert!(!safe_rel("../etc/passwd"));
        assert!(!safe_rel("/abs"));
        assert!(!safe_rel("C:/x"));
        assert!(!safe_rel("a\\b"));
        assert!(!safe_rel("a//b"));
        assert!(!safe_rel(""));
    }

    #[test]
    fn args_keep_existing_paths_only() {
        let dir = tmp("args");
        let zag = dir.join("p.zag");
        fs::write(&zag, "z").unwrap();
        let args = vec![
            OsString::from("--flag"),
            OsString::from("laicpmsdb://session/x"),
            zag.clone().into_os_string(),
            OsString::from("/definitely/not/here"),
            dir.clone().into_os_string(),
        ];
        assert_eq!(paths_in_args(args), vec![zag.to_string_lossy().into_owned(), dir.to_string_lossy().into_owned()]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn mime_from_extension() {
        assert_eq!(mime("a/B.JPG"), "image/jpeg");
        assert_eq!(mime("x.tif"), "image/tiff");
        assert_eq!(mime("s.csv"), "text/csv");
        assert_eq!(mime("p.zag"), "");
    }

    #[test]
    fn labels_for_known_tabs_only() {
        assert_eq!(module_label("images").unwrap(), "module-images");
        assert!(module_label("shell").is_err());
    }
}

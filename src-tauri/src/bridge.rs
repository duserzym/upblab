//! Host side of @lab/bridge's Tauri transport. Module webviews call these
//! commands (allowed by capabilities/modules.json and, for the remote
//! laicpmsdb origin, by the runtime capability in modules.rs); the host
//! re-emits them as events to the shell webview, which owns link routing.
//! Event names match `EVENTS` in bridge/src/protocol.ts.

use serde::Serialize;
use tauri::{AppHandle, Emitter, EventTarget, Runtime, Webview};

use crate::SHELL_WEBVIEW;

pub const EVENT_OPEN: &str = "lab-bridge://open";
pub const EVENT_NOTIFY: &str = "lab-bridge://notify";

#[derive(Clone, Serialize)]
struct OpenPayload<'a> {
    url: &'a str,
    source: &'a str,
}

#[derive(Clone, Serialize)]
struct NotifyPayload<'a> {
    event: &'a serde_json::Value,
    source: &'a str,
}

/// The module a webview hosts, as the shell names it in link logs.
pub fn module_name(webview_label: &str) -> &str {
    match webview_label {
        "module-images" => "grainatlas",
        "module-sessions" => "laicpmsdb",
        other => other,
    }
}

/// Hand a URL to the shell's resolver (also used for intercepted navigations).
pub fn forward_open<R: Runtime>(app: &AppHandle<R>, url: &str, webview_label: &str) -> bool {
    let payload = OpenPayload { url, source: module_name(webview_label) };
    match app.emit_to(EventTarget::webview(SHELL_WEBVIEW), EVENT_OPEN, payload) {
        Ok(()) => true,
        Err(err) => {
            log::warn!("could not forward {url} from {webview_label}: {err}");
            false
        }
    }
}

#[tauri::command]
pub fn bridge_open<R: Runtime>(app: AppHandle<R>, webview: Webview<R>, url: String) -> bool {
    if url.len() > 4096 {
        log::warn!("refused oversized link from {}", webview.label());
        return false;
    }
    forward_open(&app, &url, webview.label())
}

/// The laicpmsdb bearer token for module webviews. Single sign-in with the
/// token in the OS keychain is roadmap phase 3; until then modules sign in
/// themselves and this returns `None`.
#[tauri::command]
pub fn bridge_token<R: Runtime>(_webview: Webview<R>) -> Option<String> {
    None
}

#[tauri::command]
pub fn bridge_notify<R: Runtime>(app: AppHandle<R>, webview: Webview<R>, event: serde_json::Value) {
    let ok = event.get("type").and_then(|t| t.as_str()).is_some();
    if !ok {
        log::warn!("ignored bridge event without a type from {}", webview.label());
        return;
    }
    let payload = NotifyPayload { event: &event, source: module_name(webview.label()) };
    if let Err(err) = app.emit_to(EventTarget::webview(SHELL_WEBVIEW), EVENT_NOTIFY, payload) {
        log::warn!("could not forward bridge event: {err}");
    }
}

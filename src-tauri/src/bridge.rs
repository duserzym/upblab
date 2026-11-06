//! Host side of @lab/bridge's Tauri transport. Module webviews call these
//! commands (allowed by capabilities/modules.json and, for the remote
//! laicpmsdb origin, by the runtime capability in modules.rs); the host
//! re-emits them as events to the shell webview, which owns link routing.
//! Event names match `EVENTS` in bridge/src/protocol.ts.

use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime, State, Webview};

use crate::auth::{token_for, Identity};

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
    let payload = OpenPayload {
        url,
        source: module_name(webview_label),
    };
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

/// The laicpmsdb bearer token of the shell's sign-in (plan decision 5), for
/// the bundled grainatlas build and for pages of the configured server only;
/// `None` when signed out. See `auth::token_for`.
#[tauri::command]
pub async fn bridge_token<R: Runtime>(
    identity: State<'_, Identity>,
    webview: Webview<R>,
) -> Result<Option<String>, String> {
    let token = token_for(&identity, &webview).await;
    log::info!(
        "bridge token() for {}: {}",
        module_name(webview.label()),
        if token.is_some() { "token" } else { "null" }
    );
    Ok(token)
}

#[tauri::command]
pub fn bridge_notify<R: Runtime>(app: AppHandle<R>, webview: Webview<R>, event: serde_json::Value) {
    let ok = event.get("type").and_then(|t| t.as_str()).is_some();
    if !ok {
        log::warn!(
            "ignored bridge event without a type from {}",
            webview.label()
        );
        return;
    }
    let payload = NotifyPayload {
        event: &event,
        source: module_name(webview.label()),
    };
    if let Err(err) = app.emit_to(EventTarget::webview(SHELL_WEBVIEW), EVENT_NOTIFY, payload) {
        log::warn!("could not forward bridge event: {err}");
    }
}

const COMMAND_EVENT: &str = "lab-bridge:command";

/// Only the latest untaken command for each module webview matters.
#[derive(Default)]
pub struct Commands {
    waiting: Mutex<HashMap<String, Value>>,
    sequence: AtomicU64,
}

fn valid_id(value: Option<&Value>) -> bool {
    value.and_then(Value::as_str).is_some_and(|id| {
        (1..=128).contains(&id.len())
            && id.as_bytes()[0].is_ascii_alphanumeric()
            && id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"._~-".contains(&c))
    })
}

fn valid_grain(value: Option<&Value>) -> bool {
    value.and_then(Value::as_str).is_some_and(|grain| {
        let parts: Vec<_> = grain.split('/').collect();
        parts.len() <= 2
            && parts
                .iter()
                .all(|part| valid_id(Some(&Value::String((*part).into()))))
    })
}

fn valid_command(command: &Value) -> bool {
    if !valid_id(command.get("project"))
        || command.get("flash").is_some_and(|v| !v.is_boolean())
        || command.get("via").is_some_and(|v| !v.is_string())
    {
        return false;
    }
    match command.get("type").and_then(Value::as_str) {
        Some("focus-spot") => valid_id(command.get("spot")),
        Some("focus-grain") => {
            valid_grain(command.get("grain"))
                && command.get("spot").is_none_or(|v| valid_id(Some(v)))
        }
        _ => false,
    }
}

impl Commands {
    fn store(&self, label: &str, command: Value) -> Result<u64, String> {
        if !valid_command(&command) {
            return Err("invalid bridge command".into());
        }
        self.waiting
            .lock()
            .map_err(|e| e.to_string())?
            .insert(label.into(), command);
        Ok(self.sequence.fetch_add(1, Ordering::Relaxed))
    }

    fn take(&self, label: &str) -> Result<Option<Value>, String> {
        Ok(self
            .waiting
            .lock()
            .map_err(|e| e.to_string())?
            .remove(label))
    }
}

/// Shell only: queue a command even if the module has not loaded yet.
#[tauri::command]
pub fn module_command<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, Commands>,
    module: String,
    command: Value,
) -> Result<bool, String> {
    let label = crate::files::module_label(&module)?;
    let id = state.store(label, command)?;
    let Some(webview) = app.get_webview(label) else {
        return Ok(false);
    };
    let js = format!(
        "window.dispatchEvent(new CustomEvent({COMMAND_EVENT:?}, {{ detail: {{ id: {id} }} }}));"
    );
    if let Err(err) = webview.eval(js) {
        log::warn!("could not nudge command for {label}: {err}");
    }
    Ok(true)
}

/// Module only: callers can take only their own webview's command, once.
#[tauri::command]
pub fn bridge_take_command<R: Runtime>(
    state: State<'_, Commands>,
    webview: Webview<R>,
) -> Result<Option<Value>, String> {
    state.take(webview.label())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn commands_validate_ids_and_optional_fields() {
        let spot = json!({"type": "focus-spot", "project": "p._~-", "spot": "s", "flash": true, "via": "review"});
        assert!(valid_command(&spot));
        for id in ["", "-bad", "a/b", "a b", "a?b", "é", "a\n"] {
            let mut command = spot.clone();
            command["project"] = json!(id);
            assert!(!valid_command(&command), "accepted {id:?}");
            command = spot.clone();
            command["spot"] = json!(id);
            assert!(!valid_command(&command), "accepted {id:?}");
        }
        assert!(valid_command(
            &json!({"type": "focus-spot", "project": "a".repeat(128), "spot": "s"})
        ));
        assert!(!valid_command(
            &json!({"type": "focus-spot", "project": "a".repeat(129), "spot": "s"})
        ));
        for grain in ["g", "area/12", "a._~/1-2"] {
            assert!(valid_command(
                &json!({"type": "focus-grain", "project": "p", "grain": grain, "spot": "s"})
            ));
        }
        for grain in ["", "/g", "g/", "a/b/c", "a//b", "a/../b"] {
            assert!(!valid_command(
                &json!({"type": "focus-grain", "project": "p", "grain": grain})
            ));
        }
        for (field, value) in [
            ("flash", json!("yes")),
            ("via", json!(true)),
            ("spot", Value::Null),
            ("type", json!("future")),
        ] {
            let mut command = spot.clone();
            command[field] = value;
            assert!(!valid_command(&command));
        }
        assert!(!valid_command(&Value::Null));
    }

    #[test]
    fn newest_command_is_taken_once_by_its_webview_only() {
        let state = Commands::default();
        let first = json!({"type": "focus-spot", "project": "p", "spot": "first"});
        let latest = json!({"type": "focus-grain", "project": "p", "grain": "a/2"});
        state.store("module-images", first.clone()).unwrap();
        state.store("module-images", latest.clone()).unwrap();
        state.store("module-sessions", first.clone()).unwrap();
        assert!(state
            .store("module-images", json!({"type": "future"}))
            .is_err());
        assert_eq!(state.take("shell").unwrap(), None);
        assert_eq!(state.take("module-images").unwrap(), Some(latest));
        assert_eq!(state.take("module-images").unwrap(), None);
        assert_eq!(state.take("module-sessions").unwrap(), Some(first));
    }
}

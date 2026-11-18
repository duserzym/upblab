//! Host side of @lab/bridge's Tauri transport. Module webviews call these
//! commands (allowed by capabilities/modules.json and, for the remote
//! UPbDB origin, by the runtime capability in modules.rs); the host
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
        "module-sessions" | "module-people" => "upbdb",
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

/// The UPbDB bearer token of the shell's sign-in (plan decision 5), for
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

pub const THEME_EVENT: &str = "lab-bridge:theme";

/// The shell resolves System; the host only stores and forwards that value.
pub struct ThemeState(Mutex<String>);

impl Default for ThemeState {
    fn default() -> Self {
        Self(Mutex::new("light".into()))
    }
}

pub fn valid_theme(theme: &str) -> bool {
    matches!(theme, "light" | "dark")
}

impl ThemeState {
    pub fn current(&self) -> Result<String, String> {
        self.0
            .lock()
            .map(|value| value.clone())
            .map_err(|e| e.to_string())
    }

    fn set(&self, theme: &str) -> Result<(), String> {
        if !valid_theme(theme) {
            return Err("invalid bridge theme".into());
        }
        *self.0.lock().map_err(|e| e.to_string())? = theme.into();
        Ok(())
    }
}

/// One eval updates older modules and notifies bridge-aware modules. The
/// observer also handles document-start, before an <html> element exists.
pub fn theme_script(theme: &str) -> Result<String, String> {
    if !valid_theme(theme) {
        return Err("invalid bridge theme".into());
    }
    Ok(format!(
        "(() => {{ const theme = {theme:?}; const apply = () => {{ if (!document.documentElement) return false; document.documentElement.setAttribute('data-theme', theme); window.dispatchEvent(new CustomEvent({THEME_EVENT:?}, {{ detail: {{ theme }} }})); return true; }}; if (!apply()) {{ const observer = new MutationObserver(() => {{ if (apply()) observer.disconnect(); }}); observer.observe(document, {{ childList: true }}); }} }})();"
    ))
}

/// Shell-only command: update all existing module webviews, including hidden ones.
#[tauri::command]
pub fn module_theme<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, ThemeState>,
    theme: String,
) -> Result<(), String> {
    state.set(&theme)?;
    let script = theme_script(&theme)?;
    if let Some(window) = app.get_window("main") {
        let native = if theme == "dark" {
            tauri::Theme::Dark
        } else {
            tauri::Theme::Light
        };
        window
            .set_theme(Some(native))
            .map_err(|err| err.to_string())?;
    }
    for label in ["module-images", "module-sessions", "module-people"] {
        if let Some(webview) = app.get_webview(label) {
            if let Err(err) = webview.eval(&script) {
                log::warn!("could not publish theme to {label}: {err}");
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn bridge_theme(state: State<'_, ThemeState>) -> Result<String, String> {
    state.current()
}

/// v5.3: only the shell can change scope; modules may read and observe it.
#[derive(Clone, Default, serde::Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Oversight {
    pub view_as: Option<ViewAs>,
    pub on_behalf: bool,
}
#[derive(Clone, serde::Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ViewAs {
    pub username: String,
    pub name: String,
}
#[derive(Default)]
pub struct OversightState(Mutex<Oversight>);
impl OversightState {
    pub fn current(&self) -> Result<Oversight, String> {
        self.0.lock().map(|v| v.clone()).map_err(|e| e.to_string())
    }
    pub fn writable(&self) -> Result<(), String> {
        if self.current()?.view_as.is_some() {
            Err("Viewing as another account is read-only".into())
        } else {
            Ok(())
        }
    }
}
pub fn oversight_script(value: &Oversight) -> Result<String, String> {
    let json = serde_json::to_string(value).map_err(|e| e.to_string())?;
    Ok(format!(
        "window.dispatchEvent(new CustomEvent('lab-bridge:oversight', {{ detail: {json} }}));"
    ))
}
#[tauri::command]
pub fn bridge_oversight(state: State<'_, OversightState>) -> Result<Oversight, String> {
    state.current()
}
#[tauri::command]
pub fn module_oversight<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, OversightState>,
    oversight: Oversight,
) -> Result<(), String> {
    if oversight
        .view_as
        .as_ref()
        .is_some_and(|v| v.username.is_empty() || v.username.len() > 200 || v.name.len() > 500)
    {
        return Err("Invalid oversight account".into());
    }
    let script = oversight_script(&oversight)?;
    *state.0.lock().map_err(|e| e.to_string())? = oversight;
    for label in ["module-images", "module-sessions", "module-people"] {
        if let Some(webview) = app.get_webview(label) {
            webview.eval(&script).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

const COMMAND_EVENT: &str = "lab-bridge:command";

/// Keep presentation independently so a tab switch cannot replace a pending focus.
#[derive(Default)]
struct PendingCommands {
    command: Option<Value>,
    presentation: Option<Value>,
}

/// Only the latest command of each kind for each module webview matters.
#[derive(Default)]
pub struct Commands {
    waiting: Mutex<HashMap<String, PendingCommands>>,
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

fn valid_server(value: &Value) -> bool {
    value.as_str().is_some_and(|server| {
        server.chars().count() <= 2048
            && !server.chars().any(|c| c <= ' ')
            && url::Url::parse(server)
                .is_ok_and(|u| matches!(u.scheme(), "http" | "https") && u.host_str().is_some())
    })
}

fn valid_count(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_f64)
        .is_some_and(|n| n.is_finite() && n >= 0.0 && n.fract() == 0.0)
}

fn valid_atlas_mode(value: Option<&Value>) -> bool {
    matches!(value.and_then(Value::as_str), Some("view" | "edit"))
}

fn valid_command(command: &Value) -> bool {
    if matches!(
        command.get("type").and_then(Value::as_str),
        Some("open-project" | "set-mode" | "leave-edit" | "sync-draft" | "discard-draft")
    ) && command.get("id").is_some_and(|id| {
        !id.as_str().is_some_and(|id| {
            !id.is_empty()
                && id.len() <= 64
                && id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        })
    }) {
        return false;
    }
    match command.get("type").and_then(Value::as_str) {
        Some("set-presentation") => {
            return matches!(
                command.get("presentation").and_then(Value::as_str),
                Some("viewer" | "editor")
            );
        }
        Some("report-status") => return true,
        Some("open-project") => {
            return valid_id(command.get("project"))
                && command.get("server").is_none_or(valid_server)
                && command
                    .get("mode")
                    .is_none_or(|v| valid_atlas_mode(Some(v)))
                && command.get("revision").is_none_or(|v| valid_count(Some(v)));
        }
        Some("set-mode") => {
            return valid_id(command.get("project")) && valid_atlas_mode(command.get("mode"));
        }
        Some("leave-edit") => {
            return valid_id(command.get("project"))
                && matches!(
                    command.get("decision").and_then(Value::as_str),
                    Some("sync" | "keep-draft" | "discard")
                );
        }
        Some("sync-draft" | "discard-draft") => return valid_id(command.get("project")),
        Some("atlas-synced") => {
            return valid_id(command.get("project"))
                && valid_id(command.get("mount"))
                && valid_count(command.get("revision"));
        }
        _ => {}
    }
    if command.get("type").and_then(Value::as_str) == Some("review-spots") {
        let projects = command.get("projects").and_then(Value::as_object);
        return projects.is_some_and(|projects| {
            projects.len() <= 64
                && projects.iter().all(|(project, spots)| {
                    valid_id(Some(&Value::String(project.clone())))
                        && spots.as_array().is_some_and(|spots| {
                            spots.len() <= 10000 && spots.iter().all(|spot| valid_id(Some(spot)))
                        })
                })
        }) && command.get("colors").is_none_or(|colors| {
            colors.as_object().is_some_and(|projects| {
                projects.len() <= 64
                    && projects.iter().all(|(project, spots)| {
                        valid_id(Some(&Value::String(project.clone())))
                            && spots.as_object().is_some_and(|spots| {
                                spots.len() <= 10000
                                    && spots.iter().all(|(spot, color)| {
                                        valid_id(Some(&Value::String(spot.clone())))
                                            && color.as_str().is_some_and(|color| {
                                                color.len() == 7
                                                    && color.starts_with('#')
                                                    && color.as_bytes()[1..]
                                                        .iter()
                                                        .all(u8::is_ascii_hexdigit)
                                            })
                                    })
                            })
                    })
            })
        }) && command.get("groups").is_none_or(|groups| {
            groups.as_object().is_some_and(|projects| {
                projects.len() <= 64
                    && projects.iter().all(|(project, groups)| {
                        valid_id(Some(&Value::String(project.clone())))
                            && groups.as_array().is_some_and(|groups| {
                                groups.len() <= 256
                                    && groups.iter().all(|group| {
                                        group.as_object().is_some_and(|group| {
                                            group.get("name").and_then(Value::as_str).is_some_and(
                                                |name| {
                                                    (1..=200).contains(&name.encode_utf16().count())
                                                },
                                            ) && group
                                                .get("color")
                                                .and_then(Value::as_str)
                                                .is_some_and(|color| {
                                                    color.len() == 7
                                                        && color.starts_with('#')
                                                        && color.as_bytes()[1..]
                                                            .iter()
                                                            .all(u8::is_ascii_hexdigit)
                                                })
                                                && group
                                                    .get("spots")
                                                    .and_then(Value::as_array)
                                                    .is_some_and(|spots| {
                                                        spots.len() <= 10000
                                                            && spots
                                                                .iter()
                                                                .all(|spot| valid_id(Some(spot)))
                                                    })
                                        })
                                    })
                            })
                    })
            })
        }) && command.get("focus").is_none_or(|focus| {
            focus.as_object().is_some_and(|focus| {
                let mut focus = focus.clone();
                focus.insert("type".into(), Value::String("focus-spot".into()));
                valid_command(&Value::Object(focus))
            })
        });
    }
    if command.get("server").is_some_and(|v| !valid_server(v))
        || !valid_id(command.get("project"))
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
        let mut waiting = self.waiting.lock().map_err(|e| e.to_string())?;
        let pending = waiting.entry(label.into()).or_default();
        if command.get("type").and_then(Value::as_str) == Some("set-presentation") {
            pending.presentation = Some(command);
        } else {
            pending.command = Some(command);
        }
        Ok(self.sequence.fetch_add(1, Ordering::Relaxed))
    }

    fn take(&self, label: &str) -> Result<Option<Value>, String> {
        let mut waiting = self.waiting.lock().map_err(|e| e.to_string())?;
        let Some(pending) = waiting.get_mut(label) else {
            return Ok(None);
        };
        let command = pending
            .presentation
            .take()
            .or_else(|| pending.command.take());
        if pending.presentation.is_none() && pending.command.is_none() {
            waiting.remove(label);
        }
        Ok(command)
    }

    fn has_waiting(&self, label: &str) -> Result<bool, String> {
        Ok(self
            .waiting
            .lock()
            .map_err(|e| e.to_string())?
            .contains_key(label))
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
    let command = state.take(webview.label())?;
    if state.has_waiting(webview.label())? {
        // The bridge serialises pulls. This nudge queues the second kind after
        // this reply, even for an older module that ignores presentation.
        if let Err(err) = webview.eval(format!(
            "window.dispatchEvent(new CustomEvent({COMMAND_EVENT:?}));"
        )) {
            log::warn!("could not nudge remaining command: {err}");
        }
    }
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn module_labels_name_their_hosted_app() {
        assert_eq!(module_name("module-images"), "grainatlas");
        assert_eq!(module_name("module-sessions"), "upbdb");
        assert_eq!(module_name("module-people"), "upbdb");
        assert_eq!(module_name("shell"), "shell");
    }
    #[test]
    fn themes_accept_only_resolved_values() {
        let state = ThemeState::default();
        assert_eq!(state.current().unwrap(), "light");
        for theme in ["light", "dark"] {
            assert!(valid_theme(theme));
            state.set(theme).unwrap();
            assert_eq!(state.current().unwrap(), theme);
        }
        for theme in ["", "system", "Dark", " dark", "dark\n", "<script>"] {
            assert!(!valid_theme(theme));
            assert!(state.set(theme).is_err());
            assert!(theme_script(theme).is_err());
        }
        assert_eq!(state.current().unwrap(), "dark");
    }

    #[test]
    fn theme_eval_sets_attribute_and_dispatches_event_when_html_exists() {
        for theme in ["light", "dark"] {
            let script = theme_script(theme).unwrap();
            assert!(script.contains(&format!("const theme = {theme:?}")));
            assert!(script.contains("setAttribute('data-theme', theme)"));
            assert!(script.contains(THEME_EVENT));
            assert!(script.contains("detail: { theme }"));
            assert!(script.contains("if (!document.documentElement) return false"));
            assert!(script.contains("new MutationObserver"));
            assert!(script.contains("observer.disconnect()"));
        }
    }

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
    fn commands_validate_optional_published_atlas_server() {
        for kind in ["focus-spot", "focus-grain"] {
            let mut command = json!({"type": kind, "project": "p", "spot": "s", "grain": "g"});
            for server in ["http://localhost:8000", "https://lab.example/atlas"] {
                command["server"] = json!(server);
                assert!(valid_command(&command));
            }
            command["server"] = json!(format!("https://h/{}", "x".repeat(2038)));
            assert!(valid_command(&command));
            command["server"] = json!(format!("https://h/{}", "x".repeat(2040)));
            assert!(!valid_command(&command));
            for server in [
                "",
                "file:///tmp/a",
                "https://",
                "https://h/ a",
                "https://h/\n",
            ] {
                command["server"] = json!(server);
                assert!(!valid_command(&command));
            }
            command["server"] = Value::Null;
            assert!(!valid_command(&command));
        }
    }

    #[test]
    fn review_spots_validate_optional_colors_and_limits() {
        let mut command = json!({"type": "review-spots", "projects": {"p": ["s"]}});
        assert!(valid_command(&command));
        command["future"] = json!(true);
        command["colors"] = json!({"p": {"s": "#aB12fF"}});
        command["focus"] = json!({"project": "p", "spot": "s"});
        assert!(valid_command(&command));
        for colors in [
            Value::Null,
            json!([]),
            json!({"bad/id": {"s": "#123456"}}),
            json!({"p": []}),
            json!({"p": null}),
            json!({"p": {"bad/id": "#123456"}}),
        ] {
            command["colors"] = colors;
            assert!(!valid_command(&command));
        }
        for color in [
            "red",
            "123456",
            "#123",
            "#1234567",
            "#gg1234",
            "#12345\n",
            "#123456\n",
            "#é1234",
        ] {
            command["colors"] = json!({"p": {"s": color}});
            assert!(!valid_command(&command));
        }
        command["colors"] = json!({"p": {"s": 123456}});
        assert!(!valid_command(&command));
        command["colors"] = json!({});
        assert!(valid_command(&command));
        let mut projects = serde_json::Map::new();
        for i in 0..64 {
            projects.insert(format!("p{i}"), json!({}));
        }
        command["colors"] = Value::Object(projects.clone());
        assert!(valid_command(&command));
        projects.insert("extra".into(), json!({}));
        command["colors"] = Value::Object(projects);
        assert!(!valid_command(&command));
        let mut spots = serde_json::Map::new();
        for i in 0..10000 {
            spots.insert(format!("s{i}"), json!("#123456"));
        }
        command["colors"] = json!({"p": spots});
        assert!(valid_command(&command));
        command["colors"]["p"]["extra"] = json!("#123456");
        assert!(!valid_command(&command));
    }

    #[test]
    fn review_spots_validate_optional_groups_and_limits() {
        let mut command = json!({"type": "review-spots", "projects": {"p": ["s"]},
            "colors": {"p": {"s": "#123456"}}, "focus": {"project": "p", "spot": "s"}});
        assert!(valid_command(&command));
        let group = json!({"name": "Sample A", "color": "#aB12fF", "spots": ["s"]});
        command["groups"] = json!({"p": [group.clone()]});
        command["future"] = json!(true);
        assert!(valid_command(&command));
        for groups in [
            Value::Null,
            json!([]),
            json!("groups"),
            json!({"bad/id": []}),
            json!({"p": {}}),
            json!({"p": null}),
            json!({"p": [null]}),
            json!({"p": [[]]}),
        ] {
            command["groups"] = groups;
            assert!(!valid_command(&command));
        }
        for (field, values) in [
            (
                "name",
                vec![json!(""), json!("x".repeat(201)), json!(1), Value::Null],
            ),
            (
                "color",
                vec![
                    json!("red"),
                    json!("123456"),
                    json!("#123"),
                    json!("#1234567"),
                    json!("#gg1234"),
                    json!("#123456\n"),
                    json!(1),
                    Value::Null,
                ],
            ),
            (
                "spots",
                vec![
                    json!({}),
                    json!("s"),
                    json!(["bad/id"]),
                    json!([1]),
                    json!([null]),
                    Value::Null,
                ],
            ),
        ] {
            for value in values {
                let mut invalid = group.clone();
                invalid[field] = value;
                command["groups"] = json!({"p": [invalid]});
                assert!(!valid_command(&command));
            }
            let mut missing = group.clone();
            missing.as_object_mut().unwrap().remove(field);
            command["groups"] = json!({"p": [missing]});
            assert!(!valid_command(&command));
        }
        command["groups"] = json!({});
        assert!(valid_command(&command));
        command["groups"] = json!({"p": []});
        assert!(valid_command(&command));
        command["groups"] =
            json!({"p": [{"name": "x".repeat(200), "color": "#123456", "spots": []}]});
        assert!(valid_command(&command));
        let mut projects = serde_json::Map::new();
        for i in 0..64 {
            projects.insert(format!("p{i}"), json!([group.clone()]));
        }
        command["groups"] = Value::Object(projects.clone());
        assert!(valid_command(&command));
        projects.insert("extra".into(), json!([]));
        command["groups"] = Value::Object(projects);
        assert!(!valid_command(&command));
        command["groups"] = json!({"p": vec![group.clone(); 256]});
        assert!(valid_command(&command));
        command["groups"]["p"]
            .as_array_mut()
            .unwrap()
            .push(group.clone());
        assert!(!valid_command(&command));
        let spots: Vec<_> = (0..10000).map(|i| format!("s{i}")).collect();
        command["groups"] =
            json!({"p": [{"name": "Sample A", "color": "#123456", "spots": spots}]});
        assert!(valid_command(&command));
        command["groups"]["p"][0]["spots"]
            .as_array_mut()
            .unwrap()
            .push(json!("extra"));
        assert!(!valid_command(&command));
    }

    #[test]
    fn atlas_commands_validate_required_ids_and_ignore_extra_fields() {
        for mut command in [
            json!({"type": "open-project", "project": "p"}),
            json!({"type": "set-mode", "project": "p", "mode": "view"}),
            json!({"type": "leave-edit", "project": "p", "decision": "sync"}),
            json!({"type": "sync-draft", "project": "p"}),
            json!({"type": "discard-draft", "project": "p"}),
            json!({"type": "atlas-synced", "project": "p", "mount": "m", "revision": 0}),
        ] {
            assert!(valid_command(&command));
            command["future"] = json!({"anything": true});
            command["flash"] = Value::Null;
            command["via"] = json!(false);
            assert!(valid_command(&command));
            command["project"] = json!("a".repeat(128));
            assert!(valid_command(&command));
            for id in [
                "",
                "-bad",
                "a/b",
                "a b",
                "a?b",
                "é",
                "a\n",
                &"a".repeat(129),
            ] {
                command["project"] = json!(id);
                assert!(!valid_command(&command), "accepted {command}");
            }
            for project in [Value::Null, json!(1)] {
                command["project"] = project;
                assert!(!valid_command(&command));
            }
            command.as_object_mut().unwrap().remove("project");
            assert!(!valid_command(&command));
        }
        assert!(valid_command(&json!({"type": "report-status"})));
        assert!(valid_command(
            &json!({"type": "report-status", "future": true, "project": null})
        ));
    }

    #[test]
    fn presentation_commands_accept_only_viewer_or_editor() {
        for presentation in [json!("viewer"), json!("editor")] {
            assert!(valid_command(
                &json!({"type": "set-presentation", "presentation": presentation})
            ));
        }
        for presentation in [
            Value::Null,
            json!(false),
            json!("view"),
            json!("edit"),
            json!(""),
        ] {
            assert!(!valid_command(
                &json!({"type": "set-presentation", "presentation": presentation})
            ));
        }
        assert!(!valid_command(&json!({"type": "set-presentation"})));
    }

    #[test]
    fn atlas_command_completion_ids() {
        for mut command in [
            json!({"type": "open-project", "project": "p"}),
            json!({"type": "set-mode", "project": "p", "mode": "edit"}),
            json!({"type": "leave-edit", "project": "p", "decision": "sync"}),
            json!({"type": "sync-draft", "project": "p"}),
            json!({"type": "discard-draft", "project": "p"}),
        ] {
            assert!(valid_command(&command));
            for id in [json!("a"), json!("_-A09"), json!("x".repeat(64))] {
                command["id"] = id;
                assert!(valid_command(&command));
            }
            for id in [
                json!(""),
                json!("x".repeat(65)),
                json!("a.b"),
                json!("a/b"),
                json!("é"),
                json!("a\n"),
                json!(null),
                json!(42),
                json!(true),
            ] {
                command["id"] = id;
                assert!(!valid_command(&command), "accepted {command}");
            }
        }
    }

    #[test]
    fn atlas_commands_validate_modes_decisions_and_counts() {
        for mode in ["view", "edit"] {
            assert!(valid_command(
                &json!({"type": "open-project", "project": "p", "mode": mode, "revision": 0})
            ));
            assert!(valid_command(
                &json!({"type": "set-mode", "project": "p", "mode": mode})
            ));
        }
        for kind in ["open-project", "set-mode"] {
            for mode in [
                json!("VIEW"),
                json!("checking"),
                json!(""),
                Value::Null,
                json!(true),
            ] {
                assert!(!valid_command(
                    &json!({"type": kind, "project": "p", "mode": mode})
                ));
            }
        }
        assert!(!valid_command(&json!({"type": "set-mode", "project": "p"})));
        for decision in ["sync", "keep-draft", "discard"] {
            assert!(valid_command(
                &json!({"type": "leave-edit", "project": "p", "decision": decision})
            ));
        }
        for decision in [
            json!("cancel"),
            json!("keep"),
            json!(""),
            Value::Null,
            json!(true),
        ] {
            assert!(!valid_command(
                &json!({"type": "leave-edit", "project": "p", "decision": decision})
            ));
        }
        assert!(!valid_command(
            &json!({"type": "leave-edit", "project": "p"})
        ));
        for kind in ["open-project", "atlas-synced"] {
            for revision in [json!(0), json!(1), json!(1.0)] {
                assert!(valid_command(
                    &json!({"type": kind, "project": "p", "mount": "m", "revision": revision})
                ));
            }
            for revision in [json!(-1), json!(0.5), json!("1"), Value::Null, json!(true)] {
                assert!(!valid_command(
                    &json!({"type": kind, "project": "p", "mount": "m", "revision": revision})
                ));
            }
        }
        assert!(!valid_command(
            &json!({"type": "atlas-synced", "project": "p", "mount": "m"})
        ));
        assert!(!valid_command(
            &json!({"type": "atlas-synced", "project": "p", "revision": 0})
        ));
        for mount in [
            json!(""),
            json!("-bad"),
            json!("a/b"),
            json!("a b"),
            json!("a?b"),
            json!("é"),
            json!("a\n"),
            json!("a".repeat(129)),
            Value::Null,
            json!(1),
        ] {
            assert!(!valid_command(
                &json!({"type": "atlas-synced", "project": "p", "mount": mount, "revision": 0})
            ));
        }
    }

    #[test]
    fn open_project_validates_optional_server_like_focus_spot() {
        for server in [
            "http://localhost:8000",
            "https://lab.example/atlas",
            &format!("https://h/{}", "x".repeat(2038)),
        ] {
            assert!(valid_command(
                &json!({"type": "open-project", "project": "p", "server": server})
            ));
        }
        for server in [
            "",
            "file:///tmp/a",
            "javascript:alert(1)",
            "https://",
            "https://h/ a",
            "https://h/\n",
            &format!("https://h/{}", "x".repeat(2040)),
        ] {
            assert!(!valid_command(
                &json!({"type": "open-project", "project": "p", "server": server})
            ));
        }
        for server in [Value::Null, json!(true)] {
            assert!(!valid_command(
                &json!({"type": "open-project", "project": "p", "server": server})
            ));
        }
    }

    #[test]
    fn presentation_does_not_replace_focus_and_latest_presentation_wins() {
        for presentation_first in [false, true] {
            let state = Commands::default();
            let focus = json!({"type": "focus-spot", "project": "p", "spot": "s"});
            let viewer = json!({"type": "set-presentation", "presentation": "viewer"});
            if presentation_first {
                state.store("module-images", viewer.clone()).unwrap();
            }
            state.store("module-images", focus.clone()).unwrap();
            state
                .store(
                    "module-images",
                    json!({"type": "set-presentation", "presentation": "editor"}),
                )
                .unwrap();
            state.store("module-images", viewer.clone()).unwrap();
            assert_eq!(state.take("module-images").unwrap(), Some(viewer));
            assert!(state.has_waiting("module-images").unwrap());
            assert_eq!(state.take("module-images").unwrap(), Some(focus));
            assert!(!state.has_waiting("module-images").unwrap());
        }
    }

    #[test]
    fn module_images_command_keeps_read_only_copy_credentials() {
        let state = Commands::default();
        let command = json!({
            "type": "focus-spot", "project": "p", "spot": "s",
            "server": "https://copy.invalid", "token": "invented-token", "code": "invented-code"
        });
        state.store("module-images", command.clone()).unwrap();
        assert_eq!(state.take("module-images").unwrap(), Some(command));
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
    #[test]
    fn oversight_state_is_read_only_and_serializes_the_additive_wire_fields() {
        let state = OversightState::default();
        assert!(state.writable().is_ok());
        assert_eq!(
            serde_json::to_value(state.current().unwrap()).unwrap(),
            json!({"viewAs":null,"onBehalf":false})
        );
        let scope: Oversight = serde_json::from_value(
            json!({"viewAs":{"username":"cedar","name":"Cedar Analyst"},"onBehalf":false}),
        )
        .unwrap();
        *state.0.lock().unwrap() = scope.clone();
        assert!(state.writable().is_err());
        let script = oversight_script(&scope).unwrap();
        assert!(script.contains("lab-bridge:oversight"));
        assert!(script.contains("Cedar Analyst"));
        assert!(script.contains("viewAs"));
        assert!(
            serde_json::from_value::<Oversight>(json!({"viewAs":null,"onBehalf":"yes"})).is_err()
        );
    }
}

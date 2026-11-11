//! Module tabs as native child webviews (ADR-0002). The shell page measures
//! the content area under its tab bar and asks the host to lay the module's
//! webview over it; switching tabs hides the others, so each module keeps its
//! state and a slow module never blocks the shell.

use std::collections::HashSet;
use std::sync::Mutex;

use serde::Deserialize;
use tauri::ipc::CapabilityBuilder;
use tauri::webview::{NewWindowResponse, WebviewBuilder};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Rect, Runtime, State, Url, WebviewUrl,
};
use tauri_plugin_opener::OpenerExt;

use crate::bridge::{forward_open, module_name, theme_script, ThemeState};
use crate::{MAIN_WINDOW, SCHEMES};

const MODULES: [&str; 3] = ["images", "sessions", "people"];

/// Remote origins already granted the bridge commands.
#[derive(Default)]
pub struct ModuleState {
    granted: Mutex<HashSet<String>>,
}

/// A rectangle in CSS (logical) pixels relative to the window's content area.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    /// The shell page's `window.innerHeight`, used for the macOS title bar inset.
    #[serde(default, rename = "viewportHeight")]
    viewport_height: Option<f64>,
}

impl Bounds {
    /// `y_offset` compensates the macOS title bar (see `title_bar_offset`).
    fn rect(self, y_offset: f64) -> Rect {
        Rect {
            position: LogicalPosition::new(self.x.max(0.0), self.y.max(0.0) + y_offset).into(),
            size: LogicalSize::new(self.width.max(1.0), self.height.max(1.0)).into(),
        }
    }
}

/// On macOS the window's content view extends under the title bar, and
/// WKWebView insets the shell page's CSS viewport below it. Child webviews,
/// however, are positioned against the full content view (observed with
/// wry 0.57 / tauri 2.12 on macOS 26). The shell sends its viewport height
/// with every bounds update; the difference to the content view height is the
/// title bar inset, which shifts the child back under the tab bar.
/// Windows and Linux position children in the client area and need nothing.
fn title_bar_offset<R: Runtime>(app: &AppHandle<R>, bounds: &Bounds) -> f64 {
    if !cfg!(target_os = "macos") {
        return 0.0;
    }
    let Some(viewport) = bounds.viewport_height else {
        return 0.0;
    };
    let Some(window) = app.get_window(MAIN_WINDOW) else {
        return 0.0;
    };
    let (Ok(inner), Ok(scale)) = (window.inner_size(), window.scale_factor()) else {
        return 0.0;
    };
    let inset = inner.to_logical::<f64>(scale).height - viewport;
    if (0.0..200.0).contains(&inset) {
        inset
    } else {
        0.0
    }
}

fn label(module: &str) -> Result<String, String> {
    if MODULES.contains(&module) {
        Ok(format!("module-{module}"))
    } else {
        Err(format!("unknown module tab {module:?}"))
    }
}

fn parse_url(url: &str) -> Result<Url, String> {
    let parsed: Url = url
        .parse()
        .map_err(|e| format!("invalid module URL {url:?}: {e}"))?;
    match parsed.scheme() {
        "http" | "https" | "tauri" => Ok(parsed),
        other => Err(format!("module URL scheme {other:?} not allowed")),
    }
}

/// Is this the app's own origin (bundled module builds, or the dev server)?
fn is_local(url: &Url) -> bool {
    url.scheme() == "tauri"
        || url.host_str() == Some("tauri.localhost")
        || (cfg!(debug_assertions)
            && url.host_str() == Some("localhost")
            && url.port() == Some(1420))
}

/// Remote module pages (the configured laicpmsdb server) get the bridge
/// commands for their origin only, in their own webview only.
fn grant_bridge<R: Runtime>(
    app: &AppHandle<R>,
    state: &ModuleState,
    label: &str,
    url: &Url,
) -> Result<(), String> {
    if is_local(url) {
        return Ok(()); // covered by capabilities/modules.json
    }
    let origin = url.origin().ascii_serialization();
    let key = format!("{label} {origin}");
    let mut granted = state.granted.lock().map_err(|e| e.to_string())?;
    if granted.contains(&key) {
        return Ok(());
    }
    let id: String = format!("bridge-{label}-{}", granted.len());
    app.add_capability(
        CapabilityBuilder::new(id)
            .remote(format!("{origin}/*"))
            .webview(label)
            .permission("allow-bridge-theme")
            .permission("allow-bridge-open")
            .permission("allow-bridge-token")
            .permission("allow-bridge-notify")
            .permission("allow-bridge-open-files")
            .permission("allow-bridge-take-command")
            .permission("allow-bridge-read-file"),
    )
    .map_err(|e| format!("could not grant the bridge to {origin}: {e}"))?;
    log::info!("granted @lab/bridge to {origin} in {label}");
    granted.insert(key);
    Ok(())
}

/// Set before any page script: tells @lab/bridge it runs inside the shell.
fn marker_script(module: &str, theme: &str) -> String {
    format!(
        "Object.defineProperty(window, '__LAB_SHELL__', {{ value: Object.freeze({{ module: {:?}, v: 3, minor: 1, theme: {:?} }}), configurable: false }});{}",
        module_name(&format!("module-{module}")),
        theme,
        theme_script(theme).expect("resolved theme")
    )
}

fn build_webview<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    module: &str,
    url: Url,
) -> WebviewBuilder<R> {
    let nav_app = app.clone();
    let nav_label = label.to_string();
    let page_app = app.clone();
    let win_app = app.clone();
    let win_label = label.to_string();
    WebviewBuilder::new(label, WebviewUrl::External(url))
        .initialization_script(marker_script(
            module,
            &app.state::<ThemeState>()
                .current()
                .unwrap_or_else(|_| "light".into()),
        ))
        // A webview can reload long after creation. Its fixed init script may
        // carry an older theme; refresh from the host on every page load.
        .on_page_load(move |webview, _| {
            if let Ok(theme) = page_app.state::<ThemeState>().current() {
                if let Ok(script) = theme_script(&theme) {
                    if let Err(err) = webview.eval(script) {
                        log::warn!("could not initialise module theme: {err}");
                    }
                }
            }
        })
        .initialization_script(crate::files::probe_script())
        // A plain <a href="laicpmsdb://…"> in a module goes to the shell's resolver.
        .on_navigation(move |url| {
            let scheme = url.scheme();
            if SCHEMES.contains(&scheme) {
                forward_open(&nav_app, url.as_str(), &nav_label);
                return false;
            }
            let allowed = matches!(
                scheme,
                "http" | "https" | "tauri" | "about" | "data" | "blob"
            );
            if !allowed {
                log::warn!("refused navigation to {url} in {nav_label}");
            }
            allowed
        })
        // target=_blank and window.open: lab schemes to the shell, web pages to the system browser.
        .on_new_window(move |url, _features| {
            if SCHEMES.contains(&url.scheme()) {
                forward_open(&win_app, url.as_str(), &win_label);
            } else if matches!(url.scheme(), "http" | "https") {
                if let Err(err) = win_app.opener().open_url(url.as_str(), None::<&str>) {
                    log::warn!("could not open {url} in the system browser: {err}");
                }
            } else {
                log::warn!("refused new window for {url} from {win_label}");
            }
            NewWindowResponse::Deny
        })
}

fn hide_others<R: Runtime>(app: &AppHandle<R>, keep: &str) {
    for m in MODULES {
        let other = format!("module-{m}");
        if other != keep {
            if let Some(wv) = app.get_webview(&other) {
                let _ = wv.hide();
            }
        }
    }
}

/// Show a module tab over `bounds`, creating its webview on first use.
/// `navigate` loads `url` into an existing webview (a link was followed, or
/// the server URL changed); otherwise the module stays where the user left it.
#[tauri::command]
pub async fn module_open<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, ModuleState>,
    module: String,
    url: String,
    bounds: Bounds,
    navigate: bool,
) -> Result<(), String> {
    let label = label(&module)?;
    let url = parse_url(&url)?;
    hide_others(&app, &label);
    if let Some(wv) = app.get_webview(&label) {
        if navigate {
            grant_bridge(&app, &state, &label, &url)?;
            log::info!("{label} loads {url}");
            wv.navigate(url).map_err(|e| e.to_string())?;
        }
        wv.set_bounds(bounds.rect(title_bar_offset(&app, &bounds)))
            .map_err(|e| e.to_string())?;
        wv.show().map_err(|e| e.to_string())?;
        return Ok(());
    }
    grant_bridge(&app, &state, &label, &url)?;
    log::info!("{label} loads {url}");
    let window = app.get_window(MAIN_WINDOW).ok_or("main window missing")?;
    let rect = bounds.rect(title_bar_offset(&app, &bounds));
    window
        .add_child(
            build_webview(&app, &label, &module, url),
            rect.position,
            rect.size,
        )
        .map_err(|e| format!("could not create the {module} webview: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn module_bounds<R: Runtime>(
    app: AppHandle<R>,
    module: String,
    bounds: Bounds,
) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&label(&module)?) {
        wv.set_bounds(bounds.rect(title_bar_offset(&app, &bounds)))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn module_hide<R: Runtime>(app: AppHandle<R>, module: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&label(&module)?) {
        wv.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn module_reload<R: Runtime>(app: AppHandle<R>, module: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&label(&module)?) {
        wv.reload().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_only_for_known_tabs() {
        assert_eq!(label("images").unwrap(), "module-images");
        assert_eq!(label("sessions").unwrap(), "module-sessions");
        assert_eq!(label("people").unwrap(), "module-people");
        assert!(label("shell").is_err());
        assert!(label("../x").is_err());
    }

    #[test]
    fn module_urls_are_web_or_app_origin() {
        assert!(parse_url("http://localhost:8000/app/").is_ok());
        assert!(parse_url("tauri://localhost/modules/grainatlas/index.html").is_ok());
        assert!(parse_url("file:///etc/passwd").is_err());
        assert!(parse_url("javascript:alert(1)").is_err());
        assert!(parse_url("laicpmsdb://session/x").is_err());
    }

    #[test]
    fn local_origins() {
        assert!(is_local(
            &"tauri://localhost/modules/grainatlas/index.html"
                .parse()
                .unwrap()
        ));
        assert!(is_local(
            &"http://tauri.localhost/modules/grainatlas/index.html"
                .parse()
                .unwrap()
        ));
        assert!(!is_local(&"http://localhost:8000/app/".parse().unwrap()));
    }

    #[test]
    fn marker_names_the_module() {
        assert!(marker_script("images", "dark").contains("\"grainatlas\""));
        assert!(marker_script("sessions", "light").contains("\"laicpmsdb\""));
        assert!(marker_script("people", "light").contains("\"laicpmsdb\""));
        let script = marker_script("images", "dark");
        assert!(script.contains("v: 3, minor: 1, theme: \"dark\""));
        assert!(script.contains("new MutationObserver"));
    }
}

//! Native menu. Tab shortcuts live here rather than in the shell page because
//! keystrokes go to whichever webview has focus: once the user clicks into a
//! module webview, a page-level ⌘1 would never reach the shell. Menu
//! accelerators are handled by the window, whatever webview is focused.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime};

use crate::{MAIN_WINDOW, SHELL_WEBVIEW};

/// Event the shell listens on; the payload is the menu item id.
pub const EVENT_MENU: &str = "shell://menu";

pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    // The platform default (app, Edit with copy/paste, Window) plus a Tabs menu.
    let menu = Menu::default(app)?;
    // Native Quit invokes terminate: on macOS, bypassing window CloseRequested.
    // Replace that predefined action, preserving its platform label and place.
    let quit_text = PredefinedMenuItem::quit(app, None)?.text()?;
    for item in menu.items()? {
        if let Some(submenu) = item.as_submenu() {
            for (at, item) in submenu.items()?.iter().enumerate() {
                if let Some(predefined) = item.as_predefined_menuitem() {
                    if predefined.text()? == quit_text {
                        submenu.remove_at(at)?;
                        submenu.insert(
                            &MenuItem::with_id(
                                app,
                                "app:quit",
                                &quit_text,
                                true,
                                Some("CmdOrCtrl+Q"),
                            )?,
                            at,
                        )?;
                    }
                }
            }
        }
    }
    let tabs = Submenu::with_items(
        app,
        "Tabs",
        true,
        &[
            &MenuItem::with_id(app, "tab:home", "Home", true, Some("CmdOrCtrl+1"))?,
            &MenuItem::with_id(app, "tab:images", "Images", true, Some("CmdOrCtrl+2"))?,
            &MenuItem::with_id(app, "tab:sessions", "Sessions", true, Some("CmdOrCtrl+3"))?,
            &MenuItem::with_id(app, "tab:review", "Review", true, Some("CmdOrCtrl+4"))?,
            &MenuItem::with_id(app, "tab:reduce", "Reduce", true, Some("CmdOrCtrl+5"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "module:reload",
                "Reload Module",
                true,
                Some("CmdOrCtrl+R"),
            )?,
            &MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?,
        ],
    )?;
    // Before the Window menu on macOS, at the end elsewhere.
    let at = menu
        .items()?
        .len()
        .saturating_sub(if cfg!(target_os = "macos") { 2 } else { 0 });
    menu.insert(&tabs, at)?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let id = event.id().0.clone();
        if id == "app:quit" {
            // Use the same native close event as the title-bar button: geometry
            // saves first, and the UI may prevent it while its quit guard runs.
            if let Some(window) = app.get_window(MAIN_WINDOW) {
                if let Err(err) = window.close() {
                    log::warn!("quit close request failed: {err}");
                }
            }
        } else if id.starts_with("tab:") || id == "settings" || id == "module:reload" {
            if let Err(err) = app.emit_to(EventTarget::webview(SHELL_WEBVIEW), EVENT_MENU, id) {
                log::warn!("menu event not delivered: {err}");
            }
        }
    });
    Ok(())
}

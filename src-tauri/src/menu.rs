//! Native menu. Tab shortcuts live here rather than in the shell page because
//! keystrokes go to whichever webview has focus: once the user clicks into a
//! module webview, a page-level ⌘1 would never reach the shell. Menu
//! accelerators are handled by the window, whatever webview is focused.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime};

use crate::{MAIN_WINDOW, SHELL_WEBVIEW};

/// Event the shell listens on; the payload is the menu item id.
pub const EVENT_MENU: &str = "shell://menu";
/// Menu id for Cmd+W, handled by the shell page (never closes the window).
pub const MENU_CLOSE: &str = "shell:close";

pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    // The platform default (app, Edit with copy/paste, Window) plus a Tabs menu.
    let menu = Menu::default(app)?;
    // Native Quit invokes terminate: on macOS, bypassing window CloseRequested.
    // Replace that predefined action, preserving its platform label and place.
    // Native Close Window (Cmd+W) closes the only window, which ends the app.
    // Cmd+W closes what the shell page has open instead (Settings, Account,
    // a maximised Review panel, an open menu); with nothing open it does nothing.
    let quit_text = PredefinedMenuItem::quit(app, None)?.text()?;
    let close_text = PredefinedMenuItem::close_window(app, None)?.text()?;
    for item in menu.items()? {
        if let Some(submenu) = item.as_submenu() {
            for (at, item) in submenu.items()?.iter().enumerate() {
                if let Some(predefined) = item.as_predefined_menuitem() {
                    let text = predefined.text()?;
                    let replacement = if text == quit_text {
                        Some(("app:quit", quit_text.as_str(), "CmdOrCtrl+Q"))
                    } else if text == close_text {
                        Some((MENU_CLOSE, "Close Tab", "CmdOrCtrl+W"))
                    } else {
                        None
                    };
                    if let Some((id, label, accelerator)) = replacement {
                        submenu.remove_at(at)?;
                        submenu.insert(
                            &MenuItem::with_id(app, id, label, true, Some(accelerator))?,
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
            &MenuItem::with_id(app, "tab:sessions", "Sessions", true, Some("CmdOrCtrl+2"))?,
            &MenuItem::with_id(app, "tab:review", "Review", true, Some("CmdOrCtrl+3"))?,
            &MenuItem::with_id(app, "tab:reduce", "Reduce", true, Some("CmdOrCtrl+4"))?,
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
            // Cmd+Q goes straight to the native watchdog, even if the UI hangs.
            if let Some(window) = app.get_window(MAIN_WINDOW) {
                crate::geometry::save(&window);
            }
            crate::quit::request(app);
        } else if id.starts_with("tab:")
            || id == "settings"
            || id == "module:reload"
            || id == MENU_CLOSE
        {
            if let Err(err) = app.emit_to(EventTarget::webview(SHELL_WEBVIEW), EVENT_MENU, id) {
                log::warn!("menu event not delivered: {err}");
            }
        }
    });
    Ok(())
}

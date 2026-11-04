//! The main window's size and position, remembered between runs (grainatlas
//! `docs/ux-conventions.md` rule 7) in `<app config dir>/window.json`, in
//! logical pixels: per viewer, never in a project or a server record.
//!
//! A saved place is used only while its title bar still lies on a connected
//! monitor, and the size is clamped to that monitor's work area, so a window
//! left on a large external monitor reopens whole on a 14-inch laptop. The
//! default size (1280 x 800, centred) is clamped the same way.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Monitor, Runtime, Window, WindowEvent};

use crate::MAIN_WINDOW;

/// Default size: a 13- or 14-inch laptop screen (1280 x 800 logical and up).
pub const DEFAULT: (f64, f64) = (1280.0, 800.0);
/// Smallest window: the tab bar, Home and Settings still fit without clipping.
pub const MIN: (f64, f64) = (1024.0, 640.0);

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
pub struct Geometry {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default)]
    pub maximized: bool,
}

/// A monitor's work area (without menu bar, Dock or taskbar), logical pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

fn area_of(m: &Monitor) -> Area {
    let s = m.scale_factor();
    let a = m.work_area();
    Area {
        x: a.position.x as f64 / s,
        y: a.position.y as f64 / s,
        w: a.size.width as f64 / s,
        h: a.size.height as f64 / s,
    }
}

/// Where a saved window goes: on the monitor that holds its title bar (40 px
/// high, 100 px in from the left), shrunk to that work area and moved fully
/// inside it. `None` when no connected monitor holds it any more.
pub fn fit(saved: Geometry, areas: &[Area]) -> Option<Geometry> {
    let (tx, ty) = (saved.x + 100.0, saved.y + 20.0);
    let a = areas.iter().find(|a| tx >= a.x && tx <= a.x + a.w && ty >= a.y && ty <= a.y + a.h)?;
    Some(inside(saved, *a))
}

/// `g` shrunk to `a` (never below the minimum size unless the area itself is smaller) and moved inside it.
fn inside(g: Geometry, a: Area) -> Geometry {
    let w = g.w.max(MIN.0.min(a.w)).min(a.w);
    let h = g.h.max(MIN.1.min(a.h)).min(a.h);
    Geometry {
        x: g.x.clamp(a.x, (a.x + a.w - w).max(a.x)),
        y: g.y.clamp(a.y, (a.y + a.h - h).max(a.y)),
        w,
        h,
        maximized: g.maximized,
    }
}

/// The default window on `a`: 1280 x 800, or the work area if that is smaller, centred.
pub fn default_on(a: Area) -> Geometry {
    let (w, h) = (DEFAULT.0.min(a.w), DEFAULT.1.min(a.h));
    Geometry { x: a.x + (a.w - w) / 2.0, y: a.y + (a.h - h) / 2.0, w, h, maximized: false }
}

fn file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("window.json"))
}

fn apply<R: Runtime>(w: &Window<R>, g: Geometry) {
    let _ = w.set_size(LogicalSize::new(g.w, g.h));
    let _ = w.set_position(LogicalPosition::new(g.x, g.y));
    if g.maximized {
        let _ = w.maximize();
    }
}

/// Before the window is shown: the saved place if it still fits a monitor,
/// else the default size on the primary monitor, centred.
pub fn restore<R: Runtime>(w: &Window<R>) {
    let areas: Vec<Area> = w.available_monitors().unwrap_or_default().iter().map(area_of).collect();
    let saved = file(w.app_handle())
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice::<Geometry>(&b).ok());
    if let Some(g) = saved.and_then(|g| fit(g, &areas)) {
        log::info!("window restored at {:.0}x{:.0}+{:.0}+{:.0}", g.w, g.h, g.x, g.y);
        apply(w, g);
        return;
    }
    let primary = w.primary_monitor().ok().flatten().map(|m| area_of(&m)).or_else(|| areas.first().copied());
    if let Some(a) = primary {
        apply(w, default_on(a));
    }
}

/// Records the window's place (not while minimised; a maximised window keeps its normal size).
pub fn save<R: Runtime>(w: &Window<R>) {
    if w.is_minimized().unwrap_or(false) {
        return;
    }
    let Some(path) = file(w.app_handle()) else { return };
    let s = w.scale_factor().unwrap_or(1.0);
    let maximized = w.is_maximized().unwrap_or(false);
    let prev: Option<Geometry> = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok());
    let g = match (maximized, prev) {
        (true, Some(p)) => Geometry { maximized: true, ..p },
        _ => {
            let (Ok(pos), Ok(size)) = (w.outer_position(), w.inner_size()) else { return };
            Geometry { x: pos.x as f64 / s, y: pos.y as f64 / s, w: size.width as f64 / s, h: size.height as f64 / s, maximized }
        }
    };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&path, serde_json::to_vec(&g).unwrap_or_default());
}

/// Save half a second after the last move or resize, not on every event of a drag.
pub fn track<R: Runtime>(w: &Window<R>) {
    let pending = Arc::new(AtomicBool::new(false));
    let win = w.clone();
    w.on_window_event(move |event| match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            if pending.swap(true, Ordering::SeqCst) {
                return;
            }
            let (win, pending) = (win.clone(), pending.clone());
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(500));
                pending.store(false, Ordering::SeqCst);
                save(&win);
            });
        }
        WindowEvent::CloseRequested { .. } => save(&win),
        _ => {}
    });
}

/// Settings → Reset window: forget the saved place; default size, centred.
#[tauri::command]
pub fn window_reset<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(path) = file(&app) {
        let _ = std::fs::remove_file(path);
    }
    let w = app.get_window(MAIN_WINDOW).ok_or("main window missing")?;
    let _ = w.unmaximize();
    let monitor = w.current_monitor().ok().flatten().or_else(|| w.primary_monitor().ok().flatten());
    match monitor {
        Some(m) => apply(&w, default_on(area_of(&m))),
        None => {
            let _ = w.set_size(LogicalSize::new(DEFAULT.0, DEFAULT.1));
            let _ = w.center();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // A 14-inch MacBook at its default scaling: 1512 x 982, menu bar 33 px (Dock hidden).
    const LAPTOP: Area = Area { x: 0.0, y: 33.0, w: 1512.0, h: 949.0 };
    // The smallest screen the lab supports: 1280 x 800 with menu bar and Dock.
    const SMALL: Area = Area { x: 0.0, y: 25.0, w: 1280.0, h: 705.0 };
    // A 27-inch monitor to the right of the laptop.
    const EXTERNAL: Area = Area { x: 1512.0, y: 0.0, w: 2560.0, h: 1415.0 };

    #[test]
    fn a_saved_place_on_a_connected_monitor_is_kept() {
        let g = Geometry { x: 100.0, y: 80.0, w: 1300.0, h: 820.0, maximized: false };
        assert_eq!(fit(g, &[LAPTOP]), Some(g));
    }

    #[test]
    fn a_window_from_the_large_monitor_shrinks_onto_the_laptop() {
        // Saved on the external monitor, then reopened on the laptop alone at the same x:
        // the title bar is off every monitor, so the default is used.
        let big = Geometry { x: 1700.0, y: 60.0, w: 2200.0, h: 1300.0, maximized: false };
        assert_eq!(fit(big, &[LAPTOP]), None);
        // Still connected: kept, fully inside the external monitor.
        assert_eq!(fit(big, &[LAPTOP, EXTERNAL]), Some(big));
        // Its title bar on the laptop, but bigger than it: clamped to the work area.
        let wide = Geometry { x: 20.0, y: 40.0, w: 2200.0, h: 1300.0, maximized: false };
        assert_eq!(fit(wide, &[LAPTOP]), Some(Geometry { x: 0.0, y: 33.0, w: 1512.0, h: 949.0, maximized: false }));
    }

    #[test]
    fn a_window_hanging_off_the_edge_is_pulled_back_in() {
        let g = Geometry { x: 900.0, y: 300.0, w: 1280.0, h: 800.0, maximized: true };
        let f = fit(g, &[SMALL]).unwrap();
        assert_eq!((f.x, f.y, f.w, f.h), (0.0, 25.0, 1280.0, 705.0));
        assert!(f.maximized);
    }

    #[test]
    fn never_below_the_minimum_unless_the_screen_is_smaller() {
        let tiny = Geometry { x: 10.0, y: 40.0, w: 300.0, h: 200.0, maximized: false };
        let f = fit(tiny, &[LAPTOP]).unwrap();
        assert_eq!((f.w, f.h), MIN);
    }

    #[test]
    fn the_default_is_centred_and_fits_small_screens() {
        assert_eq!(default_on(LAPTOP), Geometry { x: 116.0, y: 107.5, w: 1280.0, h: 800.0, maximized: false });
        let d = default_on(SMALL);
        assert_eq!((d.x, d.y, d.w, d.h), (0.0, 25.0, 1280.0, 705.0));
    }

    #[test]
    fn old_files_without_maximized_still_read() {
        let g: Geometry = serde_json::from_str(r#"{"x":1,"y":2,"w":1300,"h":820}"#).unwrap();
        assert!(!g.maximized);
    }
}

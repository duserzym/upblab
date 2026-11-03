//! UPb Studio desktop host.
//!
//! One window (`main`) holding the shell webview (`shell`, the Svelte UI) and
//! one child webview per module tab (`module-images`, `module-sessions`),
//! laid over the area the shell reserves for them (ADR-0002). The host owns
//! no scientific data: it positions webviews, forwards @lab/bridge calls and
//! deep links to the shell, probes the laicpmsdb server and launches UPbRPy
//! Studio.

mod bridge;
mod menu;
mod modules;
mod probe;
mod studio;

use tauri::webview::WebviewBuilder;
use tauri::window::{Color, WindowBuilder};
use tauri::{LogicalPosition, Manager, WebviewUrl};

pub const MAIN_WINDOW: &str = "main";
pub const SHELL_WEBVIEW: &str = "shell";
/// URL schemes the shell routes (plan section 4.4). Registered by the
/// installers through `plugins.deep-link.desktop.schemes` in tauri.conf.json.
pub const SCHEMES: [&str; 3] = ["laicpmsdb", "grainatlas", "upbr"];

/// Dark wallpaper base from the glass tokens, so the window never flashes white.
const BACKGROUND: Color = Color(12, 17, 27, 255);

pub fn run() {
    let mut builder = tauri::Builder::default();

    // Must be the first plugin: a second launch (Windows and Linux deliver deep
    // links that way) hands its URL to this instance and exits.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_window(MAIN_WINDOW) {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("upbstudio".into()),
                    }),
                ])
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(modules::ModuleState::default())
        .invoke_handler(tauri::generate_handler![
            modules::module_open,
            modules::module_bounds,
            modules::module_hide,
            modules::module_reload,
            probe::probe,
            studio::studio_status,
            studio::studio_launch,
            bridge::bridge_open,
            bridge::bridge_token,
            bridge::bridge_notify,
        ])
        .setup(|app| {
            // macOS registers schemes from the bundle's Info.plist; Windows and
            // Linux installers write the registry / .desktop entries. In a dev
            // build on Windows or Linux, register at runtime so links work too.
            #[cfg(all(debug_assertions, any(windows, target_os = "linux")))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(err) = app.deep_link().register_all() {
                    log::warn!("could not register URL schemes at runtime: {err}");
                }
            }

            menu::install(app.handle())?;

            let window = WindowBuilder::new(app, MAIN_WINDOW)
                .title("UPb Studio")
                .inner_size(1280.0, 820.0)
                .min_inner_size(960.0, 600.0)
                .background_color(BACKGROUND)
                .build()?;
            let size = window.inner_size()?.to_logical::<f64>(window.scale_factor()?);
            window.add_child(
                WebviewBuilder::new(SHELL_WEBVIEW, WebviewUrl::App("index.html".into()))
                    .background_color(BACKGROUND)
                    .auto_resize(),
                LogicalPosition::new(0.0, 0.0),
                size,
            )?;
            log::info!("UPb Studio {} started", app.package_info().version);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running UPb Studio");
}

//! UPb Studio desktop host.
//!
//! One window (`main`) holding the shell webview (`shell`, the Svelte UI) and
//! one child webview per module tab (`module-images`, `module-sessions`),
//! laid over the area the shell reserves for them (ADR-0002). The host owns
//! no scientific data: it positions webviews, forwards @lab/bridge calls and
//! deep links to the shell, probes the laicpmsdb server, launches UPbRPy
//! Studio, and in "This computer" mode runs laicpmsdb and PostgreSQL locally
//! (`local_service`, ADR-0003).

mod auth;
mod bridge;
mod files;
mod geometry;
pub mod local_service;
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

/// Light base from the glass tokens (`--bg`, light is the default theme), so a
/// fresh window does not flash dark before the shell page paints.
const BACKGROUND: Color = Color(238, 242, 248, 255);

pub fn run() {
    let mut builder = tauri::Builder::default();

    // Must be the first plugin: a second launch (Windows and Linux deliver deep
    // links that way) hands its URL to this instance and exits.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_window(MAIN_WINDOW) {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            // Windows: a file association or the folder verb launched us again with a path.
            files::push_opened(app, files::paths_in_args(argv.into_iter().skip(1).map(Into::into)));
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
        .plugin(tauri_plugin_dialog::init())
        .manage(modules::ModuleState::default())
        .manage(files::Files::default())
        .manage(bridge::Commands::default())
        .manage(auth::Identity::default())
        .manage(local_service::LocalService::default())
        .invoke_handler(tauri::generate_handler![
            modules::module_open,
            modules::module_bounds,
            modules::module_hide,
            modules::module_reload,
            probe::probe,
            studio::studio_status,
            studio::studio_launch,
            auth::auth_restore,
            auth::auth_login,
            auth::auth_exchange,
            auth::auth_logout,
            auth::auth_handoff,
            auth::api_get,
            bridge::bridge_open,
            bridge::bridge_token,
            bridge::bridge_notify,
            bridge::module_command,
            bridge::bridge_take_command,
            files::bridge_open_files,
            files::bridge_read_file,
            files::files_scan,
            files::files_offer,
            files::files_take_opened,
            geometry::window_reset,
            local_service::local_service_status,
            local_service::local_service_start,
            local_service::local_service_stop,
            local_service::local_service_bootstrap,
            local_service::local_service_logs,
            local_service::local_service_open_logs,
        ])
        .on_webview_event(files::on_webview_event)
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

            // At its remembered place, or the default fitted to this screen
            // (ux-conventions rule 7).
            let place = geometry::initial(app.handle());
            let window = WindowBuilder::new(app, MAIN_WINDOW)
                .title("UPb Studio")
                .inner_size(place.w, place.h)
                .position(place.x, place.y)
                .min_inner_size(geometry::MIN.0, geometry::MIN.1)
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
            if place.maximized {
                let _ = window.maximize();
            }
            geometry::track(&window);
            log::info!("UPb Studio {} started", app.package_info().version);
            // Windows: launched by a file association or the folder verb with a path.
            // (macOS hands opened files over as file:// URLs through the deep-link plugin.)
            files::push_opened(app.handle(), files::paths_in_args(std::env::args_os().skip(1)));
            local_service::init(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building UPb Studio")
        .run(|app, event| {
            // Quit (menu, last window closed, Cmd-Q): stop laicpmsdb, then
            // PostgreSQL, before the process ends (ADR-0003, life cycle 3).
            if let tauri::RunEvent::Exit = event {
                local_service::shutdown(app);
            }
        });
}

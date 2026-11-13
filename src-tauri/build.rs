fn main() {
    // Declaring the app's own commands makes each one permission-gated
    // (`allow-<command>`), so module webviews get only the bridge commands
    // (capabilities/modules.json) while the shell gets the rest.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "module_open",
            "module_bounds",
            "module_hide",
            "module_reload",
            "probe",
            "studio_status",
            "studio_launch",
            "grainatlas_launch",
            "auth_restore",
            "auth_login",
            "auth_exchange",
            "auth_logout",
            "auth_handoff",
            "api_get",
            "bridge_open",
            "bridge_token",
            "bridge_notify",
            "module_command",
            "bridge_take_command",
            "bridge_open_files",
            "bridge_read_file",
            "files_scan",
            "files_project_package",
            "files_pick_session",
            "files_offer",
            "files_take_opened",
            "window_reset",
            "quit_answer",
            "quit_confirm",
            "quit_cancel",
            "local_service_status",
            "local_service_start",
            "local_service_stop",
            "local_service_bootstrap",
            "local_service_logs",
            "local_service_open_logs",
        ]),
    ))
    .expect("failed to run tauri-build");
}

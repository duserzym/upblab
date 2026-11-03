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
            "bridge_open",
            "bridge_token",
            "bridge_notify",
        ]),
    ))
    .expect("failed to run tauri-build");
}

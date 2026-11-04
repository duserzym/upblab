// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // A copy of this binary started as the local-service watchdog never
    // opens a window (src/local_service/guard.rs).
    upbstudio_lib::local_service::guard::run_if_requested();
    upbstudio_lib::run()
}

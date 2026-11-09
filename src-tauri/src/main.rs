// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Claude Code statusline bridge: short-lived CLI mode, no GUI.
    if std::env::args().any(|a| a == dynamic_island_lib::STATUSLINE_BRIDGE_FLAG) {
        dynamic_island_lib::run_statusline_bridge();
        return;
    }
    // Restarted after a crash: let the old process finish exiting first, or the
    // single-instance check would find it still there.
    if std::env::args().any(|a| a == dynamic_island_lib::AFTER_CRASH_FLAG) {
        std::thread::sleep(std::time::Duration::from_secs(3));
    }
    dynamic_island_lib::run()
}

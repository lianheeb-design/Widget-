//! The island's own features: the data providers (and through them the
//! modules' data, global shortcuts, the local API, Claude Code hooks…) and
//! files dropped on the island. They run only while this installation may be
//! used (see `license`); locked, the app shows the island and the tray and
//! nothing else.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager};

use crate::hub::Hub;
use crate::providers::Providers;

static STARTED: AtomicBool = AtomicBool::new(false);

/// Whether the features were started in this run.
pub fn started() -> bool {
    STARTED.load(Ordering::SeqCst)
}

/// Starts the features, once. Runs on the main thread: the drop target is an
/// OLE registration on the island window.
pub fn start(app: &AppHandle) {
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let hub = app.state::<Arc<Hub>>().inner().clone();
    for provider in &app.state::<Providers>().0 {
        provider.clone().start(hub.clone());
    }
    if let Some(win) = app.get_webview_window(crate::window::ISLAND_LABEL) {
        crate::file_drop::hook(app, &win);
    }
}

//! Self-update from GitHub releases.
//!
//! The release workflow publishes a signed `latest.json` next to the
//! installers (endpoint and public key in `tauri.conf.json`). Installed builds
//! check it shortly after startup and then every few hours, download a newer
//! version and offer it: in the island (the `update` snapshot), in the tray and
//! on the About page. It installs only when the person clicks, since
//! installing on Windows closes the app.
//!
//! This copy is a fork: until `UPDATES-EINRICHTEN.bat` points `tauri.conf.json`
//! at the person's own GitHub repository, the endpoint is still the original
//! project's, whose releases would replace the fork. Then updates stay off.

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const FIRST_CHECK: Duration = Duration::from_secs(20);
const INTERVAL: Duration = Duration::from_secs(3 * 60 * 60);

/// Snapshot id the island listens to: `{ version }` while an update waits.
pub const UPDATE_ID: &str = "update";

const CONFIG: &str = include_str!("../tauri.conf.json");

/// Whether the updater points at this fork's own releases.
pub fn configured() -> bool {
    CONFIG.contains("latest.json")
        && !CONFIG.contains("HeyyCzer/windows-island/releases")
        && !CONFIG.contains("DEIN-GITHUB-NAME")
}

/// A downloaded update waiting for the user: the update and its installer.
#[derive(Default)]
pub struct Pending(Mutex<Option<(Update, Vec<u8>)>>);

pub fn spawn(app: AppHandle) {
    if cfg!(debug_assertions) {
        return; // dev builds would "update" into the released app
    }
    if crate::portable::is_portable() {
        return; // the installer would land elsewhere; portable users re-download
    }
    if crate::store::IS_STORE {
        return; // the Microsoft Store updates it
    }
    if !configured() {
        return; // `check_update` then answers "notConfigured"
    }
    app.manage(Pending::default());
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_CHECK);
        loop {
            if let Err(e) = tauri::async_runtime::block_on(check(&app)) {
                log::warn!("update check failed: {e}");
            }
            std::thread::sleep(INTERVAL);
        }
    });
}

/// Look for a newer release and download it. Returns the version waiting to
/// be installed, if any.
async fn check(app: &AppHandle) -> tauri_plugin_updater::Result<Option<String>> {
    if let Some((update, _)) = &*app.state::<Pending>().0.lock().unwrap() {
        return Ok(Some(update.version.clone())); // already waiting on the user
    }
    let Some(update) = app.updater()?.check().await? else {
        return Ok(None);
    };
    let bytes = update.download(|_, _| {}, || {}).await?;
    let version = update.version.clone();
    *app.state::<Pending>().0.lock().unwrap() = Some((update, bytes));
    crate::tray::show_update(app, &version);
    if let Some(hub) = app.try_state::<std::sync::Arc<crate::hub::Hub>>() {
        hub.publish(UPDATE_ID, serde_json::json!({ "version": version }));
    }
    Ok(Some(version))
}

/// Manual check from the About page. Errors with `"notConfigured"` before
/// updates are set up, `"portable"` on portable builds, `"store"` on the
/// Microsoft Store edition and `"dev"` on dev builds, which never self-update.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<String>, String> {
    if crate::portable::is_portable() {
        return Err("portable".into());
    }
    if crate::store::IS_STORE {
        return Err("store".into());
    }
    if !configured() {
        return Err("notConfigured".into());
    }
    if app.try_state::<Pending>().is_none() {
        return Err("dev".into());
    }
    check(&app).await.map_err(|e| {
        log::warn!("update check failed: {e}");
        e.to_string()
    })
}

/// Install the pending update from the About page.
#[tauri::command]
pub fn install_update(app: AppHandle) {
    install(&app);
}

/// Install the downloaded update. On Windows the installer takes over and the
/// app exits; the installer starts it again when done.
pub fn install(app: &AppHandle) {
    let Some(pending) = app.try_state::<Pending>() else {
        return;
    };
    let Some((update, bytes)) = pending.0.lock().unwrap().take() else {
        return;
    };
    if let Err(e) = update.install(bytes) {
        log::error!("update install failed: {e}");
        return;
    }
    app.restart();
}

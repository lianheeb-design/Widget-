//! User settings: a flat JSON key/value store persisted in the app config dir.
//!
//! The backend doesn't know the schema — defaults and meaning live in the
//! frontend (each module declares its own settings). Every change is broadcast
//! as `settings://changed` so all windows stay in sync.

use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

pub const CHANGED_EVENT: &str = "settings://changed";
pub const SETTINGS_LABEL: &str = "settings";

pub struct Settings {
    path: PathBuf,
    data: Mutex<Map<String, Value>>,
}

impl Settings {
    pub fn load(app: &AppHandle) -> Self {
        let path = app
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| std::env::temp_dir())
            .join("settings.json");
        let data = std::fs::read_to_string(&path)
            .ok()
            .and_then(|t| serde_json::from_str::<Map<String, Value>>(&t).ok())
            .unwrap_or_default();
        Self {
            path,
            data: Mutex::new(data),
        }
    }

    /// Current raw value of a setting (`None` = never set, use the default).
    pub fn get(&self, key: &str) -> Option<Value> {
        self.data.lock().unwrap().get(key).cloned()
    }

    pub fn snapshot(&self) -> Map<String, Value> {
        self.data.lock().unwrap().clone()
    }

    fn save(&self, data: &Map<String, Value>) {
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(text) = serde_json::to_string_pretty(data) {
            let _ = std::fs::write(&self.path, text);
        }
    }
}

#[tauri::command]
pub fn get_settings(settings: State<Settings>) -> Map<String, Value> {
    settings.data.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_setting(app: AppHandle, key: String, value: Value) {
    set(&app, &key, value);
}

/// Marks a settings backup, so a random JSON file isn't taken for one.
const BACKUP_KIND: &str = "island-settings-backup";

/// Saves every setting to a file the person picks ("Back up settings").
/// `Ok(false)`: cancelled. Secret keys aren't in there (they live in the
/// Windows Credential Manager).
#[tauri::command]
pub async fn export_settings(app: AppHandle) -> Result<bool, String> {
    let Some(path) = crate::dialog::pick_save(
        "Island backup (*.json)",
        "*.json",
        "island-einstellungen.json",
    ) else {
        return Ok(false);
    };
    let backup = serde_json::json!({
        "kind": BACKUP_KIND,
        "version": app.package_info().version.to_string(),
        "settings": app.state::<Settings>().snapshot(),
    });
    let text = serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Replaces every setting with those of a backup the person picks.
/// `Ok(false)`: cancelled; `Err("notBackup")`: not a backup file.
#[tauri::command]
pub async fn import_settings(app: AppHandle) -> Result<bool, String> {
    let Some(path) = crate::dialog::pick_file("Island backup (*.json)", "*.json") else {
        return Ok(false);
    };
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let data = parse_backup(&text).ok_or("notBackup")?;
    let settings = app.state::<Settings>();
    {
        let mut current = settings.data.lock().unwrap();
        *current = data.clone();
        settings.save(&current);
    }
    let _ = app.emit(CHANGED_EVENT, data);
    crate::tray::sync_hidden(&app);
    Ok(true)
}

/// The settings inside a backup file, if it is one.
fn parse_backup(text: &str) -> Option<Map<String, Value>> {
    let value: Value = serde_json::from_str(text).ok()?;
    if value.get("kind")?.as_str()? != BACKUP_KIND {
        return None;
    }
    value.get("settings")?.as_object().cloned()
}

/// Store and broadcast a setting (backend side of `setSetting`).
pub fn set(app: &AppHandle, key: &str, value: Value) {
    let settings = app.state::<Settings>();
    let snapshot = {
        let mut data = settings.data.lock().unwrap();
        data.insert(key.to_string(), value);
        settings.save(&data);
        data.clone()
    };
    let _ = app.emit(CHANGED_EVENT, snapshot);
    if key == crate::tray::HIDDEN_KEY {
        crate::tray::sync_hidden(app);
    }
}

#[tauri::command]
pub fn open_settings(app: AppHandle) -> Result<(), String> {
    open(&app).map_err(|e| e.to_string())
}

const SIZE: (f64, f64) = (860.0, 620.0);

pub fn open(app: &AppHandle) -> tauri::Result<()> {
    if let Some(win) = app.get_webview_window(SETTINGS_LABEL) {
        win.unminimize()?;
        win.show()?;
        return win.set_focus();
    }
    // Callers are sync commands / tray / single-instance handlers on the main
    // thread, where building a webview deadlocks on Windows (WebView2 needs the
    // event loop). Build from another thread instead.
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = create(&app) {
            eprintln!("settings window: {e}");
        }
    });
    Ok(())
}

fn create(app: &AppHandle) -> tauri::Result<()> {
    let _win = WebviewWindowBuilder::new(app, SETTINGS_LABEL, WebviewUrl::App("index.html".into()))
        .title(crate::i18n::t(app, "window.settings"))
        .inner_size(SIZE.0, SIZE.1)
        .resizable(false)
        .center()
        // Custom titlebar lives in the webview (see `SettingsApp.tsx`).
        .decorations(false)
        .background_color(tauri::webview::Color(12, 12, 16, 255))
        .build()?;
    Ok(())
}

const REPO_URL: &str = "https://github.com/HeyyCzer/windows-island";

/// Open the GitHub repo in the default browser (About page).
#[tauri::command]
pub fn open_repo() {
    open_url(REPO_URL);
}

/// Open a web page in the default browser (island links, e.g. usage pages).
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("only https links".into());
    }
    open_url(&url);
    Ok(())
}

/// Open a URL in the default browser.
pub fn open_url(url: &str) {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        use windows::core::{HSTRING, PCWSTR, w};
        ShellExecuteW(
            None,
            w!("open"),
            &HSTRING::from(url),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
    }
}

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> bool {
    crate::autostart::is_enabled(&app)
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    crate::autostart::set(&app, enabled)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_backups() {
        let ok = r#"{"kind":"island-settings-backup","version":"1.0.0","settings":{"a":1}}"#;
        assert_eq!(parse_backup(ok).unwrap().get("a"), Some(&Value::from(1)));
        assert!(parse_backup(r#"{"settings":{"a":1}}"#).is_none());
        assert!(parse_backup("not json").is_none());
        assert!(parse_backup(r#"{"kind":"island-settings-backup","settings":[1]}"#).is_none());
    }
}

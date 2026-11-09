//! Web apps (ChatGPT, Claude, Gemini…) inside the island: each one is a
//! child webview of the island window, laid over the rect the island's
//! "AI apps" panel reserves for it. Hiding keeps it alive, so the
//! conversation is still there next time, and logins stay in the island's
//! WebView2 profile.
//!
//! The page is a remote site: it gets no Tauri capabilities (see
//! `capabilities/default.json`, which grants them to the island's own
//! webviews only), so it can't call any command. Links that want a new
//! window open in the default browser.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::Deserialize;
use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewBuilder, WebviewUrl,
};

const LABEL_PREFIX: &str = "webapp-";
/// Hidden this long, the web apps are closed: a page like ChatGPT keeps running
/// (and using the processor and memory) while hidden. Logins stay; next time the
/// page loads anew.
const SLEEP_AFTER: Duration = Duration::from_secs(10 * 60);
/// Bumped on every show and hide: a pending sleep only runs if nothing happened since.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Where the panel wants the web app, in CSS px of the island window.
#[derive(Deserialize, Clone, Copy, Debug)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn label_of(id: &str) -> Result<String, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("bad id".into());
    }
    Ok(format!("{LABEL_PREFIX}{id}"))
}

fn web_apps(app: &AppHandle) -> Vec<Webview> {
    app.webviews()
        .into_iter()
        .filter(|(label, _)| label.starts_with(LABEL_PREFIX))
        .map(|(_, webview)| webview)
        .collect()
}

/// Shows web app `id` (created on first use at `url`) over `rect`, hides
/// the others, and gives it the keyboard.
pub fn show(app: &AppHandle, id: &str, url: &str, rect: Rect) -> Result<(), String> {
    let label = label_of(id)?;
    let url: Url = url.parse().map_err(|_| "bad url".to_string())?;
    if url.scheme() != "https" {
        return Err("only https".into());
    }
    if rect.width < 50.0 || rect.height < 50.0 {
        return Err("too small".into());
    }
    let island = app
        .get_webview_window(crate::window::ISLAND_LABEL)
        .ok_or("no island window")?;
    GENERATION.fetch_add(1, Ordering::Relaxed);
    crate::window::set_web_app_open(&island, true);
    crate::window::allow_activation();
    let _ = island.set_focus();
    for other in web_apps(app) {
        if other.label() != label {
            let _ = other.hide();
        }
    }
    let position = LogicalPosition::new(rect.x, rect.y);
    let size = LogicalSize::new(rect.width, rect.height);
    if let Some(webview) = app.get_webview(&label) {
        webview.set_position(position).map_err(|e| e.to_string())?;
        webview.set_size(size).map_err(|e| e.to_string())?;
        webview.show().map_err(|e| e.to_string())?;
        let _ = webview.set_focus();
        return Ok(());
    }
    let window = app
        .get_window(crate::window::ISLAND_LABEL)
        .ok_or("no island window")?;
    // `add_child` waits for the main thread: building it from a command
    // running there would deadlock, so build from another thread.
    std::thread::spawn(move || {
        let builder = WebviewBuilder::new(&label, WebviewUrl::External(url)).on_new_window(
            |url, _features| {
                if url.scheme() == "https" || url.scheme() == "http" {
                    crate::settings::open_url(url.as_str());
                }
                NewWindowResponse::Deny
            },
        );
        match window.add_child(builder, position, size) {
            Ok(webview) => {
                let _ = webview.set_focus();
            }
            Err(e) => log::warn!("web app {label}: {e}"),
        }
    });
    Ok(())
}

/// Hides every web app (the panel closed); the island stops taking the keyboard.
pub fn hide(app: &AppHandle) {
    let open = web_apps(app);
    for webview in &open {
        let _ = webview.hide();
    }
    if let Some(island) = app.get_webview_window(crate::window::ISLAND_LABEL) {
        crate::window::set_web_app_open(&island, false);
    }
    if open.is_empty() {
        return;
    }
    let generation = GENERATION.fetch_add(1, Ordering::Relaxed) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SLEEP_AFTER);
        if GENERATION.load(Ordering::Relaxed) != generation {
            return;
        }
        for webview in web_apps(&app) {
            if let Err(e) = webview.close() {
                log::warn!("web app {}: {e}", webview.label());
            }
        }
    });
}

/// Lets the web app take the keyboard: activates the island, then focuses it.
pub fn focus(app: &AppHandle, id: &str) -> Result<(), String> {
    let webview = app.get_webview(&label_of(id)?).ok_or("not open")?;
    if let Some(island) = app.get_webview_window(crate::window::ISLAND_LABEL) {
        crate::window::allow_activation();
        let _ = island.set_focus();
    }
    webview.set_focus().map_err(|e| e.to_string())
}

/// Back, reload, or the page's address (to open it in the browser).
pub fn command(app: &AppHandle, id: &str, what: &str) -> Result<Option<String>, String> {
    let webview = app.get_webview(&label_of(id)?).ok_or("not open")?;
    match what {
        "back" => webview.eval("history.back()").map(|_| None),
        "reload" => webview.reload().map(|_| None),
        "url" => webview.url().map(|u| Some(u.to_string())),
        _ => return Err("unknown".into()),
    }
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_only_from_plain_ids() {
        assert_eq!(label_of("chatgpt").unwrap(), "webapp-chatgpt");
        assert!(label_of("").is_err());
        assert!(label_of("../x").is_err());
        assert!(label_of("a b").is_err());
    }
}

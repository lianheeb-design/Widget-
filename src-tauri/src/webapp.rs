//! Web apps (ChatGPT, Claude, Gemini…) in their own window that drops down
//! under the island, instead of a browser tab. One window per app: closing it
//! only hides it, so the conversation is still there next time, and logins
//! stay in the island's WebView2 profile.
//!
//! The page is a remote site: it gets no Tauri capabilities (see
//! `capabilities/default.json`, which lists only the island's own windows),
//! so it can't call any command. Links that want a new window open in the
//! default browser.

use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, Manager, PhysicalPosition, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

const LABEL_PREFIX: &str = "webapp-";
/// Logical size: about a phone's width, most of a laptop screen's height.
const SIZE: (f64, f64) = (460.0, 720.0);
/// Logical gap between the top of the screen and the window, under the pill.
const TOP: f64 = 64.0;

/// `id` names the app (`chatgpt`), `url` its https start page. Shows its
/// window, or hides it when it is already in front (a second click on the
/// island's button).
pub fn toggle(app: &AppHandle, id: &str, url: &str, title: &str) -> Result<(), String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("bad id".into());
    }
    let url: Url = url.parse().map_err(|_| "bad url".to_string())?;
    if url.scheme() != "https" {
        return Err("only https".into());
    }
    let label = format!("{LABEL_PREFIX}{id}");
    if let Some(win) = app.get_webview_window(&label) {
        let visible = win.is_visible().unwrap_or(false);
        let focused = win.is_focused().unwrap_or(false);
        if visible && focused {
            return win.hide().map_err(|e| e.to_string());
        }
        place(app, &win);
        let _ = win.unminimize();
        win.show().map_err(|e| e.to_string())?;
        return win.set_focus().map_err(|e| e.to_string());
    }
    // Building a webview from a command on the main thread deadlocks on
    // Windows (WebView2 needs the event loop): build it from another thread.
    let app = app.clone();
    let title = title.to_owned();
    std::thread::spawn(move || {
        if let Err(e) = create(&app, &label, url, &title) {
            log::warn!("web app window: {e}");
        }
    });
    Ok(())
}

fn create(app: &AppHandle, label: &str, url: Url, title: &str) -> tauri::Result<()> {
    let win = WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
        .title(title)
        .inner_size(SIZE.0, SIZE.1)
        .min_inner_size(360.0, 420.0)
        .resizable(true)
        .visible(false)
        .on_new_window(|url, _features| {
            if url.scheme() == "https" || url.scheme() == "http" {
                crate::settings::open_url(url.as_str());
            }
            NewWindowResponse::Deny
        })
        .build()?;
    place(app, &win);
    // The close button hides: the chat is still there next time.
    let hide = win.clone();
    win.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = hide.hide();
        }
    });
    win.show()?;
    win.set_focus()
}

/// Centered under the island, on the island's screen.
fn place(app: &AppHandle, win: &WebviewWindow) {
    let Some(island) = app.get_webview_window(crate::window::ISLAND_LABEL) else {
        return;
    };
    let (Ok(Some(monitor)), Ok(pos), Ok(size), Ok(own)) = (
        island.current_monitor(),
        island.outer_position(),
        island.outer_size(),
        win.outer_size(),
    ) else {
        return;
    };
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let center = pos.x + size.width as i32 / 2;
    let left = area.position.x;
    let right = area.position.x + area.size.width as i32 - own.width as i32;
    let x = (center - own.width as i32 / 2).clamp(left, right.max(left));
    let y = area.position.y + (TOP * scale) as i32;
    let _ = win.set_position(PhysicalPosition::new(x, y));
}

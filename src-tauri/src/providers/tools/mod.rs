//! Tools for the control center, Git and ChatGPT modules. Nothing to publish
//! or poll: every feature is a request from the UI, answered here.
//!
//! - `system`: screen brightness, computer volume, lock, screenshots;
//! - `git`: status, add, commit, push and pull of local repositories;
//! - `openai`: a ChatGPT chat with the person's own OpenAI API key.

mod desktop;
mod git;
mod openai;
mod picker;
mod system;
mod translate;

use std::sync::{Arc, OnceLock};

use serde_json::Value;

use super::Provider;
use crate::hub::Hub;

pub const PROVIDER_ID: &str = "tools";

/// `CREATE_NO_WINDOW`: helper processes (git, powershell) flash no console.
#[cfg(windows)]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
pub struct ToolsProvider {
    hub: OnceLock<Arc<Hub>>,
}

impl Provider for ToolsProvider {
    fn id(&self) -> &'static str {
        PROVIDER_ID
    }

    fn start(self: Arc<Self>, hub: Arc<Hub>) {
        desktop::start(hub.clone());
        let _ = self.hub.set(hub);
    }

    fn action(&self, action: &str, payload: Value) -> Result<Value, String> {
        if let Some(rest) = action.strip_prefix("git_") {
            return git::action(rest, &payload);
        }
        if let Some(rest) = action.strip_prefix("openai_") {
            return openai::action(rest, &payload);
        }
        if let Some(rest) = action.strip_prefix("translate_") {
            return translate::action(rest, &payload);
        }
        if action == "log_error" {
            let message = payload["message"].as_str().unwrap_or_default();
            let message: String = message.chars().take(2000).collect();
            log::error!("ui: {message}");
            return Ok(Value::Null);
        }
        if action == "open_log" {
            let dir = crate::logfile::dir().ok_or("no log")?;
            crate::settings::open_url(&dir.to_string_lossy());
            return Ok(Value::Null);
        }
        if action == "idle_ms" {
            return Ok(idle_ms().map_or(Value::Null, Value::from));
        }
        if action == "clipboard_text" {
            return Ok(
                crate::providers::clipboard::current_text().map_or(Value::Null, Value::String)
            );
        }
        if action == "copy_text" {
            let hub = self.hub.get().ok_or("not started")?;
            let text = payload["text"].as_str().ok_or("text missing")?;
            crate::providers::clipboard::copy_text(hub, text)?;
            return Ok(Value::Null);
        }
        if let Some(what) = action.strip_prefix("webapp_") {
            let hub = self.hub.get().ok_or("not started")?;
            let app = hub.app();
            let id = payload["id"].as_str().unwrap_or_default();
            return match what {
                "show" => {
                    let rect: crate::webapp::Rect = serde_json::from_value(payload["rect"].clone())
                        .map_err(|e| e.to_string())?;
                    let url = payload["url"].as_str().unwrap_or_default();
                    crate::webapp::show(app, id, url, rect).map(|_| Value::Null)
                }
                "hide" => {
                    crate::webapp::hide(app);
                    Ok(Value::Null)
                }
                "focus" => crate::webapp::focus(app, id).map(|_| Value::Null),
                other => crate::webapp::command(app, id, other)
                    .map(|url| url.map_or(Value::Null, Value::String)),
            };
        }
        if action == "pick_color" {
            let hub = self.hub.get().cloned().ok_or("not started")?;
            picker::start(hub)?;
            return Ok(Value::Null);
        }
        if let Some(result) = desktop::action(action, &payload) {
            return result;
        }
        system::action(action, &payload)
    }
}

/// How long ago the person last typed or moved the mouse (ms): whether
/// someone is at the computer (the morning briefing waits for them).
#[cfg(windows)]
fn idle_ms() -> Option<u64> {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    unsafe { GetLastInputInfo(&mut info) }.as_bool().then(|| {
        // Both wrap after 49 days; their difference doesn't.
        u64::from(unsafe { GetTickCount() }.wrapping_sub(info.dwTime))
    })
}

#[cfg(not(windows))]
fn idle_ms() -> Option<u64> {
    None
}

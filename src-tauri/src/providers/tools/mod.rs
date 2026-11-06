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
        if action == "copy_text" {
            let hub = self.hub.get().ok_or("not started")?;
            let text = payload["text"].as_str().ok_or("text missing")?;
            crate::providers::clipboard::copy_text(hub, text)?;
            return Ok(Value::Null);
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

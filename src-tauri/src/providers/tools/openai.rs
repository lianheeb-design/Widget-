//! ChatGPT in the island, with the person's own OpenAI API key (created at
//! platform.openai.com; billed by OpenAI per use, separate from a ChatGPT
//! subscription). The key lives in the Windows Credential Manager and never
//! reaches the UI; the UI sends the conversation and gets the answer back.

use std::time::Duration;

use serde_json::{Value, json};

use crate::providers::credentials;

const KEY_TARGET: &str = "dynamic-island:openai";
const API: &str = "https://api.openai.com/v1";
/// Turns sent along with each question, so long chats stay cheap.
const HISTORY: usize = 20;

pub fn action(action: &str, payload: &Value) -> Result<Value, String> {
    match action {
        "status" => Ok(json!({ "hasKey": credentials::read(KEY_TARGET).is_some() })),
        "set_key" => {
            let key = payload["key"].as_str().unwrap_or_default().trim();
            if !key.starts_with("sk-") || key.len() < 20 {
                return Err("invalidKey".into());
            }
            // Check it before keeping it.
            models(key)?;
            credentials::write(KEY_TARGET, key)?;
            Ok(Value::Null)
        }
        "clear_key" => {
            credentials::delete(KEY_TARGET)?;
            Ok(Value::Null)
        }
        "models" => Ok(json!(models(&key()?)?)),
        "chat" => chat(payload).map(|text| json!({ "text": text })),
        other => Err(format!("openai: unsupported action '{other}'")),
    }
}

fn key() -> Result<String, String> {
    credentials::read(KEY_TARGET).ok_or_else(|| "noKey".into())
}

fn agent(timeout: Duration) -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(timeout))
        .build()
        .into()
}

fn read_json(res: &mut ureq::http::Response<ureq::Body>) -> Value {
    res.body_mut()
        .read_to_string()
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// OpenAI's error body → a short code the UI translates, or its message.
fn api_error(status: u16, body: &Value) -> String {
    let code = body["error"]["code"].as_str().unwrap_or_default();
    match (status, code) {
        (401, _) => "badKey".into(),
        (429, "insufficient_quota") => "quota".into(),
        (429, _) => "rateLimited".into(),
        (_, "model_not_found") => "model".into(),
        (404, _) => "model".into(),
        _ => body["error"]["message"]
            .as_str()
            .map(|m| m.chars().take(240).collect())
            .unwrap_or_else(|| format!("HTTP {status}")),
    }
}

/// Chat models the key can use, newest names first.
fn models(key: &str) -> Result<Vec<String>, String> {
    let mut res = agent(Duration::from_secs(15))
        .get(format!("{API}/models"))
        .header("Authorization", &format!("Bearer {key}"))
        .call()
        .map_err(|_| "network".to_string())?;
    let status = res.status().as_u16();
    let body = read_json(&mut res);
    if status != 200 {
        return Err(api_error(status, &body));
    }
    let skip = [
        "audio",
        "realtime",
        "tts",
        "transcribe",
        "image",
        "search",
        "embedding",
        "moderation",
        "instruct",
        "codex",
        "dall-e",
        "whisper",
        "computer-use",
    ];
    let mut ids: Vec<String> = body["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| m["id"].as_str())
        .filter(|id| id.starts_with("gpt-") || id.starts_with("chatgpt-") || id.starts_with('o'))
        .filter(|id| !skip.iter().any(|s| id.contains(s)))
        .map(str::to_owned)
        .collect();
    ids.sort_by(|a, b| b.cmp(a));
    Ok(ids)
}

/// `{ model, messages: [{ role: "user" | "assistant", content }] }` → the answer.
fn chat(payload: &Value) -> Result<String, String> {
    let key = key()?;
    let model = payload["model"]
        .as_str()
        .filter(|m| !m.is_empty())
        .ok_or("model")?;
    let all: Vec<Value> = payload["messages"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let role = m["role"].as_str()?;
            let content = m["content"].as_str()?;
            matches!(role, "user" | "assistant")
                .then(|| json!({ "role": role, "content": content }))
        })
        .collect();
    if all.is_empty() {
        return Err("empty".into());
    }
    let mut messages = vec![json!({
        "role": "system",
        "content": "You are ChatGPT inside a small Dynamic Island panel on a Windows PC. \
                    Answer briefly and clearly, in the language of the question. \
                    Use short paragraphs or simple lists; no tables.",
    })];
    messages.extend(all[all.len().saturating_sub(HISTORY)..].iter().cloned());

    let mut res = agent(Duration::from_secs(120))
        .post(format!("{API}/chat/completions"))
        .header("Authorization", &format!("Bearer {key}"))
        .header("Content-Type", "application/json")
        .send(json!({ "model": model, "messages": messages }).to_string())
        .map_err(|_| "network".to_string())?;
    let status = res.status().as_u16();
    let body = read_json(&mut res);
    if status != 200 {
        return Err(api_error(status, &body));
    }
    body["choices"][0]["message"]["content"]
        .as_str()
        .map(|t| t.trim().to_owned())
        .filter(|t| !t.is_empty())
        .ok_or_else(|| "empty".into())
}

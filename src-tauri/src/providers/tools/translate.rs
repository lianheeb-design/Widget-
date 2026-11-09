//! The translator: MyMemory (free, no account, about 5000 characters a day)
//! or, with the person's own DeepL key (free at deepl.com), DeepL. The key
//! lives in the Windows Credential Manager and never reaches the UI.

use std::time::Duration;

use serde_json::{Value, json};

use crate::providers::credentials;

const KEY_TARGET: &str = "dynamic-island:deepl";
/// MyMemory takes at most 500 bytes per request: longer texts go in pieces.
const CHUNK: usize = 450;
/// Languages DeepL translates into (lowercase ISO codes); others use MyMemory.
const DEEPL: &[&str] = &[
    "ar", "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "hu", "id", "it", "ja", "ko",
    "lt", "lv", "nb", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "zh",
];

pub fn action(action: &str, payload: &Value) -> Result<Value, String> {
    match action {
        "status" => Ok(json!({ "hasKey": credentials::read(KEY_TARGET).is_some() })),
        "set_key" => {
            let key = payload["key"].as_str().unwrap_or_default().trim();
            if key.is_empty() {
                return Err("empty".into());
            }
            credentials::write(KEY_TARGET, key)?;
            Ok(Value::Null)
        }
        "clear_key" => {
            credentials::delete(KEY_TARGET)?;
            Ok(Value::Null)
        }
        "run" => {
            let text = payload["text"].as_str().unwrap_or_default().trim();
            let from = payload["from"].as_str().unwrap_or("auto");
            let to = payload["to"].as_str().unwrap_or("en");
            if text.is_empty() {
                return Ok(json!({ "text": "", "detected": null, "service": null }));
            }
            if !is_code(to) || (from != "auto" && !is_code(from)) {
                return Err("bad language".into());
            }
            translate(text, from, to)
        }
        other => Err(format!("translate: unsupported action '{other}'")),
    }
}

fn is_code(code: &str) -> bool {
    (2..=3).contains(&code.len()) && code.chars().all(|c| c.is_ascii_lowercase())
}

fn translate(text: &str, from: &str, to: &str) -> Result<Value, String> {
    if let Some(key) = credentials::read(KEY_TARGET)
        && DEEPL.contains(&to)
        && (from == "auto" || DEEPL.contains(&from))
    {
        return deepl(&key, text, from, to);
    }
    mymemory(text, from, to)
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(15)))
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

/// Pieces of at most `max` bytes, cut after a sentence or a space when possible.
pub fn chunks(text: &str, max: usize) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = text;
    while rest.len() > max {
        let mut cut = max;
        while !rest.is_char_boundary(cut) {
            cut -= 1;
        }
        let head = &rest[..cut];
        let at = head
            .rfind(['.', '!', '?', '\n'])
            .map(|i| i + 1)
            .filter(|&i| i > max / 3)
            .or_else(|| head.rfind(' ').filter(|&i| i > max / 3))
            .unwrap_or(cut);
        out.push(rest[..at].trim());
        rest = rest[at..].trim_start();
    }
    if !rest.trim().is_empty() {
        out.push(rest.trim());
    }
    out
}

fn mymemory(text: &str, from: &str, to: &str) -> Result<Value, String> {
    let agent = agent();
    let source = if from == "auto" { "Autodetect" } else { from };
    let mut parts = Vec::new();
    let mut detected: Option<String> = None;
    for piece in chunks(text, CHUNK) {
        let mut res = agent
            .get("https://api.mymemory.translated.net/get")
            .query("q", piece)
            .query("langpair", format!("{source}|{to}"))
            .call()
            .map_err(|_| "network".to_string())?;
        let body = read_json(&mut res);
        if body["quotaFinished"].as_bool() == Some(true) {
            return Err("quota".into());
        }
        let status = body["responseStatus"]
            .as_u64()
            .or_else(|| body["responseStatus"].as_str().and_then(|s| s.parse().ok()));
        if status != Some(200) {
            return Err(body["responseDetails"]
                .as_str()
                .filter(|s| !s.is_empty())
                .unwrap_or("failed")
                .to_owned());
        }
        if detected.is_none() {
            detected = body["responseData"]["detectedLanguage"]
                .as_str()
                .map(|s| s.split('-').next().unwrap_or(s).to_lowercase());
        }
        parts.push(
            body["responseData"]["translatedText"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
        );
    }
    let detected = detected.or_else(|| (from != "auto").then(|| from.to_owned()));
    Ok(json!({ "text": parts.join(" "), "detected": detected, "service": "mymemory" }))
}

fn deepl(key: &str, text: &str, from: &str, to: &str) -> Result<Value, String> {
    // Free keys end in ":fx" and have their own host.
    let host = if key.ends_with(":fx") {
        "https://api-free.deepl.com"
    } else {
        "https://api.deepl.com"
    };
    let target = match to {
        "en" => "EN-GB",
        "pt" => "PT-PT",
        other => other,
    }
    .to_uppercase();
    let mut body = json!({ "text": [text], "target_lang": target });
    if from != "auto" {
        body["source_lang"] = json!(from.to_uppercase());
    }
    let mut res = agent()
        .post(format!("{host}/v2/translate"))
        .header("Authorization", &format!("DeepL-Auth-Key {key}"))
        .header("Content-Type", "application/json")
        .send(body.to_string())
        .map_err(|_| "network".to_string())?;
    let status = res.status().as_u16();
    let body = read_json(&mut res);
    match status {
        200 => {}
        401 | 403 => return Err("badKey".into()),
        456 => return Err("quota".into()),
        _ => {
            return Err(body["message"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| format!("HTTP {status}")));
        }
    }
    let first = &body["translations"][0];
    Ok(json!({
        "text": first["text"].as_str().unwrap_or_default(),
        "detected": first["detected_source_language"].as_str().map(str::to_lowercase),
        "service": "deepl",
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_text_is_one_piece() {
        assert_eq!(chunks("Hallo Welt", 450), vec!["Hallo Welt"]);
        assert!(chunks("   ", 450).is_empty());
    }

    #[test]
    fn long_text_is_cut_after_sentences() {
        let text = "Eins zwei drei. ".repeat(60);
        let parts = chunks(&text, 100);
        assert!(parts.len() > 1);
        assert!(parts.iter().all(|p| p.len() <= 100 && p.ends_with('.')));
        assert_eq!(parts.join(" "), text.trim());
    }

    #[test]
    fn never_cuts_inside_a_character() {
        let text = "ä".repeat(300);
        let parts = chunks(&text, 101);
        assert!(parts.iter().all(|p| p.len() <= 101));
        assert_eq!(parts.concat(), text);
    }

    #[test]
    fn language_codes() {
        assert!(is_code("de") && is_code("en"));
        assert!(!is_code("DE") && !is_code("d") && !is_code("de-CH"));
    }
}

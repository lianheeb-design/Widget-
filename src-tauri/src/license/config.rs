//! Where the license server is and which keys sign its tokens, baked in from
//! `src-tauri/license.json` (checked by `build.rs`). Neither is a secret: the
//! endpoint is a public URL, and a public key can only verify signatures.
//!
//! An empty `endpoint` turns the license check off (forks and builds made
//! before the server is set up behave as before).

use std::sync::LazyLock;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::Deserialize;

const RAW: &str = include_str!("../../license.json");

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// URL of the `license` Edge Function.
    pub endpoint: String,
    /// Ed25519 public keys; a token signed by any of them is accepted (more
    /// than one while a key is being rotated).
    pub public_keys: Vec<[u8; 32]>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct File {
    #[serde(default)]
    endpoint: String,
    #[serde(default)]
    public_keys: Vec<String>,
}

/// `None`: the license check is off in this build.
pub static CONFIG: LazyLock<Option<Config>> = LazyLock::new(|| {
    let (endpoint, keys) = overrides();
    match parse(RAW, endpoint, keys, cfg!(debug_assertions)) {
        Ok(config) => config,
        Err(e) => {
            // `build.rs` already refuses a broken file, so this can't happen in a release.
            log::error!("license.json: {e}");
            None
        }
    }
});

/// Dev builds only: `ISLAND_LICENSE_ENDPOINT` / `ISLAND_LICENSE_PUBLIC_KEY`
/// point the app at a local test server (`supabase/tests/local-server.ts`).
fn overrides() -> (Option<String>, Option<String>) {
    if !cfg!(debug_assertions) {
        return (None, None);
    }
    (
        std::env::var("ISLAND_LICENSE_ENDPOINT").ok(),
        std::env::var("ISLAND_LICENSE_PUBLIC_KEY").ok(),
    )
}

pub fn parse(
    raw: &str,
    endpoint_override: Option<String>,
    key_override: Option<String>,
    allow_local_http: bool,
) -> Result<Option<Config>, String> {
    let file: File = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    let endpoint = endpoint_override
        .unwrap_or(file.endpoint)
        .trim()
        .to_string();
    if endpoint.is_empty() {
        return Ok(None);
    }
    let local =
        endpoint.starts_with("http://127.0.0.1:") || endpoint.starts_with("http://localhost:");
    if !endpoint.starts_with("https://") && !(allow_local_http && local) {
        return Err("the endpoint must use https://".into());
    }
    let keys = match key_override {
        Some(key) => vec![key],
        None => file.public_keys,
    };
    let public_keys = keys
        .iter()
        .map(|key| {
            STANDARD
                .decode(key.trim())
                .ok()
                .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
                .ok_or_else(|| format!("\"{key}\" is not an Ed25519 public key"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    if public_keys.is_empty() {
        return Err("no public key".into());
    }
    Ok(Some(Config {
        endpoint,
        public_keys,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "ebVWLo/mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ=";

    #[test]
    fn the_shipped_file_parses() {
        assert!(parse(RAW, None, None, false).is_ok());
    }

    #[test]
    fn empty_endpoint_turns_it_off() {
        assert_eq!(
            parse(r#"{"endpoint":"","publicKeys":[]}"#, None, None, false),
            Ok(None)
        );
    }

    #[test]
    fn reads_endpoint_and_keys() {
        let raw = format!(
            r#"{{"endpoint":"https://x.supabase.co/functions/v1/license","publicKeys":["{KEY}"]}}"#
        );
        let config = parse(&raw, None, None, false).unwrap().unwrap();
        assert_eq!(
            config.endpoint,
            "https://x.supabase.co/functions/v1/license"
        );
        assert_eq!(config.public_keys.len(), 1);
        assert_eq!(config.public_keys[0][0], 0x79);
    }

    #[test]
    fn refuses_plain_http_and_bad_keys() {
        let http = format!(r#"{{"endpoint":"http://x.example/license","publicKeys":["{KEY}"]}}"#);
        assert!(parse(&http, None, None, true).is_err());
        let local =
            format!(r#"{{"endpoint":"http://127.0.0.1:8787/license","publicKeys":["{KEY}"]}}"#);
        assert!(parse(&local, None, None, false).is_err());
        assert!(parse(&local, None, None, true).unwrap().is_some());
        let bad = r#"{"endpoint":"https://x.example","publicKeys":["c2hvcnQ="]}"#;
        assert!(parse(bad, None, None, false).is_err());
        let none = r#"{"endpoint":"https://x.example","publicKeys":[]}"#;
        assert!(parse(none, None, None, false).is_err());
    }

    #[test]
    fn dev_overrides_win() {
        let config = parse(
            r#"{"endpoint":"","publicKeys":[]}"#,
            Some("http://127.0.0.1:8787/license".into()),
            Some(KEY.into()),
            true,
        )
        .unwrap()
        .unwrap();
        assert_eq!(config.endpoint, "http://127.0.0.1:8787/license");
    }
}

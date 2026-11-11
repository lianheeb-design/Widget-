//! What the license check keeps on this computer, in the Windows Credential
//! Manager (encrypted with the user's Windows login, like the app's other
//! secrets, see `providers/credentials.rs`):
//!
//! - the identity: the installation id and its secret, made on the first start;
//! - the last answer: the signed token, when it arrived (local clock), the
//!   latest local time seen (to notice a clock turned back) and the app
//!   version that asked.
//!
//! Should the Credential Manager refuse to store, a file in the app's data
//! folder stands in, so a missing vault never means a new installation on
//! every start.

use std::path::PathBuf;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};

use crate::providers::credentials;

pub trait Vault: Send + 'static {
    fn read(&self, key: &str) -> Option<String>;
    fn write(&self, key: &str, value: &str) -> Result<(), String>;
}

/// Credential Manager names. Dev builds keep their own installation, so the
/// developer can block a dev build without blocking their installed app;
/// `ISLAND_LICENSE_PROFILE` (dev builds only) adds more, to try several
/// installations on one computer.
pub fn keys() -> (String, String) {
    let mut suffix = String::new();
    if cfg!(debug_assertions) {
        suffix.push_str("-dev");
        if let Ok(profile) = std::env::var("ISLAND_LICENSE_PROFILE") {
            let profile: String = profile
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
                .take(32)
                .collect();
            if !profile.is_empty() {
                suffix.push('-');
                suffix.push_str(&profile);
            }
        }
    }
    (
        format!("dynamic-island:license-identity{suffix}"),
        format!("dynamic-island:license-state{suffix}"),
    )
}

pub struct SystemVault {
    fallback_dir: Option<PathBuf>,
}

impl SystemVault {
    pub fn new(fallback_dir: Option<PathBuf>) -> Self {
        Self { fallback_dir }
    }

    fn fallback(&self, key: &str) -> Option<PathBuf> {
        let name: String = key
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        Some(self.fallback_dir.as_ref()?.join(format!("{name}.json")))
    }
}

impl Vault for SystemVault {
    fn read(&self, key: &str) -> Option<String> {
        credentials::read(key).or_else(|| std::fs::read_to_string(self.fallback(key)?).ok())
    }

    fn write(&self, key: &str, value: &str) -> Result<(), String> {
        match credentials::write(key, value) {
            Ok(()) => {
                if let Some(path) = self.fallback(key) {
                    let _ = std::fs::remove_file(path);
                }
                Ok(())
            }
            Err(e) => {
                log::warn!("license: credential manager refused ({e}), using a file");
                let path = self
                    .fallback(key)
                    .ok_or("no folder for the fallback file")?;
                if let Some(dir) = path.parent() {
                    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
                }
                std::fs::write(path, value).map_err(|e| e.to_string())
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Identity {
    /// Random UUID (v4): who this installation is.
    pub id: String,
    /// 32 random bytes (base64url): proves it to the server, which keeps only a hash.
    pub secret: String,
    /// When it was made (unix seconds, local clock).
    pub created: i64,
}

impl Identity {
    pub fn generate(now: i64) -> Result<Self, String> {
        let mut bytes = [0u8; 48];
        getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
        let mut uuid = [0u8; 16];
        uuid.copy_from_slice(&bytes[..16]);
        Ok(Self {
            id: uuid_v4(uuid),
            secret: URL_SAFE_NO_PAD.encode(&bytes[16..]),
            created: now,
        })
    }

    pub fn is_valid(&self) -> bool {
        is_uuid(&self.id)
            && self.secret.len() == 43
            && URL_SAFE_NO_PAD
                .decode(&self.secret)
                .is_ok_and(|b| b.len() == 32)
    }
}

/// The last answer from the server and the clock readings around it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Saved {
    pub token: Option<String>,
    /// When the token arrived (local clock).
    #[serde(default)]
    pub received: i64,
    /// Latest local time seen while running.
    #[serde(default)]
    pub seen: i64,
    /// App version that got the token.
    #[serde(default)]
    pub version: String,
}

/// Formats 16 random bytes as a version 4 UUID.
pub fn uuid_v4(mut b: [u8; 16]) -> String {
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let hex: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    )
}

fn is_uuid(s: &str) -> bool {
    s.len() == 36
        && s.char_indices().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_digit() || ('a'..='f').contains(&c),
        })
}

/// `bytes` random bytes, base64url (the nonce of a check).
pub fn random_token(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| e.to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    /// In-memory vault; clones share their contents (like the real one across restarts).
    #[derive(Clone, Default)]
    pub struct MemoryVault {
        pub data: Arc<Mutex<HashMap<String, String>>>,
        pub refuse_writes: Arc<Mutex<bool>>,
    }

    impl Vault for MemoryVault {
        fn read(&self, key: &str) -> Option<String> {
            self.data.lock().unwrap().get(key).cloned()
        }

        fn write(&self, key: &str, value: &str) -> Result<(), String> {
            if *self.refuse_writes.lock().unwrap() {
                return Err("refused".into());
            }
            self.data
                .lock()
                .unwrap()
                .insert(key.to_string(), value.to_string());
            Ok(())
        }
    }

    #[test]
    fn identities_are_random_v4_uuids() {
        let a = Identity::generate(5).unwrap();
        let b = Identity::generate(5).unwrap();
        assert_ne!(a.id, b.id);
        assert_ne!(a.secret, b.secret);
        assert!(a.is_valid() && b.is_valid());
        assert_eq!(&a.id[14..15], "4");
        assert!(matches!(&a.id[19..20], "8" | "9" | "a" | "b"));
        assert_eq!(a.created, 5);
    }

    #[test]
    fn formats_uuids() {
        assert_eq!(uuid_v4([0; 16]), "00000000-0000-4000-8000-000000000000");
        assert_eq!(uuid_v4([0xff; 16]), "ffffffff-ffff-4fff-bfff-ffffffffffff");
    }

    #[test]
    fn rejects_damaged_identities() {
        let good = Identity::generate(0).unwrap();
        let bad_id = Identity {
            id: "not-a-uuid".into(),
            ..good.clone()
        };
        let bad_secret = Identity {
            secret: "short".into(),
            ..good.clone()
        };
        let upper = Identity {
            id: good.id.to_uppercase(),
            ..good.clone()
        };
        assert!(!bad_id.is_valid() && !bad_secret.is_valid() && !upper.is_valid());
    }

    #[test]
    fn falls_back_to_a_file() {
        let dir = std::env::temp_dir().join(format!("island-license-test-{}", std::process::id()));
        let vault = SystemVault::new(Some(dir.clone()));
        let path = vault.fallback("dynamic-island:license-test").unwrap();
        assert!(path.ends_with("dynamic-island_license-test.json"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn dev_builds_use_their_own_names() {
        let (identity, state) = keys();
        assert!(identity.starts_with("dynamic-island:license-identity"));
        assert!(state.starts_with("dynamic-island:license-state"));
        assert!(identity.contains("-dev"));
    }
}

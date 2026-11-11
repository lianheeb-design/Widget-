//! The license server's answer: a JWT signed with Ed25519 (`alg: EdDSA`),
//! made by `supabase/functions/license/handler.ts`. Only a token that verifies
//! against one of the built-in public keys counts, so neither the user nor
//! anything between the app and the server can make one up or change it.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::signature::{ED25519, UnparsedPublicKey};
use serde::{Deserialize, Serialize};

pub const ISSUER: &str = "island-license";
const VERSION: u32 = 1;
/// Real tokens are ~400 bytes; anything far bigger isn't one.
const MAX_LEN: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Active,
    Blocked,
    /// Below the minimum version the server accepts.
    Outdated,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Claims {
    pub iss: String,
    /// The installation id.
    pub sub: String,
    pub status: Status,
    /// Echo of the request's nonce.
    pub nonce: String,
    /// Issued at / valid until (server time, unix seconds).
    pub iat: i64,
    pub exp: i64,
    /// Seconds until the next check.
    pub chk: i64,
    pub v: u32,
}

impl Claims {
    /// How long the token allows running without a new check (seconds).
    pub fn grace(&self) -> i64 {
        self.exp - self.iat
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenError {
    Malformed,
    UnsupportedAlgorithm,
    BadSignature,
    InvalidClaims,
}

impl std::fmt::Display for TokenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Malformed => "malformed token",
            Self::UnsupportedAlgorithm => "unsupported token algorithm",
            Self::BadSignature => "token signature does not verify",
            Self::InvalidClaims => "token claims are invalid",
        })
    }
}

#[derive(Deserialize)]
struct Header {
    alg: String,
}

/// Checks the signature and the claims every token must have. Whether it
/// belongs to this installation and answers this request is up to the caller.
pub fn verify(token: &str, keys: &[[u8; 32]]) -> Result<Claims, TokenError> {
    if token.len() > MAX_LEN {
        return Err(TokenError::Malformed);
    }
    let mut parts = token.split('.');
    let (Some(header_part), Some(payload_part), Some(signature_part), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(TokenError::Malformed);
    };

    let header: Header = decode_json(header_part)?;
    if header.alg != "EdDSA" {
        return Err(TokenError::UnsupportedAlgorithm);
    }
    let signature = URL_SAFE_NO_PAD
        .decode(signature_part)
        .map_err(|_| TokenError::Malformed)?;
    // The signature covers `header.payload` exactly as sent.
    let signed = &token[..header_part.len() + 1 + payload_part.len()];
    let valid = keys.iter().any(|key| {
        UnparsedPublicKey::new(&ED25519, key)
            .verify(signed.as_bytes(), &signature)
            .is_ok()
    });
    if !valid {
        return Err(TokenError::BadSignature);
    }

    let claims: Claims = decode_json(payload_part)?;
    if claims.iss != ISSUER || claims.v != VERSION || claims.exp <= claims.iat || claims.chk <= 0 {
        return Err(TokenError::InvalidClaims);
    }
    Ok(claims)
}

fn decode_json<T: serde::de::DeserializeOwned>(part: &str) -> Result<T, TokenError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(part)
        .map_err(|_| TokenError::Malformed)?;
    serde_json::from_slice(&bytes).map_err(|_| TokenError::Malformed)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    /// Signed by the Edge Function's own code (see `supabase/tests/license-function.test.ts`,
    /// "matches the test vector"): proves both sides speak the same format.
    const VECTOR_PUBLIC_KEY: &str = "ebVWLo/mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ=";
    const VECTOR_TOKEN: &str = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCIsImtpZCI6InRlc3QifQ.eyJpc3MiOiJpc2xhbmQtbGljZW5zZSIsInN1YiI6IjZmMWQyYzNiLTRhNTktNGU2Zi04YTdiLTljMGQxZTJmM2E0YiIsInN0YXR1cyI6ImFjdGl2ZSIsIm5vbmNlIjoiQUFBQUFBQUFBQUFBQUFBQUFBQUFBQSIsImlhdCI6MTgwMDAwMDAwMCwiZXhwIjoxODAwMDg2NDAwLCJjaGsiOjYwMCwidiI6MX0.3FZOpxbEF3ZUdZfQ8DVsOZWF1gvO8_wlIp28NUyLGeoHLu08z6F0Txcl4Ik9TwyrMZpGK1a_jYYM_UTVVuqfCA";

    /// A stand-in for the server's signing key in tests.
    pub struct TestSigner(Ed25519KeyPair);

    impl TestSigner {
        pub fn new(seed: u8) -> Self {
            Self(Ed25519KeyPair::from_seed_unchecked(&[seed; 32]).unwrap())
        }

        pub fn public_key(&self) -> [u8; 32] {
            self.0.public_key().as_ref().try_into().unwrap()
        }

        pub fn sign_raw(&self, header: &str, payload: &str) -> String {
            let input = format!(
                "{}.{}",
                URL_SAFE_NO_PAD.encode(header),
                URL_SAFE_NO_PAD.encode(payload)
            );
            let signature = self.0.sign(input.as_bytes());
            format!("{input}.{}", URL_SAFE_NO_PAD.encode(signature.as_ref()))
        }

        pub fn sign(&self, claims: serde_json::Value) -> String {
            self.sign_raw(r#"{"alg":"EdDSA","typ":"JWT"}"#, &claims.to_string())
        }
    }

    pub fn claims(sub: &str, status: &str, nonce: &str, iat: i64) -> serde_json::Value {
        serde_json::json!({
            "iss": ISSUER, "sub": sub, "status": status, "nonce": nonce,
            "iat": iat, "exp": iat + 86_400, "chk": 600, "v": 1,
        })
    }

    fn vector_key() -> [u8; 32] {
        use base64::engine::general_purpose::STANDARD;
        STANDARD
            .decode(VECTOR_PUBLIC_KEY)
            .unwrap()
            .try_into()
            .unwrap()
    }

    #[test]
    fn verifies_a_token_from_the_edge_function() {
        let claims = verify(VECTOR_TOKEN, &[vector_key()]).unwrap();
        assert_eq!(claims.sub, "6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b");
        assert_eq!(claims.status, Status::Active);
        assert_eq!(claims.nonce, "AAAAAAAAAAAAAAAAAAAAAA");
        assert_eq!(
            (claims.iat, claims.exp, claims.chk),
            (1_800_000_000, 1_800_086_400, 600)
        );
        assert_eq!(claims.grace(), 86_400);
    }

    #[test]
    fn accepts_any_configured_key() {
        let other = TestSigner::new(9).public_key();
        assert!(verify(VECTOR_TOKEN, &[other, vector_key()]).is_ok());
    }

    #[test]
    fn rejects_another_key() {
        let other = TestSigner::new(9).public_key();
        assert_eq!(
            verify(VECTOR_TOKEN, &[other]),
            Err(TokenError::BadSignature)
        );
        assert_eq!(verify(VECTOR_TOKEN, &[]), Err(TokenError::BadSignature));
    }

    #[test]
    fn rejects_an_altered_payload() {
        let mut parts: Vec<String> = VECTOR_TOKEN.split('.').map(str::to_string).collect();
        let payload = String::from_utf8(URL_SAFE_NO_PAD.decode(&parts[1]).unwrap()).unwrap();
        parts[1] = URL_SAFE_NO_PAD.encode(payload.replace("\"active\"", "\"blocked\""));
        assert_eq!(
            verify(&parts.join("."), &[vector_key()]),
            Err(TokenError::BadSignature)
        );
        // A blocked installation can't make its token "active" either.
        let signer = TestSigner::new(1);
        let blocked = signer.sign(claims("id", "blocked", "n", 100));
        let mut parts: Vec<String> = blocked.split('.').map(str::to_string).collect();
        let payload = String::from_utf8(URL_SAFE_NO_PAD.decode(&parts[1]).unwrap()).unwrap();
        parts[1] = URL_SAFE_NO_PAD.encode(payload.replace("\"blocked\"", "\"active\""));
        assert_eq!(
            verify(&parts.join("."), &[signer.public_key()]),
            Err(TokenError::BadSignature)
        );
    }

    #[test]
    fn rejects_other_algorithms_and_garbage() {
        let signer = TestSigner::new(1);
        let keys = [signer.public_key()];
        let none = signer.sign_raw(
            r#"{"alg":"none"}"#,
            &claims("id", "active", "n", 100).to_string(),
        );
        assert_eq!(verify(&none, &keys), Err(TokenError::UnsupportedAlgorithm));
        let hs = signer.sign_raw(
            r#"{"alg":"HS256"}"#,
            &claims("id", "active", "n", 100).to_string(),
        );
        assert_eq!(verify(&hs, &keys), Err(TokenError::UnsupportedAlgorithm));
        for garbage in ["", "a.b", "a.b.c.d", "!!!.###.$$$", &"x".repeat(5000)] {
            assert_eq!(
                verify(garbage, &keys),
                Err(TokenError::Malformed),
                "{garbage}"
            );
        }
    }

    #[test]
    fn rejects_tokens_with_wrong_claims() {
        let signer = TestSigner::new(1);
        let keys = [signer.public_key()];
        let mut wrong_issuer = claims("id", "active", "n", 100);
        wrong_issuer["iss"] = "someone-else".into();
        let mut expired_before_issued = claims("id", "active", "n", 100);
        expired_before_issued["exp"] = 50.into();
        let mut future_version = claims("id", "active", "n", 100);
        future_version["v"] = 2.into();
        for bad in [wrong_issuer, expired_before_issued, future_version] {
            assert_eq!(
                verify(&signer.sign(bad), &keys),
                Err(TokenError::InvalidClaims)
            );
        }
        let mut unknown_status = claims("id", "active", "n", 100);
        unknown_status["status"] = "paused".into();
        assert_eq!(
            verify(&signer.sign(unknown_status), &keys),
            Err(TokenError::Malformed)
        );
    }
}

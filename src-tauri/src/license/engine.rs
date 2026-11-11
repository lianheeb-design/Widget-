//! The license check without Tauri: the identity, the last verified answer,
//! one round trip to the server, and the rules that turn them into "may this
//! installation run right now?" ([`Access`]). `mod.rs` runs it in the app;
//! the tests here run it against a fake server and clock.
//!
//! The rules:
//! - Only a signed answer from the server counts, and only one that names this
//!   installation and echoes this request's nonce.
//! - "blocked" applies at once and stays until the server says otherwise,
//!   online or offline, across restarts.
//! - "active" lasts for the token's grace period (24 h by default) after it
//!   arrived, measured on the local clock, so a wrong clock doesn't matter;
//!   after that, without a new answer, the island stops ([`Access::Expired`])
//!   until it reaches the server again.
//! - A failed check (offline, server down, garbage) never blocks: it only
//!   means the grace period keeps running.
//! - A new installation runs for [`FIRST_RUN_GRACE`] before its first answer.
//! - A clock turned back by more than [`ROLLBACK_TOLERANCE`] counts as expired
//!   (it would otherwise stretch the grace period forever).

use serde::{Deserialize, Serialize};

use super::config::Config;
use super::store::{Identity, Saved, Vault, keys, random_token};
use super::token::{self, Claims, Status};

/// How long a new installation may run before the server first answers.
pub const FIRST_RUN_GRACE: i64 = 24 * 60 * 60;
/// Clock jumps backwards up to this much are normal (time zone, NTP, dual boot).
pub const ROLLBACK_TOLERANCE: i64 = 2 * 60 * 60;
/// Check interval before the server has said otherwise, and its bounds.
const DEFAULT_INTERVAL: i64 = 10 * 60;
const MIN_INTERVAL: i64 = 5 * 60;
const MAX_INTERVAL: i64 = 24 * 60 * 60;
/// The "latest time seen" is written down at most this often.
const SAVE_SEEN_EVERY: i64 = 10 * 60;

/// Sends one check to the server.
pub trait Transport: Send + 'static {
    /// POSTs `body` (JSON) to `url`. `Ok((status, body))` for any HTTP answer,
    /// `Err` when the server couldn't be reached (offline, DNS, timeout).
    fn post(&self, url: &str, body: &str) -> Result<(u16, String), String>;
}

/// Why the last check didn't get an answer that counts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Problem {
    /// No connection to the server.
    Offline,
    /// The server answered with an error (down, overloaded, misconfigured).
    Server,
    /// The server doesn't accept this installation's secret.
    Rejected,
    /// The answer wasn't a valid token for this request.
    Invalid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    /// New installation, no answer yet; runs until `until`.
    Pending { until: i64 },
    /// Confirmed by the server; runs until `until` without a new check.
    Active { until: i64 },
    /// Blocked by the developer.
    Blocked,
    /// This version is too old for the server.
    Outdated,
    /// No confirmation within the grace period (or the clock went back).
    Expired,
}

impl Access {
    pub fn usable(self) -> bool {
        matches!(self, Self::Pending { .. } | Self::Active { .. })
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Pending { .. } => "pending",
            Self::Active { .. } => "active",
            Self::Blocked => "blocked",
            Self::Outdated => "outdated",
            Self::Expired => "expired",
        }
    }

    pub fn until(self) -> Option<i64> {
        match self {
            Self::Pending { until } | Self::Active { until } => Some(until),
            _ => None,
        }
    }
}

/// A verified answer from the server.
#[derive(Debug, Clone)]
struct Answer {
    token: String,
    claims: Claims,
    /// Local time it arrived.
    received: i64,
    /// App version that asked.
    version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Request<'a> {
    installation_id: &'a str,
    secret: &'a str,
    nonce: &'a str,
    app_version: &'a str,
}

#[derive(Deserialize)]
struct Response {
    token: String,
}

pub struct Engine<V: Vault, T: Transport> {
    config: Config,
    vault: V,
    transport: T,
    version: String,
    identity: Identity,
    answer: Option<Answer>,
    /// Latest local time seen (a clock turned back shows up against it).
    seen: i64,
    seen_saved: i64,
    last_success: Option<i64>,
    problem: Option<Problem>,
}

impl<V: Vault, T: Transport> Engine<V, T> {
    /// Loads the identity (making one on the first start) and the last answer.
    pub fn load(
        config: Config,
        vault: V,
        transport: T,
        version: &str,
        now: i64,
    ) -> Result<Self, String> {
        let (identity_key, _) = keys();
        let identity = match vault
            .read(&identity_key)
            .and_then(|text| serde_json::from_str::<Identity>(&text).ok())
            .filter(Identity::is_valid)
        {
            Some(identity) => identity,
            None => {
                let identity = Identity::generate(now)?;
                let text = serde_json::to_string(&identity).map_err(|e| e.to_string())?;
                // Not fatal: it then lives for this run only.
                if let Err(e) = vault.write(&identity_key, &text) {
                    log::error!("license: could not store the installation id: {e}");
                }
                log::info!("license: new installation {}", identity.id);
                identity
            }
        };
        let saved = read_saved(&vault);
        let answer = restore(&config, &identity, &saved);
        Ok(Self {
            config,
            vault,
            transport,
            version: version.to_string(),
            identity,
            answer,
            seen: saved.seen,
            seen_saved: saved.seen,
            last_success: None,
            problem: None,
        })
    }

    pub fn installation_id(&self) -> &str {
        &self.identity.id
    }

    pub fn problem(&self) -> Option<Problem> {
        self.problem
    }

    /// Local time of the last answer from the server (this run or before).
    pub fn last_answer(&self) -> Option<i64> {
        self.answer.as_ref().map(|a| a.received)
    }

    pub fn last_success(&self) -> Option<i64> {
        self.last_success
    }

    pub fn access(&self, now: i64) -> Access {
        evaluate(
            self.answer.as_ref(),
            &self.identity,
            self.seen,
            &self.version,
            now,
        )
    }

    /// What a fresh start would decide from what's stored right now.
    pub fn stored_access(&self, now: i64) -> Access {
        let saved = read_saved(&self.vault);
        let answer = restore(&self.config, &self.identity, &saved);
        evaluate(
            answer.as_ref(),
            &self.identity,
            saved.seen,
            &self.version,
            now,
        )
    }

    /// Seconds until the next regular check (the server's wish, within bounds).
    pub fn interval(&self) -> i64 {
        self.answer
            .as_ref()
            .map_or(DEFAULT_INTERVAL, |a| a.claims.chk)
            .clamp(MIN_INTERVAL, MAX_INTERVAL)
    }

    /// Notes the time (the app calls this every minute or so).
    pub fn observe(&mut self, now: i64) {
        self.seen = self.seen.max(now);
        if self.seen - self.seen_saved >= SAVE_SEEN_EVERY {
            self.save();
        }
    }

    /// One round trip to the server. On success the new answer is in effect
    /// (and stored); on failure nothing changes but [`Self::problem`].
    pub fn check(&mut self, now: i64) -> Result<(), Problem> {
        let result = self.round_trip(now);
        match result {
            Ok(()) => {
                self.problem = None;
                self.last_success = Some(now);
            }
            Err(problem) => {
                self.problem = Some(problem);
                self.observe(now);
            }
        }
        result
    }

    fn round_trip(&mut self, now: i64) -> Result<(), Problem> {
        let nonce = random_token(16).map_err(|_| Problem::Invalid)?;
        let body = serde_json::to_string(&Request {
            installation_id: &self.identity.id,
            secret: &self.identity.secret,
            nonce: &nonce,
            app_version: &self.version,
        })
        .map_err(|_| Problem::Invalid)?;

        let (status, text) = self
            .transport
            .post(&self.config.endpoint, &body)
            .map_err(|e| {
                log::info!("license: server not reachable: {e}");
                Problem::Offline
            })?;
        match status {
            200 => {}
            401 => {
                log::error!("license: the server refused this installation's secret");
                return Err(Problem::Rejected);
            }
            _ => {
                log::warn!("license: server answered {status}");
                return Err(Problem::Server);
            }
        }

        let response: Response = serde_json::from_str(&text).map_err(|_| {
            log::warn!("license: unreadable answer");
            Problem::Invalid
        })?;
        let claims = token::verify(&response.token, &self.config.public_keys).map_err(|e| {
            log::warn!("license: {e}");
            Problem::Invalid
        })?;
        if claims.sub != self.identity.id || claims.nonce != nonce {
            log::warn!("license: the answer is for another installation or request");
            return Err(Problem::Invalid);
        }

        if self.answer.as_ref().map(|a| a.claims.status) != Some(claims.status) {
            log::info!("license: server says {:?}", claims.status);
        }
        self.answer = Some(Answer {
            token: response.token,
            claims,
            received: now,
            version: self.version.clone(),
        });
        // The server just vouched for this moment: start counting from here.
        self.seen = now;
        self.save();
        Ok(())
    }

    /// Writes the last answer and the clock readings; `false` if that failed.
    pub fn save(&mut self) -> bool {
        let saved = Saved {
            token: self.answer.as_ref().map(|a| a.token.clone()),
            received: self.answer.as_ref().map_or(0, |a| a.received),
            seen: self.seen,
            version: self
                .answer
                .as_ref()
                .map_or_else(|| self.version.clone(), |a| a.version.clone()),
        };
        let (_, state_key) = keys();
        let written = serde_json::to_string(&saved)
            .map_err(|e| e.to_string())
            .and_then(|text| self.vault.write(&state_key, &text));
        match written {
            Ok(()) => {
                self.seen_saved = self.seen;
                true
            }
            Err(e) => {
                log::error!("license: could not store the last answer: {e}");
                false
            }
        }
    }
}

fn read_saved(vault: &impl Vault) -> Saved {
    let (_, state_key) = keys();
    vault
        .read(&state_key)
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// The stored answer, if it still verifies and belongs to this installation
/// (a token edited by hand, or signed by a retired key, is dropped).
fn restore(config: &Config, identity: &Identity, saved: &Saved) -> Option<Answer> {
    let token = saved.token.as_ref()?;
    let claims = token::verify(token, &config.public_keys)
        .inspect_err(|e| log::warn!("license: stored answer dropped: {e}"))
        .ok()?;
    (claims.sub == identity.id).then(|| Answer {
        token: token.clone(),
        claims,
        received: saved.received,
        version: saved.version.clone(),
    })
}

fn evaluate(
    answer: Option<&Answer>,
    identity: &Identity,
    seen: i64,
    version: &str,
    now: i64,
) -> Access {
    let turned_back = now + ROLLBACK_TOLERANCE < seen;
    match answer.map(|a| (a, a.claims.status)) {
        Some((_, Status::Blocked)) => Access::Blocked,
        Some((a, Status::Outdated)) if a.version == version => Access::Outdated,
        // An "outdated" answer for an older version: this one needs its own answer.
        Some((_, Status::Outdated)) => Access::Expired,
        Some((a, Status::Active)) => {
            let until = a.received.saturating_add(a.claims.grace());
            if !turned_back && now + ROLLBACK_TOLERANCE >= a.received && now < until {
                Access::Active { until }
            } else {
                Access::Expired
            }
        }
        None => {
            let until = identity.created.saturating_add(FIRST_RUN_GRACE);
            if !turned_back && now + ROLLBACK_TOLERANCE >= identity.created && now < until {
                Access::Pending { until }
            } else {
                Access::Expired
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::license::store::tests::MemoryVault;
    use crate::license::token::tests::{TestSigner, claims};
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    const T0: i64 = 1_800_000_000;
    const HOUR: i64 = 3600;
    const ENDPOINT: &str = "https://example.supabase.co/functions/v1/license";

    /// What the fake server does with the next request.
    #[derive(Clone)]
    enum Reply {
        /// Signs a token with this status for the request (like the real server).
        Status(&'static str),
        /// Signs a token, then lets the test spoil it.
        Tampered(&'static str, fn(serde_json::Value) -> serde_json::Value),
        /// Signed with a key the app doesn't know.
        ForeignKey(&'static str),
        /// Replays an earlier answer.
        Replay(String),
        Http(u16, &'static str),
        Unreachable,
    }

    #[derive(Clone)]
    struct FakeServer {
        signer: Arc<TestSigner>,
        replies: Arc<Mutex<VecDeque<Reply>>>,
        requests: Arc<Mutex<Vec<serde_json::Value>>>,
        responses: Arc<Mutex<Vec<String>>>,
        now: Arc<Mutex<i64>>,
    }

    impl FakeServer {
        fn new() -> Self {
            Self {
                signer: Arc::new(TestSigner::new(7)),
                replies: Arc::default(),
                requests: Arc::default(),
                responses: Arc::default(),
                now: Arc::new(Mutex::new(T0)),
            }
        }

        fn reply(&self, reply: Reply) -> &Self {
            self.replies.lock().unwrap().push_back(reply);
            self
        }
    }

    impl Transport for FakeServer {
        fn post(&self, url: &str, body: &str) -> Result<(u16, String), String> {
            assert_eq!(url, ENDPOINT);
            let request: serde_json::Value = serde_json::from_str(body).unwrap();
            self.requests.lock().unwrap().push(request.clone());
            let sub = request["installationId"].as_str().unwrap();
            let nonce = request["nonce"].as_str().unwrap();
            let iat = *self.now.lock().unwrap();
            let reply = self
                .replies
                .lock()
                .unwrap()
                .pop_front()
                .expect("no reply queued");
            let token = match reply {
                Reply::Status(status) => self.signer.sign(claims(sub, status, nonce, iat)),
                Reply::Tampered(status, spoil) => {
                    self.signer.sign(spoil(claims(sub, status, nonce, iat)))
                }
                Reply::ForeignKey(status) => {
                    TestSigner::new(99).sign(claims(sub, status, nonce, iat))
                }
                Reply::Replay(body) => return Ok((200, body)),
                Reply::Http(code, body) => return Ok((code, body.to_string())),
                Reply::Unreachable => return Err("connection refused".into()),
            };
            let body = serde_json::json!({ "token": token }).to_string();
            self.responses.lock().unwrap().push(body.clone());
            Ok((200, body))
        }
    }

    fn config(server: &FakeServer) -> Config {
        Config {
            endpoint: ENDPOINT.into(),
            public_keys: vec![server.signer.public_key()],
        }
    }

    fn engine(
        server: &FakeServer,
        vault: &MemoryVault,
        now: i64,
    ) -> Engine<MemoryVault, FakeServer> {
        Engine::load(config(server), vault.clone(), server.clone(), "1.2.0", now).unwrap()
    }

    #[test]
    fn a_new_installation_registers_and_runs() {
        let (server, vault) = (FakeServer::new(), MemoryVault::default());
        let mut e = engine(&server, &vault, T0);
        assert_eq!(
            e.access(T0),
            Access::Pending {
                until: T0 + FIRST_RUN_GRACE
            }
        );

        server.reply(Reply::Status("active"));
        assert_eq!(e.check(T0), Ok(()));
        assert_eq!(
            e.access(T0),
            Access::Active {
                until: T0 + 24 * HOUR
            }
        );

        let request = &server.requests.lock().unwrap()[0];
        assert_eq!(request["installationId"], e.installation_id());
        assert_eq!(request["appVersion"], "1.2.0");
        assert_eq!(request["secret"].as_str().unwrap().len(), 43);
        // Nothing else is sent: no name, no hardware details.
        assert_eq!(request.as_object().unwrap().len(), 4);
    }

    #[test]
    fn an_existing_installation_keeps_its_id() {
        let (server, vault) = (FakeServer::new(), MemoryVault::default());
        let first = engine(&server, &vault, T0).installation_id().to_string();
        let again = engine(&server, &vault, T0 + HOUR)
            .installation_id()
            .to_string();
        assert_eq!(first, again);
        // Another computer (vault) is another installation.
        let other = engine(&server, &MemoryVault::default(), T0)
            .installation_id()
            .to_string();
        assert_ne!(first, other);
    }

    #[test]
    fn blocked_applies_at_once_and_survives_restarts_offline() {
        let (server, vault) = (FakeServer::new(), MemoryVault::default());
        let mut e = engine(&server, &vault, T0);
        server.reply(Reply::Status("active"));
        e.check(T0).unwrap();

        server.reply(Reply::Status("blocked"));
        e.check(T0 + 600).unwrap();
        assert_eq!(e.access(T0 + 600), Access::Blocked);

        // Restart without a connection: still blocked, also long after.
        let restarted = engine(&server, &vault, T0 + 700);
        assert_eq!(restarted.access(T0 + 700), Access::Blocked);
        assert_eq!(restarted.access(T0 + 1000 * HOUR), Access::Blocked);
        assert_eq!(restarted.stored_access(T0 + 700), Access::Blocked);
    }

    #[test]
    fn unblocking_is_picked_up() {
        let (server, vault) = (FakeServer::new(), MemoryVault::default());
        let mut e = engine(&server, &vault, T0);
        server.reply(Reply::Status("blocked"));
        e.check(T0).unwrap();
        assert_eq!(e.access(T0), Access::Blocked);
        server.reply(Reply::Status("active"));
        e.check(T0 + 600).unwrap();
        assert!(e.access(T0 + 600).usable());
        assert!(engine(&server, &vault, T0 + 601).access(T0 + 601).usable());
    }

    #[test]
    fn being_offline_never_blocks_within_the_grace_period() {
        let (server, vault) = (FakeServer::new(), MemoryVault::default());
        let mut e = engine(&server, &vault, T0);
        server.reply(Reply::Status("active"));
        e.check(T0).unwrap();

        for hour in 1..24 {
            let now = T0 + hour * HOUR;
            server.reply(Reply::Unreachable);
            assert_eq!(e.check(now), Err(Problem::Offline));
            assert_eq!(
                e.access(now),
                Access::Active {
                    until: T0 + 24 * HOUR
                },
                "hour {hour}"
            );
        }
        // Also after a restart in between.
        assert!(
            engine(&server, &vault, T0 + 23 * HOUR)
                .access(T0 + 23 * HOUR)
                .usable()
        );
        // Past the grace period: stopped until the server answers again.
        assert_eq!(e.access(T0 + 24 * HOUR), Access::Expired);
        server.reply(Reply::Status("active"));
        e.check(T0 + 30 * HOUR).unwrap();
        assert_eq!(
            e.access(T0 + 30 * HOUR),
            Access::Active {
                until: T0 + 54 * HOUR
            }
        );
    }

    #[test]
    fn server_errors_are_temporary() {
        let (server, vault) = (FakeServer::new(), MemoryVault::default());
        let mut e = engine(&server, &vault, T0);
        server.reply(Reply::Status("active"));
        e.check(T0).unwrap();
        for (code, problem) in [
            (500, Problem::Server),
            (503, Problem::Server),
            (429, Problem::Server),
            (401, Problem::Rejected),
        ] {
            server.reply(Reply::Http(code, r#"{"error":"x"}"#));
            assert_eq!(e.check(T0 + 60), Err(problem));
            assert!(e.access(T0 + 60).usable());
        }
        server.reply(Reply::Http(200, "<html>captive portal</html>"));
        assert_eq!(e.check(T0 + 60), Err(Problem::Invalid));
        assert_eq!(e.problem(), Some(Problem::Invalid));
        assert!(e.access(T0 + 60).usable());
    }

    #[test]
    fn forged_answers_are_ignored() {
        let (server, vault) = (FakeServer::new(), MemoryVault::default());
        let mut e = engine(&server, &vault, T0);
        server.reply(Reply::Status("blocked"));
        e.check(T0).unwrap();

        // A blocked installation can't unlock itself with a made-up answer.
        server.reply(Reply::ForeignKey("active"));
        assert_eq!(e.check(T0 + 60), Err(Problem::Invalid));
        server.reply(Reply::Tampered("active", |mut c| {
            c["sub"] = "00000000-0000-4000-8000-000000000000".into();
            c
        }));
        assert_eq!(e.check(T0 + 120), Err(Problem::Invalid));
        server.reply(Reply::Tampered("active", |mut c| {
            c["nonce"] = "an-old-request".into();
            c
        }));
        assert_eq!(e.check(T0 + 180), Err(Problem::Invalid));
        assert_eq!(e.access(T0 + 180), Access::Blocked);
    }

    #[test]
    fn an_old_answer_cannot_be_replayed() {
        let (server, vault) = (FakeServer::new(), MemoryVault::default());
        let mut e = engine(&server, &vault, T0);
        server.reply(Reply::Status("active"));
        e.check(T0).unwrap();
        let old_active = server.responses.lock().unwrap()[0].clone();

        server.reply(Reply::Status("blocked"));
        e.check(T0 + 600).unwrap();
        // Someone serves the old "active" answer back (a proxy, a hosts file…).
        server.reply(Reply::Replay(old_active));
        assert_eq!(e.check(T0 + 1200), Err(Problem::Invalid));
        assert_eq!(e.access(T0 + 1200), Access::Blocked);
    }

    #[test]
    fn edited_storage_is_not_trusted() {
        let (server, vault) = (FakeServer::new(), MemoryVault::default());
        let mut e = engine(&server, &vault, T0);
        server.reply(Reply::Status("blocked"));
        e.check(T0).unwrap();

        // Swap the stored token for an "active" one signed by someone else.
        let (_, state_key) = keys();
        let mut saved: Saved = serde_json::from_str(&vault.read(&state_key).unwrap()).unwrap();
        let sub = e.installation_id().to_string();
        saved.token = Some(TestSigner::new(42).sign(claims(&sub, "active", "x", T0)));
        vault
            .write(&state_key, &serde_json::to_string(&saved).unwrap())
            .unwrap();
        // The forged token is dropped; long after the first-run grace, that means expired.
        let restarted = engine(&server, &vault, T0 + 48 * HOUR);
        assert_eq!(restarted.access(T0 + 48 * HOUR), Access::Expired);
    }

    #[test]
    fn a_clock_turned_back_doesnt_stretch_the_grace_period() {
        let (server, vault) = (FakeServer::new(), MemoryVault::default());
        let mut e = engine(&server, &vault, T0);
        server.reply(Reply::Status("active"));
        e.check(T0).unwrap();

        // Ran 20 hours, then the clock goes back 18 hours.
        e.observe(T0 + 20 * HOUR);
        assert_eq!(e.access(T0 + 2 * HOUR), Access::Expired);
        // Small jumps are fine.
        assert!(e.access(T0 + 19 * HOUR).usable());
        // Also after a restart (the latest time is stored).
        assert_eq!(
            engine(&server, &vault, T0 + 2 * HOUR).access(T0 + 2 * HOUR),
            Access::Expired
        );
        // A real answer resets it.
        server.reply(Reply::Status("active"));
        e.check(T0 + 2 * HOUR).unwrap();
        assert!(e.access(T0 + 3 * HOUR).usable());
    }

    #[test]
    fn a_wrong_clock_does_not_matter() {
        let (server, vault) = (FakeServer::new(), MemoryVault::default());
        // The server's clock is 3 days ahead of this computer's.
        *server.now.lock().unwrap() = T0 + 72 * HOUR;
        let mut e = engine(&server, &vault, T0);
        server.reply(Reply::Status("active"));
        e.check(T0).unwrap();
        assert_eq!(
            e.access(T0 + HOUR),
            Access::Active {
                until: T0 + 24 * HOUR
            }
        );
    }

    #[test]
    fn first_run_grace_runs_out_without_an_answer() {
        let (server, vault) = (FakeServer::new(), MemoryVault::default());
        let mut e = engine(&server, &vault, T0);
        server.reply(Reply::Unreachable);
        assert_eq!(e.check(T0), Err(Problem::Offline));
        assert!(e.access(T0 + 23 * HOUR).usable());
        assert_eq!(e.access(T0 + 24 * HOUR), Access::Expired);
    }

    #[test]
    fn outdated_holds_until_the_app_is_updated() {
        let (server, vault) = (FakeServer::new(), MemoryVault::default());
        let mut e = engine(&server, &vault, T0);
        server.reply(Reply::Status("outdated"));
        e.check(T0).unwrap();
        assert_eq!(e.access(T0), Access::Outdated);
        assert_eq!(
            engine(&server, &vault, T0 + 60).access(T0 + 60),
            Access::Outdated
        );
        // The updated app doesn't inherit the old version's answer; it asks again.
        let updated = Engine::load(
            config(&server),
            vault.clone(),
            server.clone(),
            "1.3.0",
            T0 + 60,
        )
        .unwrap();
        assert_eq!(updated.access(T0 + 60), Access::Expired);
    }

    #[test]
    fn follows_the_servers_check_interval_within_bounds() {
        let (server, vault) = (FakeServer::new(), MemoryVault::default());
        let mut e = engine(&server, &vault, T0);
        assert_eq!(e.interval(), 600);
        server.reply(Reply::Tampered("active", |mut c| {
            c["chk"] = 5.into();
            c
        }));
        e.check(T0).unwrap();
        assert_eq!(e.interval(), MIN_INTERVAL);
    }

    #[test]
    fn a_vault_that_refuses_writes_doesnt_break_anything() {
        let (server, vault) = (FakeServer::new(), MemoryVault::default());
        *vault.refuse_writes.lock().unwrap() = true;
        let mut e = engine(&server, &vault, T0);
        server.reply(Reply::Status("blocked"));
        e.check(T0).unwrap();
        assert_eq!(e.access(T0), Access::Blocked);
        // Nothing reached the vault, so a restart wouldn't come up blocked:
        // the app must not rely on a restart then (see `mod.rs`).
        assert!(e.stored_access(T0).usable());
    }
}

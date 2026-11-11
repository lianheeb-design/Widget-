//! Remote access management: the developer can block single installations
//! of the app from the admin dashboard, and unblock them again.
//!
//! Every installation has a random id (no account, no hardware fingerprint).
//! It checks in with the `license` Edge Function at startup, every 10 minutes,
//! when the internet comes back and on demand, and gets a signed answer. The
//! rules for that answer (offline grace period, replay protection…) are in
//! `engine.rs`; the design and its limits in `docs/licensing/README.md`.
//!
//! What "blocked" means for the app:
//! - Started locked, it runs none of its features (`features.rs`): no data
//!   providers, global shortcuts, local API, Claude Code hooks, file drops or
//!   sounds. The island and the tray stay, to explain what's going on.
//! - Locked while running, it turns everything off at once (the gates below,
//!   checked in `hub.rs`, `providers/mod.rs`, `lib.rs`, `sound.rs`, the local
//!   API and the PiP window) and then restarts itself into the locked state,
//!   so nothing keeps running in the background.
//! - Unblocked, it starts the features right away, no restart needed.
//!
//! The island learns the state from the `license` snapshot (see
//! `src/core/license.ts`).

mod config;
mod engine;
mod network;
mod store;
mod token;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::hub::Hub;
use engine::{Access, Engine, Problem, Transport};
use store::SystemVault;

/// Snapshot id the frontend reads.
pub const SNAPSHOT_ID: &str = "license";
/// Passed to the new process when the app restarts into the locked state.
pub const RESTART_FLAG: &str = "--license-restart";

/// What the island still gets while locked: its own state and a ready update.
const ALLOWED_WHILE_LOCKED: &[&str] = &[SNAPSHOT_ID, crate::updater::UPDATE_ID];
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// Waits between failed checks (seconds), before the regular interval takes over.
const RETRY: [u64; 7] = [5, 10, 20, 60, 120, 300, 600];
/// At startup, an installation whose last answer ran out shows nothing (instead
/// of "connection needed") for this long, while the network comes up.
const STARTUP_WINDOW: Duration = Duration::from_secs(25);
/// How often the waiting loop wakes up to notice the grace period running out.
const TICK: Duration = Duration::from_secs(60);
/// Network changes come in bursts; the check waits for them to settle.
const NETWORK_SETTLE: Duration = Duration::from_secs(3);
/// A successful check this recent makes a network change not worth a new one.
const NETWORK_SKIP_AFTER_SUCCESS: i64 = 60;
const MANUAL_WAIT: Duration = Duration::from_secs(20);
/// Never restart into the locked state more often than this (no restart loops).
const RESTART_GAP: Duration = Duration::from_secs(5 * 60);

static USABLE: AtomicBool = AtomicBool::new(true);

/// Whether the app's features may run right now.
pub fn is_usable() -> bool {
    USABLE.load(Ordering::SeqCst)
}

/// Whether the island may receive snapshot `id` right now.
pub fn allows(id: &str) -> bool {
    allowed(is_usable(), id)
}

fn allowed(usable: bool, id: &str) -> bool {
    usable || ALLOWED_WHILE_LOCKED.contains(&id)
}

type AppEngine = Engine<SystemVault, Http>;

pub struct License {
    /// `None`: the license check is off in this build (or couldn't start).
    engine: Option<Mutex<AppEngine>>,
    checking: AtomicBool,
    /// No check has settled yet in this run.
    initial: AtomicBool,
    trigger: Mutex<Option<Sender<Trigger>>>,
    /// Last published state (commands answer from here, never waiting on a check).
    status: Mutex<Status>,
}

enum Trigger {
    /// Check now and tell me when done (the "Check again" button).
    Now(Sender<()>),
    /// The internet is back.
    Online,
}

/// The `license` snapshot (see `src/core/license.ts`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// "unmanaged" (check off), "pending", "active", "blocked", "outdated", "expired".
    state: &'static str,
    usable: bool,
    installation_id: Option<String>,
    checking: bool,
    initial: bool,
    /// Last answer from the server (unix ms).
    last_check: Option<i64>,
    /// When the island stops without a new answer (unix ms).
    valid_until: Option<i64>,
    problem: Option<Problem>,
}

impl License {
    fn access(&self) -> Option<Access> {
        let engine = self.engine.as_ref()?;
        Some(
            engine
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .access(now()),
        )
    }

    fn current(&self) -> Status {
        let Some(engine) = &self.engine else {
            return Status {
                state: "unmanaged",
                usable: true,
                installation_id: None,
                checking: false,
                initial: false,
                last_check: None,
                valid_until: None,
                problem: None,
            };
        };
        let engine = engine.lock().unwrap_or_else(|e| e.into_inner());
        let access = engine.access(now());
        Status {
            state: access.name(),
            usable: access.usable(),
            installation_id: Some(engine.installation_id().to_string()),
            checking: self.checking.load(Ordering::SeqCst),
            initial: self.initial.load(Ordering::SeqCst),
            last_check: engine.last_answer().map(|t| t * 1000),
            valid_until: access.until().map(|t| t * 1000),
            problem: engine.problem(),
        }
    }
}

/// Loads the identity and the last answer and decides, before anything else
/// starts, whether this run may use the app's features.
pub fn init(app: &AppHandle) -> bool {
    let engine = config::CONFIG.clone().and_then(|config| {
        let version = app.package_info().version.to_string();
        let vault = SystemVault::new(app.path().app_local_data_dir().ok());
        Engine::load(config, vault, Http::new(), &version, now())
            .inspect_err(|e| log::error!("license: can't start the check: {e}"))
            .ok()
    });
    if engine.is_none() {
        log::info!("license: check off in this build");
    }
    let license = License {
        engine: engine.map(Mutex::new),
        checking: AtomicBool::new(false),
        initial: AtomicBool::new(true),
        trigger: Mutex::default(),
        status: Mutex::new(Status {
            state: "unmanaged",
            usable: true,
            installation_id: None,
            checking: false,
            initial: true,
            last_check: None,
            valid_until: None,
            problem: None,
        }),
    };
    let access = license.access();
    let usable = access.is_none_or(Access::usable);
    if let Some(access) = access.filter(|a| !a.usable()) {
        log::warn!("license: starting locked ({})", access.name());
    }
    USABLE.store(usable, Ordering::SeqCst);
    app.manage(license);
    publish(app);
    usable
}

/// Starts the background checks (nothing to do when the check is off).
pub fn spawn(app: AppHandle) {
    if app.state::<License>().engine.is_none() {
        return;
    }
    let (tx, rx) = mpsc::channel();
    *app.state::<License>().trigger.lock().unwrap() = Some(tx.clone());
    let spawned = std::thread::Builder::new()
        .name("license".into())
        .spawn(move || {
            network::watch(move || {
                let _ = tx.send(Trigger::Online);
            });
            run(&app, &rx);
        });
    if let Err(e) = spawned {
        log::error!("license: can't start the checks: {e}");
    }
}

fn run(app: &AppHandle, rx: &Receiver<Trigger>) {
    let started = Instant::now();
    let mut failures = 0usize;
    let mut waiters: Vec<Sender<()>> = Vec::new();
    loop {
        let ok = check(app);
        for waiter in waiters.drain(..) {
            let _ = waiter.send(());
        }
        let license = app.state::<License>();
        if ok || started.elapsed() >= STARTUP_WINDOW {
            license.initial.store(false, Ordering::SeqCst);
        }
        update(app);

        let interval = with_engine(app, |e| e.interval()).unwrap_or(600) as u64;
        failures = if ok { 0 } else { failures + 1 };
        let delay = if ok {
            interval
        } else {
            jitter(RETRY[(failures - 1).min(RETRY.len() - 1)]).min(interval)
        };
        let due = Instant::now() + Duration::from_secs(delay);

        loop {
            let left = due.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            match rx.recv_timeout(left.min(TICK)) {
                Ok(Trigger::Now(reply)) => {
                    waiters.push(reply);
                    break;
                }
                Ok(Trigger::Online) => {
                    let recent = with_engine(app, |e| e.last_success())
                        .flatten()
                        .is_some_and(|t| now() - t < NETWORK_SKIP_AFTER_SUCCESS);
                    if !recent {
                        std::thread::sleep(NETWORK_SETTLE);
                        break;
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    with_engine(app, |e| e.observe(now()));
                    if started.elapsed() >= STARTUP_WINDOW {
                        license.initial.store(false, Ordering::SeqCst);
                    }
                    update(app);
                }
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        // Whatever piled up meanwhile is answered by the coming check.
        while let Ok(trigger) = rx.try_recv() {
            if let Trigger::Now(reply) = trigger {
                waiters.push(reply);
            }
        }
    }
}

fn with_engine<R>(app: &AppHandle, f: impl FnOnce(&mut AppEngine) -> R) -> Option<R> {
    let license = app.state::<License>();
    let engine = license.engine.as_ref()?;
    Some(f(&mut engine.lock().unwrap_or_else(|e| e.into_inner())))
}

/// One check, shown as "checking" meanwhile. `true` on a valid answer.
fn check(app: &AppHandle) -> bool {
    let license = app.state::<License>();
    license.checking.store(true, Ordering::SeqCst);
    publish(app);
    let ok = with_engine(app, |e| e.check(now()).is_ok()).unwrap_or(true);
    license.checking.store(false, Ordering::SeqCst);
    ok
}

/// Applies the current state: tells the island, and locks or unlocks.
fn update(app: &AppHandle) {
    let Some(access) = app.state::<License>().access() else {
        return;
    };
    let usable = access.usable();
    let was = USABLE.swap(usable, Ordering::SeqCst);
    publish(app);
    if was && !usable {
        lock(app, access);
    } else if !was && usable {
        unlock(app);
    }
}

fn publish(app: &AppHandle) {
    let license = app.state::<License>();
    let status = license.current();
    *license.status.lock().unwrap() = status.clone();
    if let Some(hub) = app.try_state::<Arc<Hub>>() {
        hub.publish(SNAPSHOT_ID, status);
    }
}

fn lock(app: &AppHandle, access: Access) {
    log::warn!("license: locked ({})", access.name());
    crate::webapp::hide(app);
    crate::pip::close_pip(app.clone());
    if crate::features::started() {
        restart_locked(app);
    }
}

fn unlock(app: &AppHandle) {
    log::info!("license: unlocked");
    let handle = app.clone();
    let started = app.run_on_main_thread(move || {
        crate::features::start(&handle);
        if let Some(hub) = handle.try_state::<Arc<Hub>>() {
            hub.resync();
        }
    });
    if let Err(e) = started {
        log::error!("license: can't start the features: {e}");
    }
}

/// The features run in background threads that can't be stopped one by one,
/// so the app starts over without them. Only when the new process is sure to
/// come up locked (its state is stored), and never twice within
/// [`RESTART_GAP`]; otherwise it stays up with the gates closed.
fn restart_locked(app: &AppHandle) {
    let stored_locked = with_engine(app, |e| {
        e.save();
        !e.stored_access(now()).usable()
    })
    .unwrap_or(false);
    if !stored_locked {
        log::error!("license: the locked state couldn't be stored; staying up with features off");
        return;
    }
    let marker = app
        .path()
        .app_local_data_dir()
        .ok()
        .map(|dir| dir.join("license-restart"));
    let recent = marker.as_ref().is_some_and(|m| {
        std::fs::metadata(m)
            .and_then(|meta| meta.modified())
            .is_ok_and(|t| t.elapsed().is_ok_and(|age| age < RESTART_GAP))
    });
    if recent {
        log::warn!("license: restarted moments ago; staying up with features off");
        return;
    }
    if let Some(marker) = &marker {
        if let Some(dir) = marker.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(marker, b"");
    }
    match std::env::current_exe()
        .and_then(|exe| std::process::Command::new(exe).arg(RESTART_FLAG).spawn())
    {
        Ok(_) => {
            log::warn!("license: restarting locked");
            log::logger().flush();
            app.exit(0);
        }
        Err(e) => log::error!("license: can't restart: {e}"),
    }
}

/// The current state, e.g. for the About page.
#[tauri::command]
pub fn license_status(app: AppHandle) -> Status {
    app.state::<License>().status.lock().unwrap().clone()
}

/// Checks right away (the "Check again" buttons) and returns the new state.
#[tauri::command]
pub async fn license_refresh(app: AppHandle) -> Status {
    let (tx, rx) = mpsc::channel();
    let sent = app
        .state::<License>()
        .trigger
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|trigger| trigger.send(Trigger::Now(tx)).is_ok());
    if sent {
        let _ = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(MANUAL_WAIT)).await;
    }
    app.state::<License>().status.lock().unwrap().clone()
}

/// The license server over HTTPS.
struct Http(ureq::Agent);

impl Http {
    fn new() -> Self {
        Self(
            ureq::Agent::config_builder()
                .http_status_as_error(false)
                .timeout_global(Some(REQUEST_TIMEOUT))
                .build()
                .into(),
        )
    }
}

impl Transport for Http {
    fn post(&self, url: &str, body: &str) -> Result<(u16, String), String> {
        let mut res = self
            .0
            .post(url)
            .header("Content-Type", "application/json")
            .send(body)
            .map_err(|e| e.to_string())?;
        let status = res.status().as_u16();
        let text = res
            .body_mut()
            .with_config()
            .limit(16 * 1024)
            .read_to_string()
            .map_err(|e| e.to_string())?;
        Ok((status, text))
    }
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

/// ±20 %, so installations don't all retry at the same moment after an outage.
fn jitter(secs: u64) -> u64 {
    let mut byte = [0u8; 1];
    let _ = getrandom::fill(&mut byte);
    secs * (80 + u64::from(byte[0]) % 41) / 100
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jitter_stays_within_a_fifth() {
        for _ in 0..200 {
            let value = jitter(100);
            assert!((80..=120).contains(&value), "{value}");
        }
    }

    #[test]
    fn locked_island_gets_only_its_own_state() {
        assert!(allowed(false, SNAPSHOT_ID));
        assert!(allowed(false, crate::updater::UPDATE_ID));
        assert!(!allowed(false, "music"));
        assert!(!allowed(false, "clipboard"));
        assert!(allowed(true, "music"));
    }

    /// The whole chain over real HTTP: this client (`Http`, `Engine`), the
    /// Edge Function's handler and the migration's SQL, with block and unblock
    /// done the way the dashboard does them. Needs the local server:
    /// `cd supabase/tests && bun local-server.ts`, then
    /// `cargo test --lib -- --ignored local_server`.
    #[test]
    #[ignore = "needs supabase/tests/local-server.ts running"]
    fn local_server_end_to_end() {
        use base64::Engine as _;
        use store::tests::MemoryVault;

        let base = std::env::var("ISLAND_LICENSE_TEST_SERVER")
            .unwrap_or_else(|_| "http://127.0.0.1:8787".into());
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .build()
            .into();
        let key_text = agent
            .get(format!("{base}/local/public-key"))
            .call()
            .expect("is the local server running?")
            .body_mut()
            .read_to_string()
            .unwrap();
        let key: [u8; 32] = base64::engine::general_purpose::STANDARD
            .decode(key_text.trim())
            .unwrap()
            .try_into()
            .unwrap();
        let config = config::Config {
            endpoint: format!("{base}/functions/v1/license"),
            public_keys: vec![key],
        };

        let login = |email: &str, password: &str| -> String {
            let body = serde_json::json!({ "email": email, "password": password });
            let mut res = agent
                .post(format!("{base}/auth/v1/token?grant_type=password"))
                .header("Content-Type", "application/json")
                .send(body.to_string())
                .unwrap();
            let body: serde_json::Value =
                serde_json::from_str(&res.body_mut().read_to_string().unwrap()).unwrap();
            body["access_token"].as_str().unwrap().to_string()
        };
        let set_status = |token: &str, id: &str, status: &str| -> u16 {
            let body = serde_json::json!({
                "p_installation_id": id, "p_status": status, "p_reason": "end-to-end test",
            });
            agent
                .post(format!("{base}/rest/v1/rpc/admin_set_installation_status"))
                .header("Authorization", &format!("Bearer {token}"))
                .header("Content-Type", "application/json")
                .send(body.to_string())
                .unwrap()
                .status()
                .as_u16()
        };
        let admin = login("admin@localhost", "local-admin");
        let user = login("user@localhost", "local-user");

        // 1. A new installation registers and runs.
        let vault = MemoryVault::default();
        let start = now();
        let mut app =
            Engine::load(config.clone(), vault.clone(), Http::new(), "1.2.0", start).unwrap();
        assert!(matches!(app.access(start), Access::Pending { .. }));
        app.check(now()).unwrap();
        assert!(matches!(app.access(now()), Access::Active { .. }));
        let id = app.installation_id().to_string();

        // 2. Restarted, it is the same installation.
        let mut restarted =
            Engine::load(config.clone(), vault.clone(), Http::new(), "1.2.0", now()).unwrap();
        assert_eq!(restarted.installation_id(), id);
        restarted.check(now()).unwrap();

        // 3. Blocked from the dashboard: the next check locks it, also after a restart.
        assert_eq!(set_status(&admin, &id, "BLOCKED"), 200);
        app.check(now()).unwrap();
        assert_eq!(app.access(now()), Access::Blocked);
        let restarted =
            Engine::load(config.clone(), vault.clone(), Http::new(), "1.2.0", now()).unwrap();
        assert_eq!(restarted.access(now()), Access::Blocked);

        // 4. Someone who isn't an admin can't unblock it.
        assert_eq!(set_status(&user, &id, "ACTIVE"), 403);
        assert_eq!(set_status("not-a-token", &id, "ACTIVE"), 401);
        app.check(now()).unwrap();
        assert_eq!(app.access(now()), Access::Blocked);

        // 5. Unblocked: runs again.
        assert_eq!(set_status(&admin, &id, "ACTIVE"), 200);
        app.check(now()).unwrap();
        assert!(matches!(app.access(now()), Access::Active { .. }));

        // 6. Another installation is managed on its own.
        let mut other = Engine::load(
            config.clone(),
            MemoryVault::default(),
            Http::new(),
            "1.2.0",
            now(),
        )
        .unwrap();
        other.check(now()).unwrap();
        assert_ne!(other.installation_id(), id);
        assert_eq!(set_status(&admin, other.installation_id(), "BLOCKED"), 200);
        other.check(now()).unwrap();
        app.check(now()).unwrap();
        assert_eq!(other.access(now()), Access::Blocked);
        assert!(matches!(app.access(now()), Access::Active { .. }));

        // 7. Server gone: the check fails, nothing crashes, the app keeps running.
        let gone = config::Config {
            endpoint: "http://127.0.0.1:9/functions/v1/license".into(),
            ..config
        };
        let mut offline = Engine::load(gone, vault, Http::new(), "1.2.0", now()).unwrap();
        assert_eq!(offline.check(now()), Err(Problem::Offline));
        assert!(matches!(offline.access(now()), Access::Active { .. }));
    }

    /// The deployed server named in `license.json`, with the built-in key:
    /// registers a throwaway installation (delete it in the dashboard's SQL
    /// editor afterwards). `cargo test --lib -- --ignored live_server`.
    #[test]
    #[ignore = "registers an installation on the real server"]
    fn live_server_confirms_a_new_installation() {
        use store::tests::MemoryVault;

        let config = config::CONFIG
            .clone()
            .expect("license.json has no endpoint");
        let mut app = Engine::load(
            config,
            MemoryVault::default(),
            Http::new(),
            "0.0.0-test",
            now(),
        )
        .unwrap();
        assert_eq!(app.check(now()), Ok(()));
        assert!(matches!(app.access(now()), Access::Active { .. }));
        println!("test installation: {}", app.installation_id());
    }
}

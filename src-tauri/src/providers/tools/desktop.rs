//! Desktop state for the island and small system actions:
//!
//! - the `desktop` snapshot: whether a web browser is the active window (the
//!   island then shrinks out of the way of its tabs) and the battery level;
//! - opening programs, files, folders and links (custom quick buttons);
//! - dark mode on and off.

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};

use crate::hub::Hub;

pub const DESKTOP_ID: &str = "desktop";
const POLL: Duration = Duration::from_millis(700);

/// Executables of common browsers, lowercase.
const BROWSERS: &[&str] = &[
    "chrome.exe",
    "msedge.exe",
    "firefox.exe",
    "opera.exe",
    "brave.exe",
    "vivaldi.exe",
    "arc.exe",
    "zen.exe",
    "librewolf.exe",
    "waterfox.exe",
    "floorp.exe",
    "chromium.exe",
];

#[derive(Serialize, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
struct Desktop {
    browser: bool,
    /// 0–100; `None` without a battery.
    battery: Option<u8>,
    charging: bool,
}

pub fn start(hub: Arc<Hub>) {
    std::thread::spawn(move || {
        let mut last: Option<Desktop> = None;
        loop {
            let state = Desktop {
                browser: imp::foreground_exe()
                    .map(|exe| BROWSERS.contains(&exe.as_str()))
                    .unwrap_or(false),
                battery: imp::battery().map(|b| b.0),
                charging: imp::battery().is_some_and(|b| b.1),
            };
            if last.as_ref() != Some(&state) {
                hub.publish(DESKTOP_ID, state.clone());
                last = Some(state);
            }
            std::thread::sleep(POLL);
        }
    });
}

pub fn action(action: &str, payload: &Value) -> Option<Result<Value, String>> {
    Some(match action {
        "open_target" => {
            let target = payload["target"].as_str().unwrap_or_default().trim();
            imp::open(target).map(|_| Value::Null)
        }
        "pick_file" => Ok(json!(crate::dialog::pick_file(
            "Programme und Dateien",
            "*.*"
        ))),
        "pick_folder" => Ok(json!(crate::dialog::pick_folder())),
        "dark_mode" => Ok(json!(imp::dark_mode())),
        "set_dark_mode" => {
            imp::set_dark_mode(payload["on"].as_bool().unwrap_or(true)).map(|_| Value::Null)
        }
        "transit" => transit(payload),
        "installed_apps" => {
            let names: Vec<String> = payload["names"]
                .as_array()
                .map(|list| {
                    list.iter()
                        .filter_map(|n| n.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default();
            Ok(json!(apps::installed(&names)))
        }
        "open_app" => {
            let id = payload["appId"].as_str().unwrap_or_default().trim();
            if id.is_empty() || id.chars().any(char::is_control) {
                return Some(Err("bad app id".into()));
            }
            imp::open(&format!("shell:AppsFolder\\{id}")).map(|_| Value::Null)
        }
        "alarm_start" => {
            alarm::start(tone_of(payload));
            Ok(Value::Null)
        }
        "alarm_stop" => {
            alarm::stop();
            Ok(Value::Null)
        }
        "alarm_test" => {
            alarm::test(tone_of(payload));
            Ok(Value::Null)
        }
        "open_settings" => {
            let uri = payload["uri"].as_str().unwrap_or_default();
            if !uri.starts_with("ms-settings:") {
                return Some(Err("only ms-settings: links".into()));
            }
            imp::open(uri).map(|_| Value::Null)
        }
        _ => return None,
    })
}

/// Desktop apps in the Start menu (Store and classic ones alike), found by
/// their name, so the quick launch can open e.g. the ChatGPT or Claude app
/// instead of the website.
mod apps {
    use serde::{Deserialize, Serialize};

    #[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
    pub struct StartApp {
        #[serde(rename(deserialize = "Name", serialize = "name"))]
        pub name: String,
        #[serde(rename(deserialize = "AppID", serialize = "appId"))]
        pub app_id: String,
    }

    /// The Start menu apps whose name is one of `names` (ignoring case).
    pub fn installed(names: &[String]) -> Vec<StartApp> {
        if names.is_empty() {
            return Vec::new();
        }
        let wanted: Vec<String> = names.iter().map(|n| n.to_lowercase()).collect();
        start_apps()
            .into_iter()
            .filter(|app| wanted.contains(&app.name.to_lowercase()))
            .collect()
    }

    /// `[{"Name":…,"AppID":…}]` from PowerShell; one app comes as a lone object.
    pub fn parse(json: &str) -> Vec<StartApp> {
        let json = json.trim();
        if json.is_empty() {
            return Vec::new();
        }
        serde_json::from_str::<Vec<StartApp>>(json)
            .or_else(|_| serde_json::from_str::<StartApp>(json).map(|app| vec![app]))
            .unwrap_or_default()
    }

    #[cfg(windows)]
    fn start_apps() -> Vec<StartApp> {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        let script = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; \
                      Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress";
        let Ok(out) = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .creation_flags(super::super::CREATE_NO_WINDOW)
            .output()
        else {
            return Vec::new();
        };
        if !out.status.success() {
            return Vec::new();
        }
        parse(&String::from_utf8_lossy(&out.stdout))
    }

    #[cfg(not(windows))]
    fn start_apps() -> Vec<StartApp> {
        Vec::new()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn parses_a_list_and_a_single_app() {
            let list = parse(
                r#"[{"Name":"Claude","AppID":"Claude_pzs8sxrjxfjjc!Claude"},{"Name":"ChatGPT","AppID":"OpenAI.Codex_2p2nqsd0c76g0!App"}]"#,
            );
            assert_eq!(list.len(), 2);
            assert_eq!(list[0].name, "Claude");
            assert_eq!(list[1].app_id, "OpenAI.Codex_2p2nqsd0c76g0!App");
            let one = parse(r#"{"Name":"Gemini","AppID":"Google.Gemini!App"}"#);
            assert_eq!(one.len(), 1);
            assert!(parse("").is_empty());
            assert!(parse("not json").is_empty());
        }

        #[test]
        fn serializes_for_the_ui() {
            let app = StartApp {
                name: "Claude".into(),
                app_id: "Claude!App".into(),
            };
            assert_eq!(
                serde_json::to_string(&app).unwrap(),
                r#"{"name":"Claude","appId":"Claude!App"}"#
            );
        }
    }
}

/// Alarm tone 1–10 (Windows' `Alarm01.wav` … `Alarm10.wav`).
fn tone_of(payload: &Value) -> u8 {
    payload["tone"].as_u64().unwrap_or(1).clamp(1, 10) as u8
}

/// The alarm clock's sound. It rings here in the backend, so it keeps going
/// even when the island's WebView is throttled in the background, until
/// `stop` or a safety limit.
mod alarm {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{Duration, Instant};

    /// Bumped by every start and stop: a ringing loop ends once it changes.
    static GENERATION: AtomicU64 = AtomicU64::new(0);
    /// Rings at most this long, in case the island never says stop.
    const LIMIT: Duration = Duration::from_secs(10 * 60);
    const PAUSE: Duration = Duration::from_millis(600);

    fn tone_path(tone: u8) -> Option<PathBuf> {
        let windows = std::env::var_os("WINDIR").or_else(|| std::env::var_os("SystemRoot"))?;
        let path = PathBuf::from(windows)
            .join("Media")
            .join(format!("Alarm{tone:02}.wav"));
        path.exists().then_some(path)
    }

    fn ring_once(tone: u8) {
        let played = tone_path(tone).is_some_and(|path| crate::sound::play_blocking(&path));
        if !played {
            // No alarm files (e.g. a stripped-down Windows): the reminder sound.
            crate::sound::system("Notification.Looping.Alarm");
            std::thread::sleep(Duration::from_secs(3));
        }
    }

    pub fn start(tone: u8) {
        let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        std::thread::spawn(move || {
            let began = Instant::now();
            while GENERATION.load(Ordering::SeqCst) == generation && began.elapsed() < LIMIT {
                ring_once(tone);
                std::thread::sleep(PAUSE);
            }
        });
    }

    pub fn stop() {
        GENERATION.fetch_add(1, Ordering::SeqCst);
    }

    /// One ring, to try the tone in the settings.
    pub fn test(tone: u8) {
        std::thread::spawn(move || ring_once(tone));
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn stop_ends_the_current_generation() {
            let before = GENERATION.load(Ordering::SeqCst);
            stop();
            assert!(GENERATION.load(Ordering::SeqCst) > before);
        }
    }
}

/// Swiss public transport (transport.opendata.ch, free, no key): `kind` is
/// `stationboard` or `locations`, `query` its URL parameters.
fn transit(payload: &Value) -> Result<Value, String> {
    let kind = payload["kind"].as_str().unwrap_or_default();
    if !matches!(kind, "stationboard" | "locations" | "connections") {
        return Err("bad kind".into());
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(12)))
        .build()
        .into();
    let mut request = agent.get(format!("https://transport.opendata.ch/v1/{kind}"));
    if let Some(query) = payload["query"].as_object() {
        for (key, value) in query {
            let value = match value {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            request = request.query(key, &value);
        }
    }
    let mut res = request.call().map_err(|_| "network".to_string())?;
    if res.status().as_u16() != 200 {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    let text = res
        .body_mut()
        .read_to_string()
        .map_err(|_| "network".to_string())?;
    serde_json::from_str(&text).map_err(|_| "bad response".to_string())
}

#[cfg(windows)]
mod imp {
    use windows::Win32::Foundation::{CloseHandle, LPARAM, WPARAM};
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    use windows::Win32::System::Registry::{
        HKEY_CURRENT_USER, REG_DWORD, RRF_RT_REG_DWORD, RegGetValueW, RegSetKeyValueW,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        QueryFullProcessImageNameW,
    };
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, HWND_BROADCAST, SMTO_ABORTIFHUNG,
        SW_SHOWNORMAL, SendMessageTimeoutW, WM_SETTINGCHANGE,
    };
    use windows::core::{HSTRING, PWSTR, w};

    const PERSONALIZE: windows::core::PCWSTR =
        w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize");

    /// File name of the active window's program, lowercase.
    pub fn foreground_exe() -> Option<String> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_invalid() {
                return None;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == 0 {
                return None;
            }
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_WIN32,
                PWSTR(buf.as_mut_ptr()),
                &mut len,
            )
            .is_ok();
            let _ = CloseHandle(process);
            if !ok {
                return None;
            }
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            path.rsplit(['\\', '/']).next().map(str::to_lowercase)
        }
    }

    /// (percent, charging), or `None` without a battery.
    pub fn battery() -> Option<(u8, bool)> {
        let mut status = SYSTEM_POWER_STATUS::default();
        unsafe { GetSystemPowerStatus(&mut status) }.ok()?;
        // 128: no system battery; 255: unknown.
        if status.BatteryFlag & 128 != 0 || status.BatteryLifePercent > 100 {
            return None;
        }
        Some((status.BatteryLifePercent, status.ACLineStatus == 1))
    }

    /// Programs, documents, folders and web links, as a double-click would.
    pub fn open(target: &str) -> Result<(), String> {
        if target.is_empty() {
            return Err("empty".into());
        }
        let web = target.starts_with("https://") || target.starts_with("http://");
        let settings = target.starts_with("ms-settings:");
        let start_app = target.starts_with("shell:AppsFolder\\");
        if !web && !settings && !start_app && !std::path::Path::new(target).exists() {
            return Err("notFound".into());
        }
        let result = unsafe {
            ShellExecuteW(
                None,
                w!("open"),
                &HSTRING::from(target),
                None,
                None,
                SW_SHOWNORMAL,
            )
        };
        // Values above 32 mean success.
        if result.0 as isize > 32 {
            Ok(())
        } else {
            Err("failed".into())
        }
    }

    fn read_dword(name: windows::core::PCWSTR) -> Option<u32> {
        let mut value = 0u32;
        let mut size = std::mem::size_of::<u32>() as u32;
        unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                PERSONALIZE,
                name,
                RRF_RT_REG_DWORD,
                None,
                Some(&mut value as *mut u32 as *mut _),
                Some(&mut size),
            )
        }
        .ok()
        .ok()?;
        Some(value)
    }

    /// Whether apps use the dark theme.
    pub fn dark_mode() -> bool {
        read_dword(w!("AppsUseLightTheme")) == Some(0)
    }

    pub fn set_dark_mode(on: bool) -> Result<(), String> {
        let light: u32 = if on { 0 } else { 1 };
        for name in [w!("AppsUseLightTheme"), w!("SystemUsesLightTheme")] {
            unsafe {
                RegSetKeyValueW(
                    HKEY_CURRENT_USER,
                    PERSONALIZE,
                    name,
                    REG_DWORD.0,
                    Some(&light as *const u32 as *const _),
                    std::mem::size_of::<u32>() as u32,
                )
            }
            .ok()
            .map_err(|e| e.to_string())?;
        }
        // Tell running apps (taskbar, Explorer, windows) to repaint.
        unsafe {
            let _ = SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                WPARAM(0),
                LPARAM(w!("ImmersiveColorSet").as_ptr() as isize),
                SMTO_ABORTIFHUNG,
                300,
                None,
            );
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn foreground_exe() -> Option<String> {
        None
    }
    pub fn battery() -> Option<(u8, bool)> {
        None
    }
    pub fn open(_target: &str) -> Result<(), String> {
        Err("windows only".into())
    }
    pub fn dark_mode() -> bool {
        false
    }
    pub fn set_dark_mode(_on: bool) -> Result<(), String> {
        Err("windows only".into())
    }
}

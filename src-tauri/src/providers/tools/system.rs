//! Brightness, volume, lock and screenshots for the control center.

use std::time::Duration;

use serde_json::{Value, json};

use crate::providers::music::volume;

pub fn action(action: &str, payload: &Value) -> Result<Value, String> {
    match action {
        "state" => Ok(json!({
            "brightness": brightness::get(),
            "volume": volume::system(),
        })),
        "brightness" => {
            let level = payload["level"].as_u64().ok_or("level missing")?.min(100) as u32;
            brightness::set(level)?;
            Ok(Value::Null)
        }
        "volume" => {
            volume::set(&json!({
                "target": "system",
                "level": payload["level"],
                "muted": payload["muted"],
            }))
            .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "lock" => lock(),
        "screenclip" => screenclip(),
        "screenshot" => screenshot(),
        "open_screenshots" => open_screenshots(),
        other => Err(format!("tools: unsupported action '{other}'")),
    }
}

/// Time for the island to fold away before Windows captures the screen.
const SETTLE: Duration = Duration::from_millis(450);

#[cfg(windows)]
fn lock() -> Result<Value, String> {
    use windows::Win32::System::Shutdown::LockWorkStation;
    unsafe { LockWorkStation() }.map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

/// Windows' own snipping overlay (the same as Win+Shift+S).
#[cfg(windows)]
fn screenclip() -> Result<Value, String> {
    std::thread::sleep(SETTLE);
    std::process::Command::new("explorer.exe")
        .arg("ms-screenclip:")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

/// The whole screen into Pictures\Screenshots, the same as Win+PrtScn.
#[cfg(windows)]
fn screenshot() -> Result<Value, String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_KEYBOARD, KEYBD_EVENT_FLAGS, KEYBDINPUT, KEYEVENTF_KEYUP, SendInput,
        VIRTUAL_KEY, VK_LWIN, VK_SNAPSHOT,
    };

    std::thread::sleep(SETTLE);
    let key = |vk: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let none = KEYBD_EVENT_FLAGS(0);
    let inputs = [
        key(VK_LWIN, none),
        key(VK_SNAPSHOT, none),
        key(VK_SNAPSHOT, KEYEVENTF_KEYUP),
        key(VK_LWIN, KEYEVENTF_KEYUP),
    ];
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize != inputs.len() {
        return Err("SendInput was blocked".into());
    }
    Ok(Value::Null)
}

/// The folder Win+PrtScn saves to (it can be moved, so ask Windows).
#[cfg(windows)]
fn open_screenshots() -> Result<Value, String> {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{FOLDERID_Screenshots, KF_FLAG_CREATE, SHGetKnownFolderPath};

    let folder = unsafe {
        let path = SHGetKnownFolderPath(&FOLDERID_Screenshots, KF_FLAG_CREATE, None)
            .map_err(|e| e.to_string())?;
        let text = path.to_string().map_err(|e| e.to_string());
        CoTaskMemFree(Some(path.0 as _));
        text?
    };
    std::process::Command::new("explorer.exe")
        .arg(folder)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

#[cfg(not(windows))]
fn lock() -> Result<Value, String> {
    Err("windows only".into())
}
#[cfg(not(windows))]
fn screenclip() -> Result<Value, String> {
    Err("windows only".into())
}
#[cfg(not(windows))]
fn screenshot() -> Result<Value, String> {
    Err("windows only".into())
}
#[cfg(not(windows))]
fn open_screenshots() -> Result<Value, String> {
    Err("windows only".into())
}

/// Screen brightness, 0–100. External monitors over DDC/CI (most monitors
/// support it, some have it off in their on-screen menu); a laptop's own panel
/// through WMI, which is the only way Windows offers for it.
mod brightness {
    #[cfg(windows)]
    pub fn get() -> Option<u32> {
        ddc::get().or_else(wmi::get)
    }

    #[cfg(windows)]
    pub fn set(level: u32) -> Result<(), String> {
        let ddc = ddc::set(level);
        let wmi = wmi::set(level);
        if ddc || wmi {
            Ok(())
        } else {
            Err("unsupported".into())
        }
    }

    #[cfg(not(windows))]
    pub fn get() -> Option<u32> {
        None
    }

    #[cfg(not(windows))]
    pub fn set(_level: u32) -> Result<(), String> {
        Err("unsupported".into())
    }

    #[cfg(windows)]
    mod ddc {
        use windows::Win32::Devices::Display::{
            DestroyPhysicalMonitors, GetMonitorBrightness, GetNumberOfPhysicalMonitorsFromHMONITOR,
            GetPhysicalMonitorsFromHMONITOR, PHYSICAL_MONITOR, SetMonitorBrightness,
        };
        use windows::Win32::Foundation::{LPARAM, RECT};
        use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, HDC, HMONITOR};
        use windows::core::BOOL;

        /// Every physical monitor Windows can talk to, freed after `f` ran on each.
        fn each_monitor(mut f: impl FnMut(&PHYSICAL_MONITOR)) {
            unsafe extern "system" fn collect(
                monitor: HMONITOR,
                _: HDC,
                _: *mut RECT,
                data: LPARAM,
            ) -> BOOL {
                let list = unsafe { &mut *(data.0 as *mut Vec<HMONITOR>) };
                list.push(monitor);
                true.into()
            }
            let mut monitors: Vec<HMONITOR> = Vec::new();
            unsafe {
                let _ = EnumDisplayMonitors(
                    None,
                    None,
                    Some(collect),
                    LPARAM(&raw mut monitors as isize),
                );
            }
            for monitor in monitors {
                unsafe {
                    let mut count = 0u32;
                    if GetNumberOfPhysicalMonitorsFromHMONITOR(monitor, &mut count).is_err()
                        || count == 0
                    {
                        continue;
                    }
                    let mut physical = vec![PHYSICAL_MONITOR::default(); count as usize];
                    if GetPhysicalMonitorsFromHMONITOR(monitor, &mut physical).is_err() {
                        continue;
                    }
                    for p in &physical {
                        f(p);
                    }
                    let _ = DestroyPhysicalMonitors(&physical);
                }
            }
        }

        pub fn get() -> Option<u32> {
            let mut found = None;
            each_monitor(|p| {
                if found.is_some() {
                    return;
                }
                let (mut min, mut cur, mut max) = (0u32, 0u32, 0u32);
                let ok = unsafe {
                    GetMonitorBrightness(p.hPhysicalMonitor, &mut min, &mut cur, &mut max)
                } != 0;
                if ok && max > min {
                    found = Some(((cur.saturating_sub(min)) * 100 + (max - min) / 2) / (max - min));
                }
            });
            found
        }

        pub fn set(level: u32) -> bool {
            let mut any = false;
            each_monitor(|p| {
                let (mut min, mut cur, mut max) = (0u32, 0u32, 0u32);
                unsafe {
                    if GetMonitorBrightness(p.hPhysicalMonitor, &mut min, &mut cur, &mut max) == 0
                        || max <= min
                    {
                        return;
                    }
                    let value = min + (max - min) * level / 100;
                    if SetMonitorBrightness(p.hPhysicalMonitor, value) != 0 {
                        any = true;
                    }
                }
            });
            any
        }
    }

    /// Built-in laptop panels, through PowerShell's CIM cmdlets.
    #[cfg(windows)]
    mod wmi {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        use super::super::super::CREATE_NO_WINDOW;

        fn powershell(script: &str) -> Option<String> {
            let out = Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", script])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .ok()?;
            out.status
                .success()
                .then(|| String::from_utf8_lossy(&out.stdout).trim().to_owned())
        }

        pub fn get() -> Option<u32> {
            powershell(
                "(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness",
            )?
            .parse()
            .ok()
        }

        pub fn set(level: u32) -> bool {
            let script = format!(
                "$m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop; \
                 $m | ForEach-Object {{ Invoke-CimMethod -InputObject $_ -MethodName WmiSetBrightness -Arguments @{{ Timeout = [uint32]1; Brightness = [byte]{level} }} -ErrorAction Stop | Out-Null }}"
            );
            powershell(&script).is_some()
        }
    }
}

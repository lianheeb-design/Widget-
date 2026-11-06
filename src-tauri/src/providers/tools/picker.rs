//! Screen color picker: while it runs, the color under the cursor is published
//! about 30 times a second; a left click takes it (and copies `#RRGGBB`),
//! right click or Esc cancels. Low-level mouse and keyboard hooks swallow those
//! clicks and keys so the app underneath never sees them.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::hub::Hub;

/// Snapshot id the UI listens to.
pub const PICKER_ID: &str = "picker";
/// Gives up on its own, so a forgotten picker never keeps the hooks.
const TIMEOUT: Duration = Duration::from_secs(60);

static RUNNING: AtomicBool = AtomicBool::new(false);
static SEQ: AtomicU64 = AtomicU64::new(0);
/// Color under the cursor as 0x00RRGGBB.
static CURRENT: AtomicU32 = AtomicU32::new(0);
/// What ended the session, set by the hooks.
static OUTCOME: Mutex<Option<Outcome>> = Mutex::new(None);

#[derive(Clone, Copy)]
enum Outcome {
    Picked(u32),
    Cancelled,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct State {
    picking: bool,
    /// `#RRGGBB` under the cursor while picking; the picked one afterwards.
    hex: Option<String>,
    /// Bumped on every finished pick, so the UI can show it once.
    seq: u64,
    picked: bool,
}

fn hex(rgb: u32) -> String {
    format!("#{:06X}", rgb & 0x00FF_FFFF)
}

pub fn start(hub: Arc<Hub>) -> Result<(), String> {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    *OUTCOME.lock().unwrap() = None;
    std::thread::spawn(move || {
        let outcome = imp::run(&hub);
        let seq = SEQ.fetch_add(1, Ordering::SeqCst) + 1;
        let picked = match outcome {
            Some(Outcome::Picked(rgb)) => {
                let text = hex(rgb);
                let _ = crate::providers::clipboard::copy_text(&hub, &text);
                Some(text)
            }
            _ => None,
        };
        hub.publish(
            PICKER_ID,
            State {
                picking: false,
                picked: picked.is_some(),
                hex: picked,
                seq,
            },
        );
        RUNNING.store(false, Ordering::SeqCst);
    });
    Ok(())
}

/// Publishes the color under the cursor; called from the picker's own thread.
fn publish_current(hub: &Hub) {
    hub.publish(
        PICKER_ID,
        State {
            picking: true,
            hex: Some(hex(CURRENT.load(Ordering::Relaxed))),
            seq: SEQ.load(Ordering::SeqCst),
            picked: false,
        },
    );
}

fn finish(outcome: Outcome) {
    let mut slot = OUTCOME.lock().unwrap();
    if slot.is_none() {
        *slot = Some(outcome);
    }
}

#[cfg(windows)]
mod imp {
    use super::*;
    use windows::Win32::Foundation::{LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::Graphics::Gdi::{CLR_INVALID, GetDC, GetPixel, ReleaseDC};
    use windows::Win32::UI::Input::KeyboardAndMouse::VK_ESCAPE;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetCursorPos, GetMessageW, HC_ACTION, KBDLLHOOKSTRUCT,
        KillTimer, MSG, MSLLHOOKSTRUCT, PostQuitMessage, SetTimer, SetWindowsHookExW,
        TranslateMessage, UnhookWindowsHookEx, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP,
        WM_LBUTTONDOWN, WM_LBUTTONUP, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_SYSKEYDOWN, WM_TIMER,
    };

    /// A click that ended the session: its button-up is swallowed too, then the loop quits.
    static WAIT_FOR_UP: AtomicBool = AtomicBool::new(false);

    fn sample(x: i32, y: i32) -> Option<u32> {
        unsafe {
            let dc = GetDC(None);
            if dc.is_invalid() {
                return None;
            }
            let color = GetPixel(dc, x, y);
            ReleaseDC(None, dc);
            if color.0 == CLR_INVALID {
                return None;
            }
            // COLORREF is 0x00BBGGRR.
            let v = color.0;
            Some(((v & 0xFF) << 16) | (v & 0xFF00) | ((v >> 16) & 0xFF))
        }
    }

    unsafe extern "system" fn mouse(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            let info = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
            match wparam.0 as u32 {
                WM_LBUTTONDOWN => {
                    let rgb = sample(info.pt.x, info.pt.y)
                        .unwrap_or_else(|| CURRENT.load(Ordering::Relaxed));
                    finish(Outcome::Picked(rgb));
                    WAIT_FOR_UP.store(true, Ordering::SeqCst);
                    return LRESULT(1);
                }
                WM_RBUTTONDOWN => {
                    finish(Outcome::Cancelled);
                    WAIT_FOR_UP.store(true, Ordering::SeqCst);
                    return LRESULT(1);
                }
                WM_LBUTTONUP | WM_RBUTTONUP if WAIT_FOR_UP.swap(false, Ordering::SeqCst) => {
                    unsafe { PostQuitMessage(0) };
                    return LRESULT(1);
                }
                _ => {}
            }
        }
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    unsafe extern "system" fn keyboard(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
            if info.vkCode == VK_ESCAPE.0 as u32 {
                let msg = wparam.0 as u32;
                if msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN {
                    finish(Outcome::Cancelled);
                } else if msg == WM_KEYUP {
                    unsafe { PostQuitMessage(0) };
                }
                return LRESULT(1);
            }
        }
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    pub(super) fn run(hub: &Hub) -> Option<Outcome> {
        WAIT_FOR_UP.store(false, Ordering::SeqCst);
        let started = Instant::now();
        unsafe {
            let mouse_hook = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse), None, 0).ok()?;
            let keyboard_hook = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard), None, 0) {
                Ok(h) => h,
                Err(_) => {
                    let _ = UnhookWindowsHookEx(mouse_hook);
                    return None;
                }
            };
            let timer = SetTimer(None, 0, 33, None);
            let mut last = u32::MAX;
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                if msg.message == WM_TIMER {
                    let mut pt = POINT::default();
                    if GetCursorPos(&mut pt).is_ok()
                        && let Some(rgb) = sample(pt.x, pt.y)
                    {
                        CURRENT.store(rgb, Ordering::Relaxed);
                        if rgb != last {
                            last = rgb;
                            publish_current(hub);
                        }
                    }
                    if started.elapsed() > TIMEOUT {
                        finish(Outcome::Cancelled);
                        break;
                    }
                    continue;
                }
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            let _ = KillTimer(None, timer);
            let _ = UnhookWindowsHookEx(keyboard_hook);
            let _ = UnhookWindowsHookEx(mouse_hook);
        }
        *OUTCOME.lock().unwrap()
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;
    pub(super) fn run(_hub: &Hub) -> Option<Outcome> {
        None
    }
}

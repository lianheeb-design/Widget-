//! Downloads: the newest files in the Downloads folder, to open, show in
//! Explorer, drag out, keep on the shelf or ask Claude about.
//!
//! The folder is read every couple of seconds while the module is on. Files a
//! browser is still writing (`.crdownload`, `.part`, …) stay out of the list
//! until they are done. A file that shows up while the island runs (a download
//! that just finished) is reported as `latest`, so the island can peek.

use std::collections::{HashMap, HashSet};
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use tauri::Manager;
use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::DeleteObject;
use windows::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_SYSTEM};
use windows::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx, CoTaskMemFree};
use windows::Win32::UI::Shell::{
    FOLDERID_Downloads, IShellItemImageFactory, KF_FLAG_DEFAULT, SHCreateItemFromParsingName,
    SHGetKnownFolderPath, SIIGBF_RESIZETOFIT, ShellExecuteW,
};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use windows::core::{HSTRING, PCWSTR, w};

use super::clipboard::image::{Picture, encode_png};
use super::{Provider, now_ms};
use crate::hub::Hub;
use crate::settings::Settings;

pub const ID: &str = "downloads";
const ENABLED_KEY: &str = "module.downloads.enabled";
/// Rows in the list, newest first.
const MAX_ITEMS: usize = 30;
/// Side of the previews: sharp in a 36 px row at 200 %.
const PREVIEW_SIZE: i32 = 72;
const POLL: Duration = Duration::from_secs(2);
const POLL_OFF: Duration = Duration::from_secs(5);
/// A file that shows up counts as just downloaded when it arrived this recently.
const FRESH_MS: u64 = 10 * 60 * 1000;
/// Extensions browsers and download tools give a file while they write it.
const PARTIAL: &[&str] = &[
    "crdownload",
    "part",
    "partial",
    "opdownload",
    "tmp",
    "!ut",
    "aria2",
];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Item {
    path: String,
    name: String,
    is_dir: bool,
    /// Lowercase extension, for the icon when there is no preview.
    ext: String,
    /// Bytes; 0 for folders.
    size: u64,
    /// When it arrived in the folder (Unix ms).
    at: u64,
    /// Windows' own preview (the picture, a video frame…) or the file's icon,
    /// as a PNG data URL.
    thumb: Option<String>,
}

/// The latest file that showed up while the island runs.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Arrival {
    path: String,
    name: String,
    /// When the island noticed it (Unix ms).
    seen_at: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct State {
    /// The Downloads folder; `None` when there is none.
    folder: Option<String>,
    items: Vec<Item>,
    latest: Option<Arrival>,
}

/// One file or folder in the Downloads folder.
#[derive(Debug, Clone, PartialEq)]
struct Entry {
    path: PathBuf,
    name: String,
    is_dir: bool,
    size: u64,
    at: u64,
}

impl Entry {
    fn item(&self, thumb: Option<String>) -> Item {
        Item {
            path: self.path.to_string_lossy().to_string(),
            name: self.name.clone(),
            is_dir: self.is_dir,
            ext: if self.is_dir {
                String::new()
            } else {
                self.path
                    .extension()
                    .map(|e| e.to_string_lossy().to_lowercase())
                    .unwrap_or_default()
            },
            size: self.size,
            at: self.at,
            thumb,
        }
    }

    /// A preview stays valid while the file keeps its path and time.
    fn key(&self) -> (PathBuf, u64) {
        (self.path.clone(), self.at)
    }
}

/// `"setup.exe.crdownload"` → `"setup.exe"`: the name a download in progress
/// will get when it's done.
fn partial_base(name: &str) -> Option<&str> {
    let (base, ext) = name.rsplit_once('.')?;
    (!base.is_empty() && PARTIAL.iter().any(|p| ext.eq_ignore_ascii_case(p))).then_some(base)
}

/// When it landed in the folder: the later of created (a new file, or one
/// copied in) and modified (a download renamed when it finished).
fn arrived(meta: &std::fs::Metadata) -> u64 {
    let ms = |time: std::io::Result<SystemTime>| {
        time.ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as u64)
    };
    ms(meta.created()).max(ms(meta.modified()))
}

/// Everything finished in `dir`, newest first. Leaves out files still being
/// downloaded (and the empty placeholder Firefox keeps under the final name
/// meanwhile), hidden and system files, and Office's `~$` lock files.
fn scan(dir: &Path) -> Vec<Entry> {
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut busy = HashSet::new();
    let mut entries = Vec::new();
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some(base) = partial_base(&name) {
            busy.insert(base.to_lowercase());
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let hidden = FILE_ATTRIBUTE_HIDDEN.0 | FILE_ATTRIBUTE_SYSTEM.0;
        if meta.file_attributes() & hidden != 0 || name.starts_with("~$") {
            continue;
        }
        entries.push(Entry {
            path: entry.path(),
            is_dir: meta.is_dir(),
            size: if meta.is_dir() { 0 } else { meta.len() },
            at: arrived(&meta),
            name,
        });
    }
    entries.retain(|e| !busy.contains(&e.name.to_lowercase()));
    entries.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| a.name.cmp(&b.name)));
    entries
}

/// The newest entry that wasn't there in the last scan and arrived recently
/// (`entries` newest first). Old files moved in don't count.
fn arrival<'a>(before: &HashSet<PathBuf>, entries: &'a [Entry], now: u64) -> Option<&'a Entry> {
    entries
        .iter()
        .find(|e| !before.contains(&e.path) && e.at.saturating_add(FRESH_MS) >= now)
}

/// Where Windows saves downloads (the folder can be moved, so ask Windows).
fn downloads_folder() -> Option<PathBuf> {
    let known = unsafe {
        SHGetKnownFolderPath(&FOLDERID_Downloads, KF_FLAG_DEFAULT, None)
            .ok()
            .and_then(|path| {
                let out = path.to_string().ok().map(PathBuf::from);
                CoTaskMemFree(Some(path.0 as *const _));
                out
            })
    };
    known.or_else(|| {
        std::env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join("Downloads"))
    })
}

/// Windows' own preview of a file (the picture, a video frame, a PDF page…)
/// or its icon, as a PNG data URL — what Explorer shows. Needs COM on this thread.
fn preview(path: &Path) -> Option<String> {
    let pixels = unsafe {
        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(&HSTRING::from(path.as_os_str()), None).ok()?;
        let size = SIZE {
            cx: PREVIEW_SIZE,
            cy: PREVIEW_SIZE,
        };
        let bitmap = factory.GetImage(size, SIIGBF_RESIZETOFIT).ok()?;
        let pixels = super::process::bitmap_bgra(bitmap);
        let _ = DeleteObject(bitmap.into());
        pixels
    };
    let (width, height, mut rgba) = pixels?;
    straighten(&mut rgba);
    let png = encode_png(&Picture {
        width,
        height,
        rgba,
    })
    .ok()?;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    ))
}

/// Shell bitmaps are BGRA with premultiplied alpha, or without any alpha (all
/// zero) for plain pictures: turn them into straight RGBA.
fn straighten(pixels: &mut [u8]) {
    let (pixels, _) = pixels.as_chunks_mut::<4>();
    let no_alpha = pixels.iter().all(|px| px[3] == 0);
    for px in pixels {
        px.swap(0, 2);
        let alpha = px[3] as u32;
        if no_alpha {
            px[3] = 255;
        } else if alpha > 0 && alpha < 255 {
            for c in &mut px[..3] {
                *c = ((*c as u32 * 255 + alpha / 2) / alpha).min(255) as u8;
            }
        }
    }
}

/// Opens Explorer on the folder with the file selected.
fn reveal(path: &Path) {
    // Paths can't contain quotes, so quoting it is enough.
    let args = HSTRING::from(format!("/select,\"{}\"", path.display()));
    unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            w!("explorer.exe"),
            &args,
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
    }
}

struct Ctx {
    hub: Arc<Hub>,
    folder: Option<PathBuf>,
    /// The paths listed now: the only ones the UI may open, reveal or drag.
    listed: Mutex<Vec<PathBuf>>,
}

impl Ctx {
    fn enabled(&self) -> bool {
        self.hub
            .app()
            .state::<Settings>()
            .get(ENABLED_KEY)
            .and_then(|v| v.as_bool())
            .unwrap_or(true)
    }

    fn known(&self, payload: &Value) -> Result<PathBuf, String> {
        let path = payload.as_str().ok_or("missing path")?;
        self.listed
            .lock()
            .unwrap()
            .iter()
            .find(|p| p.as_os_str() == path)
            .cloned()
            .ok_or_else(|| "not in the downloads list".to_string())
    }
}

fn watch(ctx: Arc<Ctx>) {
    // The previews come from the shell, which wants COM on this thread.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }
    let folder_text = ctx.folder.as_ref().map(|f| f.to_string_lossy().to_string());
    // `None`: nothing read yet (or since the module was turned on), so nothing counts as new.
    let mut before: Option<HashSet<PathBuf>> = None;
    let mut latest: Option<Arrival> = None;
    let mut previews: HashMap<(PathBuf, u64), Option<String>> = HashMap::new();
    loop {
        let Some(folder) = ctx.folder.as_deref().filter(|_| ctx.enabled()) else {
            before = None;
            latest = None;
            previews.clear();
            ctx.listed.lock().unwrap().clear();
            ctx.hub.publish(
                ID,
                &State {
                    folder: folder_text.clone(),
                    ..Default::default()
                },
            );
            std::thread::sleep(POLL_OFF);
            continue;
        };
        let all = scan(folder);
        let now = now_ms();
        if let Some(prev) = &before
            && let Some(new) = arrival(prev, &all, now)
        {
            latest = Some(Arrival {
                path: new.path.to_string_lossy().to_string(),
                name: new.name.clone(),
                seen_at: now,
            });
        }
        before = Some(all.iter().map(|e| e.path.clone()).collect());
        let shown = &all[..all.len().min(MAX_ITEMS)];
        *ctx.listed.lock().unwrap() = shown.iter().map(|e| e.path.clone()).collect();
        previews.retain(|key, _| shown.iter().any(|e| e.key() == *key));

        let publish = |previews: &HashMap<(PathBuf, u64), Option<String>>| {
            let items = shown
                .iter()
                .map(|e| e.item(previews.get(&e.key()).cloned().flatten()))
                .collect();
            ctx.hub.publish(
                ID,
                &State {
                    folder: folder_text.clone(),
                    items,
                    latest: latest.clone(),
                },
            );
        };
        // The list first; previews (which can take a moment) right after.
        publish(&previews);
        let missing: Vec<&Entry> = shown
            .iter()
            .filter(|e| !previews.contains_key(&e.key()))
            .collect();
        if !missing.is_empty() {
            for e in missing {
                previews.insert(e.key(), preview(&e.path));
            }
            publish(&previews);
        }
        std::thread::sleep(POLL);
    }
}

#[derive(Default)]
pub struct DownloadsProvider {
    ctx: Mutex<Option<Arc<Ctx>>>,
}

impl Provider for DownloadsProvider {
    fn id(&self) -> &'static str {
        ID
    }

    fn start(self: Arc<Self>, hub: Arc<Hub>) {
        let ctx = Arc::new(Ctx {
            hub,
            folder: downloads_folder(),
            listed: Mutex::default(),
        });
        *self.ctx.lock().unwrap() = Some(ctx.clone());
        std::thread::spawn(move || watch(ctx));
    }

    fn action(&self, action: &str, payload: Value) -> Result<Value, String> {
        let ctx = self
            .ctx
            .lock()
            .unwrap()
            .clone()
            .ok_or("downloads not started")?;
        match action {
            "open" => crate::settings::open_url(&ctx.known(&payload)?.to_string_lossy()),
            "reveal" => reveal(&ctx.known(&payload)?),
            // Drag a file out to any app (Explorer, WhatsApp, an e-mail…).
            "drag" => {
                crate::providers::shelf::start_drag(ctx.hub.app(), vec![ctx.known(&payload)?])
            }
            "openFolder" => {
                let folder = ctx.folder.as_ref().ok_or("no downloads folder")?;
                crate::settings::open_url(&folder.to_string_lossy());
            }
            _ => return Err(format!("{ID}: unknown action '{action}'")),
        }
        Ok(Value::Null)
    }
}

#[cfg(test)]
mod tests {
    use std::fs::{File, FileTimes};
    use std::os::windows::fs::FileTimesExt;

    use windows::Win32::Storage::FileSystem::SetFileAttributesW;

    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("island-downloads-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A file that arrived at `ms` (Unix ms), with `bytes` of content.
    fn file_at(dir: &Path, name: &str, ms: u64, bytes: usize) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, vec![b'x'; bytes]).unwrap();
        let time = UNIX_EPOCH + Duration::from_millis(ms);
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(FileTimes::new().set_modified(time).set_created(time))
            .unwrap();
        path
    }

    fn entry(name: &str, at: u64) -> Entry {
        Entry {
            path: PathBuf::from(format!("C:\\Downloads\\{name}")),
            name: name.into(),
            is_dir: false,
            size: 1,
            at,
        }
    }

    #[test]
    fn knows_downloads_in_progress() {
        assert_eq!(partial_base("setup.exe.crdownload"), Some("setup.exe"));
        assert_eq!(
            partial_base("Unconfirmed 123.crdownload"),
            Some("Unconfirmed 123")
        );
        assert_eq!(partial_base("movie.mkv.part"), Some("movie.mkv"));
        assert_eq!(partial_base("ARCHIVE.ZIP.PART"), Some("ARCHIVE.ZIP"));
        assert_eq!(partial_base("song.mp3.opdownload"), Some("song.mp3"));
        assert_eq!(partial_base("report.pdf"), None);
        assert_eq!(partial_base("part"), None);
        assert_eq!(partial_base(".part"), None);
    }

    #[test]
    fn lists_finished_downloads_newest_first() {
        let dir = temp_dir("scan");
        file_at(&dir, "old.pdf", 1_000_000, 3);
        file_at(&dir, "new.zip", 3_000_000, 5);
        file_at(&dir, "middle.png", 2_000_000, 1);
        // Chrome / Edge / Opera while downloading.
        file_at(&dir, "big.iso.crdownload", 4_000_000, 1);
        // Firefox: an empty placeholder under the final name, plus the `.part`.
        file_at(&dir, "movie.mkv", 4_000_000, 0);
        file_at(&dir, "movie.mkv.part", 4_000_000, 7);
        // Office's lock file and a hidden system file.
        file_at(&dir, "~$letter.docx", 4_000_000, 1);
        let ini = file_at(&dir, "desktop.ini", 4_000_000, 1);
        unsafe {
            SetFileAttributesW(
                &HSTRING::from(ini.as_os_str()),
                FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM,
            )
            .unwrap();
        }

        let names: Vec<String> = scan(&dir).into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["new.zip", "middle.png", "old.pdf"]);

        let first = &scan(&dir)[0];
        assert_eq!((first.size, first.at, first.is_dir), (5, 3_000_000, false));
        assert_eq!(first.item(None).ext, "zip");

        // A folder (an unpacked zip) is listed too, without a size.
        std::fs::create_dir(dir.join("Unpacked")).unwrap();
        let folder = scan(&dir).into_iter().find(|e| e.is_dir).unwrap();
        assert_eq!((folder.name.as_str(), folder.size), ("Unpacked", 0));
        assert_eq!(folder.item(None).ext, "");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_folder_lists_nothing() {
        assert!(scan(Path::new("C:\\does\\not\\exist\\island")).is_empty());
    }

    #[test]
    fn announces_only_new_recent_files() {
        let now = 100 * FRESH_MS;
        let before: HashSet<PathBuf> = [entry("seen.pdf", now - 5_000).path].into();
        let entries = [
            entry("just-done.zip", now - 2_000),
            entry("seen.pdf", now - 5_000),
            entry("moved-in-old.txt", now - FRESH_MS - 1),
        ];
        assert_eq!(
            arrival(&before, &entries, now).map(|e| e.name.as_str()),
            Some("just-done.zip")
        );
        // The same list again: nothing new.
        let before: HashSet<PathBuf> = entries.iter().map(|e| e.path.clone()).collect();
        assert_eq!(arrival(&before, &entries, now), None);
        // Something old that shows up (moved in from elsewhere) isn't a download.
        let before: HashSet<PathBuf> = HashSet::new();
        assert_eq!(arrival(&before, &entries[2..], now), None);
    }

    #[test]
    fn straightens_shell_pixels() {
        // A plain picture: BGR, alpha all zero → opaque RGB.
        let mut plain = vec![10, 20, 30, 0, 40, 50, 60, 0];
        straighten(&mut plain);
        assert_eq!(plain, [30, 20, 10, 255, 60, 50, 40, 255]);
        // An icon: premultiplied alpha → straight alpha.
        let mut icon = vec![50, 100, 0, 128, 0, 0, 0, 0, 1, 2, 3, 255];
        straighten(&mut icon);
        assert_eq!(icon, [0, 199, 100, 128, 0, 0, 0, 0, 3, 2, 1, 255]);
    }
}

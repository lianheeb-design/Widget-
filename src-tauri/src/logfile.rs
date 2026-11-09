//! A small error log in the app's log folder (`island.log`): warnings and
//! errors from the backend, errors the island's UI reports, and crashes. The
//! previous run's log is kept as `island.old.log`, so a problem can still be
//! looked at after a restart. About → "Open error log" shows the folder.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use log::{Level, LevelFilter, Log, Metadata, Record};
use tauri::{AppHandle, Manager};

const FILE: &str = "island.log";
const OLD: &str = "island.old.log";
/// A log never grows past this; then it starts over (keeping the last as `OLD`).
const MAX_BYTES: u64 = 1024 * 1024;

static DIR: OnceLock<PathBuf> = OnceLock::new();

struct FileLog {
    file: Mutex<Option<File>>,
}

impl Log for FileLog {
    fn enabled(&self, metadata: &Metadata) -> bool {
        // Only this app's own messages, not every library's chatter.
        metadata.level() <= Level::Warn
            || (metadata.level() <= Level::Info && metadata.target().starts_with("dynamic_island"))
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let line = format!(
            "{} {:<5} {}: {}\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
            record.level(),
            record.target(),
            record.args()
        );
        if cfg!(debug_assertions) {
            eprint!("{line}");
        }
        let mut guard = self.file.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(file) = guard.as_mut() {
            if file.metadata().is_ok_and(|m| m.len() > MAX_BYTES)
                && let Some(dir) = DIR.get()
            {
                *guard = rotate(dir);
            }
            if let Some(file) = guard.as_mut() {
                let _ = file.write_all(line.as_bytes());
            }
        }
    }

    fn flush(&self) {
        if let Some(file) = self.file.lock().ok().as_mut().and_then(|g| g.as_mut()) {
            let _ = file.flush();
        }
    }
}

/// Moves the current log aside and opens a fresh one.
fn rotate(dir: &Path) -> Option<File> {
    let _ = std::fs::rename(dir.join(FILE), dir.join(OLD));
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(FILE))
        .ok()
}

/// Starts logging (once, at startup), and logs crashes too.
pub fn init(app: &AppHandle) {
    let Ok(dir) = app.path().app_log_dir() else {
        return;
    };
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let file = rotate(&dir);
    let _ = DIR.set(dir);
    let logger = Box::leak(Box::new(FileLog {
        file: Mutex::new(file),
    }));
    if log::set_logger(logger).is_ok() {
        log::set_max_level(LevelFilter::Info);
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("crash: {info}");
        log::logger().flush();
        previous(info);
    }));
    log::info!("started version {}", app.package_info().version);
}

/// The folder with the logs, for the About page's button.
pub fn dir() -> Option<&'static PathBuf> {
    DIR.get()
}

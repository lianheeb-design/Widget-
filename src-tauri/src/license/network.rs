//! Tells the license check when the internet connection comes back, so an
//! installation that went offline is confirmed again right away instead of at
//! the next regular check.

/// Calls `on_online` whenever Windows reports a network change that leaves
/// the computer with internet access. Call it on a thread that lives as long
/// as the app (it joins the thread to COM's multithreaded apartment, which
/// keeps the registration alive); the callback runs on a pool thread.
#[cfg(windows)]
pub fn watch(on_online: impl Fn() + Send + Sync + 'static) {
    use windows::Networking::Connectivity::{
        NetworkConnectivityLevel, NetworkInformation, NetworkStatusChangedEventHandler,
    };
    use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};

    fn online() -> bool {
        NetworkInformation::GetInternetConnectionProfile()
            .and_then(|profile| profile.GetNetworkConnectivityLevel())
            .is_ok_and(|level| level == NetworkConnectivityLevel::InternetAccess)
    }

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let handler = NetworkStatusChangedEventHandler::new(move |_| {
        if online() {
            on_online();
        }
        Ok(())
    });
    // Registered for the app's lifetime: never removed.
    if let Err(e) = NetworkInformation::NetworkStatusChanged(&handler) {
        log::warn!("license: can't watch the network: {e}");
    }
}

#[cfg(not(windows))]
pub fn watch(_on_online: impl Fn() + Send + Sync + 'static) {}

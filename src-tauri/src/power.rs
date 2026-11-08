// 3.8: the window's unlock of the master password ends when Windows locks, the PC sleeps or Windows shuts down (Electron's
// powerMonitor 'lock-screen' / 'suspend' / 'shutdown'). Orb's main window hears Windows' session changes
// (WTSRegisterSessionNotification → WM_WTSSESSION_CHANGE) and power broadcasts (WM_POWERBROADCAST) through a subclass
// of its window procedure, also while hidden, and asks the engine for master.lock.
use tauri::{AppHandle, WebviewWindow};

const WM_QUERYENDSESSION: u32 = 0x0011;
const WM_ENDSESSION: u32 = 0x0016;
const WM_POWERBROADCAST: u32 = 0x0218;
const WM_WTSSESSION_CHANGE: u32 = 0x02B1;
const PBT_APMSUSPEND: usize = 0x0004;
const WTS_SESSION_LOCK: usize = 0x0007;

/// The window messages that end the unlock.
pub fn locks(msg: u32, wparam: usize) -> bool {
  match msg {
    WM_WTSSESSION_CHANGE => wparam == WTS_SESSION_LOCK,
    WM_POWERBROADCAST => wparam == PBT_APMSUSPEND,
    WM_QUERYENDSESSION => true,
    WM_ENDSESSION => wparam != 0,
    _ => false,
  }
}

static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

fn lock_master() {
  let Some(app) = APP.get() else { return };
  let engine = crate::engine::get(app);
  if !engine.is_running() {
    return;
  }
  tauri::async_runtime::spawn(async move {
    let _ = engine.call("master.lock", serde_json::json!({}), std::time::Duration::from_secs(5)).await;
  });
}

#[cfg(windows)]
pub fn watch(window: &WebviewWindow) {
  use windows::Win32::System::RemoteDesktop::{WTSRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION};
  use windows::Win32::UI::Shell::SetWindowSubclass;
  use tauri::Manager;
  let Ok(hwnd) = window.hwnd() else { return };
  let _ = APP.set(window.app_handle().clone());
  // SAFETY: the window lives as long as Orb; the subclass is removed by Windows when it is destroyed.
  unsafe {
    if let Err(e) = WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION) {
      eprintln!("bloqueo de Windows: {e}");
    }
    let _ = SetWindowSubclass(hwnd, Some(subclass), 0x4f52_4231, 0);
  }
}

#[cfg(windows)]
unsafe extern "system" fn subclass(
  hwnd: windows::Win32::Foundation::HWND,
  msg: u32,
  wparam: windows::Win32::Foundation::WPARAM,
  lparam: windows::Win32::Foundation::LPARAM,
  _id: usize,
  _data: usize,
) -> windows::Win32::Foundation::LRESULT {
  if locks(msg, wparam.0) {
    lock_master();
  }
  // SAFETY: the next procedure in the chain, as Windows expects.
  unsafe { windows::Win32::UI::Shell::DefSubclassProc(hwnd, msg, wparam, lparam) }
}

#[cfg(not(windows))]
pub fn watch(_: &WebviewWindow) {}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn lock_suspend_and_shutdown_end_the_unlock() {
    assert!(locks(WM_WTSSESSION_CHANGE, WTS_SESSION_LOCK));
    assert!(!locks(WM_WTSSESSION_CHANGE, 0x8)); // WTS_SESSION_UNLOCK
    assert!(!locks(WM_WTSSESSION_CHANGE, 0x1)); // WTS_CONSOLE_CONNECT
    assert!(locks(WM_POWERBROADCAST, PBT_APMSUSPEND));
    assert!(!locks(WM_POWERBROADCAST, 0x12)); // PBT_APMRESUMEAUTOMATIC
    assert!(locks(WM_QUERYENDSESSION, 0));
    assert!(locks(WM_ENDSESSION, 1));
    assert!(!locks(WM_ENDSESSION, 0)); // the shutdown was cancelled
    assert!(!locks(0x0010, 0)); // WM_CLOSE
  }
}

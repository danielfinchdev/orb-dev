// 3.8: the window's unlock of the master password ends when Windows locks, the session is disconnected (console or
// remote), the PC sleeps or Windows shuts down (Electron's powerMonitor 'lock-screen' / 'suspend' / 'shutdown'). Orb's
// main window hears Windows' session changes (WTSRegisterSessionNotification → WM_WTSSESSION_CHANGE) and power
// broadcasts (WM_POWERBROADCAST) through a subclass of its window procedure, also while hidden, and asks the engine for
// master.lock. Before sleeping it waits for the engine's answer (up to 1.5 s: Windows gives about 2), so the lock is done
// before the engine is frozen. Whether Windows is locked also keeps the agents' text off notices (notify.rs).
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, WebviewWindow};

const WM_NCDESTROY: u32 = 0x0082;
const WM_QUERYENDSESSION: u32 = 0x0011;
const WM_ENDSESSION: u32 = 0x0016;
const WM_POWERBROADCAST: u32 = 0x0218;
const WM_WTSSESSION_CHANGE: u32 = 0x02B1;
const PBT_APMSUSPEND: usize = 0x0004;
const WTS_CONSOLE_DISCONNECT: usize = 0x0002;
const WTS_REMOTE_DISCONNECT: usize = 0x0004;
const WTS_SESSION_LOCK: usize = 0x0007;
const WTS_SESSION_UNLOCK: usize = 0x0008;

/// The window messages that end the unlock.
pub fn locks(msg: u32, wparam: usize) -> bool {
  match msg {
    WM_WTSSESSION_CHANGE => matches!(wparam, WTS_SESSION_LOCK | WTS_CONSOLE_DISCONNECT | WTS_REMOTE_DISCONNECT),
    WM_POWERBROADCAST => wparam == PBT_APMSUSPEND,
    WM_QUERYENDSESSION => true,
    WM_ENDSESSION => wparam != 0,
    _ => false,
  }
}

static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();
/// Locked until known otherwise (review D-fix B5): the state Windows gives when Orb starts, then its session changes.
static LOCKED: AtomicBool = AtomicBool::new(true);
/// Windows' session changes could not be heard: whether it is locked is never known, so notices are always private.
static DEAF: AtomicBool = AtomicBool::new(false);

/// Windows is locked now (or this session disconnected), or Orb cannot know.
pub fn session_locked() -> bool {
  DEAF.load(Ordering::SeqCst) || LOCKED.load(Ordering::SeqCst)
}

/// Whether this session is locked now, as Windows says (WTSSessionInfoEx); None when it does not say.
#[cfg(windows)]
fn locked_now() -> Option<bool> {
  use windows::core::PWSTR;
  use windows::Win32::System::RemoteDesktop::{WTSFreeMemory, WTSQuerySessionInformationW, WTSSessionInfoEx, WTSINFOEXW, WTS_CURRENT_SERVER_HANDLE, WTS_CURRENT_SESSION};
  const WTS_SESSIONSTATE_LOCK: i32 = 0;
  const WTS_SESSIONSTATE_UNLOCK: i32 = 1;
  let mut buf = PWSTR::null();
  let mut len = 0u32;
  // SAFETY: Windows allocates the buffer (freed below) and says its size; read only as WTSINFOEXW when it is that big.
  unsafe {
    WTSQuerySessionInformationW(Some(WTS_CURRENT_SERVER_HANDLE), WTS_CURRENT_SESSION, WTSSessionInfoEx, &mut buf, &mut len).ok()?;
    let out = if (len as usize) >= std::mem::size_of::<WTSINFOEXW>() && !buf.is_null() {
      let info = &*(buf.0 as *const WTSINFOEXW);
      match (info.Level, info.Data.WTSInfoExLevel1.SessionFlags) {
        (1, WTS_SESSIONSTATE_LOCK) => Some(true),
        (1, WTS_SESSIONSTATE_UNLOCK) => Some(false),
        _ => None,
      }
    } else {
      None
    };
    WTSFreeMemory(buf.0 as _);
    out
  }
}

fn lock_master(wait: bool) {
  let Some(app) = APP.get() else { return };
  let engine = crate::engine::get(app);
  if !engine.is_running() {
    return;
  }
  let call = async move {
    if let Err(e) = engine.call("master.lock", serde_json::json!({}), Duration::from_millis(if wait { 1500 } else { 5000 })).await {
      engine.log_line(&format!("master.lock al bloquear o suspender: {e}"));
    }
  };
  if wait {
    // On Orb's UI thread, outside the async runtime: its tasks (the engine's answer) run on their own threads.
    tauri::async_runtime::block_on(call);
  } else {
    tauri::async_runtime::spawn(call);
  }
}

#[cfg(windows)]
pub fn watch(window: &WebviewWindow) {
  use tauri::Manager;
  use windows::Win32::UI::Shell::SetWindowSubclass;
  let Ok(hwnd) = window.hwnd() else { return };
  let _ = APP.set(window.app_handle().clone());
  // SAFETY: the window lives as long as Orb; the subclass is removed by Windows when it is destroyed.
  unsafe {
    let _ = SetWindowSubclass(hwnd, Some(subclass), 0x4f52_4231, 0);
  }
  // Session notifications: Windows' session service may not be ready yet right after signing in: tried again a few
  // times, and a failure is written to the engine's log (never only to a console nobody sees).
  let raw = hwnd.0 as isize;
  std::thread::spawn(move || {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::RemoteDesktop::{WTSRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION};
    let mut last = None;
    for attempt in 0..5 {
      // SAFETY: the window handle stays valid while Orb runs; a destroyed one just fails.
      match unsafe { WTSRegisterSessionNotification(HWND(raw as _), NOTIFY_FOR_THIS_SESSION) } {
        Ok(()) => {
          // Registered first, then asked: a lock in between is heard. Windows does not say: as before, unlocked.
          LOCKED.store(locked_now().unwrap_or(false), Ordering::SeqCst);
          return;
        }
        Err(e) => last = Some(e),
      }
      std::thread::sleep(Duration::from_secs(2 * (attempt + 1)));
    }
    DEAF.store(true, Ordering::SeqCst);
    if let (Some(app), Some(e)) = (APP.get(), last) {
      crate::engine::get(app).log_line(&format!("sin avisos de bloqueo de Windows (los avisos no llevan el texto): {e}"));
    }
  });
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
  if msg == WM_WTSSESSION_CHANGE {
    match wparam.0 {
      WTS_SESSION_LOCK | WTS_CONSOLE_DISCONNECT | WTS_REMOTE_DISCONNECT => LOCKED.store(true, Ordering::SeqCst),
      WTS_SESSION_UNLOCK => LOCKED.store(false, Ordering::SeqCst),
      _ => {}
    }
  }
  if locks(msg, wparam.0) {
    lock_master(msg == WM_POWERBROADCAST);
  }
  if msg == WM_NCDESTROY {
    // SAFETY: the window being destroyed is the one registered.
    let _ = unsafe { windows::Win32::System::RemoteDesktop::WTSUnRegisterSessionNotification(hwnd) };
  }
  // SAFETY: the next procedure in the chain, as Windows expects.
  unsafe { windows::Win32::UI::Shell::DefSubclassProc(hwnd, msg, wparam, lparam) }
}

#[cfg(not(windows))]
pub fn watch(_: &WebviewWindow) {}
#[cfg(not(windows))]
fn locked_now() -> Option<bool> {
  None
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn lock_suspend_disconnect_and_shutdown_end_the_unlock() {
    assert!(locks(WM_WTSSESSION_CHANGE, WTS_SESSION_LOCK));
    assert!(!locks(WM_WTSSESSION_CHANGE, WTS_SESSION_UNLOCK));
    assert!(!locks(WM_WTSSESSION_CHANGE, 0x1)); // WTS_CONSOLE_CONNECT
    assert!(locks(WM_WTSSESSION_CHANGE, WTS_CONSOLE_DISCONNECT));
    assert!(locks(WM_WTSSESSION_CHANGE, WTS_REMOTE_DISCONNECT));
    assert!(locks(WM_POWERBROADCAST, PBT_APMSUSPEND));
    assert!(!locks(WM_POWERBROADCAST, 0x12)); // PBT_APMRESUMEAUTOMATIC
    assert!(locks(WM_QUERYENDSESSION, 0));
    assert!(locks(WM_ENDSESSION, 1));
    assert!(!locks(WM_ENDSESSION, 0)); // the shutdown was cancelled
    assert!(!locks(0x0010, 0)); // WM_CLOSE
  }

  /// Review D-fix B5: private until Orb knows; this test session (signed in, unlocked) is read as unlocked.
  #[test]
  fn the_lock_state_starts_locked_and_windows_says_this_session_is_not() {
    assert!(session_locked() || !LOCKED.load(Ordering::SeqCst));
    #[cfg(windows)]
    assert_eq!(locked_now(), Some(false));
  }
}

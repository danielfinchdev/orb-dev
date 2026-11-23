// The real Windows Hello (Orb.exe on Windows): KeyCredentialManager makes an RSA-2048 key per Orb account, kept by Windows
// (in the TPM when there is one) that signs only after the user's gesture (face, finger or PIN). Orb keeps its public half
// (hello.rs) and checks every signature itself, so this file only has to hand the OS answers over faithfully and fail closed.
//
// Prompt in front: Orb is an unpackaged Win32 app and KeyCredentialManager has no HWND-taking interop (unlike
// UserConsentVerifier), so Windows may open the Hello prompt behind Orb's window. Orb's window is brought to the front first and,
// while the prompt is pending, a helper thread looks for the prompt's window (the credential UI's XAML host) and raises it.
// This is best effort: Windows may refuse a foreground change; the prompt still works, only behind other windows.
use crate::hello::{Hello, HelloError, HelloKey, ALG};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use windows::core::{BOOL, HSTRING, PCWSTR};
use windows::Security::Credentials::{KeyCredential, KeyCredentialCreationOption, KeyCredentialManager, KeyCredentialStatus};
use windows::Security::Cryptography::Core::CryptographicPublicKeyBlobType;
use windows::Storage::Streams::{DataReader, DataWriter, IBuffer};
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentProcessId, GetCurrentThreadId};
use windows::Win32::System::TpmBaseServices::{Tbsi_GetDeviceInfo, TPM_DEVICE_INFO};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
use windows::Win32::UI::WindowsAndMessaging::{
  EnumWindows, FindWindowW, GetForegroundWindow, GetWindow, GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow, GW_OWNER, SW_RESTORE,
};

/// How long the helper looks for the prompt: longer than any prompt the person will leave open before Orb gives up on it.
const FRONT_FOR_MS: u64 = 120_000;
/// The window class of the Windows Hello prompt (CredentialUIBroker's XAML host).
const PROMPT_CLASS: &str = "Credential Dialog Xaml Host";

pub struct WindowsHello;

fn name(account: &str) -> HSTRING {
  HSTRING::from(format!("Orb:{account}"))
}

fn init() {
  // The thread may already have an apartment; either way the WinRT calls below work.
  unsafe {
    let _ = RoInitialize(RO_INIT_MULTITHREADED);
  }
}

fn raise(h: HWND) {
  // SAFETY: plain window calls on a handle that may be gone by now; the OS then just says no.
  unsafe {
    if IsIconic(h).as_bool() {
      let _ = ShowWindow(h, SW_RESTORE);
    }
    if SetForegroundWindow(h).as_bool() {
      return;
    }
    // Windows only lets the foreground's owner switch it: join its input queue for the moment of the call.
    let fg = GetForegroundWindow();
    let fg_thread = GetWindowThreadProcessId(fg, None);
    let me = GetCurrentThreadId();
    if fg_thread != 0 && fg_thread != me && AttachThreadInput(me, fg_thread, true).as_bool() {
      let _ = SetForegroundWindow(h);
      let _ = AttachThreadInput(me, fg_thread, false);
    }
  }
}

/// Orb's own window: the first visible top-level window of this process with no owner.
fn orb_window() -> Option<HWND> {
  struct Find(Option<HWND>, u32);
  unsafe extern "system" fn each(h: HWND, l: LPARAM) -> BOOL {
    // SAFETY: `l` is the &mut Find that orb_window passed to EnumWindows, alive for the whole enumeration.
    let find = unsafe { &mut *(l.0 as *mut Find) };
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(h, Some(&mut pid)) };
    if pid == find.1 && unsafe { IsWindowVisible(h) }.as_bool() && unsafe { GetWindow(h, GW_OWNER) }.is_err() {
      find.0 = Some(h);
      return BOOL(0);
    }
    BOOL(1)
  }
  let mut find = Find(None, unsafe { GetCurrentProcessId() });
  // SAFETY: the callback only touches `find`, which outlives the call.
  let _ = unsafe { EnumWindows(Some(each), LPARAM(&mut find as *mut Find as isize)) };
  find.0
}

/// Raises Orb now and the Hello prompt once it shows, until dropped.
struct Front(Arc<AtomicBool>);
impl Front {
  fn new() -> Front {
    if let Some(h) = orb_window() {
      raise(h);
    }
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let _ = std::thread::Builder::new().name("orb-hello-front".into()).spawn(move || {
      let class: Vec<u16> = PROMPT_CLASS.encode_utf16().chain(Some(0)).collect();
      let mut waited = 0;
      while !flag.load(Ordering::Relaxed) && waited < FRONT_FOR_MS {
        // SAFETY: `class` is NUL-terminated and lives through the call.
        if let Ok(h) = unsafe { FindWindowW(PCWSTR(class.as_ptr()), PCWSTR::null()) } {
          if !h.is_invalid() {
            raise(h);
            return;
          }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
        waited += 100;
      }
    });
    Front(stop)
  }
}
impl Drop for Front {
  fn drop(&mut self) {
    self.0.store(true, Ordering::Relaxed);
  }
}

fn status_error(s: KeyCredentialStatus) -> HelloError {
  match s {
    KeyCredentialStatus::UserCanceled | KeyCredentialStatus::UserPrefersPassword => HelloError::Cancelled,
    // The key is gone (Hello was reset or the credential deleted): it has to be turned on again.
    KeyCredentialStatus::NotFound => HelloError::Changed,
    _ => HelloError::Failed,
  }
}

fn to_buffer(data: &[u8]) -> windows::core::Result<IBuffer> {
  let w = DataWriter::new()?;
  w.WriteBytes(data)?;
  w.DetachBuffer()
}
fn from_buffer(b: &IBuffer) -> windows::core::Result<Vec<u8>> {
  let r = DataReader::FromBuffer(b)?;
  let mut out = vec![0u8; r.UnconsumedBufferLength()? as usize];
  r.ReadBytes(&mut out)?;
  Ok(out)
}

/// Whether the PC has a security chip (TPM 1.2 or 2.0), by the TPM Base Services.
fn has_tpm() -> bool {
  let mut info = TPM_DEVICE_INFO::default();
  // SAFETY: `info` is a live TPM_DEVICE_INFO and the size passed is its own.
  let r = unsafe { Tbsi_GetDeviceInfo(std::mem::size_of::<TPM_DEVICE_INFO>() as u32, &mut info as *mut _ as *mut _) };
  r == 0 && (info.tpmVersion == 1 || info.tpmVersion == 2)
}

fn create_key(account: &str) -> Result<HelloKey, HelloError> {
  let r = KeyCredentialManager::RequestCreateAsync(&name(account), KeyCredentialCreationOption::ReplaceExisting)
    .and_then(|o| o.join())
    .map_err(|_| HelloError::Failed)?;
  match r.Status() {
    Ok(KeyCredentialStatus::Success) => {}
    Ok(s) => return Err(status_error(s)),
    Err(_) => return Err(HelloError::Failed),
  }
  let cred: KeyCredential = r.Credential().map_err(|_| HelloError::Failed)?;
  // The PKCS#1 public key is what Orb stores; hello.rs › enable refuses (and deletes) anything that is not RSA-2048.
  let public = cred
    .RetrievePublicKeyWithBlobType(CryptographicPublicKeyBlobType::Pkcs1RsaPublicKey)
    .and_then(|b| from_buffer(&b))
    .map_err(|_| HelloError::Failed)?;
  Ok(HelloKey { public, alg: ALG.to_string(), tpm: has_tpm() })
}

fn sign_with(account: &str, message: &[u8]) -> Result<Vec<u8>, HelloError> {
  let open = KeyCredentialManager::OpenAsync(&name(account)).and_then(|o| o.join()).map_err(|_| HelloError::Failed)?;
  match open.Status() {
    Ok(KeyCredentialStatus::Success) => {}
    Ok(s) => return Err(status_error(s)),
    Err(_) => return Err(HelloError::Failed),
  }
  let cred = open.Credential().map_err(|_| HelloError::Failed)?;
  let buf = to_buffer(message).map_err(|_| HelloError::Failed)?;
  let signed = cred.RequestSignAsync(&buf).and_then(|o| o.join()).map_err(|_| HelloError::Failed)?;
  match signed.Status() {
    Ok(KeyCredentialStatus::Success) => {}
    Ok(s) => return Err(status_error(s)),
    Err(_) => return Err(HelloError::Failed),
  }
  signed.Result().and_then(|b| from_buffer(&b)).map_err(|_| HelloError::Failed)
}

impl Hello for WindowsHello {
  fn available(&self) -> bool {
    init();
    // Only asks Windows whether Hello is set up: it shows nothing.
    KeyCredentialManager::IsSupportedAsync().and_then(|o| o.join()).unwrap_or(false)
  }
  fn create(&self, account: &str) -> Result<HelloKey, HelloError> {
    init();
    let _front = Front::new();
    create_key(account)
  }
  fn sign(&self, account: &str, message: &[u8]) -> Result<Vec<u8>, HelloError> {
    init();
    let _front = Front::new();
    sign_with(account, message)
  }
  fn delete(&self, account: &str) {
    init();
    if let Ok(o) = KeyCredentialManager::DeleteAsync(&name(account)) {
      let _ = o.join();
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  // Asks Windows only whether Hello is set up (no prompt, no key); whatever the PC says, it must not panic.
  #[test]
  fn asking_is_supported_shows_nothing() {
    let _ = WindowsHello.available();
  }

  #[test]
  fn credential_names_are_per_account() {
    assert_eq!(name("orb1").to_string(), "Orb:orb1");
  }
}

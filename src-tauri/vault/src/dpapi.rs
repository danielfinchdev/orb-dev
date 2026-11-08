// Windows' DPAPI for this Windows user, never with a prompt: what seals this PC's secret on disk (machine.rs › Dpapi).
// Moved here from Orb.exe (3.8.1, decision 20 d): the engine can no longer ask anyone to open it.
use crate::locked::Locked;

#[cfg(windows)]
mod imp {
  use super::Locked;
  use windows::Win32::Foundation::{LocalFree, HLOCAL};
  use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};

  fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 }
  }

  /// DPAPI's LocalAlloc'ed answer, copied into locked memory, wiped and freed.
  fn take(out: CRYPT_INTEGER_BLOB) -> Locked {
    // SAFETY: DPAPI filled `out` with a LocalAlloc'ed buffer of cbData bytes, wiped and freed here once copied.
    unsafe {
      let raw = std::slice::from_raw_parts_mut(out.pbData, out.cbData as usize);
      let v = Locked::from_slice(raw);
      zeroize::Zeroize::zeroize(raw);
      let _ = LocalFree(Some(HLOCAL(out.pbData as _)));
      v
    }
  }

  pub fn protect(data: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
    let (input, extra) = (blob(data), blob(entropy));
    let mut out = CRYPT_INTEGER_BLOB::default();
    // SAFETY: the input blobs point at live slices for the length of the call.
    unsafe {
      CryptProtectData(&input, windows::core::w!("orb"), Some(&extra as *const _), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out).map_err(|e| format!("DPAPI: {e}"))?;
    }
    Ok(take(out).as_slice().to_vec())
  }

  pub fn unprotect(data: &[u8], entropy: &[u8]) -> Result<Locked, ()> {
    let (input, extra) = (blob(data), blob(entropy));
    let mut out = CRYPT_INTEGER_BLOB::default();
    // SAFETY: as in protect.
    unsafe {
      CryptUnprotectData(&input, None, Some(&extra as *const _), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out).map_err(|_| ())?;
    }
    Ok(take(out))
  }
}

#[cfg(not(windows))]
mod imp {
  use super::Locked;
  pub fn protect(_: &[u8], _: &[u8]) -> Result<Vec<u8>, String> {
    Err("solo en Windows".into())
  }
  pub fn unprotect(_: &[u8], _: &[u8]) -> Result<Locked, ()> {
    Err(())
  }
}

pub use imp::{protect, unprotect};

// The approval secret's sealing (host.seal / host.unseal: src/engine/approval-secret.mjs keeps the rest of its life: the
// copy outside the workspace, the files kept aside). Windows' DPAPI for this Windows user, straight from Rust:
//   ORB2 + CryptProtectData(text, entropy "orb.clave.v2")   what Orb 3.8.1 writes;
//   v10 + nonce(12) + AES-256-GCM(text)                     what Electron's safeStorage wrote (Orb up to 3.8.0), opened
//                                                           with the key in <app data>\Local State (os_crypt.encrypted_key
//                                                           = base64("DPAPI" + a DPAPI blob)). Read only: never written.
// Local State is never deleted or changed: it is the only way to open older sealed copies.
use std::path::Path;

pub const ORB2: &[u8] = b"ORB2";
const V10: &[u8] = b"v10";
const ENTROPY: &[u8] = b"orb.clave.v2";
/// Far more than a sealed secret (95 bytes from Electron, ~250 from DPAPI): anything bigger is not one.
pub const MAX_BLOB: usize = 16 * 1024;

/// Local State is a few KB; anything this big is not Chromium's.
const MAX_LOCAL_STATE: u64 = 4 * 1024 * 1024;

/// Why a sealed secret did not open, for the engine (src/engine/approval-secret.mjs › loadHostSecret): `Io` is for now
/// (try again: never a new secret); the rest is how the key is (the user decides).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum UnsealError {
  /// Local State could not be read now (in use, no access, a read error).
  Io,
  /// No Local State: Electron's v10 can never open here.
  Missing,
  /// DPAPI refuses it: another Windows user's, or damaged.
  Dpapi,
  /// The AES-GCM tag does not match: another key, or damaged.
  Tag,
  /// Not a sealed secret, a damaged Local State, or not text.
  Format,
}

impl UnsealError {
  pub fn code(self) -> &'static str {
    match self {
      Self::Io => "io",
      Self::Missing => "missing",
      Self::Dpapi => "dpapi",
      Self::Tag => "tag",
      Self::Format => "format",
    }
  }
}

impl std::fmt::Display for UnsealError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str(match self {
      Self::Io => "no se puede leer Local State ahora",
      Self::Missing => "falta Local State",
      Self::Dpapi => "DPAPI: no abre (otro usuario de Windows o dañado)",
      Self::Tag => "no abre con esta clave",
      Self::Format => "formato desconocido",
    })
  }
}

/// Overwrites a buffer that held a secret (the text or a key) before it is freed; volatile, so it is not optimised away.
pub fn wipe(bytes: &mut [u8]) {
  for b in bytes.iter_mut() {
    // SAFETY: a valid, aligned &mut u8.
    unsafe { std::ptr::write_volatile(b, 0) };
  }
  std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
}

/// A buffer wiped when dropped.
pub struct Secret(pub Vec<u8>);
impl Drop for Secret {
  fn drop(&mut self) {
    wipe(&mut self.0);
  }
}

pub fn seal(text: &str) -> Result<Vec<u8>, String> {
  let mut out = ORB2.to_vec();
  out.extend(dpapi::protect(text.as_bytes(), ENTROPY)?);
  Ok(out)
}

/// The text of a sealed secret: ORB2 (DPAPI) or Electron's v10 with the key of `local_state`.
pub fn unseal(blob: &[u8], local_state: &Path) -> Result<String, UnsealError> {
  if blob.len() > MAX_BLOB {
    return Err(UnsealError::Format);
  }
  let plain = if let Some(rest) = blob.strip_prefix(ORB2) {
    Secret(dpapi::unprotect(rest, ENTROPY).map_err(|_| UnsealError::Dpapi)?)
  } else if blob.starts_with(V10) {
    let text = read_local_state(local_state)?;
    let key = Secret(electron_key(&text)?);
    Secret(electron_open(&key.0, blob)?)
  } else {
    return Err(UnsealError::Format);
  };
  std::str::from_utf8(&plain.0).map(str::to_string).map_err(|_| UnsealError::Format)
}

fn read_local_state(file: &Path) -> Result<String, UnsealError> {
  use std::io::Read;
  let f = std::fs::File::open(file).map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { UnsealError::Missing } else { UnsealError::Io })?;
  if f.metadata().map_err(|_| UnsealError::Io)?.len() > MAX_LOCAL_STATE {
    return Err(UnsealError::Format);
  }
  let mut text = String::new();
  f.take(MAX_LOCAL_STATE + 1).read_to_string(&mut text).map_err(|e| if e.kind() == std::io::ErrorKind::InvalidData { UnsealError::Format } else { UnsealError::Io })?;
  Ok(text)
}

/// The AES key of Chromium's os_crypt, from the text of Local State.
pub fn electron_key(local_state: &str) -> Result<Vec<u8>, UnsealError> {
  use base64::Engine as _;
  let v: serde_json::Value = serde_json::from_str(local_state).map_err(|_| UnsealError::Format)?;
  let wrapped = v.pointer("/os_crypt/encrypted_key").and_then(|k| k.as_str()).ok_or(UnsealError::Format)?;
  let wrapped = base64::engine::general_purpose::STANDARD.decode(wrapped).map_err(|_| UnsealError::Format)?;
  let blob = wrapped.strip_prefix(b"DPAPI").ok_or(UnsealError::Format)?;
  let mut key = dpapi::unprotect(blob, &[]).map_err(|_| UnsealError::Dpapi)?;
  if key.len() != 32 {
    wipe(&mut key);
    return Err(UnsealError::Format);
  }
  Ok(key)
}

/// v10 + nonce(12) + AES-256-GCM ciphertext and tag.
pub fn electron_open(key: &[u8], blob: &[u8]) -> Result<Vec<u8>, UnsealError> {
  use aes_gcm::aead::{Aead, KeyInit};
  use aes_gcm::{Aes256Gcm, Nonce};
  let body = blob.strip_prefix(V10).ok_or(UnsealError::Format)?;
  if body.len() < 12 + 16 {
    return Err(UnsealError::Format);
  }
  let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| UnsealError::Format)?;
  cipher.decrypt(Nonce::from_slice(&body[..12]), &body[12..]).map_err(|_| UnsealError::Tag)
}

#[cfg(windows)]
pub mod dpapi {
  use windows::Win32::Foundation::{LocalFree, HLOCAL};
  use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};

  fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 }
  }

  fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
    // SAFETY: DPAPI filled `out` with a LocalAlloc'ed buffer of cbData bytes, wiped and freed here once copied (it may
    // hold the secret in clear or Electron's key).
    unsafe {
      let raw = std::slice::from_raw_parts_mut(out.pbData, out.cbData as usize);
      let v = raw.to_vec();
      super::wipe(raw);
      let _ = LocalFree(Some(HLOCAL(out.pbData as _)));
      v
    }
  }

  /// For this Windows user only, never with a prompt.
  pub fn protect(data: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
    let input = blob(data);
    let extra = blob(entropy);
    let mut out = CRYPT_INTEGER_BLOB::default();
    // SAFETY: the input blobs point at live slices for the length of the call.
    unsafe {
      CryptProtectData(&input, windows::core::w!("orb"), (!entropy.is_empty()).then_some(&extra as *const _), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        .map_err(|e| format!("DPAPI: {e}"))?;
    }
    Ok(take(out))
  }

  pub fn unprotect(data: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
    let input = blob(data);
    let extra = blob(entropy);
    let mut out = CRYPT_INTEGER_BLOB::default();
    // SAFETY: as in protect.
    unsafe {
      CryptUnprotectData(&input, None, (!entropy.is_empty()).then_some(&extra as *const _), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        .map_err(|_| "DPAPI: no abre (otro usuario de Windows o dañado)".to_string())?;
    }
    Ok(take(out))
  }
}

#[cfg(not(windows))]
pub mod dpapi {
  pub fn protect(_: &[u8], _: &[u8]) -> Result<Vec<u8>, String> {
    Err("solo en Windows".into())
  }
  pub fn unprotect(_: &[u8], _: &[u8]) -> Result<Vec<u8>, String> {
    Err("solo en Windows".into())
  }
}

#[cfg(all(test, windows))]
mod tests {
  use super::*;
  use base64::Engine as _;

  const SECRET: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  fn temp(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("orb-secretos-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
  }

  /// What Chromium's os_crypt does on Windows: a random AES key, wrapped with DPAPI (no entropy) in Local State, and
  /// v10 + nonce + AES-256-GCM.
  fn electron_like(dir: &Path, text: &str) -> Vec<u8> {
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Nonce};
    let key: [u8; 32] = std::array::from_fn(|i| (i as u8).wrapping_mul(37).wrapping_add(11));
    let mut wrapped = b"DPAPI".to_vec();
    wrapped.extend(dpapi::protect(&key, &[]).unwrap());
    let state = serde_json::json!({ "os_crypt": { "encrypted_key": base64::engine::general_purpose::STANDARD.encode(wrapped) }, "other": 1 });
    std::fs::write(dir.join("Local State"), state.to_string()).unwrap();
    let nonce = [7u8; 12];
    let mut blob = b"v10".to_vec();
    blob.extend(nonce);
    blob.extend(Aes256Gcm::new_from_slice(&key).unwrap().encrypt(Nonce::from_slice(&nonce), text.as_bytes()).unwrap());
    blob
  }

  #[test]
  fn orb2_round_trip_and_its_entropy() {
    let sealed = seal(SECRET).unwrap();
    assert!(sealed.starts_with(ORB2));
    assert_ne!(seal(SECRET).unwrap(), sealed, "DPAPI salts every seal");
    assert_eq!(unseal(&sealed, Path::new("no-hace-falta")).unwrap(), SECRET);
    // Plain DPAPI without Orb's entropy (another program's blob) does not open as ORB2, nor the other way round.
    let mut foreign = ORB2.to_vec();
    foreign.extend(dpapi::protect(SECRET.as_bytes(), &[]).unwrap());
    assert_eq!(unseal(&foreign, Path::new("x")), Err(UnsealError::Dpapi));
    assert!(dpapi::unprotect(&sealed[4..], &[]).is_err());
    let mut broken = sealed.clone();
    let last = broken.len() - 1;
    broken[last] ^= 1;
    assert!(unseal(&broken, Path::new("x")).is_err());
  }

  #[test]
  fn electron_v10_opens_with_its_local_state_and_nothing_else() {
    let dir = temp("v10");
    let blob = electron_like(&dir, SECRET);
    let state = dir.join("Local State");
    let before = std::fs::read(&state).unwrap();
    assert_eq!(unseal(&blob, &state).unwrap(), SECRET);
    assert_eq!(std::fs::read(&state).unwrap(), before, "Local State is never changed");
    // Without Local State, with another one, or changed: it does not open (and says so, never a wrong text).
    assert_eq!(unseal(&blob, &dir.join("no-existe")), Err(UnsealError::Missing));
    let other = temp("v10-otro");
    electron_like(&other, "otra cosa");
    let mut tampered = blob.clone();
    tampered[20] ^= 1;
    assert_eq!(unseal(&tampered, &state), Err(UnsealError::Tag));
    std::fs::write(other.join("Local State"), r#"{"os_crypt":{"encrypted_key":"bm8gZHBhcGk="}}"#).unwrap();
    assert!(unseal(&blob, &other.join("Local State")).is_err());
    std::fs::write(other.join("Local State"), "roto").unwrap();
    assert!(unseal(&blob, &other.join("Local State")).is_err());
    assert!(unseal(b"v10corto", &state).is_err());
    assert!(unseal(b"otro formato", &state).is_err());
    assert!(unseal(&vec![b'v'; MAX_BLOB + 1], &state).is_err());
    assert_eq!(unseal(b"otro formato", &state), Err(UnsealError::Format));
    // A Local State far too big is not read at all; one that cannot be opened now is «try again», not «unreadable».
    let big = other.join("grande");
    std::fs::write(&big, vec![b' '; (MAX_LOCAL_STATE + 1) as usize]).unwrap();
    assert_eq!(unseal(&blob, &big), Err(UnsealError::Format));
    assert_eq!(unseal(&blob, &dir), Err(UnsealError::Io), "a folder where Local State should be: a read error");
    assert_eq!(UnsealError::Io.code(), "io");
    let _ = std::fs::remove_dir_all(dir);
    let _ = std::fs::remove_dir_all(other);
  }

  /// A clave.enc made by the real Electron of this repository (node_modules/electron, the one Orb 3.8.0 ships), with no
  /// window, in a throwaway data folder: Rust opens it. Skipped (and says so) where that Electron is not installed.
  #[test]
  fn real_electron_safe_storage_blob_opens() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let electron = root.join("node_modules").join("electron").join("dist").join("electron.exe");
    if !electron.exists() {
      eprintln!("sin node_modules/electron: prueba con Electron real omitida");
      return;
    }
    let dir = temp("electron");
    let script = dir.join("sellar.cjs");
    std::fs::write(
      &script,
      r#"const { app, safeStorage } = require('electron'); const fs = require('fs'); const path = require('path');
const dir = process.env.ORB_TEST_DIR; app.setPath('userData', path.join(dir, 'datos'));
app.whenReady().then(() => { fs.writeFileSync(path.join(dir, 'clave.enc'), safeStorage.encryptString(process.env.ORB_TEST_SECRET)); app.quit(); });"#,
    )
    .unwrap();
    let status = std::process::Command::new(&electron)
      .arg(&script)
      .env("ORB_TEST_DIR", &dir)
      .env("ORB_TEST_SECRET", SECRET)
      .env_remove("ELECTRON_RUN_AS_NODE")
      .status()
      .unwrap();
    assert!(status.success(), "Electron: {status:?}");
    let blob = std::fs::read(dir.join("clave.enc")).unwrap();
    assert!(blob.starts_with(b"v10"), "safeStorage on Windows writes v10");
    assert_eq!(unseal(&blob, &dir.join("datos").join("Local State")).unwrap(), SECRET);
    let _ = std::fs::remove_dir_all(dir);
  }
}

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

pub fn seal(text: &str) -> Result<Vec<u8>, String> {
  let mut out = ORB2.to_vec();
  out.extend(dpapi::protect(text.as_bytes(), ENTROPY)?);
  Ok(out)
}

/// The text of a sealed secret: ORB2 (DPAPI) or Electron's v10 with the key of `local_state`.
pub fn unseal(blob: &[u8], local_state: &Path) -> Result<String, String> {
  if blob.len() > MAX_BLOB {
    return Err("demasiado grande".into());
  }
  let plain = if let Some(rest) = blob.strip_prefix(ORB2) {
    dpapi::unprotect(rest, ENTROPY)?
  } else if blob.starts_with(V10) {
    let text = std::fs::read_to_string(local_state).map_err(|_| "falta Local State".to_string())?;
    electron_open(&electron_key(&text)?, blob)?
  } else {
    return Err("formato desconocido".into());
  };
  String::from_utf8(plain).map_err(|_| "no es texto".to_string())
}

/// The AES key of Chromium's os_crypt, from the text of Local State.
pub fn electron_key(local_state: &str) -> Result<Vec<u8>, String> {
  use base64::Engine as _;
  let v: serde_json::Value = serde_json::from_str(local_state).map_err(|_| "Local State dañado".to_string())?;
  let wrapped = v.pointer("/os_crypt/encrypted_key").and_then(|k| k.as_str()).ok_or("Local State sin clave")?;
  let wrapped = base64::engine::general_purpose::STANDARD.decode(wrapped).map_err(|_| "Local State dañado".to_string())?;
  let blob = wrapped.strip_prefix(b"DPAPI").ok_or("Local State: clave desconocida")?;
  let key = dpapi::unprotect(blob, &[])?;
  if key.len() != 32 {
    return Err("Local State: clave desconocida".into());
  }
  Ok(key)
}

/// v10 + nonce(12) + AES-256-GCM ciphertext and tag.
pub fn electron_open(key: &[u8], blob: &[u8]) -> Result<Vec<u8>, String> {
  use aes_gcm::aead::{Aead, KeyInit};
  use aes_gcm::{Aes256Gcm, Nonce};
  let body = blob.strip_prefix(V10).ok_or("no es v10")?;
  if body.len() < 12 + 16 {
    return Err("v10 corto".into());
  }
  let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "clave no válida".to_string())?;
  cipher.decrypt(Nonce::from_slice(&body[..12]), &body[12..]).map_err(|_| "no abre con esta clave".to_string())
}

#[cfg(windows)]
pub mod dpapi {
  use windows::Win32::Foundation::{LocalFree, HLOCAL};
  use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};

  fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 }
  }

  fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
    // SAFETY: DPAPI filled `out` with a LocalAlloc'ed buffer of cbData bytes, freed here once copied.
    unsafe {
      let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
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
    assert!(unseal(&foreign, Path::new("x")).is_err());
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
    assert!(unseal(&blob, &dir.join("no-existe")).is_err());
    let other = temp("v10-otro");
    electron_like(&other, "otra cosa");
    let mut tampered = blob.clone();
    tampered[20] ^= 1;
    assert!(unseal(&tampered, &state).is_err());
    std::fs::write(other.join("Local State"), r#"{"os_crypt":{"encrypted_key":"bm8gZHBhcGk="}}"#).unwrap();
    assert!(unseal(&blob, &other.join("Local State")).is_err());
    std::fs::write(other.join("Local State"), "roto").unwrap();
    assert!(unseal(&blob, &other.join("Local State")).is_err());
    assert!(unseal(b"v10corto", &state).is_err());
    assert!(unseal(b"otro formato", &state).is_err());
    assert!(unseal(&vec![b'v'; MAX_BLOB + 1], &state).is_err());
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

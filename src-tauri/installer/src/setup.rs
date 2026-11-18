//! Getting the setup ready to run and checking it, so that what starts is what was checked:
//!  1. a new private folder (random name, created exclusively) in the user's temp folder;
//!  2. the setup is written there, closed, and reopened for reading WITHOUT sharing writes or deletes;
//!  3. with that handle still open: the SHA-256 fixed in the binary, the minisign signature (if one came along) against the
//!     updater's PUBLIC key, and the file's final path (junctions and links resolved);
//!  4. exactly that final path is started, while the handle stays open.
//! Anything that does not fit stops here and the setup is never started.
use crate::mode::RealToken;
use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::Storage::FileSystem::{GetFinalPathNameByHandleW, FILE_NAME_NORMALIZED};

/// FILE_SHARE_READ: other processes may read (the system must, to start it), none may write or delete.
const SHARE_READ: u32 = 1;

/// What is checked and run: the bytes, the SHA-256 (hex) they must have, an optional minisign signature and the public key.
pub struct Source<'a> {
  pub bytes: &'a [u8],
  pub sha256: &'a str,
  pub sig: Option<&'a str>,
  pub pubkey_b64: &'a str,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum StageError {
  /// The temporary folder or the file could not be made, written or reopened.
  Io,
  /// The path of the open file is not the one that was written (a link or junction, or a name Windows rewrites).
  Path,
  Hash,
  Signature,
}

pub fn sha256_hex(data: &[u8]) -> String {
  Sha256::digest(data).iter().map(|b| format!("{b:02x}")).collect()
}

pub fn hash_matches(data: &[u8], expected_hex: &str) -> bool {
  let want = expected_hex.trim().to_ascii_lowercase();
  want.len() == 64 && sha256_hex(data) == want
}

/// `sig` is what `tauri signer` writes (the base64 of the minisign file) or that file's text; `pubkey_b64` is the base64 of
/// the public key's text, as in tauri.conf.json.
pub fn signature_valid(data: &[u8], sig: &str, pubkey_b64: &str) -> bool {
  let text = |b64: &str| STANDARD.decode(b64.trim()).ok().and_then(|b| String::from_utf8(b).ok());
  let Some(key) = text(pubkey_b64).and_then(|t| minisign_verify::PublicKey::decode(&t).ok()) else { return false };
  let sig_text = if sig.trim_start().starts_with("untrusted comment:") { Some(sig.to_string()) } else { text(sig) };
  let Some(signature) = sig_text.and_then(|t| minisign_verify::Signature::decode(&t).ok()) else { return false };
  key.verify(data, &signature, true).is_ok()
}

/// A path without the `\\?\` prefix `GetFinalPathNameByHandleW` adds.
pub fn plain_path(p: &Path) -> PathBuf {
  let s = p.to_string_lossy();
  if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
    PathBuf::from(format!(r"\\{rest}"))
  } else if let Some(rest) = s.strip_prefix(r"\\?\") {
    PathBuf::from(rest)
  } else {
    p.to_path_buf()
  }
}

/// Windows drops a trailing dot or space from a name when it reads a path, so such a name would start another file.
pub fn starts_as_written(path: &Path) -> bool {
  path.components().all(|c| match c {
    std::path::Component::Normal(name) => !name.to_string_lossy().ends_with(['.', ' ']),
    _ => true,
  })
}

/// A folder only this run made. It is removed (with what is inside) when dropped.
pub struct PrivateDir {
  path: PathBuf,
}

impl PrivateDir {
  /// Creates `base\orb-instalador-<random>`. `create_dir` fails if the name exists, so the folder is always new.
  pub fn create_in(base: &Path) -> std::io::Result<PrivateDir> {
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|e| std::io::Error::other(e.to_string()))?;
    let name: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let path = base.join(format!("orb-instalador-{name}"));
    create_owner_only_dir(&path)?;
    Ok(PrivateDir { path })
  }

  pub fn path(&self) -> &Path {
    &self.path
  }
}

/// Creates the folder (failing if it exists) with a protected access list: full control only for its owner and for SYSTEM, so no
/// other account of the PC can read or change what is put inside. Files made in it inherit that list.
fn create_owner_only_dir(path: &Path) -> std::io::Result<()> {
  use windows::core::PCWSTR;
  use windows::Win32::Foundation::{LocalFree, HLOCAL};
  use windows::Win32::Security::Authorization::{ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1};
  use windows::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};
  use windows::Win32::Storage::FileSystem::CreateDirectoryW;
  let sddl = wide(std::ffi::OsStr::new("D:PAI(A;OICI;FA;;;OW)(A;OICI;FA;;;SY)"));
  let wide_path = wide(path.as_os_str());
  let mut descriptor = PSECURITY_DESCRIPTOR::default();
  // SAFETY: `sddl` is NUL-terminated and outlives the call; `descriptor` is a valid out pointer. The buffer Windows allocates is
  // freed with LocalFree below, after the only use of it.
  unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(PCWSTR(sddl.as_ptr()), SDDL_REVISION_1, &mut descriptor, None) }.map_err(|e| std::io::Error::other(e.to_string()))?;
  let attributes = SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: descriptor.0, bInheritHandle: false.into() };
  // SAFETY: `wide_path` is NUL-terminated; `attributes` points at the descriptor above, which is alive until it is freed.
  let made = unsafe { CreateDirectoryW(PCWSTR(wide_path.as_ptr()), Some(&attributes)) };
  // SAFETY: the descriptor came from the conversion above and is not used again.
  unsafe { LocalFree(Some(HLOCAL(descriptor.0))) };
  made.map_err(|e| std::io::Error::other(e.to_string()))
}

impl Drop for PrivateDir {
  fn drop(&mut self) {
    let _ = std::fs::remove_dir_all(&self.path);
  }
}

/// A setup that passed every check. The file stays open (no writes by others) as long as this lives.
pub struct Staged {
  // The handle goes before the folder: the folder cannot be removed while the file is open.
  file: File,
  dir: PrivateDir,
  pub path: PathBuf,
  pub signature_checked: bool,
}

fn final_path(file: &File) -> Option<PathBuf> {
  let mut buf = [0u16; 2048];
  // SAFETY: the handle is open for the whole call, and the buffer length is the one passed.
  let n = unsafe { GetFinalPathNameByHandleW(HANDLE(file.as_raw_handle()), &mut buf, FILE_NAME_NORMALIZED) } as usize;
  (n > 0 && n < buf.len()).then(|| PathBuf::from(std::ffi::OsString::from_wide(&buf[..n])))
}

fn same_path(a: &Path, b: &Path) -> bool {
  a.to_string_lossy().eq_ignore_ascii_case(&b.to_string_lossy())
}

/// Writes and checks the setup in a new private folder under `base`. See the module's text for the order.
pub fn stage(src: &Source, base: &Path) -> Result<Staged, StageError> {
  let dir = PrivateDir::create_in(base).map_err(|_| StageError::Io)?;
  // The folder is the real one only if resolving it changes nothing: that is what the final path is compared with.
  let dir_real = plain_path(&std::fs::canonicalize(dir.path()).map_err(|_| StageError::Io)?);
  let wanted = dir_real.join("orb-setup.exe");
  {
    let mut w = std::fs::OpenOptions::new().write(true).create_new(true).open(&wanted).map_err(|_| StageError::Io)?;
    w.write_all(src.bytes).map_err(|_| StageError::Io)?;
    w.flush().map_err(|_| StageError::Io)?;
  }
  let mut file = std::fs::OpenOptions::new().read(true).share_mode(SHARE_READ).open(&wanted).map_err(|_| StageError::Io)?;
  let real = plain_path(&final_path(&file).ok_or(StageError::Path)?);
  if !same_path(&real, &wanted) || !starts_as_written(&real) {
    return Err(StageError::Path);
  }
  // Everything below is read from the handle that will stay open, not from the bytes in memory.
  let mut data = Vec::with_capacity(src.bytes.len());
  file.seek(SeekFrom::Start(0)).map_err(|_| StageError::Io)?;
  file.read_to_end(&mut data).map_err(|_| StageError::Io)?;
  if !hash_matches(&data, src.sha256) {
    return Err(StageError::Hash);
  }
  let signature_checked = match src.sig {
    Some(sig) => {
      if !signature_valid(&data, sig, src.pubkey_b64) {
        return Err(StageError::Signature);
      }
      true
    }
    None => false,
  };
  Ok(Staged { file, dir, path: real, signature_checked })
}

impl Staged {
  /// Starts exactly the file that was checked, with `raw_args` as its command-line tail (not re-quoted: the setup's `/D=`
  /// must stay unquoted), and waits for it. No elevation is asked for. Needs the token of a real run.
  pub fn run(&self, _token: &RealToken, raw_args: &str) -> std::io::Result<ExitStatus> {
    // The file may only be started from the place it was checked in.
    let again = plain_path(&final_path(&self.file).ok_or_else(|| std::io::Error::other("path"))?);
    if !same_path(&again, &self.path) {
      return Err(std::io::Error::other("path changed"));
    }
    let mut cmd = Command::new(&self.path);
    cmd.current_dir(self.dir.path());
    if !raw_args.is_empty() {
      cmd.raw_arg(raw_args);
    }
    cmd.status()
  }
}

/// Wide string for the Windows calls.
pub fn wide(s: &std::ffi::OsStr) -> Vec<u16> {
  s.encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
  use super::*;

  // The crate minisign-verify's own published test vector (public key, signature and the data "test").
  const KEY_TEXT: &str = "untrusted comment: minisign public key\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3\n";
  const SIG_TEXT: &str = "untrusted comment: signature from minisign secret key\nRWQf6LRCGA9i59SLOFxz6NxvASXDJeRtuZykwQepbDEGt87ig1BNpWaVWuNrm73YiIiJbq71Wi+dP9eKL8OC351vwIasSSbXxwA=\ntrusted comment: timestamp:1555779966\tfile:test\nQtKMXWyYcwdpZAlPF7tE2ENJkRd1ujvKjlj1m9RtHTBnZPa5WKU5uWRs5GoP5M/VqE81QFuMKI5k/SfNQUaOAA==";

  #[test]
  fn sha256_matches_and_a_changed_byte_does_not() {
    let data = b"orb setup bytes".to_vec();
    let sha = sha256_hex(&data);
    assert!(hash_matches(&data, &sha));
    assert!(hash_matches(&data, &sha.to_ascii_uppercase()));
    let mut changed = data.clone();
    changed[3] ^= 1;
    assert!(!hash_matches(&changed, &sha));
    assert!(!hash_matches(&data, ""));
    assert!(!hash_matches(&data, "abcd"));
  }

  #[test]
  fn signature_good_bad_and_unreadable() {
    let key = STANDARD.encode(KEY_TEXT);
    assert!(signature_valid(b"test", SIG_TEXT, &key));
    // the way `tauri signer` writes it: base64 of the minisign file
    assert!(signature_valid(b"test", &STANDARD.encode(SIG_TEXT), &key));
    assert!(!signature_valid(b"Test", SIG_TEXT, &key), "other data");
    assert!(!signature_valid(b"test", "not a signature", &key));
    assert!(!signature_valid(b"test", SIG_TEXT, "not a key"));
    // another key's signature must not pass: a key with another id
    let other = STANDARD.encode("untrusted comment: minisign public key\nRWRaZsn9mpx9MDEArzAJ8TJOEUE031gYsJo8Vwy/T3w46Rzx0wNZsg8H\n");
    assert!(!signature_valid(b"test", SIG_TEXT, &other));
  }

  #[test]
  fn the_updater_key_of_the_app_is_a_valid_public_key() {
    let key = STANDARD.decode(crate::embedded::UPDATER_PUBKEY).unwrap();
    assert!(minisign_verify::PublicKey::decode(&String::from_utf8(key).unwrap()).is_ok());
  }

  #[test]
  fn private_dirs_are_new_and_random_and_cleaned_up() {
    let base = std::env::temp_dir();
    let a = PrivateDir::create_in(&base).unwrap();
    let b = PrivateDir::create_in(&base).unwrap();
    assert_ne!(a.path(), b.path());
    assert!(a.path().is_dir());
    std::fs::write(a.path().join("f"), b"x").unwrap();
    let kept = a.path().to_path_buf();
    drop(a);
    assert!(!kept.exists());
    // an existing name is never reused: create_dir refuses it
    assert!(std::fs::create_dir(b.path()).is_err());
  }

  #[test]
  fn paths_are_plain_and_start_as_written() {
    assert_eq!(plain_path(Path::new(r"\\?\C:\Users\a\x.exe")), PathBuf::from(r"C:\Users\a\x.exe"));
    assert_eq!(plain_path(Path::new(r"\\?\UNC\srv\share\x.exe")), PathBuf::from(r"\\srv\share\x.exe"));
    assert_eq!(plain_path(Path::new(r"C:\a\b.exe")), PathBuf::from(r"C:\a\b.exe"));
    assert!(starts_as_written(Path::new(r"C:\a\b.exe")));
    assert!(!starts_as_written(Path::new(r"C:\a.\b.exe")));
    assert!(!starts_as_written(Path::new(r"C:\a \b.exe")));
  }

  #[test]
  fn stage_refuses_a_wrong_hash_and_a_wrong_signature_and_leaves_nothing() {
    let base = std::env::temp_dir().join(format!("orb-stage-test-{}", std::process::id()));
    std::fs::create_dir_all(&base).unwrap();
    let key = STANDARD.encode(KEY_TEXT);
    let good_sha = sha256_hex(b"test");
    let zeros = "0".repeat(64);
    let with = |sha: &str, sig: Option<&str>, key: &str| stage(&Source { bytes: b"test", sha256: sha, sig, pubkey_b64: key }, &base);
    assert_eq!(with(&zeros, None, &key).err(), Some(StageError::Hash));
    let sha = good_sha.as_str();
    assert_eq!(with(sha, Some("garbage"), &key).err(), Some(StageError::Signature));
    // good: hash and signature fit; the file is held open without write sharing
    let staged = with(sha, Some(SIG_TEXT), &key).unwrap();
    assert!(staged.signature_checked);
    assert!(std::fs::OpenOptions::new().write(true).open(&staged.path).is_err(), "no one may write the checked file");
    assert!(std::fs::remove_file(&staged.path).is_err(), "nor delete it");
    let held = staged.path.parent().unwrap().to_path_buf();
    drop(staged);
    assert!(!held.exists(), "the temporary folder is gone");
    // without a signature only the hash is checked
    assert!(!with(sha, None, &key).unwrap().signature_checked);
    assert_eq!(std::fs::read_dir(&base).unwrap().count(), 0, "every failed or finished run removed its folder");
    let _ = std::fs::remove_dir_all(&base);
  }
}

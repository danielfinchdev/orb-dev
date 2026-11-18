//! The path that starts the setup, with a harmless stand-in program (the `fake-setup` binary of this crate) instead of an
//! installer. Run with `cargo test --offline --features fake-setup`.
#![cfg(feature = "fake-setup")]
use orb_instalador::mode::RealToken;
use orb_instalador::setup::{self, Source, StageError};
use std::path::PathBuf;

fn fake_bytes() -> Vec<u8> {
  std::fs::read(env!("CARGO_BIN_EXE_fake-setup")).unwrap()
}

fn scratch(name: &str) -> PathBuf {
  let p = std::env::temp_dir().join(format!("orb-fake-{name}-{}", std::process::id()));
  let _ = std::fs::remove_dir_all(&p);
  std::fs::create_dir_all(&p).unwrap();
  p
}

#[test]
fn a_checked_setup_runs_from_its_private_folder_with_the_exact_arguments_and_leaves_nothing() {
  let base = scratch("ok");
  let bytes = fake_bytes();
  let sha = setup::sha256_hex(&bytes);
  let marker = base.join("marker.txt");
  let src = Source { bytes: &bytes, sha256: &sha, sig: None, pubkey_b64: "" };
  let staged = setup::stage(&src, &base).unwrap();
  assert!(staged.path.starts_with(&base) && staged.path.file_name().unwrap() == "orb-setup.exe");
  // the unquoted tail is passed as it is (NSIS wants /D= last and without quotes)
  let status = staged.run(&RealToken::for_tests(), &format!("--marker \"{}\" --exit 7", marker.display())).unwrap();
  assert_eq!(status.code(), Some(7));
  let written = std::fs::read_to_string(&marker).unwrap();
  assert!(written.contains("--exit") && written.contains('7'));
  drop(staged);
  let left: Vec<_> = std::fs::read_dir(&base).unwrap().map(|e| e.unwrap().file_name()).collect();
  assert_eq!(left, vec![std::ffi::OsString::from("marker.txt")], "only the test's own marker remains: the private folder is gone");
  let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn a_changed_byte_never_runs() {
  let base = scratch("bad");
  let bytes = fake_bytes();
  let sha = setup::sha256_hex(&bytes);
  let mut changed = bytes.clone();
  let last = changed.len() - 1;
  changed[last] ^= 1;
  let marker = base.join("marker.txt");
  let src = Source { bytes: &changed, sha256: &sha, sig: None, pubkey_b64: "" };
  assert_eq!(setup::stage(&src, &base).err(), Some(StageError::Hash));
  assert!(!marker.exists());
  assert_eq!(std::fs::read_dir(&base).unwrap().count(), 0, "the private folder of a refused setup is removed");
  let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn a_signature_that_does_not_fit_never_runs() {
  let base = scratch("sig");
  let bytes = fake_bytes();
  let sha = setup::sha256_hex(&bytes);
  let key = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDMwN0Q5QzlBRkRDOTY2NUEKUldSYVpzbjltcHg5TURFQXJ6QUo4VEpPRVVFMDMxZ1lzSm84Vld5L1QzdzQ2Unp4MHdOWnNnOEgK";
  let sig = "untrusted comment: x\nRUQf6LRCGA9i59SLOFxz6NxvASXDJeRtuZykwQepbDEGt87ig1BNpWaVWuNrm73YiIiJbq71Wi+dP9eKL8OC351vwIasSSbXxwA=\ntrusted comment: t\nQtKMXWyYcwdpZAlPF7tE2ENJkRd1ujvKjlj1m9RtHTBnZPa5WKU5uWRs5GoP5M/VqE81QFuMKI5k/SfNQUaOAA==";
  let src = Source { bytes: &bytes, sha256: &sha, sig: Some(sig), pubkey_b64: key };
  assert_eq!(setup::stage(&src, &base).err(), Some(StageError::Signature));
  let _ = std::fs::remove_dir_all(&base);
}

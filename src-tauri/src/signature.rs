// Authenticode check of an editor's program before Orb starts it ("Open in VS Code / Cursor…"). The file must carry a valid
// embedded signature and the signer must be the maker of that editor. Nothing here lets a program through "anyway".
use std::path::PathBuf;

/// What an editor's program must be signed by, besides a valid embedded signature that Windows trusts.
#[derive(Debug, PartialEq)]
pub enum Expected {
  /// One of these signer names, compared whole and without regard to case (never "contains"). The first is the one shown
  /// to the user; more exact names can be added to a list.
  Named(&'static [&'static str]),
  /// Any signer, as long as the signature is valid and trusted. Only for editors whose signer name nobody has checked yet.
  AnyTrusted,
}

/// Signer names: VS Code was checked on a real PC; Cursor's was confirmed by Cursor's staff in their forum; JetBrains',
/// Windsurf's and Zed's are the makers' published legal names but not checked on a PC. An unchecked name fails closed (the
/// editor is refused and the real signer is shown), so correcting one is a one-line edit to its list here.
pub fn expected_signer(which: &str) -> Expected {
  match which {
    "vscode" => Expected::Named(&["Microsoft Corporation"]),
    "windsurf" => Expected::Named(&["Codeium, Inc.", "Codeium Inc.", "Windsurf, Inc."]),
    "zed" => Expected::Named(&["Zed Industries, Inc.", "Zed Industries Inc."]),
    "jetbrains" => Expected::Named(&["JetBrains s.r.o."]),
    _ => Expected::Named(&["Anysphere, Inc."]),
  }
}

#[cfg_attr(not(windows), allow(dead_code))]
pub fn signer_matches(signer: &str, accepted: &[&str]) -> bool {
  !signer.is_empty() && accepted.iter().any(|a| a.eq_ignore_ascii_case(signer))
}

/// A signer's name as it is shown to the user: no control characters and at most 120 characters.
#[cfg_attr(not(windows), allow(dead_code))]
fn display_signer(name: &str) -> String {
  name.chars().filter(|c| !c.is_control()).take(120).collect()
}

/// Why a program was not let through.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, PartialEq)]
pub enum Failure {
  /// No embedded signature, or one that does not verify.
  Unsigned,
  /// Valid signature, but from someone else (the signer's name, cleaned for display).
  WrongSigner(String),
  /// The program could not be opened or resolved (permission, locked by another process, a path that changes).
  Unreadable,
}

/// Whether Windows starts this path as written. It drops a trailing dot or space from a folder or file name when it reads a
/// path, so `...\cursor.\Cursor.exe` would be looked up again as `...\cursor\Cursor.exe`: another place than the one checked.
#[cfg_attr(not(windows), allow(dead_code))]
fn starts_as_written(path: &std::path::Path) -> bool {
  path.components().all(|c| match c {
    std::path::Component::Normal(name) => !name.to_string_lossy().ends_with(['.', ' ']),
    _ => true,
  })
}

/// A program that passed the check. `path` is the one to start; while this value lives the file stays open without write
/// access for others, so what starts is what was checked.
pub struct Verified {
  pub path: PathBuf,
  _lock: Option<std::fs::File>,
}

#[cfg(windows)]
pub use win::verify_editor;

/// Outside Windows Orb starts no editors, so there is nothing to verify.
#[cfg(not(windows))]
pub fn verify_editor(path: &std::path::Path, _which: &str) -> Result<Verified, Failure> {
  Ok(Verified { path: path.to_path_buf(), _lock: None })
}

#[cfg(windows)]
mod win {
  use super::{display_signer, expected_signer, signer_matches, Expected, Failure, Verified};
  use std::fs::File;
  use std::os::windows::ffi::{OsStrExt, OsStringExt};
  use std::os::windows::fs::OpenOptionsExt;
  use std::os::windows::io::AsRawHandle;
  use std::path::{Path, PathBuf};
  use windows::Win32::Foundation::{HANDLE, HWND};
  use windows::Win32::Security::Cryptography::{CertGetNameStringW, CERT_NAME_SIMPLE_DISPLAY_TYPE};
  use windows::Win32::Security::WinTrust::{
    WTHelperGetProvCertFromChain, WTHelperGetProvSignerFromChain, WTHelperProvDataFromStateData, WinVerifyTrust, WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA,
    WINTRUST_DATA_0, WINTRUST_DATA_PROVIDER_FLAGS, WINTRUST_FILE_INFO, WTD_CACHE_ONLY_URL_RETRIEVAL, WTD_CHOICE_FILE, WTD_REVOCATION_CHECK_NONE, WTD_REVOKE_NONE,
    WTD_STATEACTION_CLOSE, WTD_STATEACTION_VERIFY, WTD_UI_NONE,
  };
  use windows::Win32::Storage::FileSystem::{GetFinalPathNameByHandleW, FILE_NAME_NORMALIZED};

  /// Checks `path` (already canonical, see host.rs) against the editor's accepted signers.
  pub fn verify_editor(path: &Path, which: &str) -> Result<Verified, Failure> {
    verify(path, &expected_signer(which))
  }

  pub fn verify(path: &Path, expected: &Expected) -> Result<Verified, Failure> {
    // Share for reading only: other writers are refused while this handle lives, and the system can still start the program.
    let file = std::fs::OpenOptions::new().read(true).share_mode(1).open(path).map_err(|_| Failure::Unreadable)?;
    // What the open handle really is must be the path that will be started; a junction or link swapped in after the caller
    // resolved the path shows up here and is refused.
    let real = crate::tools::plain_path(&final_path(&file).ok_or(Failure::Unreadable)?);
    if !real.to_string_lossy().eq_ignore_ascii_case(&path.to_string_lossy()) || !super::starts_as_written(&real) {
      return Err(Failure::Unreadable);
    }
    let signer = signer_of(&file, &real).ok_or(Failure::Unsigned)?;
    match expected {
      Expected::AnyTrusted => {}
      Expected::Named(names) if signer_matches(&signer, names) => {}
      Expected::Named(_) => return Err(Failure::WrongSigner(display_signer(&signer))),
    }
    Ok(Verified { path: real, _lock: Some(file) })
  }

  fn final_path(file: &File) -> Option<PathBuf> {
    let mut buf = [0u16; 1024];
    // SAFETY: the handle is open for the whole call, and the buffer length is the one passed.
    let n = unsafe { GetFinalPathNameByHandleW(HANDLE(file.as_raw_handle()), &mut buf, FILE_NAME_NORMALIZED) } as usize;
    (n > 0 && n < buf.len()).then(|| PathBuf::from(std::ffi::OsString::from_wide(&buf[..n])))
  }

  /// The subject name of the leaf certificate of the embedded signature, only if the signature verifies. No network (no
  /// revocation lookups, cached URLs only) and no window.
  fn signer_of(file: &File, path: &Path) -> Option<String> {
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut info = WINTRUST_FILE_INFO {
      cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
      pcwszFilePath: windows::core::PCWSTR(wide.as_ptr()),
      hFile: HANDLE(file.as_raw_handle()),
      pgKnownSubject: std::ptr::null_mut(),
    };
    let mut data = WINTRUST_DATA {
      cbStruct: std::mem::size_of::<WINTRUST_DATA>() as u32,
      dwUIChoice: WTD_UI_NONE,
      fdwRevocationChecks: WTD_REVOKE_NONE,
      dwUnionChoice: WTD_CHOICE_FILE,
      Anonymous: WINTRUST_DATA_0 { pFile: &mut info },
      dwStateAction: WTD_STATEACTION_VERIFY,
      dwProvFlags: WINTRUST_DATA_PROVIDER_FLAGS(WTD_REVOCATION_CHECK_NONE.0 | WTD_CACHE_ONLY_URL_RETRIEVAL.0),
      ..Default::default()
    };
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    // INVALID_HANDLE_VALUE as the window tells WinVerifyTrust to show no UI.
    let no_window = HWND(-1isize as *mut core::ffi::c_void);
    // SAFETY: `data` and `info` are fully initialised, and `wide` and the open file outlive the call. WinVerifyTrust reads
    // them and writes only the state handle into `data.hWVTStateData`.
    let status = unsafe { WinVerifyTrust(no_window, &mut action, &mut data as *mut _ as *mut core::ffi::c_void) };
    let name = if status == 0 {
      // SAFETY: the state handle comes from the VERIFY call above and is still open; the pointers the helpers return live
      // inside that state, so they are only used before the CLOSE below.
      unsafe { leaf_name(data.hWVTStateData) }
    } else {
      None
    };
    // The state is always closed, also when the check failed.
    data.dwStateAction = WTD_STATEACTION_CLOSE;
    // SAFETY: the same structures as above; CLOSE releases the state the VERIFY call allocated.
    unsafe { WinVerifyTrust(no_window, &mut action, &mut data as *mut _ as *mut core::ffi::c_void) };
    name
  }

  /// SAFETY: `state` must be the open state handle of a successful WinVerifyTrust VERIFY call.
  unsafe fn leaf_name(state: HANDLE) -> Option<String> {
    let prov = WTHelperProvDataFromStateData(state);
    if prov.is_null() {
      return None;
    }
    let signer = WTHelperGetProvSignerFromChain(prov, 0, false, 0);
    if signer.is_null() {
      return None;
    }
    let cert = WTHelperGetProvCertFromChain(signer, 0);
    if cert.is_null() || (*cert).pCert.is_null() {
      return None;
    }
    let mut buf = [0u16; 512];
    let n = CertGetNameStringW((*cert).pCert, CERT_NAME_SIMPLE_DISPLAY_TYPE, 0, None, Some(&mut buf)) as usize;
    // `n` counts the final NUL; 1 means an empty name.
    (n > 1 && n <= buf.len()).then(|| String::from_utf16_lossy(&buf[..n - 1]))
  }

  #[cfg(test)]
  mod tests {
    use super::*;

    const MS: Expected = Expected::Named(&["Microsoft Corporation"]);

    fn canon(p: &Path) -> PathBuf {
      crate::tools::plain_path(&std::fs::canonicalize(p).unwrap())
    }

    /// A System32 program known to carry its own signature (most are signed through a catalog), if this PC has one.
    fn signed_program() -> Option<PathBuf> {
      let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
      ["MpSigStub.exe", "xgamecontrol.exe", "microsoft.windows.softwarelogo.showdesktop.exe"]
        .iter()
        .map(|n| PathBuf::from(&root).join("System32").join(n))
        .find(|p| p.is_file())
        .map(|p| canon(&p))
    }

    #[test]
    fn a_file_without_signature_is_rejected() {
      let p = std::env::temp_dir().join(format!("orb-unsigned-{}.exe", std::process::id()));
      std::fs::write(&p, b"not a program").unwrap();
      let r = verify(&canon(&p), &MS);
      let _ = std::fs::remove_file(&p);
      assert_eq!(r.err(), Some(Failure::Unsigned));
    }

    #[test]
    fn a_missing_file_is_unreadable() {
      assert_eq!(verify(Path::new("C:\\orb-does-not-exist\\x.exe"), &MS).err(), Some(Failure::Unreadable));
    }

    #[test]
    fn a_path_that_is_not_the_final_one_is_refused() {
      let Some(exe) = signed_program() else {
        eprintln!("skipped: no System32 program with an embedded signature on this PC");
        return;
      };
      let name = exe.file_name().unwrap().to_owned();
      let roundabout = exe.parent().unwrap().join("..").join("System32").join(name);
      assert_eq!(verify(&roundabout, &MS).err(), Some(Failure::Unreadable));
    }

    #[test]
    fn an_embedded_signature_is_accepted_only_for_its_signer() {
      let Some(exe) = signed_program() else {
        eprintln!("skipped: no System32 program with an embedded signature on this PC");
        return;
      };
      let ok = verify(&exe, &MS).unwrap_or_else(|f| panic!("{} should verify: {f:?}", exe.display()));
      assert!(ok.path.to_string_lossy().eq_ignore_ascii_case(&exe.to_string_lossy()));
      drop(ok);
      assert!(verify(&exe, &Expected::Named(&["microsoft corporation"])).is_ok());
      assert_eq!(verify(&exe, &expected_signer("cursor")).err(), Some(Failure::WrongSigner("Microsoft Corporation".into())));
      // Windsurf and Zed also require their own maker, not any trusted signer.
      assert_eq!(verify(&exe, &expected_signer("zed")).err(), Some(Failure::WrongSigner("Microsoft Corporation".into())));
      assert_eq!(verify(&exe, &expected_signer("windsurf")).err(), Some(Failure::WrongSigner("Microsoft Corporation".into())));
    }

    #[test]
    fn an_unsigned_file_fails_for_every_editor() {
      let p = std::env::temp_dir().join(format!("orb-unsigned-all-{}.exe", std::process::id()));
      std::fs::write(&p, b"not a program").unwrap();
      let p2 = canon(&p);
      let results: Vec<_> = ["vscode", "cursor", "windsurf", "zed", "jetbrains"].iter().map(|w| verify(&p2, &expected_signer(w)).err()).collect();
      let _ = std::fs::remove_file(&p);
      assert!(results.iter().all(|r| *r == Some(Failure::Unsigned)), "{results:?}");
    }

    #[test]
    fn a_signed_program_with_a_changed_byte_is_rejected() {
      let Some(exe) = signed_program() else {
        eprintln!("skipped: no System32 program with an embedded signature on this PC");
        return;
      };
      let dir = std::env::temp_dir().join(format!("orb-signed-copy-{}", std::process::id()));
      std::fs::create_dir_all(&dir).unwrap();
      let copy = dir.join("copy.exe");
      std::fs::copy(&exe, &copy).unwrap();
      let copy = canon(&copy);
      let before = verify(&copy, &MS).map(|_| ());
      let mut bytes = std::fs::read(&copy).unwrap();
      let mid = bytes.len() / 2;
      bytes[mid] ^= 0xFF;
      std::fs::write(&copy, &bytes).unwrap();
      let after = verify(&copy, &MS).err();
      let _ = std::fs::remove_dir_all(&dir);
      assert_eq!(before, Ok(()));
      assert_eq!(after, Some(Failure::Unsigned));
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn signer_comparison_is_exact_and_ignores_case() {
    let ms: &[&str] = &["Microsoft Corporation"];
    assert!(signer_matches("Microsoft Corporation", ms));
    assert!(signer_matches("MICROSOFT CORPORATION", ms));
    assert!(!signer_matches("Microsoft Corporation Evil", ms));
    assert!(!signer_matches("Evil Microsoft Corporation", ms));
    assert!(!signer_matches("", ms));
    assert!(!signer_matches("", &[""]));
  }

  #[test]
  fn a_name_ending_in_a_dot_or_a_space_is_not_started() {
    use std::path::Path;
    assert!(starts_as_written(Path::new(r"C:\Users\a\AppData\Local\Programs\cursor\Cursor.exe")));
    assert!(starts_as_written(Path::new(r"C:\Program Files\Microsoft VS Code\Code.exe")));
    for bad in [r"C:\Programs\cursor.\Cursor.exe", r"C:\Programs\cursor \Cursor.exe", r"C:\Programs\cursor\Cursor.exe.", r"C:\Programs\cursor..\Cursor.exe"] {
      assert!(!starts_as_written(Path::new(bad)), "{bad}");
    }
  }

  #[test]
  fn no_editor_has_an_empty_signer_list_or_name() {
    for which in ["vscode", "cursor", "windsurf", "zed", "jetbrains", "anything-else"] {
      match expected_signer(which) {
        Expected::Named(list) => assert!(!list.is_empty() && list.iter().all(|n| !n.trim().is_empty()), "{which}"),
        Expected::AnyTrusted => panic!("{which} must name its signer"),
      }
    }
  }

  #[test]
  fn a_shown_signer_has_no_control_characters_and_is_short() {
    let shown = display_signer(&format!("Ev\u{1b}[31mil\n{}", "x".repeat(300)));
    assert!(!shown.chars().any(|c| c.is_control()));
    assert_eq!(shown.chars().count(), 120);
  }
}

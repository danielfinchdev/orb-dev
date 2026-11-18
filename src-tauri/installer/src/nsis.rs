//! What the face tells the NSIS setup and how it reads the way the setup ended. The setup's silent mode (`/S`) shows no
//! window and no progress; its hooks (src-tauri/nsis/hooks.nsh) end a refusal with exit code 2 and leave the reason in
//! %APPDATA%\Orb.dev\puente-fallido.json. Nothing else tells why a silent run failed, so anything else is shown as a generic failure.
use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Why the setup refused to install (the REASON word of the hooks' OrbRefuse).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Refusal {
  /// Opened as administrator: it cannot remove Orb 3.8.0 that way.
  Elevado,
  /// Orb 3.8.0's folder holds other files or data.
  Carpeta,
  /// Another Orb (not 3.8.0's) is open.
  Otro,
  /// Orb 3.8.0 is still open.
  Abierto,
  /// Orb 3.8.0's own uninstaller failed.
  Desinstalador,
}

impl Refusal {
  pub fn from_word(w: &str) -> Option<Self> {
    Some(match w {
      "elevado" => Refusal::Elevado,
      "carpeta" => Refusal::Carpeta,
      "otro" => Refusal::Otro,
      "abierto" => Refusal::Abierto,
      "desinstalador" => Refusal::Desinstalador,
      _ => return None,
    })
  }
}

/// How a run of the setup ended.
#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
  /// Exit code 0: to be confirmed against what the setup left in the registry.
  Installed,
  Refused { reason: Refusal, version: String },
  /// Any other code (or none): no reason can be known in silent mode.
  Failed { code: Option<i32> },
}

/// The content of puente-fallido.json that matters: the reason and Orb 3.8.0's version.
pub fn parse_fail_file(json: &str) -> Option<(Refusal, String)> {
  let v: serde_json::Value = serde_json::from_str(json.trim_start_matches('\u{feff}')).ok()?;
  let reason = Refusal::from_word(v.get("reason")?.as_str()?)?;
  Some((reason, clean_version(v.get("version").and_then(|x| x.as_str()).unwrap_or(""))))
}

/// A version is shown inside a sentence: only the characters a version has, and not too many.
pub fn clean_version(v: &str) -> String {
  v.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+')).take(32).collect()
}

/// The refusal file only counts if this very run wrote it (a file left by an earlier run says nothing about this one).
pub fn is_fresh(modified: SystemTime, run_started: SystemTime) -> bool {
  modified >= run_started.checked_sub(Duration::from_secs(2)).unwrap_or(SystemTime::UNIX_EPOCH)
}

pub fn classify(exit: Option<i32>, fail: Option<(Refusal, String)>) -> Outcome {
  match (exit, fail) {
    (Some(0), _) => Outcome::Installed,
    (Some(2), Some((reason, version))) => Outcome::Refused { reason, version },
    (code, _) => Outcome::Failed { code },
  }
}

/// Orb's data folder (where the hooks write puente-fallido.json).
pub fn data_dir() -> Option<PathBuf> {
  std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("Orb.dev"))
}

/// The refusal this run left, if any.
pub fn read_fail_file(dir: &Path, run_started: SystemTime) -> Option<(Refusal, String)> {
  let file = dir.join("puente-fallido.json");
  let meta = std::fs::metadata(&file).ok()?;
  if !is_fresh(meta.modified().ok()?, run_started) {
    return None;
  }
  parse_fail_file(&std::fs::read_to_string(&file).ok()?)
}

/// The tail of the command line for the setup. `/D=` must come last and unquoted (an NSIS rule), which is why this is one
/// raw string and not a list of arguments. `/NS` skips both shortcuts, the desktop one and the Start menu one: the setup
/// has no switch for each. Never `/R` (Orb is opened by the face) and never `/UPDATE`.
pub fn silent_cmdline(dir: Option<&Path>, shortcuts: bool) -> String {
  let mut s = String::from("/S");
  if !shortcuts {
    s.push_str(" /NS");
  }
  if let Some(d) = dir {
    s.push_str(" /D=");
    s.push_str(&d.to_string_lossy());
  }
  s
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DirError {
  /// Not a plain absolute path on a drive.
  Invalid,
  /// Inside Windows' or Program Files' folders, which need administrator rights.
  NeedsAdmin,
  /// It exists, has files, and is not an Orb folder.
  NotEmpty,
  /// Orb 3.8.0's own folder (or inside it): the setup's hooks would not remove 3.8.0 and its uninstaller would later delete the new Orb too.
  Electron,
}

const RESERVED: [&str; 22] = [
  "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// The text of a folder the user typed or picked, as the path the setup will receive. Pure: nothing is read from the disk.
pub fn validate_dir(text: &str) -> Result<PathBuf, DirError> {
  let t = text.trim();
  if t.is_empty() || t.chars().count() > 200 || t.chars().any(|c| c.is_control() || matches!(c, '"' | '<' | '>' | '|' | '?' | '*')) {
    return Err(DirError::Invalid);
  }
  let t = t.replace('/', "\\");
  let t = t.trim_end_matches('\\');
  // Rust's components() quietly drops "." and doubled separators; the setup would get the text as written.
  if t.split('\\').skip(1).any(|s| s.is_empty() || s == "." || s == "..") {
    return Err(DirError::Invalid);
  }
  let mut parts = Path::new(t).components();
  // A drive letter with a backslash, never UNC, `\\?\` or a relative path.
  match (parts.next(), parts.next()) {
    (Some(Component::Prefix(p)), Some(Component::RootDir)) if matches!(p.kind(), std::path::Prefix::Disk(_)) => {}
    _ => return Err(DirError::Invalid),
  }
  let mut depth = 0;
  for c in parts {
    match c {
      Component::Normal(n) => {
        let n = n.to_string_lossy();
        let stem = n.split('.').next().unwrap_or("").to_ascii_uppercase();
        if n.ends_with(['.', ' ']) || n.starts_with(' ') || n.contains(':') || RESERVED.contains(&stem.as_str()) {
          return Err(DirError::Invalid);
        }
        depth += 1;
      }
      _ => return Err(DirError::Invalid),
    }
  }
  if depth == 0 {
    return Err(DirError::Invalid);
  }
  let p = PathBuf::from(t);
  if needs_admin(&p) {
    return Err(DirError::NeedsAdmin);
  }
  Ok(p)
}

fn needs_admin(p: &Path) -> bool {
  let low = p.to_string_lossy().to_ascii_lowercase();
  let mut roots: Vec<String> = ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "SystemRoot", "ProgramData"]
    .iter()
    .filter_map(|v| std::env::var(v).ok())
    .map(|v| v.to_ascii_lowercase())
    .collect();
  roots.push(r"c:\windows".into());
  roots.iter().any(|r| !r.is_empty() && (low == *r || low.starts_with(&format!("{}\\", r.trim_end_matches('\\')))))
}

/// An existing folder is fine if it is empty or already holds Orb on Tauri (its `uninstall.exe` next to `Orb.exe`: a reinstall);
/// anything else would mix Orb with someone's files.
pub fn check_existing_dir(p: &Path) -> Result<(), DirError> {
  match std::fs::read_dir(p) {
    Err(_) => Ok(()), // missing: the setup creates it
    Ok(mut it) => {
      if it.next().is_none() || (p.join("Orb.exe").is_file() && p.join("uninstall.exe").is_file()) {
        Ok(())
      } else {
        Err(DirError::NotEmpty)
      }
    }
  }
}

fn norm(p: &Path) -> String {
  p.to_string_lossy().to_ascii_lowercase().trim_end_matches('\\').to_string()
}

/// True when `p` is Orb 3.8.0's folder or inside it, or holds that Orb's uninstaller.
pub fn is_electron_folder(p: &Path, electron: Option<&Path>) -> bool {
  // Any folder above counts too: a short 8.3 name, a junction or a letter case Windows treats as equal would slip past a text comparison.
  if p.ancestors().any(|a| a.join("Uninstall Orb.exe").is_file()) {
    return true;
  }
  electron.is_some_and(|e| {
    let (p, e) = (norm(p), norm(e));
    !e.is_empty() && (p == e || p.starts_with(&format!("{e}\\")))
  })
}

/// The folder the user chose, as the only thing the setup may be given: valid text, not Orb 3.8.0's folder, and empty or Orb's.
pub fn validate_target(text: &str, electron: Option<&Path>) -> Result<PathBuf, DirError> {
  let p = validate_dir(text)?;
  if is_electron_folder(&p, electron) {
    return Err(DirError::Electron);
  }
  check_existing_dir(&p)?;
  Ok(p)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn cmdline_puts_the_folder_last_and_unquoted() {
    assert_eq!(silent_cmdline(None, true), "/S");
    assert_eq!(silent_cmdline(None, false), "/S /NS");
    assert_eq!(silent_cmdline(Some(Path::new(r"D:\Mis cosas\Orb")), false), r"/S /NS /D=D:\Mis cosas\Orb");
    assert!(!silent_cmdline(Some(Path::new(r"D:\Orb")), true).contains("/R"));
  }

  #[test]
  fn exit_codes_map_to_outcomes() {
    let fail = Some((Refusal::Abierto, "3.8.0".to_string()));
    assert_eq!(classify(Some(0), None), Outcome::Installed);
    assert_eq!(classify(Some(0), fail.clone()), Outcome::Installed);
    assert_eq!(classify(Some(2), fail.clone()), Outcome::Refused { reason: Refusal::Abierto, version: "3.8.0".into() });
    // 2 without this run's file is an abort of the template (a downgrade, a program that would not close): no reason is known.
    assert_eq!(classify(Some(2), None), Outcome::Failed { code: Some(2) });
    assert_eq!(classify(Some(1), fail), Outcome::Failed { code: Some(1) });
    assert_eq!(classify(None, None), Outcome::Failed { code: None });
  }

  #[test]
  fn the_refusal_file_is_read_as_the_hooks_write_it() {
    let json = r#"{"from":"electron","version":"3.8.0","reason":"elevado","updated":0}"#;
    assert_eq!(parse_fail_file(json), Some((Refusal::Elevado, "3.8.0".into())));
    assert_eq!(parse_fail_file("\u{feff}{\"version\":\"3.8.0\",\"reason\":\"otro\"}"), Some((Refusal::Otro, "3.8.0".into())));
    assert_eq!(parse_fail_file(r#"{"reason":"invented"}"#), None);
    assert_eq!(parse_fail_file("not json"), None);
    for (w, r) in [("carpeta", Refusal::Carpeta), ("abierto", Refusal::Abierto), ("desinstalador", Refusal::Desinstalador)] {
      assert_eq!(parse_fail_file(&format!(r#"{{"version":"1","reason":"{w}"}}"#)).map(|x| x.0), Some(r));
    }
  }

  #[test]
  fn versions_shown_in_text_are_clean() {
    assert_eq!(clean_version("3.8.0"), "3.8.0");
    assert_eq!(clean_version("3.8.0\"}<b>"), "3.8.0b");
    assert_eq!(clean_version(&"9".repeat(80)).len(), 32);
  }

  #[test]
  fn an_old_refusal_file_does_not_count() {
    let start = SystemTime::now();
    assert!(is_fresh(start + Duration::from_secs(5), start));
    assert!(is_fresh(start, start));
    assert!(!is_fresh(start - Duration::from_secs(3600), start));
  }

  #[test]
  fn folders_are_validated() {
    assert_eq!(validate_dir(r"D:\Mis cosas\Orb").unwrap(), PathBuf::from(r"D:\Mis cosas\Orb"));
    assert_eq!(validate_dir(r"D:/Orb/").unwrap(), PathBuf::from(r"D:\Orb"));
    for bad in ["", "   ", "D:", r"D:\", "Orb", r"\\server\share\Orb", r"\\?\C:\Orb", r"D:\a\..\b", r"D:\a\.\b", r"D:\Orb.", r"D:\CON", r"D:\a|b", "D:\\a\"b", r"D:\x:y", "D:\\\u{7}"] {
      assert_eq!(validate_dir(bad), Err(DirError::Invalid), "{bad:?}");
    }
    assert_eq!(validate_dir(r"C:\Windows\Orb"), Err(DirError::NeedsAdmin));
    assert_eq!(validate_dir(&format!(r"C:\Windows\{}", "a".repeat(250))), Err(DirError::Invalid));
  }

  #[test]
  fn an_existing_folder_must_be_empty_or_orbs() {
    let base = std::env::temp_dir().join(format!("orb-nsis-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    assert!(check_existing_dir(&base.join("missing")).is_ok());
    std::fs::create_dir_all(base.join("empty")).unwrap();
    assert!(check_existing_dir(&base.join("empty")).is_ok());
    std::fs::create_dir_all(base.join("mine")).unwrap();
    std::fs::write(base.join("mine").join("notes.txt"), b"x").unwrap();
    assert_eq!(check_existing_dir(&base.join("mine")), Err(DirError::NotEmpty));
    std::fs::write(base.join("mine").join("Orb.exe"), b"x").unwrap();
    assert_eq!(check_existing_dir(&base.join("mine")), Err(DirError::NotEmpty), "an Orb.exe alone is not proof it is Orb's");
    std::fs::write(base.join("mine").join("uninstall.exe"), b"x").unwrap();
    assert!(check_existing_dir(&base.join("mine")).is_ok());
    let _ = std::fs::remove_dir_all(&base);
  }

  #[test]
  fn orb_3_8_0_folder_is_never_a_target() {
    let base = std::env::temp_dir().join(format!("orb-electron-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    let electron = base.join("Programs").join("Orb");
    std::fs::create_dir_all(&electron).unwrap();
    let text = |p: &Path| p.to_string_lossy().into_owned();
    // the folder itself (any case, trailing slash) and anything inside it
    assert_eq!(validate_target(&text(&electron), Some(&electron)), Err(DirError::Electron));
    assert_eq!(validate_target(&format!("{}\\", text(&electron).to_uppercase()), Some(&electron)), Err(DirError::Electron));
    assert_eq!(validate_target(&text(&electron.join("sub")), Some(&electron)), Err(DirError::Electron));
    // any folder holding 3.8.0's uninstaller, even when the registry says nothing
    std::fs::write(electron.join("Uninstall Orb.exe"), b"x").unwrap();
    assert_eq!(validate_target(&text(&electron), None), Err(DirError::Electron));
    // a subfolder of a folder that holds the uninstaller, even when the registry says nothing and the name is written differently
    assert_eq!(validate_target(&text(&electron.join("deep").join("er")), None), Err(DirError::Electron));
    // a sibling is fine; so is the same name prefix
    assert!(validate_target(&text(&base.join("Programs").join("Orb2")), Some(&electron)).is_ok());
    assert!(validate_target(&text(&base.join("Orb")), Some(&electron)).is_ok());
    let _ = std::fs::remove_dir_all(&base);
  }
}

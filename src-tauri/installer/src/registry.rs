//! What the setups left in the user's registry, read-only: the installed Orb (to open it and to confirm an installation) and
//! Orb 3.8.0 on Electron (which the setup's hooks remove before installing).
use std::path::{Path, PathBuf};
use windows_registry::CURRENT_USER;

/// The uninstall key of Orb on Tauri (the template names it after the product) and of Orb 3.8.0 (electron-builder's,
/// the same one src-tauri/nsis/hooks.nsh reads).
const ORB_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Orb";
const ELECTRON_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\c791290b-4a7b-5a24-9cba-134994a22734";

#[derive(Debug, Clone, PartialEq)]
pub struct Installed {
  pub dir: PathBuf,
  pub exe: PathBuf,
  pub version: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Electron {
  pub version: String,
  pub dir: PathBuf,
}

/// The template writes InstallLocation between quotes.
pub fn unquote(s: &str) -> &str {
  s.trim().trim_matches('"')
}

/// Orb on Tauri as the setup registered it, if its program is really there.
pub fn installed_orb() -> Option<Installed> {
  let key = CURRENT_USER.open(ORB_KEY).ok()?;
  let dir = PathBuf::from(unquote(&key.get_string("InstallLocation").ok()?));
  // The program is always Orb.exe (tauri.conf.json mainBinaryName); a name read from the registry is never started.
  let exe = dir.join("Orb.exe");
  if !dir.is_absolute() || !exe.is_file() {
    return None;
  }
  Some(Installed { dir, exe, version: key.get_string("DisplayVersion").unwrap_or_default() })
}

/// Orb 3.8.0, only when its uninstaller is where the hooks look for it (they do nothing otherwise).
pub fn electron() -> Option<Electron> {
  let key = CURRENT_USER.open(ELECTRON_KEY).ok();
  let dir = key
    .as_ref()
    .and_then(|k| k.get_string("InstallLocation").ok())
    .map(|s| PathBuf::from(unquote(&s)))
    .filter(|d| !d.as_os_str().is_empty())
    .unwrap_or_else(default_electron_dir);
  if !dir.join("Uninstall Orb.exe").is_file() {
    return None;
  }
  let version = key.and_then(|k| k.get_string("DisplayVersion").ok()).map(|v| crate::nsis::clean_version(&v)).unwrap_or_default();
  Some(Electron { version, dir })
}

pub fn default_electron_dir() -> PathBuf {
  std::env::var_os("LOCALAPPDATA").map(|l| Path::new(&l).join("Programs").join("Orb")).unwrap_or_default()
}

/// Where the setup installs by default for this user (installMode currentUser).
pub fn default_install_dir() -> PathBuf {
  std::env::var_os("LOCALAPPDATA").map(|l| Path::new(&l).join("Orb")).unwrap_or_default()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn install_location_loses_its_quotes() {
    assert_eq!(unquote("\"C:\\Users\\a\\AppData\\Local\\Orb\""), r"C:\Users\a\AppData\Local\Orb");
    assert_eq!(unquote(r"C:\Orb"), r"C:\Orb");
  }

}

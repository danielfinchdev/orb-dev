// The first start after the installer replaced Orb 3.8.0 (Electron) (src-tauri/nsis/hooks.nsh leaves the mark
// migrado-desde-electron.json in the app's data folder): what Electron leaves behind that Tauri never reads goes, and the
// window says once that Orb moved to its new base (its interface preferences, kept by Electron's Chromium, start again).
//   - Chromium's caches in %APPDATA%\Orb.dev (Cache, GPUCache, Code Cache, Partitions…) and electron-updater's download
//     folder (%LOCALAPPDATA%\orb-dev-updater, with the installer that brought 3.8.1).
//   - Never Local State (the key that opens the secret Electron sealed: secrets.rs), the copies of the keys (claves\),
//     ubicacion.json or interfaz.json, nor anything of the workspace.
// The mark is kept, renamed, as a record.
use std::path::{Path, PathBuf};

pub const MARK: &str = "migrado-desde-electron.json";
const DONE: &str = "migrado-desde-electron.hecho.json";
/// What Electron's Chromium kept in the app's data folder and Orb on Tauri never reads (its own WebView2 profile is
/// elsewhere): caches, and the agents' browser sessions of 3.8.0 (Partitions; dropping them was accepted).
const LEFTOVERS: [&str; 9] = ["Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache", "GrShaderCache", "ShaderCache", "Partitions"];

/// Done once, when the mark is there: true if it was (the window then says so). `updater_cache`: electron-updater's
/// folder, only for the real data folder (never with a separate one: tests, measurements).
pub fn after_electron(user_data: &Path, updater_cache: Option<PathBuf>) -> bool {
  let mark = user_data.join(MARK);
  if !mark.is_file() {
    return false;
  }
  for name in LEFTOVERS {
    let dir = user_data.join(name);
    // Only real folders (never through a link or junction to somewhere else).
    if std::fs::symlink_metadata(&dir).map(|m| m.is_dir()).unwrap_or(false) {
      let _ = std::fs::remove_dir_all(&dir);
    }
  }
  if let Some(cache) = updater_cache {
    if std::fs::symlink_metadata(&cache).map(|m| m.is_dir()).unwrap_or(false) {
      let _ = std::fs::remove_dir_all(&cache);
    }
  }
  let _ = std::fs::rename(&mark, user_data.join(DONE));
  true
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn after_electron_only_its_leftovers_go_once() {
    let root = std::env::temp_dir().join(format!("orb-migrate-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    let data = root.join("Orb.dev");
    let cache = root.join("orb-dev-updater");
    for d in ["Cache", "GPUCache", "Code Cache/js", "Partitions/agente", "claves", "Local Storage"] {
      std::fs::create_dir_all(data.join(d)).unwrap();
    }
    std::fs::create_dir_all(cache.join("pending")).unwrap();
    for f in ["Local State", "ubicacion.json", "interfaz.json", "claves/abc.enc", "Cache/data_0"] {
      std::fs::write(data.join(f), b"x").unwrap();
    }
    // Without the mark nothing happens.
    assert!(!after_electron(&data, Some(cache.clone())));
    assert!(data.join("Cache").exists() && cache.exists());
    std::fs::write(data.join(MARK), br#"{"from":"electron","version":"3.8.0","uninstaller":"0"}"#).unwrap();
    assert!(after_electron(&data, Some(cache.clone())));
    for gone in ["Cache", "GPUCache", "Code Cache", "Partitions"] {
      assert!(!data.join(gone).exists(), "{gone}");
    }
    assert!(!cache.exists());
    for kept in ["Local State", "ubicacion.json", "interfaz.json", "claves/abc.enc", "Local Storage", DONE] {
      assert!(data.join(kept).exists(), "{kept}");
    }
    assert!(!data.join(MARK).exists());
    // Once.
    assert!(!after_electron(&data, Some(cache.clone())));
    let _ = std::fs::remove_dir_all(&root);
  }
}

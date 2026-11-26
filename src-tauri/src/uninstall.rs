// «Desinstalar Orb», the part only the app can do: the check that its own uninstaller is there, the Recycle Bin for the
// project folders Orb made (the engine names them, this file checks both marks and the place again), and the launch of the
// uninstaller from next to Orb.exe once the data is gone. The plan and the deleting of data are the engine's
// (src/domain/data/uninstall.mjs).
use crate::delete::{checked_folder, folder_in_use, put_back, trash, InUse};
use crate::engine::Engine;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// The file a created folder carries (src/domain/projects/created-marks.mjs › MARK_FILE).
const MARK: &str = ".orb-creada";

/// The one-use code of desinstalado.json and a folder's token: 32 lowercase hex characters.
pub fn valid_code(code: &str) -> bool {
  code.len() == 32 && code.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// The folder carries exactly the token the engine named: a plain file (never a link) with one token and nothing else.
pub fn mark_ok(folder: &Path, token: &str) -> bool {
  if !valid_code(token) {
    return false;
  }
  let file = folder.join(MARK);
  let Ok(meta) = std::fs::symlink_metadata(&file) else { return false };
  if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > 100 {
    return false;
  }
  std::fs::read_to_string(&file).map(|t| t.trim() == token).unwrap_or(false)
}

/// The program's own uninstaller, beside Orb.exe (NSIS names it uninstall.exe), or None (an unpacked Orb.dev has none).
pub fn installer_beside(exe: &Path) -> Option<PathBuf> {
  let file = exe.parent()?.join("uninstall.exe");
  std::fs::symlink_metadata(&file).ok().filter(|m| m.is_file() && !m.file_type().is_symlink()).map(|_| file)
}
pub fn installer_path() -> Option<PathBuf> {
  installer_beside(&std::env::current_exe().ok()?)
}

/// What desinstalado.json must say for the code to be used: the same code, and not past its hour (`expires`, in ms).
pub fn mark_allows(text: &str, code: &str, now_ms: u128) -> bool {
  let Ok(v) = serde_json::from_str::<Value>(text) else { return false };
  v.get("code").and_then(Value::as_str) == Some(code) && v.get("expires").and_then(Value::as_u64).is_some_and(|e| u128::from(e) > now_ms)
}

/// A project folder Orb made, to the Recycle Bin. Never deleted for good here: what the Recycle Bin cannot take stays, and the
/// answer says so ({ ok: false, noTrash } or { ok: false, locked }) for the engine to stop and report.
pub async fn trash_marked(home: PathBuf, folder: String, token: String) -> Result<Value, String> {
  put_back(Path::new(&folder));
  let real = checked_folder(&home, &folder).ok_or_else(|| "carpeta no válida".to_string())?;
  if !mark_ok(&real, &token) {
    return Err("marca no válida".into());
  }
  if folder_in_use(&real) != InUse::Free {
    return Ok(json!({ "ok": false, "locked": true }));
  }
  let target = real.clone();
  let (tx, rx) = tokio::sync::oneshot::channel();
  // A thread of its own for COM (STA), as delete.rs › trash_step.
  std::thread::Builder::new().name("orb-papelera".into()).spawn(move || { let _ = tx.send(trash(&target)); }).map_err(|e| e.to_string())?;
  let trashed = rx.await.unwrap_or_else(|_| Err("papelera: el hilo terminó".into()));
  if trashed.is_err() || real.exists() {
    return Ok(json!({ "ok": false, "noTrash": true }));
  }
  Ok(json!({ "ok": true }))
}

/// The window's last step of «Desinstalar»: Orb ends (the engine first, with its agents; the vault goes with this process) and
/// the uninstaller beside Orb.exe starts with /P and /ORBPURGE=<code>. The code must be the one in desinstalado.json, written by
/// the engine when the data was gone, and not past its hour.
pub async fn launch(engine: Arc<Engine>, app: tauri::AppHandle, code: String) -> Result<(), String> {
  let bad = || engine.t("sys.main.badAction", &[]);
  if !valid_code(&code) {
    return Err(bad());
  }
  let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
  let text = std::fs::read_to_string(engine.user_data().join("desinstalado.json")).map_err(|_| bad())?;
  if !mark_allows(&text, &code, now) {
    return Err(bad());
  }
  let exe = installer_path().ok_or_else(bad)?;
  // Orb leaves first: the engine and its agents, so nothing of Orb is running when the uninstaller looks.
  engine.begin_quit();
  let e = engine.clone();
  let _ = tokio::task::spawn_blocking(move || e.shutdown(Duration::from_secs(4))).await;
  let mut cmd = std::process::Command::new(&exe);
  cmd.arg("/P").arg(format!("/ORBPURGE={code}"));
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0000_0008 | 0x0000_0200); // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
  }
  cmd.spawn().map_err(|e| e.to_string())?;
  app.exit(0);
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("orb-rs-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
  }
  const TOKEN: &str = "0123456789abcdef0123456789abcdef";

  #[test]
  fn codes_are_32_lowercase_hex() {
    assert!(valid_code(TOKEN));
    for bad in ["", "0123", "0123456789ABCDEF0123456789ABCDEF", "0123456789abcdef0123456789abcdeg", "0123456789abcdef0123456789abcdef0", "../../x"] {
      assert!(!valid_code(bad), "{bad}");
    }
  }

  #[test]
  fn a_folder_is_orbs_only_with_its_own_token() {
    let d = temp("mark");
    assert!(!mark_ok(&d, TOKEN), "no mark file");
    std::fs::write(d.join(MARK), format!("{TOKEN}\n")).unwrap();
    assert!(mark_ok(&d, TOKEN));
    assert!(!mark_ok(&d, "ffffffffffffffffffffffffffffffff"), "another token");
    assert!(!mark_ok(&d, "no-hex"), "a token that is not one");
    std::fs::write(d.join(MARK), format!("{TOKEN} y algo mas\n")).unwrap();
    assert!(!mark_ok(&d, TOKEN), "more than a token");
    std::fs::write(d.join(MARK), "x".repeat(500)).unwrap();
    assert!(!mark_ok(&d, TOKEN), "too long");
    let _ = std::fs::remove_dir_all(&d);
  }

  #[test]
  fn the_uninstaller_is_the_one_beside_the_exe() {
    let d = temp("exe");
    let exe = d.join("Orb.exe");
    std::fs::write(&exe, "x").unwrap();
    assert_eq!(installer_beside(&exe), None);
    std::fs::write(d.join("uninstall.exe"), "x").unwrap();
    assert_eq!(installer_beside(&exe), Some(d.join("uninstall.exe")));
    let _ = std::fs::remove_dir_all(&d);
  }

  #[test]
  fn the_mark_allows_its_own_code_for_an_hour() {
    let text = format!(r#"{{"v":1,"code":"{TOKEN}","expires":1000}}"#);
    assert!(mark_allows(&text, TOKEN, 999));
    assert!(!mark_allows(&text, TOKEN, 1000), "expired");
    assert!(!mark_allows(&text, "ffffffffffffffffffffffffffffffff", 10), "another code");
    assert!(!mark_allows("no json", TOKEN, 10));
    assert!(!mark_allows(r#"{"code":"x"}"#, TOKEN, 10), "no expiry");
  }
}

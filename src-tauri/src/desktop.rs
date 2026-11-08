// What Orb's window asks the app for directly, as Electron's main.mjs did (app:pick*, app:openPath, app:openExternal,
// app:feedbackCapture / app:feedbackImages): Windows' own file and folder dialogs (the page has no dialog permission:
// Rust opens them), a folder in the File Explorer (never a file to run; core and its secrets only with a fresh unlock of
// the master password, checked by the engine), a web page over https in the browser, and the window's picture and the
// pictures picked for a feedback mail.
use crate::engine;
use crate::protocol;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder};
use tauri_plugin_opener::OpenerExt;

const MAX_IMAGES: usize = 3;
const MAX_IMAGE_BYTES: u64 = 5 * 1024 * 1024;

fn dialog(window: &WebviewWindow, title: Option<String>, fallback: &str) -> FileDialogBuilder<tauri::Wry> {
  let engine = engine::get(window.app_handle());
  let title: String = title.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| engine.t(fallback, &[])).chars().take(100).collect();
  window.dialog().file().set_parent(window).set_title(title)
}

fn paths(picked: Option<Vec<tauri_plugin_dialog::FilePath>>, max: usize) -> Vec<String> {
  picked.unwrap_or_default().into_iter().filter_map(|p| p.into_path().ok()).take(max).map(|p| p.to_string_lossy().to_string()).collect()
}

pub async fn pick_folder(window: &WebviewWindow, title: Option<String>) -> Option<String> {
  let picked = dialog(window, title, "sys.dialog.pickFolder").set_can_create_directories(true).blocking_pick_folder();
  picked.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string())
}

/// Agentes › Ruta del programa: the agent's program, chosen instead of typed.
pub async fn pick_program(window: &WebviewWindow, title: Option<String>) -> Option<String> {
  let engine = engine::get(window.app_handle());
  let picked = dialog(window, title, "sys.dialog.pickProgram")
    .add_filter(engine.t("sys.dialog.programs", &[]), &["exe", "cmd", "bat", "ps1", "js", "mjs", "cjs"])
    .add_filter(engine.t("sys.dialog.allFiles", &[]), &["*"])
    .blocking_pick_file();
  picked.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string())
}

/// The Pizarra's attachments: any files, up to 20 at a time.
pub async fn pick_files(window: &WebviewWindow, title: Option<String>) -> Vec<String> {
  paths(dialog(window, title, "sys.dialog.pickFiles").blocking_pick_files(), 20)
}

/// Pictures for an agent's message: up to 10.
pub async fn pick_images(window: &WebviewWindow) -> Vec<String> {
  let engine = engine::get(window.app_handle());
  let picked = dialog(window, None, "sys.dialog.refImages").add_filter(engine.t("sys.dialog.images", &[]), &["png", "jpg", "jpeg", "gif", "webp", "bmp"]).blocking_pick_files();
  paths(picked, 10)
}

/// A PNG or JPEG of at most 5 MB, by its first bytes (not its extension), as src/engine/feedback.mjs › readImage.
pub fn read_image(file: &Path) -> Option<Value> {
  use base64::Engine as _;
  let meta = std::fs::metadata(file).ok()?;
  if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_IMAGE_BYTES {
    return None;
  }
  let bytes = std::fs::read(file).ok()?;
  let kind = image_kind(&bytes)?;
  let name: String = file.file_name()?.to_string_lossy().chars().take(80).collect();
  Some(json!({ "name": name, "type": kind, "data": base64::engine::general_purpose::STANDARD.encode(&bytes) }))
}

pub fn image_kind(b: &[u8]) -> Option<&'static str> {
  if b.len() > 8 && b.starts_with(&[0x89, b'P', b'N', b'G']) {
    Some("image/png")
  } else if b.len() > 3 && b.starts_with(&[0xff, 0xd8, 0xff]) {
    Some("image/jpeg")
  } else {
    None
  }
}

pub async fn feedback_images(window: &WebviewWindow) -> Vec<Value> {
  let picked = window.dialog().file().set_parent(window).add_filter("PNG / JPEG", &["png", "jpg", "jpeg"]).blocking_pick_files();
  picked.unwrap_or_default().into_iter().filter_map(|p| p.into_path().ok()).take(MAX_IMAGES).filter_map(|p| read_image(&p)).collect()
}

/// The window's picture (PNG, base64); the page makes it at most 1920 px wide and names it.
pub async fn feedback_capture(window: &WebviewWindow) -> Result<Option<String>, String> {
  use base64::Engine as _;
  let png = crate::webview::capture(window).await?;
  if png.is_empty() || png.len() as u64 > MAX_IMAGE_BYTES * 4 {
    return Ok(None);
  }
  Ok(Some(base64::engine::general_purpose::STANDARD.encode(png)))
}

/// A path as Windows resolves it (a junction, a short 8.3 name or the \\?\ prefix lead to the same folder), lower case.
fn real_lower(p: &Path) -> String {
  let r = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
  let s = r.to_string_lossy().to_string();
  s.strip_prefix("\\\\?\\").unwrap_or(&s).trim_end_matches('\\').to_lowercase()
}

/// core itself (all of it at once) and its secrets: only with a fresh unlock of the master password. Its tool folders
/// (MCP servers, adb, logs) open as before.
pub fn guarded(home: Option<&Path>, target: &Path) -> bool {
  let Some(home) = home else { return false };
  let core = home.join("core");
  protocol::guarded_core(&real_lower(target), &real_lower(&core), &real_lower(&core.join("secretos")))
}

pub async fn open_path(window: &WebviewWindow, target: String, unlock: Option<String>) -> Result<bool, String> {
  let engine = engine::get(window.app_handle());
  if !protocol::local_path(&target) {
    return Err(engine.t("sys.main.badPath", &[]));
  }
  let path = PathBuf::from(&target);
  if guarded(engine.home().as_deref(), &path) {
    engine.call("master.check", json!({ "unlock": unlock.unwrap_or_default() }), Duration::from_secs(10)).await?;
  }
  let meta = std::fs::metadata(&path).map_err(|_| engine.t("sys.main.folderMissing", &[]))?;
  if !meta.is_dir() {
    return Err(engine.t("sys.main.foldersOnly", &[])); // never run a file
  }
  window.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())?;
  Ok(true)
}

pub fn open_external(window: &WebviewWindow, url: String) -> Result<bool, String> {
  let engine = engine::get(window.app_handle());
  let u = tauri::Url::parse(&url).map_err(|_| engine.t("sys.main.badLink", &[]))?;
  if u.scheme() != "https" {
    return Err(engine.t("sys.main.httpsOnly", &[]));
  }
  window.opener().open_url(u.as_str(), None::<&str>).map_err(|e| e.to_string())?;
  Ok(true)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn feedback_pictures_by_their_bytes() {
    assert_eq!(image_kind(b"\x89PNG\r\n\x1a\n0000"), Some("image/png"));
    assert_eq!(image_kind(b"\xff\xd8\xff\xe0xx"), Some("image/jpeg"));
    assert_eq!(image_kind(b"GIF89a....."), None);
    let dir = std::env::temp_dir().join(format!("orb-imagenes-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("a.png"), b"\x89PNG\r\n\x1a\nresto").unwrap();
    std::fs::write(dir.join("falsa.png"), b"<script>").unwrap();
    std::fs::write(dir.join("vacia.jpg"), b"").unwrap();
    let a = read_image(&dir.join("a.png")).unwrap();
    assert_eq!((a["name"].as_str(), a["type"].as_str()), (Some("a.png"), Some("image/png")));
    assert!(read_image(&dir.join("falsa.png")).is_none());
    assert!(read_image(&dir.join("vacia.jpg")).is_none());
    assert!(read_image(&dir).is_none());
    let _ = std::fs::remove_dir_all(dir);
  }

  #[test]
  fn core_and_its_secrets_are_guarded_by_their_real_path() {
    let home = std::env::temp_dir().join(format!("orb-guardado-{}", std::process::id()));
    std::fs::create_dir_all(home.join("core").join("secretos").join("x")).unwrap();
    std::fs::create_dir_all(home.join("core").join("mcp")).unwrap();
    let h = Some(home.as_path());
    assert!(guarded(h, &home.join("core")));
    assert!(guarded(h, &home.join("CORE").join("secretos")));
    assert!(guarded(h, &home.join("core").join("secretos").join("x")));
    assert!(guarded(h, &home.join("core").join("mcp").join("..").join("secretos")));
    assert!(!guarded(h, &home.join("core").join("mcp")));
    assert!(!guarded(h, &home));
    assert!(!guarded(None, &home.join("core")));
    let _ = std::fs::remove_dir_all(home);
  }
}

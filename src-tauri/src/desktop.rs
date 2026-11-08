// What Orb's window asks the app for directly, as Orb 3.8.0 did (app:pick*, app:openPath, app:openExternal,
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
  let (secrets, data) = (real_lower(&core.join("secretos")), real_lower(&core.join("datos")));
  protocol::guarded_core(&real_lower(target), &real_lower(&core), &[&secrets, &data])
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
    assert!(guarded(h, &home.join("core").join("datos")));
    assert!(guarded(h, &home.join("core").join("datos").join("copias")));
    assert!(!guarded(h, &home.join("core").join("datosx")));
    assert!(!guarded(h, &home.join("core").join("mcp")));
    assert!(!guarded(h, &home));
    assert!(!guarded(None, &home.join("core")));
    let _ = std::fs::remove_dir_all(home);
  }
}

/// Orb on Electron (3.8.0 or earlier, still installed) open with this same data folder: Chromium's single-instance lock
/// is a message-only window of class Chrome_MessageWindow named after the data folder. Tauri's own lock does not see it,
/// and two engines on one workspace would step on each other (the engine also keeps a lock of its own: engine.mjs).
/// The window that guard_against_electron leaves (this Orb's, or another Tauri Orb's: the same program) is not Electron.
#[cfg(windows)]
pub fn electron_running(user_data: &std::path::Path) -> bool {
  use windows::core::{w, HSTRING};
  use windows::Win32::UI::WindowsAndMessaging::{FindWindowExW, HWND_MESSAGE};
  let name = HSTRING::from(user_data.as_os_str());
  let mut after = None;
  loop {
    // SAFETY: two valid wide strings for the length of the call; `after` is a window this loop found.
    let Ok(h) = (unsafe { FindWindowExW(Some(HWND_MESSAGE), after, w!("Chrome_MessageWindow"), &name) }) else { return false };
    if h.is_invalid() {
      return false;
    }
    if !same_program(h) {
      return true;
    }
    after = Some(h);
  }
}
#[cfg(not(windows))]
pub fn electron_running(_: &std::path::Path) -> bool {
  false
}

/// Whether a window belongs to this Orb's own program (this process, or another start of the same Orb.exe).
#[cfg(windows)]
fn same_program(h: windows::Win32::Foundation::HWND) -> bool {
  use windows::core::PWSTR;
  use windows::Win32::Foundation::CloseHandle;
  use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
  use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
  let mut pid = 0u32;
  // SAFETY: a window handle (it may be gone: then pid stays 0) and a valid out pointer.
  unsafe { GetWindowThreadProcessId(h, Some(&mut pid)) };
  if pid == 0 {
    return false;
  }
  if pid == std::process::id() {
    return true;
  }
  let Ok(me) = std::env::current_exe() else { return false };
  // SAFETY: query-only access; the handle is closed below.
  let Ok(process) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }) else { return false };
  let mut buf = [0u16; 1024];
  let mut len = buf.len() as u32;
  // SAFETY: a buffer of `len` wide characters; the call writes at most that many and sets `len`.
  let ok = unsafe { QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len) }.is_ok();
  // SAFETY: the handle opened above.
  unsafe { CloseHandle(process).ok() };
  ok && String::from_utf16_lossy(&buf[..len as usize]).eq_ignore_ascii_case(&me.to_string_lossy())
}

/// 3.8.1 (review Tauri D-fix M5): Orb 3.8.0 (Electron) opened AFTER this Orb never starts. This Orb leaves the same
/// message-only window Chromium's single-instance lock looks for (class Chrome_MessageWindow, named after the data
/// folder), on a thread of its own: Electron's requestSingleInstanceLock finds it, sends it its command line
/// (WM_COPYDATA), gets «received» and quits, as when the same Electron app is opened twice; this Orb comes to the front
/// instead (`knock`). Answered at once, so Chromium never takes it for a hung window.
#[cfg(windows)]
pub fn guard_against_electron(user_data: &std::path::Path, knock: impl Fn() + Send + Sync + 'static) -> bool {
  use std::sync::OnceLock;
  use windows::core::{w, HSTRING};
  use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
  use windows::Win32::System::LibraryLoader::GetModuleHandleW;
  use windows::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW, TranslateMessage, HWND_MESSAGE, MSG, WINDOW_EX_STYLE, WINDOW_STYLE, WM_COPYDATA, WNDCLASSW};
  static KNOCK: OnceLock<Box<dyn Fn() + Send + Sync>> = OnceLock::new();
  if KNOCK.set(Box::new(knock)).is_err() {
    return false; // once per process
  }
  extern "system" fn proc(h: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    if msg == WM_COPYDATA {
      if let Some(k) = KNOCK.get() {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| k()));
      }
      return LRESULT(1);
    }
    // SAFETY: the default handling of a message of this window.
    unsafe { DefWindowProcW(h, msg, w, l) }
  }
  let name = HSTRING::from(user_data.as_os_str());
  let (tx, rx) = std::sync::mpsc::channel();
  let spawned = std::thread::Builder::new().name("orb-instancia-electron".into()).spawn(move || {
    // SAFETY: a class with a static name and a window procedure that live for the whole process; a message-only window
    // owned by this thread, whose messages this loop dispatches until the process ends.
    unsafe {
      let instance = GetModuleHandleW(None).unwrap_or_default();
      let class = WNDCLASSW { lpfnWndProc: Some(proc), hInstance: instance.into(), lpszClassName: w!("Chrome_MessageWindow"), ..Default::default() };
      RegisterClassW(&class);
      let made = CreateWindowExW(WINDOW_EX_STYLE(0), w!("Chrome_MessageWindow"), &name, WINDOW_STYLE(0), 0, 0, 0, 0, Some(HWND_MESSAGE), None, Some(instance.into()), None);
      let _ = tx.send(made.is_ok());
      if made.is_err() {
        return;
      }
      let mut msg = MSG::default();
      while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
        let _ = TranslateMessage(&msg);
        DispatchMessageW(&msg);
      }
    }
  });
  spawned.is_ok() && rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap_or(false)
}
#[cfg(not(windows))]
pub fn guard_against_electron(_: &std::path::Path, _: impl Fn() + Send + Sync + 'static) -> bool {
  false
}

#[cfg(all(test, windows))]
mod electron_tests {
  /// The Electron of Orb 3.8.0 (44.5.1, the one it ships), without a window: ORB_TEST_ELECTRON, or
  /// <ORB_BUILD_CACHE>\electron-44.5.1\electron.exe (Electron is not a dependency of this repository). None: skipped.
  fn test_electron() -> Option<std::path::PathBuf> {
    let cache = std::env::var_os("ORB_BUILD_CACHE").map(std::path::PathBuf::from).or_else(|| std::env::var_os("LOCALAPPDATA").map(|d| std::path::PathBuf::from(d).join("orb-build-cache")));
    std::env::var_os("ORB_TEST_ELECTRON").map(std::path::PathBuf::from).or_else(|| cache.map(|c| c.join("electron-44.5.1").join("electron.exe"))).filter(|p| p.exists())
  }

  /// The real Electron of Orb 3.8.0 (test_electron), with no window, holding its single-instance lock in
  /// a throwaway data folder: seen; another folder is not. Skipped where that Electron is not there.
  #[test]
  fn an_open_electron_orb_is_seen_by_its_data_folder() {
    let Some(electron) = test_electron() else {
      eprintln!("sin el Electron de la 3.8.0 (ORB_TEST_ELECTRON o la caché de compilación): prueba omitida");
      return;
    };
    let dir = std::env::temp_dir().join(format!("orb-instancia-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("datos")).unwrap();
    let script = dir.join("uno.cjs");
    std::fs::write(&script, "const { app } = require('electron'); app.setPath('userData', process.env.ORB_TEST_DATA); if (!app.requestSingleInstanceLock()) app.quit(); setInterval(() => {}, 1000);").unwrap();
    let data = dir.join("datos");
    assert!(!super::electron_running(&data));
    let mut child = std::process::Command::new(&electron).arg(&script).env("ORB_TEST_DATA", &data).env_remove("ELECTRON_RUN_AS_NODE").spawn().unwrap();
    let mut seen = false;
    for _ in 0..100 {
      if super::electron_running(&data) {
        seen = true;
        break;
      }
      std::thread::sleep(std::time::Duration::from_millis(100));
    }
    assert!(!super::electron_running(&dir), "otra carpeta");
    let _ = child.kill();
    let _ = child.wait();
    assert!(seen, "la ventana de instancia única de Electron");
    let _ = std::fs::remove_dir_all(&dir);
  }

  /// Review D-fix M5: with this Orb's guard window for a data folder, the real Electron (Orb 3.8.0's) started afterwards
  /// on that folder does not get its single-instance lock and quits; this Orb is told (to come to the front). And the
  /// guard is not taken for an Electron by this same program.
  #[test]
  fn electron_opened_afterwards_quits_and_this_orb_is_told() {
    let Some(electron) = test_electron() else {
      eprintln!("sin el Electron de la 3.8.0 (ORB_TEST_ELECTRON o la caché de compilación): prueba omitida");
      return;
    };
    let dir = std::env::temp_dir().join(format!("orb-guarda-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("datos")).unwrap();
    let data = dir.join("datos");
    let knocked = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let k = knocked.clone();
    assert!(super::guard_against_electron(&data, move || k.store(true, std::sync::atomic::Ordering::SeqCst)));
    assert!(!super::electron_running(&data), "la ventana de este Orb no es un Electron");
    let script = dir.join("dos.cjs");
    std::fs::write(&script, "const { app } = require('electron'); const fs = require('fs'); app.setPath('userData', process.env.ORB_TEST_DATA); fs.writeFileSync(process.env.ORB_TEST_OUT, String(app.requestSingleInstanceLock())); app.quit();").unwrap();
    let out = dir.join("candado.txt");
    let mut child = std::process::Command::new(&electron).arg(&script).env("ORB_TEST_DATA", &data).env("ORB_TEST_OUT", &out).env_remove("ELECTRON_RUN_AS_NODE").spawn().unwrap();
    let mut done = None;
    for _ in 0..200 {
      if let Ok(Some(status)) = child.try_wait() {
        done = Some(status);
        break;
      }
      std::thread::sleep(std::time::Duration::from_millis(100));
    }
    if done.is_none() {
      let _ = child.kill();
      let _ = child.wait();
    }
    assert!(done.is_some(), "Electron termina solo");
    assert_eq!(std::fs::read_to_string(&out).unwrap_or_default(), "false", "sin el candado de instancia única");
    assert!(knocked.load(std::sync::atomic::Ordering::SeqCst), "este Orb se entera");
    let _ = std::fs::remove_dir_all(&dir);
  }
}

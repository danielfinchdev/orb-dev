// The little always-on-top window of the agents' browser (src/ui/pip.html), as Electron's: in the top-right corner of the
// screen Orb is on, never in the taskbar, never taking the focus. The engine decides when it shows and what it says
// (src/engine/host-browser.mjs: host.pip.show / hide / state / frame); its buttons come back here (pip_action) and go to
// the engine, except «go to Orb», done here. It lives in Orb's own WebView2 environment (same data folder and arguments
// as the main window, which WebView2 requires), with its own capability: it may only listen to its events and call
// pip_action.
// In a test build whose windows are never shown (ORB_HIDDEN_WINDOW), it is made and fed but never shown.
use crate::browser_rules::{BrowserRequest, PIP_SIZES};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub struct Pip {
  webview_data: PathBuf,
  args: String,
  state: Mutex<Option<Value>>,
  mode: Mutex<String>,
  trace: Mutex<()>,
}

pub fn init(app: &AppHandle, webview_data: PathBuf, args: String) {
  app.manage(Pip { webview_data, args, state: Mutex::new(None), mode: Mutex::new("normal".into()), trace: Mutex::new(()) });
}

const LABEL: &str = "pip";
const MARGIN: f64 = 18.0;

fn size_of(mode: &str) -> (f64, f64) {
  PIP_SIZES.iter().find(|(n, _, _)| *n == mode).map(|(_, w, h)| (*w, *h)).unwrap_or((400.0, 292.0))
}

/// Top-right corner of the work area of the screen Orb's window is on.
fn corner(app: &AppHandle, w: f64, h: f64) -> Option<(PhysicalPosition<i32>, PhysicalSize<u32>)> {
  let main = app.get_webview_window("main")?;
  let monitor = main.current_monitor().ok().flatten().or_else(|| main.primary_monitor().ok().flatten())?;
  let scale = monitor.scale_factor();
  let wa = monitor.work_area();
  let size = PhysicalSize::new((w * scale).round() as u32, (h * scale).round() as u32);
  let x = wa.position.x + wa.size.width as i32 - size.width as i32 - (MARGIN * scale).round() as i32;
  let y = wa.position.y + (MARGIN * scale).round() as i32;
  Some((PhysicalPosition::new(x, y), size))
}

fn window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
  if let Some(w) = app.get_webview_window(LABEL) {
    return Ok(w);
  }
  let pip = app.state::<Pip>();
  let mode = pip.mode.lock().unwrap().clone();
  let (w, h) = size_of(&mode);
  let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("pip.html".into()))
    .title("Orb")
    .inner_size(w, h)
    .min_inner_size(240.0, 46.0)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(true)
    .minimizable(false)
    .maximizable(false)
    .focused(false)
    .visible(false)
    .background_color(tauri::window::Color(0x11, 0x13, 0x1c, 255))
    .data_directory(pip.webview_data.clone())
    .additional_browser_args(&pip.args)
    .zoom_hotkeys_enabled(false)
    .disable_drag_drop_handler()
    .on_navigation(crate::window::own_page)
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
    .on_page_load(|w, payload| {
      if payload.event() == PageLoadEvent::Finished {
        // The page asks nothing: it gets the last state as soon as it is there.
        if let Some(s) = w.app_handle().state::<Pip>().state.lock().unwrap().clone() {
          let _ = w.emit_to(LABEL, "pip:state", s);
        }
      }
    })
    .build()?;
  crate::webview::setup(&window);
  if let Some((pos, _)) = corner(app, w, h) {
    let _ = window.set_position(pos);
  }
  Ok(window)
}

/// Shown without taking the focus from whatever the user is doing.
fn show_inactive(w: &WebviewWindow) {
  #[cfg(windows)]
  if let Ok(hwnd) = w.hwnd() {
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
    unsafe {
      let _ = ShowWindow(windows::Win32::Foundation::HWND(hwnd.0), SW_SHOWNOACTIVATE);
    }
    return;
  }
  let _ = w.show();
}

/// What the little window does, for the e2e build that never shows it (a line per change, without the pictures).
fn trace(app: &AppHandle, line: Value) {
  if !crate::window::hidden(app) {
    return;
  }
  let file = crate::engine::get(app).user_data().join("pip-e2e.jsonl");
  let pip = app.state::<Pip>();
  let _one = pip.trace.lock().unwrap(); // one line at a time
  if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(file) {
    use std::io::Write;
    let _ = f.write_all(format!("{line}
").as_bytes());
  }
}

pub async fn handle(app: &AppHandle, req: BrowserRequest) -> Result<Value, String> {
  match req {
    BrowserRequest::PipShow(mode) => {
      let pip = app.state::<Pip>();
      let old = std::mem::replace(&mut *pip.mode.lock().unwrap(), mode.clone());
      let w = window(app).map_err(|e| e.to_string())?;
      let (width, height) = size_of(&mode);
      // A new size keeps the window's top-right corner where it is.
      if old != mode {
        if let (Ok(pos), Ok(size)) = (w.outer_position(), w.outer_size()) {
          let scale = w.scale_factor().unwrap_or(1.0);
          let new = PhysicalSize::new((width * scale).round() as u32, (height * scale).round() as u32);
          let _ = w.set_size(new);
          let _ = w.set_position(PhysicalPosition::new(pos.x + size.width as i32 - new.width as i32, pos.y));
        }
      }
      trace(app, json!({ "show": mode, "visible": !crate::window::hidden(app) }));
      if !crate::window::hidden(app) && !w.is_visible().unwrap_or(false) {
        show_inactive(&w);
      }
      Ok(json!(true))
    }
    BrowserRequest::PipHide => {
      trace(app, json!({ "hide": true }));
      if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.hide();
      }
      Ok(json!(true))
    }
    BrowserRequest::PipState(state) => {
      *app.state::<Pip>().state.lock().unwrap() = Some(state.clone());
      trace(app, json!({ "state": state }));
      let _ = app.emit_to(LABEL, "pip:state", state);
      Ok(json!(true))
    }
    BrowserRequest::PipFrame(data) => {
      trace(app, json!({ "frame": data.len() }));
      if app.get_webview_window(LABEL).is_some() {
        let _ = app.emit_to(LABEL, "pip:frame", format!("data:image/jpeg;base64,{data}"));
        // The emit is only queued for Orb's UI thread (a script of ~100–200 KB for the little window). The engine sends
        // the next picture when this one is answered: answered once the UI thread has got through it (a no-op queued
        // after it), so pictures never pile up there and Orb's window keeps answering (the flood measurements showed
        // a growing backlog of 0.1 → 1.4 s stalls). At most 2 s: a busy UI drops pictures, never the other way round.
        let (tx, rx) = tokio::sync::oneshot::channel();
        if app.run_on_main_thread(move || { let _ = tx.send(()); }).is_ok() {
          let _ = tokio::time::timeout(std::time::Duration::from_secs(2), rx).await;
        }
      }
      Ok(json!(true))
    }
    _ => Err("navegador: petición desconocida".into()),
  }
}

/// A button of the little window: «go to Orb» here, the rest to the engine (sizes, close until the next activity).
pub fn action(app: &AppHandle, action: &str) -> Result<(), String> {
  match action {
    "app" => {
      if let Some(w) = app.get_webview_window("main") {
        if !crate::window::hidden(app) {
          let _ = w.unminimize();
          let _ = w.show();
          let _ = w.set_focus();
        }
      }
      Ok(())
    }
    "normal" | "grande" | "pildora" | "cerrar" | "loaded" => {
      let engine = crate::engine::get(app);
      let a = action.to_string();
      tauri::async_runtime::spawn(async move {
        let _ = engine.request("pip", json!({ "action": a }), std::time::Duration::from_secs(5)).await;
      });
      Ok(())
    }
    _ => Err("acción no válida".into()),
  }
}

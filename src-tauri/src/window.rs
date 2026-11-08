// Orb's window: no Windows title bar (the app draws its own minimise / maximise / close and moves the window by its top
// bars: src/ui/lib/tauri-bridge.js), the size of the interface (interfaz.json), the theme's background before the page
// paints, only Orb's own pages, and the question before closing with tasks running. As Orb 3.8.0 did.
use crate::engine::{self, Engine};
use crate::protocol;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, Theme, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

pub struct Ui {
  zoom: Mutex<f64>,
  interface_file: PathBuf,
  hidden: bool,
  closing: AtomicBool,
  maximized: AtomicBool,
}

/// What a test or measurement build (`--features e2e`) may ask: the window's DevTools port and a window that is never
/// shown. Only with a separate data folder (ORB_USER_DATA), so it never touches a real profile. A normal build has
/// neither.
pub struct E2e {
  pub cdp_port: Option<u16>,
  pub hidden: bool,
}

pub fn e2e(separate_data: bool) -> E2e {
  // Compiled only into the e2e build: the release binary does not even hold these names (checked before a release by
  // scripts/tauri-check-release.mjs).
  #[cfg(feature = "e2e")]
  if separate_data {
    return E2e {
      cdp_port: std::env::var("ORB_E2E_CDP_PORT").ok().and_then(|p| p.parse().ok()),
      hidden: std::env::var("ORB_HIDDEN_WINDOW").as_deref() == Ok("1"),
    };
  }
  let _ = separate_data;
  E2e { cdp_port: None, hidden: false }
}

const DARK: (u8, u8, u8) = (0x16, 0x15, 0x1d);
const LIGHT: (u8, u8, u8) = (0xfb, 0xfb, 0xfe);

pub fn create_main(app: &AppHandle, user_data: &std::path::Path, webview_data: PathBuf, e2e: E2e) -> tauri::Result<()> {
  let interface_file = user_data.join("interfaz.json");
  let zoom = protocol::read_zoom(&std::fs::read_to_string(&interface_file).unwrap_or_default());
  app.manage(Ui { zoom: Mutex::new(zoom), interface_file, hidden: e2e.hidden, closing: AtomicBool::new(false), maximized: AtomicBool::new(false) });
  let shown = Arc::new(AtomicBool::new(false));
  let on_load = shown.clone();
  let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
    .title("Orb")
    .inner_size(1360.0, 880.0)
    .min_inner_size(400.0, 560.0)
    .decorations(false)
    .shadow(true)
    .visible(false)
    .data_directory(webview_data)
    .additional_browser_args(&protocol::browser_args(e2e.cdp_port))
    .zoom_hotkeys_enabled(false)
    // The page's own drag and drop (the sidebar, the Pizarra) keeps working; dropped files are handled in a later step.
    .disable_drag_drop_handler()
    // Only Orb's pages in this window; a link that opens a new window goes to the browser if it is https.
    // Exactly http://tauri.localhost/ (its default port): another port of *.localhost is loopback, where an agent's dev
    // server may listen.
    .on_navigation(own_page)
    .on_new_window(|url, _features| {
      if url.scheme() == "https" {
        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
      }
      tauri::webview::NewWindowResponse::Deny
    })
    .on_page_load(move |w, payload| {
      if payload.event() == PageLoadEvent::Finished {
        apply_zoom(w.app_handle());
        if !w.app_handle().state::<Ui>().hidden && !on_load.swap(true, Ordering::SeqCst) {
          let _ = w.show();
        }
      }
    })
    .build()?;
  // WebView2's own settings (permissions denied, no autofill, files' paths) and Windows' lock / sleep → master.lock.
  crate::webview::setup(&window);
  crate::power::watch(&window);
  let (r, g, b) = if window.theme().ok() == Some(Theme::Dark) { DARK } else { LIGHT };
  let _ = window.set_background_color(Some(tauri::window::Color(r, g, b, 255)));
  // Shown anyway if the page takes long to load (a broken page must not leave Orb invisible).
  if !e2e.hidden {
    let w = window.clone();
    tauri::async_runtime::spawn(async move {
      tokio::time::sleep(Duration::from_secs(4)).await;
      if !shown.swap(true, Ordering::SeqCst) {
        let _ = w.show();
      }
    });
  }
  let w = window.clone();
  window.on_window_event(move |event| match event {
    WindowEvent::Resized(_) => send_state(&w),
    WindowEvent::CloseRequested { api, .. } => {
      if close_now(&w) {
        return;
      }
      api.prevent_close();
      ask_before_closing(w.clone());
    }
    _ => {}
  });
  Ok(())
}

/// One of Orb's own pages: exactly http://tauri.localhost/ (its default port; another port of *.localhost is loopback,
/// where an agent's dev server may listen), or Tauri's own scheme.
pub fn own_page(url: &tauri::Url) -> bool {
  (url.scheme() == "http" && url.host_str() == Some("tauri.localhost") && url.port().is_none()) || url.scheme() == "tauri"
}

/// A test build whose window is never shown (nobody at the PC): its notices go to a file instead of the screen.
pub fn hidden(app: &AppHandle) -> bool {
  app.try_state::<Ui>().map(|ui| ui.hidden).unwrap_or(false)
}

pub fn set_title(app: &AppHandle, name: Option<&str>) {
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.set_title(name.filter(|n| !n.trim().is_empty()).unwrap_or("Orb"));
  }
}

/// The page hears when the window is maximised or restored (its own buttons change).
fn send_state(w: &WebviewWindow) {
  let maximized = w.is_maximized().unwrap_or(false);
  let ui = w.app_handle().state::<Ui>();
  if ui.maximized.swap(maximized, Ordering::SeqCst) != maximized {
    let _ = w.emit_to("main", "app:window-state", json!({ "maximized": maximized }));
  }
}

pub fn act(w: &WebviewWindow, action: &str) -> Result<Value, String> {
  match action {
    "minimize" => w.minimize().map_err(|e| e.to_string())?,
    "maximize" => {
      if w.is_maximized().unwrap_or(false) {
        w.unmaximize().map_err(|e| e.to_string())?
      } else {
        w.maximize().map_err(|e| e.to_string())?
      }
    }
    "close" => w.close().map_err(|e| e.to_string())?,
    "fullscreen" => w.set_fullscreen(!w.is_fullscreen().unwrap_or(false)).map_err(|e| e.to_string())?,
    "state" => {}
    _ => return Err("acción de ventana desconocida".into()),
  }
  Ok(json!({ "maximized": w.is_maximized().unwrap_or(false) }))
}

pub fn zoom(app: &AppHandle) -> f64 {
  *app.state::<Ui>().zoom.lock().unwrap()
}

fn apply_zoom(app: &AppHandle) {
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.set_zoom(zoom(app) * protocol::ZOOM_BASE);
  }
}

pub fn set_zoom(app: &AppHandle, value: f64) -> f64 {
  let ui = app.state::<Ui>();
  let z = protocol::clamp_zoom(value);
  *ui.zoom.lock().unwrap() = z;
  apply_zoom(app);
  let _ = app.emit_to("main", "engine:event", json!({ "event": "ui:zoom", "payload": { "zoom": z } }));
  if let Some(dir) = ui.interface_file.parent() {
    let _ = std::fs::create_dir_all(dir);
  }
  let _ = std::fs::write(&ui.interface_file, json!({ "zoom": z }).to_string());
  z
}

/// Closing goes ahead without asking: Orb is already quitting, or there is no engine to ask, or it has not started (no
/// task can be running yet; asking would wait for a start that may never end).
fn close_now(w: &WebviewWindow) -> bool {
  let engine = engine::get(w.app_handle());
  engine.quitting() || !engine.is_running() || !matches!(engine.status(), engine::Status::Ready(_))
}

/// With tasks running, Windows' question first (a second click on the X while it is open does not ask twice).
fn ask_before_closing(w: WebviewWindow) {
  let app = w.app_handle().clone();
  if app.state::<Ui>().closing.swap(true, Ordering::SeqCst) {
    return;
  }
  let engine: Arc<Engine> = engine::get(&app);
  tauri::async_runtime::spawn(async move {
    let running = engine.call("app.state", json!({}), Duration::from_secs(5)).await.ok().and_then(|v| v.pointer("/counts/running").and_then(Value::as_u64)).unwrap_or(0);
    if running > 0 {
      let message = engine.t(if running == 1 { "sys.dialog.closeOne" } else { "sys.dialog.closeMany" }, &[("n", running.to_string())]);
      let (tx, rx) = tokio::sync::oneshot::channel();
      app
        .dialog()
        .message(message)
        .title(engine.t("sys.dialog.runningTitle", &[]))
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(engine.t("sys.dialog.closeAnyway", &[]), engine.t("sys.dialog.cancel", &[])))
        .parent(&w)
        .show(move |ok| {
          let _ = tx.send(ok);
        });
      let ok = rx.await.unwrap_or(false);
      app.state::<Ui>().closing.store(false, Ordering::SeqCst);
      if !ok {
        return;
      }
    }
    engine.begin_quit();
    app.exit(0);
  });
}

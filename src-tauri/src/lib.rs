// Orb on Tauri 2. Windows: one window with the React interface (src/renderer), the engine in its own Node process
// (engine.rs) and a narrow, checked bridge between them: the window may call only these commands, and only from Orb's
// own window (capabilities/main.json and a check of the window's label in each one).
// Android (mobile.rs) is a thin client of the PC with its own native bits: none of the desktop's modules or commands.
#[cfg(any(mobile, test))] // also in desktop tests: mobile.rs › own_page
mod mobile;
#[cfg(mobile)]
pub use mobile::run;
// The phone's end-to-end encryption, the same as src/core/mobile-crypto.mjs (Android's notification buttons use it).
mod phone_crypto;

/// Everything below is the desktop app only (one #[cfg(desktop)] per item, so the items keep their paths).
macro_rules! desktop_only {
  ($($item:item)*) => { $(#[cfg(desktop)] $item)* };
}

desktop_only! {
mod browser;
mod browser_rules;
mod delete;
mod desktop;
mod engine;
mod host;
mod migrate;
mod notify;
mod pip;
mod pipes;
mod power;
mod protocol;
mod secrets;
mod tools;
mod trace;
mod updater;
mod vault_host;
mod webview;
mod window;

use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager, RunEvent, WebviewWindow};

// %APPDATA%\Orb.dev: the app's data folder of every Orb since 2.3 (src/core/product.mjs › dataDir), also under Tauri, so
// the location of the workspace, the interface's size and the copies of the keys stay where they are.
const DATA_DIR: &str = "Orb.dev";
/// The app, for what runs outside Tauri's own callbacks (desktop.rs › guard_against_electron).
static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();
/// The window that stops an earlier Orb could not be made (review D10 B13): written to the engine's log once it exists.
static GUARD_FAILED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn only_main(window: &WebviewWindow) -> Result<(), String> {
  if window.label() == "main" {
    Ok(())
  } else {
    Err("origen no permitido".into())
  }
}

#[tauri::command]
async fn engine_call(window: WebviewWindow, method: String, params: Option<Value>) -> Result<Value, String> {
  only_main(&window)?;
  let engine = engine::get(window.app_handle());
  if !protocol::valid_method(&method) {
    return Err(engine.t("sys.main.badAction", &[]));
  }
  engine.call(&method, params.unwrap_or_else(|| json!({})), Duration::from_secs(10 * 60)).await
}

#[tauri::command]
async fn app_info(window: WebviewWindow) -> Result<Value, String> {
  only_main(&window)?;
  let app = window.app_handle();
  let engine = engine::get(app);
  // The workspace is known once the engine has looked for it (a moment after Orb starts).
  let mut rx = engine.status_watch();
  let _ = tokio::time::timeout(Duration::from_secs(30), rx.wait_for(|s| !matches!(s, engine::Status::Booting))).await;
  let home = engine.home();
  let status = engine.status();
  // The first-run setup only when the engine said there is no workspace. Looking for it failed (or never ended): an
  // error the window offers to retry, never the welcome (the real workspace may exist; a new one would replace it).
  if home.is_none() {
    match status {
      engine::Status::NoHome => {}
      engine::Status::Failed(e) => return Err(e),
      engine::Status::Booting => return Err(engine.t("sys.main.engineTimeout", &[])),
      _ => return Err(engine.t("sys.main.engineStartStopped", &[("name", "Orb".into())])),
    }
  }
  // Why the start failed, when the window offers something for it (secretBusy, secretUnreadable).
  let start_error = match &status {
    // With «Empezar con una clave nueva» the window says what is lost: whether a recovery code and a master password
    // exist in this workspace's core (review D-fix M2), and whether it keeps secrets (review D10 B6: without the master
    // password they go with the old key).
    engine::Status::Failed(e) => engine.start_code().map(|code| {
      let core = home.as_ref().map(|h| std::path::Path::new(h).join("core"));
      let has = |rel: &[&str]| core.as_ref().is_some_and(|c| rel.iter().fold(c.clone(), |p, r| p.join(r)).is_file());
      json!({ "code": code, "message": e, "recovery": has(&["datos", "copia-clave.json"]), "master": has(&["secretos", "maestra.json"]), "vault": has(&["secretos", "secretos.json"]) })
    }),
    _ => None,
  };
  // 3.8: the workspace goes to C:\Orb unless the user picks another place (the welcome shows it already chosen).
  let base = std::env::var("ORB_DEFAULT_BASE").unwrap_or_else(|_| format!("{}\\", std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into())));
  Ok(json!({ "version": app.package_info().version.to_string(), "home": home, "needsSetup": home.is_none(), "platform": "win32", "defaultBase": base, "startError": start_error }))
}

/// The window's «Reintentar» after the engine failed to start, and «Empezar con una clave nueva» after the sealed keys
/// could not be opened (newSecret: only then).
#[tauri::command]
async fn app_retry_start(window: WebviewWindow, new_secret: Option<bool>) -> Result<(), String> {
  only_main(&window)?;
  let engine = engine::get(window.app_handle());
  let new_secret = new_secret == Some(true) && engine.start_code().as_deref() == Some("secretUnreadable");
  engine.retry(new_secret).await
}

#[tauri::command]
async fn app_setup(window: WebviewWindow, data: Value) -> Result<Value, String> {
  only_main(&window)?;
  engine::get(window.app_handle()).setup(data).await
}

#[tauri::command]
async fn app_switch_home(window: WebviewWindow, target: String) -> Result<(), String> {
  only_main(&window)?;
  let app = window.app_handle().clone();
  let engine = engine::get(&app);
  engine.switch_home(&target).await?;
  engine.begin_quit();
  app.restart();
}

#[tauri::command]
fn app_zoom(window: WebviewWindow, value: Option<f64>) -> Result<f64, String> {
  only_main(&window)?;
  Ok(match value {
    Some(v) => window::set_zoom(window.app_handle(), v),
    None => window::zoom(window.app_handle()),
  })
}

#[tauri::command]
fn app_zoom_step(window: WebviewWindow, dir: String) -> Result<f64, String> {
  only_main(&window)?;
  let app = window.app_handle();
  Ok(window::set_zoom(app, protocol::zoom_step(window::zoom(app), &dir)))
}

#[tauri::command]
fn window_act(window: WebviewWindow, action: String) -> Result<Value, String> {
  only_main(&window)?;
  window::act(&window, &action)
}

#[tauri::command]
async fn app_pick_folder(window: WebviewWindow, title: Option<String>) -> Result<Option<String>, String> {
  only_main(&window)?;
  Ok(desktop::pick_folder(&window, title).await)
}

#[tauri::command]
async fn app_pick_program(window: WebviewWindow, title: Option<String>) -> Result<Option<String>, String> {
  only_main(&window)?;
  Ok(desktop::pick_program(&window, title).await)
}

#[tauri::command]
async fn app_pick_files(window: WebviewWindow, title: Option<String>) -> Result<Vec<String>, String> {
  only_main(&window)?;
  Ok(desktop::pick_files(&window, title).await)
}

#[tauri::command]
async fn app_pick_images(window: WebviewWindow) -> Result<Vec<String>, String> {
  only_main(&window)?;
  Ok(desktop::pick_images(&window).await)
}

#[tauri::command]
async fn app_feedback_images(window: WebviewWindow) -> Result<Vec<Value>, String> {
  only_main(&window)?;
  Ok(desktop::feedback_images(&window).await)
}

#[tauri::command]
async fn app_feedback_capture(window: WebviewWindow) -> Result<Option<String>, String> {
  only_main(&window)?;
  desktop::feedback_capture(&window).await
}

#[tauri::command]
async fn app_open_path(window: WebviewWindow, path: String, unlock: Option<String>) -> Result<bool, String> {
  only_main(&window)?;
  desktop::open_path(&window, path, unlock).await
}

#[tauri::command]
fn app_open_external(window: WebviewWindow, url: String) -> Result<bool, String> {
  only_main(&window)?;
  desktop::open_external(&window, url)
}

/// «Eliminar proyecto»: the master password's token, then «Reintentar», «Borrar para siempre» or «Cancelar» (delete.rs).
#[tauri::command]
async fn app_delete_project(window: WebviewWindow, name: String, unlock: Option<String>, step: Option<String>) -> Result<Value, String> {
  only_main(&window)?;
  let app = window.app_handle();
  delete::delete_project(engine::get(app), &app.state::<delete::Deletes>(), name, unlock, step).await
}

/// Ajustes › «Ver el navegador»: the little window of the agents' browser again, and what it has open.
#[tauri::command]
async fn app_show_browser(window: WebviewWindow) -> Result<Value, String> {
  only_main(&window)?;
  engine::get(window.app_handle()).request("pip", json!({ "action": "show" }), Duration::from_secs(5)).await
}

/// New versions (updater.rs): the state, «Buscar», «Descargar e instalar» and «Reiniciar e instalar».
#[tauri::command]
fn app_update(window: WebviewWindow) -> Result<updater::State, String> {
  only_main(&window)?;
  Ok(updater::get(window.app_handle()))
}

#[tauri::command]
async fn app_update_check(window: WebviewWindow) -> Result<updater::State, String> {
  only_main(&window)?;
  Ok(updater::check(window.app_handle()).await)
}

#[tauri::command]
async fn app_update_download(window: WebviewWindow) -> Result<updater::State, String> {
  only_main(&window)?;
  Ok(updater::download(window.app_handle()).await)
}

#[tauri::command]
async fn app_update_install(window: WebviewWindow) -> Result<bool, String> {
  only_main(&window)?;
  updater::install(window.app_handle()).await
}

/// A button of the little window (pip.rs). Only from that window.
#[tauri::command]
fn pip_action(window: WebviewWindow, action: String) -> Result<(), String> {
  if window.label() != "pip" {
    return Err("origen no permitido".into());
  }
  if action == "drag" {
    return window.start_dragging().map_err(|e| e.to_string());
  }
  pip::action(window.app_handle(), &action)
}

#[tauri::command]
fn window_drag(window: WebviewWindow) -> Result<(), String> {
  only_main(&window)?;
  window.start_dragging().map_err(|e| e.to_string())
}

/// Where node.exe and the engine's code are: in the package, Tauri's resources (scripts/tauri-resources.mjs); running
/// from the code, this repository's src and ORB_NODE, the packaged copy or the node of the PATH.
fn engine_paths(app: &AppHandle) -> (PathBuf, PathBuf) {
  let resources = app.path().resource_dir().unwrap_or_default();
  let bundled = resources.join("node").join("node.exe");
  if cfg!(debug_assertions) {
    let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("src");
    let node = std::env::var("ORB_NODE").map(PathBuf::from).unwrap_or_else(|_| if bundled.exists() { bundled } else { PathBuf::from("node") });
    (node, src)
  } else {
    (bundled, resources.join("app").join("src"))
  }
}

pub fn run() {
  // Before any webview or the engine exists: no WEBVIEW2_* from the environment (a DevTools port, another data folder)
  // reaches Orb's window, nor the engine and what it starts (protocol::webview2_vars).
  // Names that are not valid Unicode count too (review D4 B9): looked at as text, removed by their own name.
  for name in protocol::env_matching(protocol::webview2_vars::<Vec<String>>) {
    // SAFETY: still single-threaded: nothing else reads the environment yet.
    unsafe { std::env::remove_var(name) };
  }
  // ORB_USER_DATA: separate app data (tests, measurements); never the real profile then.
  let separate = std::env::var_os("ORB_USER_DATA").filter(|v| !v.is_empty()).map(PathBuf::from);
  let separate_for_errors = separate.clone();
  // Orb on Electron (an earlier version still installed) open on the same data: never two at once.
  if separate.is_none() {
    if let Some(dir) = std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join(DATA_DIR)) {
      // An earlier Orb opened from now on quits by itself, bringing this one to the front (desktop.rs). Made before the
      // check below (review D10 B11): an Electron starting in between is either seen by the check or meets this window.
      let guarded = desktop::guard_against_electron(&dir, || {
        if let Some(app) = APP.get() {
          let a = app.clone();
          let _ = app.run_on_main_thread(move || {
            if let Some(w) = a.get_webview_window("main") {
              let _ = w.unminimize();
              let _ = w.show();
              let _ = w.set_focus();
            }
          });
        }
      });
      if !guarded {
        // Review D10 B13: an earlier Orb opened later would not see this one (said in the log of this start).
        GUARD_FAILED.store(true, std::sync::atomic::Ordering::SeqCst);
      }
      if desktop::electron_running(&dir) {
        return startup_failed("Ya hay otro Orb abierto en este PC (una versión anterior). Ciérralo y vuelve a abrir Orb. / Another Orb (an earlier version) is open on this PC: close it and open Orb again.", None, false);
      }
    }
  }
  let mut builder = tauri::Builder::default();
  // One Orb per PC: a second start brings the open one to the front. Not for a separate data folder (tests run next to
  // the installed app, as with Electron, whose lock lived in the data folder).
  if separate.is_none() {
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
      if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
      }
    }));
  }
  let app = builder
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .invoke_handler(tauri::generate_handler![
      engine_call,
      app_info,
      app_retry_start,
      app_setup,
      app_switch_home,
      app_zoom,
      app_zoom_step,
      window_act,
      window_drag,
      app_pick_folder,
      app_pick_program,
      app_pick_files,
      app_pick_images,
      app_feedback_images,
      app_feedback_capture,
      app_open_path,
      app_open_external,
      app_delete_project,
      app_show_browser,
      app_update,
      app_update_check,
      app_update_download,
      app_update_install,
      pip_action
    ])
    .setup(move |app| {
      let handle = app.handle().clone();
      let _ = APP.set(handle.clone());
      let user_data = match &separate {
        Some(dir) => dir.clone(),
        None => app.path().data_dir()?.join(DATA_DIR),
      };
      // The window's WebView2 profile, always set here: the test one inside the separate data folder.
      let webview_data = match &separate {
        Some(dir) => dir.join("webview"),
        None => app.path().app_local_data_dir()?.join("EBWebView"),
      };
      // The agents' browser: its own WebView2 environment, in a data folder of its own (browser.rs).
      let agents_data = match &separate {
        Some(dir) => dir.join("navegador-agente"),
        None => app.path().app_local_data_dir()?.join("navegador-agente"),
      };
      browser::init(&handle, agents_data);
      trace::watch_ui(&handle);
      let e2e = window::e2e(separate.is_some());
      // The little window of the agents' browser shares Orb's window's WebView2 environment (same folder and arguments).
      pip::init(&handle, webview_data.clone(), protocol::browser_args(e2e.cdp_port));
      let (node, src) = engine_paths(&handle);
      let engine = engine::Engine::new(
        handle.clone(),
        engine::Config {
          node,
          src,
          user_data: user_data.clone(),
          version: app.package_info().version.to_string(),
          packaged: !cfg!(debug_assertions),
          separate_data: separate.is_some(),
          documents: app.path().document_dir().ok(),
          profile: app.path().home_dir().ok(),
          dev_control: cfg!(debug_assertions) && std::env::var("ORB_DEV_CONTROL").as_deref() == Ok("1"),
        },
      );
      if GUARD_FAILED.load(std::sync::atomic::Ordering::SeqCst) {
        engine.log_line("no se pudo crear la ventana que detiene a un Orb anterior (Electron) abierto después");
      }
      // Installed over Orb 3.8.0 (Electron): its leftovers go, and the window says so once (migrate.rs).
      let updater_cache = match &separate {
        None => std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("orb-dev-updater")),
        Some(_) => None,
      };
      if migrate::after_electron(&user_data, updater_cache) {
        engine.set_migrated();
      }
      app.manage(engine.clone());
      app.manage(delete::Deletes::default());
      // The engine starts while the window loads.
      tauri::async_runtime::spawn(engine.boot(None));
      window::create_main(&handle, &user_data, webview_data, e2e)?;
      updater::init(&handle);
      updater::start(&handle);
      Ok(())
    })
    .build(tauri::generate_context!());
  let app = match app {
    Ok(app) => app,
    Err(e) => return startup_failed(&e.to_string(), separate_for_errors.as_deref(), true),
  };
  app.run(|app, event| {
    if let RunEvent::Exit = event {
      // A downloaded version installs on closing: its backup first, while the engine still runs.
      updater::before_exit(app);
      // The engine gives `tailscale serve` up to 4.3 s to stop (engine.mjs › shutdown): a little more here.
      engine::get(app).shutdown(Duration::from_secs(5));
      // A new version downloaded and left for later installs now (it ends the process).
      updater::on_exit(app);
    }
  });
}

/// Orb could not start (WebView2 missing or broken, the data folder not writable…): never a silent exit. Said in the
/// log of the app's data folder and in a message box (before the engine, so in both languages).
fn startup_failed(error: &str, separate: Option<&std::path::Path>, webview_hint: bool) {
  let dir = separate.map(PathBuf::from).or_else(|| std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join(DATA_DIR)));
  if let Some(dir) = dir {
    use std::io::Write as _;
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("motor-salida.log")) {
      let _ = writeln!(f, "\n[orb] Orb no pudo arrancar: {error}");
    }
  }
  #[cfg(feature = "e2e")]
  if std::env::var_os("ORB_USER_DATA").is_some() {
    return; // a test build: nobody at the PC to read a message box
  }
  #[cfg(windows)]
  {
    use windows::core::HSTRING;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
    let hint = if webview_hint { "\n\nSi falta Microsoft Edge WebView2 Runtime, instálalo y vuelve a abrir Orb." } else { "" };
    let text = format!("Orb no pudo arrancar / Orb could not start:\n\n{error}{hint}");
    // SAFETY: two valid wide strings for the length of the call; no owner window.
    unsafe { MessageBoxW(None, &HSTRING::from(text), &HSTRING::from("Orb"), MB_OK | MB_ICONERROR) };
  }
}
}

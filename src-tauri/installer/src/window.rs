//! The window: a fixed-size WebView2 page served from the program itself (custom protocol, strict CSP, no navigation away)
//! and the messages between that page and the real work in `run`. The state of a running installation lives here, not in the
//! page: if the page is reloaded, it is told where things stand.
use orb_instalador::guard;
use orb_instalador::mode::{Mode, TestOptions};
use orb_instalador::{embedded, nsis, registry, run, setup};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::platform::windows::WindowExtWindows;
use tao::window::WindowBuilder;
use wry::http::{header, Response};
use wry::{WebContext, WebViewBuilder, WebViewBuilderExtWindows};

const CSP: &str = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'";
/// Where the simulated Orb 3.8.0 lives in test mode.
/// If the page has not said `ready` by then, the runtime is not working: the classic installer takes over.
const READY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
/// A setup that has been running this long gets a way to close the window. The NSIS install takes a minute or two, so ten minutes
/// means something is wrong; closing the window never stops the setup.
const STUCK_AFTER: std::time::Duration = std::time::Duration::from_secs(600);
const TEST_ELECTRON_DIR: &str = r"C:\Users\Dani\AppData\Local\Programs\Orb";

enum UserEvent {
  Js(Value),
  Show,
  Drag,
  Minimize,
  Exit(i32),
}

/// What the page needs to draw the installation again after a reload.
#[derive(Default)]
struct Snap {
  running: bool,
  stuck: bool,
  phase: Option<String>,
  log: Vec<Value>,
  done: Option<Value>,
}

struct Shared {
  mode: Mode,
  /// A setup is running: the window may not be closed (the setup would go on with nobody to tell).
  busy: AtomicBool,
  /// The page said `ready` at least once.
  ready: AtomicBool,
  /// The setup has been running for STUCK_AFTER: the window may be closed (the setup goes on by itself).
  stuck: AtomicBool,
  /// Which run the stuck timer belongs to.
  run_id: AtomicU64,
  hwnd: AtomicIsize,
  snap: Mutex<Snap>,
  /// The program of the Orb that was just installed: the only thing "Open Orb now" may start.
  launchable: Mutex<Option<PathBuf>>,
}

impl Shared {
  fn record(&self, v: &Value) {
    let mut s = self.snap.lock().unwrap();
    match v["ev"].as_str() {
      Some("phase") => s.phase = v["phase"].as_str().map(str::to_string),
      Some("log") => s.log.push(json!({ "key": v["key"], "arg": v["arg"] })),
      Some("done") => {
        s.done = Some(v.clone());
        s.running = false;
      }
      _ => {}
    }
  }

  fn restore_event(&self) -> Value {
    let s = self.snap.lock().unwrap();
    json!({ "ev": "restore", "running": s.running, "stuck": s.stuck, "phase": s.phase, "log": s.log, "done": s.done })
  }

  fn electron_dir(&self) -> Option<PathBuf> {
    match &self.mode {
      Mode::Real(_) => registry::electron().map(|e| e.dir),
      Mode::Test(o) => (o.electron.as_deref() != Some("no")).then(|| PathBuf::from(TEST_ELECTRON_DIR)),
    }
  }
}

fn asset(path: &str) -> Option<(&'static str, &'static [u8])> {
  Some(match path {
    "/" | "/index.html" => ("text/html; charset=utf-8", include_bytes!("../ui/index.html")),
    "/app.css" => ("text/css; charset=utf-8", include_bytes!("../ui/app.css")),
    "/app.js" => ("text/javascript; charset=utf-8", include_bytes!("../ui/app.js")),
    "/i18n.js" => ("text/javascript; charset=utf-8", include_bytes!("../ui/i18n.js")),
    "/fonts/outfit-latin-wght-normal.woff2" => ("font/woff2", include_bytes!("../ui/fonts/outfit-latin-wght-normal.woff2")),
    _ => return None,
  })
}

fn js_call(v: &Value) -> String {
  // JSON is a JavaScript expression, but U+2028 and U+2029 only became legal inside strings in 2019.
  let json = v.to_string().replace('\u{2028}', "\\u2028").replace('\u{2029}', "\\u2029");
  format!("window.orbInst&&window.orbInst.event({json})")
}

fn error_word(e: nsis::DirError) -> &'static str {
  match e {
    nsis::DirError::NeedsAdmin => "admin",
    nsis::DirError::NotEmpty => "notempty",
    nsis::DirError::Electron => "electron",
    nsis::DirError::Invalid => "invalid",
  }
}

fn dir_event(text: &str, electron: Option<&Path>) -> Value {
  let checked = nsis::validate_target(text, electron);
  let free = nsis::validate_dir(text).ok().as_deref().and_then(run::free_space);
  json!({ "ev": "dir", "dir": text, "error": checked.err().map(error_word), "free": free.as_ref().map(|f| f.0), "drive": free.map(|f| f.1).unwrap_or_default() })
}

fn init_event(mode: &Mode) -> Value {
  let (electron, default_dir, test, lang) = match mode {
    Mode::Real(_) => (
      registry::electron().map(|e| json!({ "version": e.version, "dir": e.dir })),
      registry::installed_orb().map(|i| i.dir).unwrap_or_else(registry::default_install_dir),
      false,
      None,
    ),
    Mode::Test(o) => (
      o.electron.as_deref().filter(|e| *e != "no").or(if o.electron.is_none() { Some("3.8.0") } else { None }).map(|v| json!({ "version": v, "dir": TEST_ELECTRON_DIR })),
      PathBuf::from(r"C:\Users\Dani\AppData\Local\Orb"),
      true,
      o.lang.clone(),
    ),
  };
  let free = run::free_space(&default_dir).or_else(|| run::free_space(&std::env::temp_dir()));
  json!({ "ev": "init", "version": embedded::VERSION, "electron": electron, "default_dir": default_dir, "free": free.as_ref().map(|f| f.0), "drive": free.map(|f| f.1).unwrap_or_default(), "test": test, "lang": lang })
}

/// The folder picker of Windows. A folder that already holds other files gets an `Orb` folder inside it.
fn pick_folder(hwnd: isize) -> Option<String> {
  use windows::Win32::Foundation::HWND;
  use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
  use windows::Win32::UI::Shell::{FileOpenDialog, IFileOpenDialog, FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS, SIGDN_FILESYSPATH};
  // SAFETY: COM is initialised on this thread before use and released after; every interface is dropped before CoUninitialize;
  // the string the dialog returns is freed with CoTaskMemFree after it is copied.
  let picked = unsafe {
    let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    let result = (|| -> windows::core::Result<String> {
      let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
      dialog.SetOptions(dialog.GetOptions()? | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM)?;
      dialog.Show(Some(HWND(hwnd as *mut core::ffi::c_void)))?;
      let item = dialog.GetResult()?;
      let name = item.GetDisplayName(SIGDN_FILESYSPATH)?;
      let text = name.to_string();
      CoTaskMemFree(Some(name.0 as *const core::ffi::c_void));
      text.map_err(|_| windows::core::Error::from_hresult(windows::core::HRESULT(-1)))
    })();
    if init.is_ok() {
      CoUninitialize();
    }
    result.ok()
  }?;
  let p = PathBuf::from(&picked);
  let busy_folder = std::fs::read_dir(&p).map(|mut d| d.next().is_some()).unwrap_or(false) && !p.join("uninstall.exe").is_file();
  Some(if busy_folder { p.join("Orb").to_string_lossy().into_owned() } else { picked })
}

fn handle(shared: &Arc<Shared>, proxy: &EventLoopProxy<UserEvent>, msg: &Value) {
  let send = |v: Value| {
    let _ = proxy.send_event(UserEvent::Js(v));
  };
  match msg["cmd"].as_str().unwrap_or("") {
    "ready" => {
      shared.ready.store(true, Ordering::SeqCst);
      // Also sent after a reload: the page gets everything it needs to draw where things stand.
      send(init_event(&shared.mode));
      send(shared.restore_event());
      let hidden = matches!(&shared.mode, Mode::Test(o) if o.hidden);
      if !hidden {
        let _ = proxy.send_event(UserEvent::Show);
      }
    }
    "check_dir" => send(dir_event(msg["dir"].as_str().unwrap_or(""), shared.electron_dir().as_deref())),
    "pick_dir" => {
      let (proxy, hwnd, electron) = (proxy.clone(), shared.hwnd.load(Ordering::SeqCst), shared.electron_dir());
      std::thread::spawn(move || {
        if let Some(dir) = pick_folder(hwnd) {
          let _ = proxy.send_event(UserEvent::Js(dir_event(&dir, electron.as_deref())));
        }
      });
    }
    "install" | "classic" => {
      // Never trust what the page sends: the folder is validated again here. A refusal goes back to the page as an ending of
      // kind "dir", and nothing starts.
      let dir = match msg["dir"].as_str().filter(|d| !d.is_empty()) {
        None => None,
        Some(text) => match nsis::validate_target(text, shared.electron_dir().as_deref()) {
          Ok(p) => Some(p),
          Err(e) => return send(json!({ "ev": "done", "kind": "dir", "error": error_word(e) })),
        },
      };
      // A second run cannot start over a first; the page is told where the first stands.
      if shared.busy.swap(true, Ordering::SeqCst) {
        return send(shared.restore_event());
      }
      *shared.snap.lock().unwrap() = Snap { running: true, ..Default::default() };
      shared.stuck.store(false, Ordering::SeqCst);
      let id = shared.run_id.fetch_add(1, Ordering::SeqCst) + 1;
      {
        let (shared, proxy) = (shared.clone(), proxy.clone());
        std::thread::spawn(move || {
          std::thread::sleep(STUCK_AFTER);
          if shared.busy.load(Ordering::SeqCst) && shared.run_id.load(Ordering::SeqCst) == id {
            shared.stuck.store(true, Ordering::SeqCst);
            shared.snap.lock().unwrap().stuck = true;
            let _ = proxy.send_event(UserEvent::Js(json!({ "ev": "stuck" })));
          }
        });
      }
      *shared.launchable.lock().unwrap() = None;
      send(json!({ "ev": "started" }));
      let params = run::Params { dir, shortcuts: msg["shortcuts"].as_bool().unwrap_or(true) };
      let classic = msg["cmd"] == "classic";
      let (shared, proxy) = (shared.clone(), proxy.clone());
      std::thread::spawn(move || {
        let emit = |v: Value| {
          shared.record(&v);
          let _ = proxy.send_event(UserEvent::Js(v));
        };
        match &shared.mode {
          Mode::Real(token) if classic => match run::run_classic(token, Some(&emit)) {
            Ok(code) => {
              let (mut done, exe) = run::done_after_classic(code);
              *shared.launchable.lock().unwrap() = exe;
              done["ev"] = json!("done");
              emit(done);
            }
            Err(run::ClassicError::Stage(_)) => emit(json!({ "ev": "done", "kind": "verify", "what": "io" })),
            Err(run::ClassicError::Start) => emit(json!({ "ev": "done", "kind": "failed", "code": null, "classic": true })),
          },
          Mode::Real(token) => {
            if let Some(exe) = run::run_real(token, &params, &|v| {
              emit(v);
            }) {
              *shared.launchable.lock().unwrap() = Some(exe);
            }
          }
          Mode::Test(o) => run::run_test(o, &emit),
        }
        shared.busy.store(false, Ordering::SeqCst);
      });
    }
    "launch" => {
      // Only after an ending of "installed", and only the program of the folder that was just installed.
      if shared.mode.is_real() {
        if let Some(exe) = shared.launchable.lock().unwrap().clone() {
          let _ = run::launch(&exe);
        }
      }
    }
    "minimize" => {
      let _ = proxy.send_event(UserEvent::Minimize);
    }
    "drag" => {
      let _ = proxy.send_event(UserEvent::Drag);
    }
    "close" => {
      if !shared.busy.load(Ordering::SeqCst) || shared.stuck.load(Ordering::SeqCst) {
        let _ = proxy.send_event(UserEvent::Exit(0));
      }
    }
    _ => {}
  }
}

fn browser_args(o: Option<&TestOptions>) -> String {
  // wry's own defaults, plus a debugging port that only a test run may ask for.
  let mut a = String::from("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection");
  if let Some(port) = o.and_then(|o| o.port) {
    a.push_str(&format!(" --remote-debugging-port={port}"));
  }
  a
}

/// When the window cannot be made: a real installer falls back to the classic one; a test run has nothing to fall back to.
fn cannot_show(mode: &Mode, what: &str) -> ! {
  match mode {
    Mode::Real(token) => run::classic_and_exit(token),
    Mode::Test(_) => panic!("{what}"),
  }
}

pub fn run(mode: Mode) -> ! {
  if mode.is_real() {
    // Nobody may open a debugging port on a real installer or point it at another browser.
    guard::scrub_webview2_env();
  }
  let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
  let proxy = event_loop.create_proxy();
  let window = match WindowBuilder::new()
    .with_title("Orb")
    .with_inner_size(LogicalSize::new(760.0, 520.0))
    .with_resizable(false)
    .with_maximizable(false)
    .with_decorations(false)
    .with_visible(false)
    .build(&event_loop)
  {
    Ok(w) => w,
    Err(_) => cannot_show(&mode, "window"),
  };
  // WebView2's own data folder: new and private for this run, never beside the program.
  let Ok(data) = setup::PrivateDir::create_in(&std::env::temp_dir()) else { cannot_show(&mode, "data folder") };
  let shared = Arc::new(Shared {
    mode,
    busy: AtomicBool::new(false),
    ready: AtomicBool::new(false),
    stuck: AtomicBool::new(false),
    run_id: AtomicU64::new(0),
    hwnd: AtomicIsize::new(window.hwnd() as isize),
    snap: Mutex::new(Snap::default()),
    launchable: Mutex::new(None),
  });
  let mut context = WebContext::new(Some(data.path().to_path_buf()));
  let args = browser_args(match &shared.mode {
    Mode::Test(o) => Some(o),
    Mode::Real(_) => None,
  });

  let ipc_shared = shared.clone();
  let ipc_proxy = proxy.clone();
  let builder = WebViewBuilder::new_with_web_context(&mut context)
    .with_additional_browser_args(&args)
    .with_devtools(false)
    .with_browser_accelerator_keys(false)
    .with_hotkeys_zoom(false)
    .with_url(format!("{}/", guard::ORIGIN))
    .with_custom_protocol("orbinst".into(), |_id, req| {
      let (status, ctype, body): (u16, &str, std::borrow::Cow<'static, [u8]>) = match asset(req.uri().path()) {
        Some((t, b)) => (200, t, b.into()),
        None => (404, "text/plain", b"not found".as_slice().into()),
      };
      Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, ctype)
        .header("Content-Security-Policy", CSP)
        .header("X-Content-Type-Options", "nosniff")
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .expect("response")
    })
    .with_navigation_handler(|url| guard::is_own_url(&url))
    .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny)
    .with_ipc_handler(move |req| {
      if !guard::is_own_url(&req.uri().to_string()) {
        return;
      }
      if let Ok(msg) = serde_json::from_str::<Value>(req.body()) {
        handle(&ipc_shared, &ipc_proxy, &msg);
      }
    });
  let webview = match builder.build(&window) {
    Ok(w) => w,
    Err(_) => cannot_show(&shared.mode, "WebView2"),
  };
  let mut webview = Some(webview);
  // A runtime that starts but never lets the page run would leave an invisible window for ever.
  {
    let shared = shared.clone();
    std::thread::spawn(move || {
      std::thread::sleep(READY_TIMEOUT);
      if !shared.ready.load(Ordering::SeqCst) {
        match &shared.mode {
          Mode::Real(token) => run::classic_and_exit(token),
          Mode::Test(_) => std::process::exit(3),
        }
      }
    });
  }

  event_loop.run(move |event, _, flow| {
    *flow = ControlFlow::Wait;
    match event {
      Event::UserEvent(UserEvent::Js(v)) => {
        if let Some(w) = &webview {
          let _ = w.evaluate_script(&js_call(&v));
        }
      }
      Event::UserEvent(UserEvent::Show) => {
        window.set_visible(true);
        window.set_focus();
      }
      Event::UserEvent(UserEvent::Drag) => {
        let _ = window.drag_window();
      }
      Event::UserEvent(UserEvent::Minimize) => window.set_minimized(true),
      Event::UserEvent(UserEvent::Exit(code)) => {
        drop(webview.take());
        remove_later(data.path());
        *flow = ControlFlow::ExitWithCode(code);
      }
      Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => {
        if !shared.busy.load(Ordering::SeqCst) || shared.stuck.load(Ordering::SeqCst) {
          let _ = proxy.send_event(UserEvent::Exit(0));
        }
      }
      _ => {}
    }
  })
}

/// WebView2 may still hold a file of its data folder for a moment after the window goes; this is best effort.
fn remove_later(p: &Path) {
  for _ in 0..10 {
    if std::fs::remove_dir_all(p).is_ok() || !p.exists() {
      return;
    }
    std::thread::sleep(std::time::Duration::from_millis(100));
  }
}

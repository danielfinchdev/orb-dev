// The agents' browser (src/engine/host-browser.mjs): real pages the agents drive through Orb's MCP tools, each one a
// WebView2 in a hidden window that is never shown, made here directly with WebView2 (not as Tauri windows, so they have
// no Tauri IPC, no custom protocol and nothing of Orb's window):
//   - a browser environment of its own: another data folder (…\navegador-agente), so another browser process; Orb's window
//     lives in a different one and is never reachable from these pages;
//   - no DevTools port: the engine's DevTools calls come over its stdio channel (host.browser.cdp) and go to the page with
//     CallDevToolsProtocolMethod; the page's DevTools events go back as { type: 'browserEvent' } lines;
//   - the limits of Electron's agents' browser, enforced here whatever the engine asks: only http(s) addresses (frames
//     too: never file:), no other app's protocol, a new window is refused before it exists (its address goes to the
//     engine, which opens it in the same page), every permission denied, downloads cancelled, HTTP sign-in prompts
//     cancelled, sound off, no dialogs of WebView2's own, no DevTools, context menu, accelerator keys, autofill or
//     password saving, no web messages or host objects, Edge's own user agent. What is refused is told to the engine
//     (Orb.blocked) so the agent learns why;
//   - nothing native shows on the owner's desktop: file choosers intercepted (Page.setInterceptFileChooserDialog, from
//     here, not the engine's list), the File System Access pickers off, screen capture cancelled, and the hidden window
//     far off screen and disabled, so a select's list or a date picker opens where nobody sees it; the clipboard is
//     never written by a page (pastejacking), and navigator.share and WebAuthn are not there (a script on every
//     document, before the page's own);
//   - a page cannot flood Orb: every page lives on a thread of its own («orb-agent-browser», an STA with its own message
//     loop), never on Orb's UI thread, so whatever WebView2 delivers there (each DevTools event with its whole JSON,
//     read or not) never delays Orb's window; its events are counted (browser_rules::EventGate), read only when small,
//     cut to what the engine's driver reads (browser_rules::shrink_event), and the queue to the engine is bounded
//     (engine.notify); a page past the flood limits (events, console lines or bytes a second) is closed at once (its
//     renderer process goes with it) and the agent is told;
//   - the browser process gone (a crash, Windows short of memory): its pages are closed and the environment made
//     again with the next page; a page that never finishes opening frees its place after OPEN_TIMEOUT.
// The environment (its browser process, some 300 MB) exists only while a page is open: the engine closes idle pages after
// 10 minutes, and the last page closing ends it.
use crate::browser_rules::{self, BrowserRequest};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub struct Agents {
  data_dir: PathBuf,
  next: AtomicU32,
}

/// The agents' browser data folder: next to Orb's own WebView2 profile, never inside it.
pub fn init(app: &AppHandle, data_dir: PathBuf) {
  app.manage(Agents { data_dir, next: AtomicU32::new(0) });
}

type Reply = Result<Value, String>;

/// Runs `f` on the agents' browser thread (its pages live there) and waits for what it hands to its callback.
async fn on_thread<F>(timeout: Duration, f: F) -> Reply
where
  F: FnOnce(Box<dyn FnOnce(Reply) + Send>) + Send + 'static,
{
  let (tx, rx) = tokio::sync::oneshot::channel::<Reply>();
  imp::post(Box::new(move || {
    f(Box::new(move |r| {
      let _ = tx.send(r);
    }))
  }))?;
  match tokio::time::timeout(timeout, rx).await {
    Ok(Ok(r)) => r,
    Ok(Err(_)) => Err("navegador: sin respuesta".into()),
    Err(_) => Err("navegador: tiempo agotado".into()),
  }
}

pub async fn handle(app: &AppHandle, req: BrowserRequest) -> Reply {
  if !crate::trace::on() {
    return handle_inner(app, req).await;
  }
  let t0 = std::time::Instant::now();
  let what = format!("{req:?}").chars().take(60).collect::<String>();
  let r = handle_inner(app, req).await;
  crate::trace::mark("browser.request", json!({ "req": what, "ms": t0.elapsed().as_millis() as u64, "ok": r.is_ok() }));
  r
}

async fn handle_inner(app: &AppHandle, req: BrowserRequest) -> Reply {
  match req {
    BrowserRequest::Open => {
      let st = app.state::<Agents>();
      let id = st.next.fetch_add(1, Ordering::SeqCst) + 1;
      let dir = st.data_dir.clone();
      let engine = crate::engine::get(app);
      let emit: Emit = std::sync::Arc::new(move |method: &str, params: Value| {
        engine.notify(&json!({ "type": "browserEvent", "page": id, "method": method, "params": params }));
      });
      on_thread(Duration::from_secs(40), move |done| imp::open(id, dir, emit, done)).await?;
      Ok(json!({ "page": id }))
    }
    BrowserRequest::Close(id) => on_thread(Duration::from_secs(10), move |done| done(imp::close(id).map(|_| json!(true)))).await,
    BrowserRequest::Cdp { page, method, params } => on_thread(Duration::from_secs(45), move |done| imp::cdp(page, method, params, done)).await,
    other => crate::pip::handle(app, other).await,
  }
}

/// The engine went (a crash or a restart): its pages go with it.
pub fn close_all() {
  let _ = imp::post(Box::new(imp::close_all));
}

type Job = Box<dyn FnOnce() + Send>;

pub type Emit = std::sync::Arc<dyn Fn(&str, Value) + Send + Sync>;

#[cfg(windows)]
mod imp {
  use super::*;
  use std::cell::RefCell;
  use std::collections::HashMap;
  use std::rc::Rc;
  use webview2_com::Microsoft::Web::WebView2::Win32::*;
  use webview2_com::{
    take_pwstr, BasicAuthenticationRequestedEventHandler, CallDevToolsProtocolMethodCompletedHandler, CoreWebView2EnvironmentOptions,
    CreateCoreWebView2ControllerCompletedHandler, CreateCoreWebView2EnvironmentCompletedHandler, DevToolsProtocolEventReceivedEventHandler,
    DocumentTitleChangedEventHandler, DownloadStartingEventHandler, LaunchingExternalUriSchemeEventHandler, NavigationStartingEventHandler,
    NewWindowRequestedEventHandler, PermissionRequestedEventHandler, WebResourceRequestedEventHandler, ProcessFailedEventHandler, ScreenCaptureStartingEventHandler, ScriptDialogOpeningEventHandler,
  };
  use windows::core::{w, Interface, HSTRING, PCWSTR, PWSTR};
  use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
  use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
  use windows::Win32::System::LibraryLoader::GetModuleHandleW;
  use windows::Win32::UI::WindowsAndMessaging::*;

  // ---- The agents' browser thread: an STA with its own message loop, where the environment and every page are made
  // and used (WebView2 objects belong to the thread that made them). Work comes as jobs over a channel, woken by a
  // message to a message-only window (a window's messages are delivered even inside a modal loop, a thread's are not).
  const WM_RUN: u32 = WM_APP + 1;
  struct Line {
    jobs: std::sync::mpsc::Sender<Job>,
    hwnd: isize,
  }
  static LINE: std::sync::OnceLock<Result<Line, String>> = std::sync::OnceLock::new();
  thread_local! {
    static JOBS: RefCell<Option<std::sync::mpsc::Receiver<Job>>> = const { RefCell::new(None) };
  }

  unsafe extern "system" fn line_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_RUN {
      while let Some(job) = JOBS.with(|j| j.borrow().as_ref().and_then(|r| r.try_recv().ok())) {
        // A panic in a job must not leave this window procedure (unwinding out of `extern "system"` ends Orb): it is
        // caught here, written down, and the thread goes on with the next job (review D9 B8).
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(job)).is_err() {
          eprintln!("navegador de los agentes: un trabajo falló (pánico); se sigue con el siguiente");
        }
      }
      return LRESULT(0);
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
  }

  fn start_line() -> Result<Line, String> {
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<isize, String>>();
    let (jobs, rx) = std::sync::mpsc::channel::<Job>();
    std::thread::Builder::new()
      .name("orb-agent-browser".into())
      .spawn(move || unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        JOBS.with(|j| *j.borrow_mut() = Some(rx));
        let made = (|| -> windows::core::Result<HWND> {
          let instance = GetModuleHandleW(None)?;
          let class = w!("OrbAgentBrowserLine");
          let wc = WNDCLASSW { lpfnWndProc: Some(line_proc), hInstance: instance.into(), lpszClassName: class, ..Default::default() };
          RegisterClassW(&wc);
          CreateWindowExW(WINDOW_EX_STYLE(0), class, w!("Orb"), WINDOW_STYLE(0), 0, 0, 0, 0, Some(HWND_MESSAGE), None, Some(instance.into()), None)
        })();
        match made {
          Ok(h) => {
            let _ = ready_tx.send(Ok(h.0 as isize));
          }
          Err(e) => {
            let _ = ready_tx.send(Err(e.to_string()));
            return;
          }
        }
        let mut msg = MSG::default();
        // > 0: a message; 0: WM_QUIT; -1: an error (never a busy loop on it).
        while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
          let _ = TranslateMessage(&msg);
          DispatchMessageW(&msg);
        }
      })
      .map_err(|e| e.to_string())?;
    let hwnd = ready_rx.recv().map_err(|_| "navegador: el hilo no arrancó".to_string())??;
    Ok(Line { jobs, hwnd })
  }

  /// Runs `job` on the agents' browser thread (started the first time).
  pub fn post(job: Job) -> Result<(), String> {
    let line = LINE.get_or_init(start_line).as_ref().map_err(|e| e.clone())?;
    line.jobs.send(job).map_err(|_| "navegador: el hilo terminó".to_string())?;
    // SAFETY: a window of ours that lives as long as the process.
    unsafe { PostMessageW(Some(HWND(line.hwnd as *mut _)), WM_RUN, WPARAM(0), LPARAM(0)) }.map_err(|e| e.to_string())
  }

  // The view the engine emulates is 1280×800 CSS pixels (Emulation.setDeviceMetricsOverride); the hidden window is as
  // big in physical pixels.
  const WIDTH: i32 = 1280;
  const HEIGHT: i32 = 800;
  /// No DevTools port, and none of Edge's own extras (its PDF and pop-up UI, SmartScreen calls).
  /// And no File System Access pickers (showOpenFilePicker and the like open Windows' own dialog, which file chooser
  /// interception does not cover).
  const ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-blink-features=FileSystemAccessLocal";
  /// A page that has not opened by then frees its place (the engine stops waiting at 30 s).
  const OPEN_TIMEOUT: Duration = Duration::from_secs(35);
  /// Run on every document and frame before the page's own scripts: what a click of the agent (a real user gesture)
  /// could otherwise do on the owner's PC.
  const PAGE_SCRIPT: &str = r#"(() => {
  const no = () => Promise.reject(new DOMException('Orb: no permitido en el navegador de los agentes', 'NotAllowedError'));
  const off = (o, k, v) => { try { Object.defineProperty(o, k, { value: v, configurable: false, writable: false }); } catch {} };
  try { const c = navigator.clipboard; if (c) { off(c, 'writeText', no); off(c, 'write', no); } } catch {}
  try { const ex = Document.prototype.execCommand; off(Document.prototype, 'execCommand', function (cmd, ...rest) { return /^(copy|cut)$/i.test(String(cmd)) ? false : ex.call(this, cmd, ...rest); }); } catch {}
  try { document.addEventListener('copy', (e) => { e.stopImmediatePropagation(); e.preventDefault(); }, true); document.addEventListener('cut', (e) => { e.stopImmediatePropagation(); e.preventDefault(); }, true); } catch {}
  for (const k of ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) off(window, k, undefined);
  off(Navigator.prototype, 'share', undefined); off(Navigator.prototype, 'canShare', undefined);
  try { if (navigator.credentials) { off(navigator.credentials, 'create', no); off(navigator.credentials, 'get', no); } } catch {}
  try { if (navigator.mediaDevices) off(navigator.mediaDevices, 'getDisplayMedia', no); } catch {}
  try { off(HTMLInputElement.prototype, 'showPicker', function () { throw new DOMException('Orb: no permitido', 'NotAllowedError'); }); } catch {}
})();"#;

  struct Page {
    hwnd: HWND,
    controller: ICoreWebView2Controller,
    core: ICoreWebView2,
    emit: Emit,
    _receivers: Vec<ICoreWebView2DevToolsProtocolEventReceiver>,
    /// Orb's own ports this page's requests are checked on.
    ports: Vec<u16>,
  }

  fn add_port_filters(core: &ICoreWebView2, ports: &[u16]) -> windows::core::Result<()> {
    for p in ports {
      for scheme in ["http", "https"] {
        // SAFETY: a live WebView of this thread.
        unsafe { core.AddWebResourceRequestedFilter(&HSTRING::from(format!("{scheme}://*:{p}/*")), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)? };
      }
    }
    Ok(())
  }
  /// The ports the engine named since a page opened (a server started later): checked on every open page too.
  fn refresh_port_filters() {
    let now = browser_rules::own_ports();
    PAGES.with(|p| {
      for page in p.borrow_mut().values_mut() {
        let new: Vec<u16> = now.iter().copied().filter(|x| !page.ports.contains(x)).collect();
        if !new.is_empty() && add_port_filters(&page.core, &new).is_ok() {
          page.ports.extend(new);
        }
      }
    });
  }

  /// A page's events through its gate (browser_rules::EventGate): admitted or counted, the count said once a second;
  /// a flooding page is stopped (stop_flooding) and nothing more of it is read.
  #[derive(Clone)]
  struct Gated {
    id: u32,
    emit: Emit,
    gate: Rc<RefCell<browser_rules::EventGate>>,
  }
  impl Gated {
    fn admit(&self, method: &str) -> bool {
      let now = std::time::Instant::now();
      let mut g = self.gate.borrow_mut();
      if g.flooded() {
        return false;
      }
      if g.flooding(method, now) {
        drop(g);
        self.flood(method);
        return false;
      }
      if let Some(n) = g.report(now) {
        (self.emit)("Orb.dropped", json!({ "count": n }));
      }
      g.admit(method, now)
    }
    /// An event of `bytes` was read: false (and the page stopped) when that makes it a flood.
    fn read(&self, method: &str, bytes: usize) -> bool {
      let flood = self.gate.borrow_mut().flooding_bytes(bytes, std::time::Instant::now());
      if flood {
        self.flood(method);
      }
      !flood
    }
    fn flood(&self, method: &str) {
      crate::trace::mark("browser.flood", json!({ "page": self.id, "method": method }));
      (self.emit)("Orb.blocked", json!({ "kind": "flood" }));
      let id = self.id;
      // After this event's handler, not inside it.
      let _ = post(Box::new(move || stop_flooding(id)));
    }
    fn send(&self, method: &str, params: Value) {
      if self.admit(method) {
        (self.emit)(method, params);
      }
    }
  }
  fn short(url: String) -> String {
    url.chars().take(2048).collect()
  }

  type EnvResult = Result<ICoreWebView2Environment, String>;
  type EnvWaiter = Box<dyn FnOnce(EnvResult)>;
  enum Env {
    None,
    Creating(Vec<EnvWaiter>),
    Ready(ICoreWebView2Environment),
  }

  thread_local! {
    static PAGES: RefCell<HashMap<u32, Page>> = RefCell::new(HashMap::new());
    static OPENING: RefCell<usize> = const { RefCell::new(0) };
    /// The pages still opening, by id: their callback, so a timeout or a crash can end them.
    static PENDING: RefCell<HashMap<u32, Once<Result<(), String>>>> = RefCell::new(HashMap::new());
    static ENV: RefCell<Env> = const { RefCell::new(Env::None) };
  }

  /// A callback called at most once, from whichever path gets there first.
  struct Once<T>(Rc<RefCell<Option<Box<dyn FnOnce(T)>>>>);
  impl<T> Clone for Once<T> {
    fn clone(&self) -> Self {
      Self(self.0.clone())
    }
  }
  impl<T> Once<T> {
    fn new(f: Box<dyn FnOnce(T)>) -> Self {
      Self(Rc::new(RefCell::new(Some(f))))
    }
    fn call(&self, v: T) {
      let f = self.0.borrow_mut().take();
      if let Some(f) = f {
        f(v)
      }
    }
  }

  unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
  }

  /// A window that is never shown: no taskbar button, never activated.
  fn hidden_window() -> windows::core::Result<HWND> {
    unsafe {
      let instance = GetModuleHandleW(None)?;
      let class = w!("OrbAgentPage");
      let wc = WNDCLASSW { lpfnWndProc: Some(wndproc), hInstance: instance.into(), lpszClassName: class, ..Default::default() };
      RegisterClassW(&wc); // 0 once it is registered: fine
      // Far off screen and disabled: what Chromium opens next to the page (a select's list, a date picker) is placed by
      // its window, so it would open where nobody sees it, and it takes no input from the owner.
      CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, class, w!("Orb"), WS_POPUP | WS_DISABLED, -32000, -32000, WIDTH, HEIGHT, None, None, Some(instance.into()), None)
    }
  }

  fn env_done(r: EnvResult) {
    let waiters = ENV.with(|e| {
      let next = match &r {
        Ok(env) => Env::Ready(env.clone()),
        Err(_) => Env::None,
      };
      match std::mem::replace(&mut *e.borrow_mut(), next) {
        Env::Creating(w) => w,
        _ => Vec::new(),
      }
    });
    for w in waiters {
      w(r.clone());
    }
  }

  /// The agents' browser environment, made once and shared by its pages.
  fn with_env(dir: PathBuf, then: EnvWaiter) {
    let mut then = Some(then);
    let (now, create) = ENV.with(|e| {
      let mut e = e.borrow_mut();
      match &mut *e {
        Env::Ready(env) => (Some(env.clone()), false),
        Env::Creating(w) => {
          w.extend(then.take());
          (None, false)
        }
        Env::None => {
          *e = Env::Creating(then.take().into_iter().collect());
          (None, true)
        }
      }
    });
    if let (Some(env), Some(f)) = (now, then) {
      return f(Ok(env));
    }
    if !create {
      return;
    }
    let _ = std::fs::create_dir_all(&dir);
    let options = CoreWebView2EnvironmentOptions::default();
    // SAFETY: the options object is ours and not shared yet.
    unsafe { options.set_additional_browser_arguments(ARGS.to_string()) };
    let handler = CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(|hr, env| {
      env_done(hr.map_err(|e| e.to_string()).and_then(|_| env.ok_or_else(|| "sin entorno".to_string())));
      Ok(())
    }));
    let started = unsafe { CreateCoreWebView2EnvironmentWithOptions(PCWSTR::null(), &HSTRING::from(dir.to_string_lossy().as_ref()), &ICoreWebView2EnvironmentOptions::from(options), &handler) };
    if let Err(e) = started {
      env_done(Err(e.to_string()));
    }
  }

  /// Nothing open or opening: the environment goes, and its browser process with it.
  fn release_env_if_idle() {
    let idle = PAGES.with(|p| p.borrow().is_empty()) && OPENING.with(|o| *o.borrow() == 0);
    if idle {
      ENV.with(|e| {
        let mut e = e.borrow_mut();
        if matches!(*e, Env::Ready(_)) {
          *e = Env::None;
        }
      });
    }
  }

  pub fn open(id: u32, dir: PathBuf, emit: Emit, done: Box<dyn FnOnce(Reply) + Send>) {
    let busy = PAGES.with(|p| p.borrow().len()) + OPENING.with(|o| *o.borrow());
    if busy >= browser_rules::MAX_PAGES {
      return done(Err("demasiadas páginas abiertas".into()));
    }
    OPENING.with(|o| *o.borrow_mut() += 1);
    let finish: Once<Result<(), String>> = Once::new(Box::new(move |r: Result<(), String>| {
      OPENING.with(|o| *o.borrow_mut() -= 1);
      PENDING.with(|p| p.borrow_mut().remove(&id));
      if r.is_err() {
        release_env_if_idle();
      }
      done(r.map(|_| Value::Null));
    }));
    PENDING.with(|p| p.borrow_mut().insert(id, finish.clone()));
    // Never answered (the environment or the view hangs): its place is freed; a page that arrives later is closed.
    std::thread::spawn(move || {
      std::thread::sleep(OPEN_TIMEOUT);
      let _ = post(Box::new(move || {
        if let Some(f) = PENDING.with(|p| p.borrow_mut().remove(&id)) {
          f.call(Err("navegador: tiempo agotado al abrir".into()));
        }
      }));
    });
    with_env(
      dir,
      Box::new(move |env| {
        let env = match env {
          Ok(e) => e,
          Err(e) => return finish.call(Err(e)),
        };
        let hwnd = match hidden_window() {
          Ok(h) => h,
          Err(e) => return finish.call(Err(e.to_string())),
        };
        let f = finish.clone();
        let handler = CreateCoreWebView2ControllerCompletedHandler::create(Box::new(move |hr, controller| {
          // Given up meanwhile (the timeout): what arrives late is closed.
          if !PENDING.with(|p| p.borrow().contains_key(&id)) {
            if let Some(c) = controller {
              let _ = unsafe { c.Close() };
            }
            unsafe {
              let _ = DestroyWindow(hwnd);
            }
            return Ok(());
          }
          let made = hr.map_err(|e| e.to_string()).and_then(|_| controller.ok_or_else(|| "sin vista".to_string())).and_then(|c| unsafe { setup(id, hwnd, c, emit).map_err(|e| e.to_string()) });
          match made {
            Ok(page) => {
              PAGES.with(|p| p.borrow_mut().insert(id, page));
              refresh_port_filters();
              f.call(Ok(()));
            }
            Err(e) => {
              unsafe {
                let _ = DestroyWindow(hwnd);
              }
              f.call(Err(e));
            }
          }
          Ok(())
        }));
        if let Err(e) = unsafe { env.CreateCoreWebView2Controller(hwnd, &handler) } {
          unsafe {
            let _ = DestroyWindow(hwnd);
          }
          finish.call(Err(e.to_string()));
        }
      }),
    );
  }

  fn uri(get: impl FnOnce(*mut PWSTR) -> windows::core::Result<()>) -> String {
    let mut p = PWSTR::null();
    if get(&mut p).is_err() {
      return String::new();
    }
    take_pwstr(p)
  }

  fn permission_name(kind: COREWEBVIEW2_PERMISSION_KIND) -> &'static str {
    match kind {
      COREWEBVIEW2_PERMISSION_KIND_MICROPHONE => "microphone",
      COREWEBVIEW2_PERMISSION_KIND_CAMERA => "camera",
      COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION => "geolocation",
      COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS => "notifications",
      COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ => "clipboard-read",
      COREWEBVIEW2_PERMISSION_KIND_MULTIPLE_AUTOMATIC_DOWNLOADS => "automatic-downloads",
      COREWEBVIEW2_PERMISSION_KIND_FILE_READ_WRITE => "file-system",
      _ => "other",
    }
  }

  /// The page's settings, limits and events (see the top of this file).
  unsafe fn setup(id: u32, hwnd: HWND, controller: ICoreWebView2Controller, page_emit: Emit) -> windows::core::Result<Page> {
    let gated = Gated { id, emit: page_emit.clone(), gate: Rc::new(RefCell::new(browser_rules::EventGate::new(std::time::Instant::now()))) };
    unsafe {
      controller.SetBounds(RECT { left: 0, top: 0, right: WIDTH, bottom: HEIGHT })?;
      // Drawn although its window is never shown: captures and the little window's pictures need it.
      controller.SetIsVisible(true)?;
      let core = controller.CoreWebView2()?;
      let s = core.Settings()?;
      s.SetIsWebMessageEnabled(false)?;
      s.SetAreHostObjectsAllowed(false)?;
      s.SetAreDevToolsEnabled(false)?;
      s.SetAreDefaultContextMenusEnabled(false)?;
      s.SetAreDefaultScriptDialogsEnabled(false)?;
      s.SetIsStatusBarEnabled(false)?;
      s.SetIsZoomControlEnabled(false)?;
      let s2: ICoreWebView2Settings2 = s.cast()?;
      let ua = uri(|p| s2.UserAgent(p));
      s2.SetUserAgent(&HSTRING::from(browser_rules::user_agent(&ua)))?;
      s.cast::<ICoreWebView2Settings3>()?.SetAreBrowserAcceleratorKeysEnabled(false)?;
      let s4: ICoreWebView2Settings4 = s.cast()?;
      s4.SetIsPasswordAutosaveEnabled(false)?;
      s4.SetIsGeneralAutofillEnabled(false)?;
      if let Ok(s5) = s.cast::<ICoreWebView2Settings5>() {
        let _ = s5.SetIsPinchZoomEnabled(false);
      }
      if let Ok(s6) = s.cast::<ICoreWebView2Settings6>() {
        let _ = s6.SetIsSwipeNavigationEnabled(false);
      }
      core.cast::<ICoreWebView2_8>()?.SetIsMuted(true)?;
      let mut token = 0i64;
      core.AddScriptToExecuteOnDocumentCreated(&HSTRING::from(PAGE_SCRIPT), None)?;

      // Only http(s) pages, in the page and in its frames.
      for main_frame in [true, false] {
        let e = gated.clone();
        let handler = move |args: Option<ICoreWebView2NavigationStartingEventArgs>| -> windows::core::Result<()> {
          let Some(a) = args else { return Ok(()) };
          let url = uri(|p| a.Uri(p));
          if !browser_rules::url_allowed(&url, main_frame) {
            a.SetCancel(true)?;
            e.send("Orb.blocked", json!({ "kind": "navigation", "url": short(url) }));
          }
          Ok(())
        };
        if main_frame {
          core.add_NavigationStarting(&NavigationStartingEventHandler::create(Box::new(move |_, a| handler(a))), &mut token)?;
        } else {
          core.add_FrameNavigationStarting(&NavigationStartingEventHandler::create(Box::new(move |_, a| handler(a))), &mut token)?;
        }
      }
      // Review D8 B1: nor any request (fetch, an image, a form) to the engine's own servers on this PC's loopback. Review
      // final B2: any host on those ports (url_allowed resolves names), and ports the engine names later are added to the
      // pages already open (refresh_port_filters).
      let ports = browser_rules::own_ports();
      add_port_filters(&core, &ports)?;
      {
        let env = core.cast::<ICoreWebView2_2>()?.Environment()?;
        let e = gated.clone();
        core.add_WebResourceRequested(
          &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(a) = args else { return Ok(()) };
            let url = a.Request().map(|r| uri(|p| r.Uri(p))).unwrap_or_default();
            if !browser_rules::url_allowed(&url, false) || url.is_empty() {
              let r = env.CreateWebResourceResponse(None, 403, w!("Forbidden"), w!(""))?;
              a.SetResponse(&r)?;
              e.send("Orb.blocked", json!({ "kind": "request", "url": short(url) }));
            }
            Ok(())
          })),
          &mut token,
        )?;
      }
      // Another app's protocol (mailto:, ms-settings:, an installed app's link): never launched.
      let e = gated.clone();
      core.cast::<ICoreWebView2_18>()?.add_LaunchingExternalUriScheme(
        &LaunchingExternalUriSchemeEventHandler::create(Box::new(move |_, args| {
          let Some(a) = args else { return Ok(()) };
          a.SetCancel(true)?;
          e.send("Orb.blocked", json!({ "kind": "external", "url": short(uri(|p| a.Uri(p))) }));
          Ok(())
        })),
        &mut token,
      )?;
      // A new window: refused before it exists (handled, with no window given: window.open() gets null); its address goes
      // to the engine, which opens it in this page.
      let e = gated.clone();
      core.add_NewWindowRequested(
        &NewWindowRequestedEventHandler::create(Box::new(move |_, args| {
          let Some(a) = args else { return Ok(()) };
          a.SetHandled(true)?;
          // An address too long to be a page's is not opened.
          let url = uri(|p| a.Uri(p));
          if url.len() <= 2048 {
            e.send("Orb.popup", json!({ "url": url }));
          } else {
            e.send("Orb.blocked", json!({ "kind": "navigation", "url": short(url) }));
          }
          Ok(())
        })),
        &mut token,
      )?;
      let e = gated.clone();
      core.add_PermissionRequested(
        &PermissionRequestedEventHandler::create(Box::new(move |_, args| {
          let Some(a) = args else { return Ok(()) };
          a.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
          let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
          let _ = a.PermissionKind(&mut kind);
          e.send("Orb.blocked", json!({ "kind": "permission", "url": short(uri(|p| a.Uri(p))), "permission": permission_name(kind) }));
          Ok(())
        })),
        &mut token,
      )?;
      let e = gated.clone();
      core.cast::<ICoreWebView2_10>()?.add_BasicAuthenticationRequested(
        &BasicAuthenticationRequestedEventHandler::create(Box::new(move |_, args| {
          let Some(a) = args else { return Ok(()) };
          e.send("Orb.blocked", json!({ "kind": "auth", "url": short(uri(|p| a.Uri(p))) }));
          a.SetCancel(true)?;
          Ok(())
        })),
        &mut token,
      )?;
      let e = gated.clone();
      core.cast::<ICoreWebView2_4>()?.add_DownloadStarting(
        &DownloadStartingEventHandler::create(Box::new(move |_, args| {
          let Some(a) = args else { return Ok(()) };
          a.SetCancel(true)?;
          a.SetHandled(true)?;
          let url = a.DownloadOperation().map(|op| uri(|p| op.Uri(p))).unwrap_or_default();
          e.send("Orb.blocked", json!({ "kind": "download", "url": short(url) }));
          Ok(())
        })),
        &mut token,
      )?;
      // WebView2's own dialogs are off; «leave this page?» never blocks the agent (the rest are answered in the page:
      // src/core/browser-protocol.mjs › dialogsHook; one that slips through is cancelled).
      core.add_ScriptDialogOpening(
        &ScriptDialogOpeningEventHandler::create(Box::new(|_, args| {
          let Some(a) = args else { return Ok(()) };
          let mut kind = COREWEBVIEW2_SCRIPT_DIALOG_KIND::default();
          a.Kind(&mut kind)?;
          if kind == COREWEBVIEW2_SCRIPT_DIALOG_KIND_BEFOREUNLOAD {
            a.Accept()?;
          }
          Ok(())
        })),
        &mut token,
      )?;
      // Screen capture (getDisplayMedia): Windows' own picker would show on the owner's desktop.
      if let Ok(c27) = core.cast::<ICoreWebView2_27>() {
        let e = gated.clone();
        c27.add_ScreenCaptureStarting(
          &ScreenCaptureStartingEventHandler::create(Box::new(move |_, args| {
            if let Some(a) = args {
              a.SetCancel(true)?;
              e.send("Orb.blocked", json!({ "kind": "permission", "permission": "screen-capture" }));
            }
            Ok(())
          })),
          &mut token,
        )?;
      }
      let e = page_emit.clone();
      core.add_ProcessFailed(
        &ProcessFailedEventHandler::create(Box::new(move |_, args| {
          let Some(a) = args else { return Ok(()) };
          let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
          a.ProcessFailedKind(&mut kind)?;
          if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED {
            // The whole browser went: every page with it, and the next page makes the environment again.
            browser_gone();
          } else if [COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED, COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE].contains(&kind) {
            e("Orb.crashed", json!({}));
          }
          Ok(())
        })),
        &mut token,
      )?;
      let e = gated.clone();
      core.add_DocumentTitleChanged(
        &DocumentTitleChangedEventHandler::create(Box::new(move |sender, _| {
          if let Some(c) = sender {
            if e.admit("Orb.title") {
              let title: String = uri(|p| c.DocumentTitle(p)).chars().take(browser_rules::MAX_TITLE).collect();
              (e.emit)("Orb.title", json!({ "title": title }));
            }
          }
          Ok(())
        })),
        &mut token,
      )?;
      // The DevTools events the engine's driver reads.
      let mut receivers = Vec::new();
      for name in browser_rules::CDP_EVENTS {
        let receiver = core.GetDevToolsProtocolEventReceiver(&HSTRING::from(name))?;
        let e = gated.clone();
        receiver.add_DevToolsProtocolEventReceived(
          &DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, args| {
            let Some(a) = args else { return Ok(()) };
            let t0 = std::time::Instant::now();
            // Counted before it is even read; read and cut only when small enough.
            if !e.admit(name) {
              crate::trace::tally("browser.event.dropped.us", t0.elapsed().as_micros() as u64);
              return Ok(());
            }
            let json = uri(|p| a.ParameterObjectAsJson(p));
            if !e.read(name, json.len()) {
              return Ok(());
            }
            if let Some(params) = browser_rules::shrink_event(name, &json) {
              (e.emit)(name, params);
            }
            crate::trace::tally("browser.event.read.us", t0.elapsed().as_micros() as u64);
            Ok(())
          })),
          &mut token,
        )?;
        receivers.push(receiver);
      }
      // A file chooser the page opens (an <input type=file> clicked, showPicker): intercepted here, never shown; the
      // agent learns it was refused. Asked by Rust itself, not through the engine's list of methods.
      let chooser = core.GetDevToolsProtocolEventReceiver(w!("Page.fileChooserOpened"))?;
      let e = gated.clone();
      chooser.add_DevToolsProtocolEventReceived(
        &DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, _| {
          e.send("Orb.blocked", json!({ "kind": "file" }));
          Ok(())
        })),
        &mut token,
      )?;
      receivers.push(chooser);
      let ignore = || CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(())));
      core.CallDevToolsProtocolMethod(w!("Page.enable"), w!("{}"), &ignore())?;
      core.CallDevToolsProtocolMethod(w!("Page.setInterceptFileChooserDialog"), w!(r#"{"enabled":true}"#), &ignore())?;
      core.Navigate(w!("about:blank"))?;
      Ok(Page { hwnd, controller, core, emit: page_emit, _receivers: receivers, ports })
    }
  }

  /// A DevTools method on a page: its result, or the protocol's error message.
  pub fn cdp(id: u32, method: String, params: String, done: Box<dyn FnOnce(Reply) + Send>) {
    let Some(core) = PAGES.with(|p| p.borrow().get(&id).map(|pg| pg.core.clone())) else {
      return done(Err("página cerrada".into()));
    };
    let done: Once<Reply> = Once::new(Box::new(move |r| done(r)));
    let d = done.clone();
    let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |hr, json: String| {
      d.call(match hr {
        Ok(()) => serde_json::from_str(&json).map_err(|e| e.to_string()),
        Err(e) => Err(serde_json::from_str::<Value>(&json).ok().and_then(|v| v.get("message").and_then(Value::as_str).map(str::to_string)).unwrap_or_else(|| e.to_string())),
      });
      Ok(())
    }));
    if let Err(e) = unsafe { core.CallDevToolsProtocolMethod(&HSTRING::from(method), &HSTRING::from(params), &handler) } {
      done.call(Err(e.to_string()));
    }
  }

  pub fn close(id: u32) -> Result<(), String> {
    if let Some(page) = PAGES.with(|p| p.borrow_mut().remove(&id)) {
      let t0 = std::time::Instant::now();
      unsafe {
        let _ = page.controller.Close();
        let _ = DestroyWindow(page.hwnd);
      }
      crate::trace::mark("browser.close", json!({ "page": id, "ms": t0.elapsed().as_millis() as u64 }));
    }
    release_env_if_idle();
    Ok(())
  }

  /// A flooding page is closed at once on this thread (its view and window go, and with its only frame its renderer
  /// process: Chromium ends a busy renderer rather than wait for its script), and the engine hears it as a crash, so the
  /// agent's next action opens a fresh page. Ending the renderer by its process id was tried first
  /// (ICoreWebView2Environment13::GetProcessExtendedInfos to find the main frame's process): on WebView2 runtime
  /// 157 that call made Orb exit during a flood, so it is not used.
  fn stop_flooding(id: u32) {
    let Some(emit) = PAGES.with(|p| p.borrow().get(&id).map(|pg| pg.emit.clone())) else { return };
    let t0 = std::time::Instant::now();
    let _ = close(id);
    crate::trace::mark("browser.flood.closed", json!({ "page": id, "ms": t0.elapsed().as_millis() as u64 }));
    emit("Orb.crashed", json!({}));
  }

  pub fn close_all() {
    for id in PAGES.with(|p| p.borrow().keys().copied().collect::<Vec<_>>()) {
      let _ = close(id);
    }
  }

  /// The browser process exited: its environment is dead. Every page goes (each told Orb.crashed), the pages still
  /// opening fail, and the next page makes the environment again.
  fn browser_gone() {
    let pages: Vec<Page> = PAGES.with(|p| p.borrow_mut().drain().map(|(_, pg)| pg).collect());
    for page in pages {
      (page.emit)("Orb.crashed", json!({}));
      unsafe {
        let _ = page.controller.Close();
        let _ = DestroyWindow(page.hwnd);
      }
    }
    for f in PENDING.with(|p| p.borrow_mut().drain().map(|(_, f)| f).collect::<Vec<_>>()) {
      f.call(Err("el navegador de los agentes se cerró".into()));
    }
    ENV.with(|e| {
      let mut e = e.borrow_mut();
      if matches!(*e, Env::Ready(_)) {
        *e = Env::None;
      }
    });
  }
}

#[cfg(not(windows))]
mod imp {
  use super::*;
  pub fn post(job: Job) -> Result<(), String> {
    job();
    Ok(())
  }
  pub fn open(_: u32, _: PathBuf, _: Emit, done: Box<dyn FnOnce(Reply) + Send>) {
    done(Err("solo en Windows".into()))
  }
  pub fn close(_: u32) -> Result<(), String> {
    Ok(())
  }
  pub fn cdp(_: u32, _: String, _: String, done: Box<dyn FnOnce(Reply) + Send>) {
    done(Err("solo en Windows".into()))
  }
  pub fn close_all() {}
}

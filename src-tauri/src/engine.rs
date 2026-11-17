// The engine: the bundled node.exe running src/engine/engine.mjs with ORB_ENGINE_STDIO=1, one JSON message per line on
// its stdin/stdout (src-tauri/src/pipes.rs). The same life as in Orb 3.8.0:
//   - started with Orb, before the window has loaded; it first says where the workspace is ('locate'), then 'start's;
//   - a call of the window waits until it has started; a crash restarts it (at most 3 times), exit code 75 included
//     («core lost»: it restores core when it starts again); then 'engine:restarted' or 'engine:stopped';
//   - its stderr goes to <workspace>\core\ejecuciones\motor-salida.log;
//   - inside a Job Object that kills it, and every process it started, when Orb ends, even if Orb is killed.
use crate::pipes::{Out, Process};
use crate::protocol::{self, Incoming};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, watch};

pub struct Config {
  pub node: PathBuf,
  /// The engine's code: <src>\engine\engine.mjs, <src>\mcp\server.mjs, <src>\renderer (the phone's page).
  pub src: PathBuf,
  /// The app's data folder (%APPDATA%\Orb.dev, or ORB_USER_DATA).
  pub user_data: PathBuf,
  pub version: String,
  pub packaged: bool,
  /// A separate data folder (ORB_USER_DATA: tests): never an existing workspace of the PC.
  pub separate_data: bool,
  pub documents: Option<PathBuf>,
  pub profile: Option<PathBuf>,
  pub dev_control: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Status {
  /// Started, does not know the workspace yet.
  Booting,
  /// No workspace: the window shows the first-run setup.
  NoHome,
  Starting,
  Ready(Value),
  Failed(String),
  /// Crashed too many times.
  Stopped,
}

type Reply = Result<Value, String>;

pub struct Engine {
  cfg: Config,
  app: AppHandle,
  proc: Mutex<Option<(u64, Process)>>,
  generation: AtomicU64,
  pending: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
  next: AtomicU64,
  status: watch::Sender<Status>,
  home: Mutex<Option<PathBuf>>,
  texts: Mutex<HashMap<String, String>>,
  restarts: AtomicU32,
  quitting: AtomicBool,
  /// Why the last 'start' failed, when the window offers something for it (protocol::Incoming::Started).
  start_code: Mutex<Option<String>>,
  /// The Job Object could not be made or the engine put in it: its processes would outlive a killed Orb.
  job_failed: AtomicBool,
  /// First start after the installer replaced Orb on Electron (migrate.rs): said once, when the engine is ready.
  migrated: AtomicBool,
  /// Orb's lock screen is up (master:locked { screen: true } until master:unlocked): notices without the agents' text.
  screen_locked: AtomicBool,
  #[cfg(windows)]
  job: Option<job::Job>,
}

/// How big the engine's log file grows before it is renamed to motor-salida.1.log (one kept).
const LOG_MAX: u64 = 10 * 1024 * 1024;

impl Engine {
  pub fn new(app: AppHandle, cfg: Config) -> Arc<Self> {
    #[cfg(windows)]
    let job = job::Job::new();
    #[cfg(windows)]
    let job_failed = job.is_err();
    #[cfg(not(windows))]
    let job_failed = false;
    Arc::new(Self {
      job_failed: AtomicBool::new(job_failed),
      migrated: AtomicBool::new(false),
      screen_locked: AtomicBool::new(false),
      start_code: Mutex::new(None),
      cfg,
      app,
      proc: Mutex::new(None),
      generation: AtomicU64::new(0),
      pending: Mutex::new(HashMap::new()),
      next: AtomicU64::new(0),
      status: watch::channel(Status::Booting).0,
      home: Mutex::new(None),
      texts: Mutex::new(HashMap::new()),
      restarts: AtomicU32::new(0),
      quitting: AtomicBool::new(false),
      #[cfg(windows)]
      job: job.ok(),
    })
  }

  /// The app's data folder (%APPDATA%\Orb.dev, or ORB_USER_DATA).
  pub fn user_data(&self) -> PathBuf {
    self.cfg.user_data.clone()
  }
  pub fn home(&self) -> Option<PathBuf> {
    self.home.lock().unwrap().clone()
  }
  pub fn status(&self) -> Status {
    self.status.borrow().clone()
  }
  pub fn status_watch(&self) -> watch::Receiver<Status> {
    self.status.subscribe()
  }
  pub fn is_running(&self) -> bool {
    self.proc.lock().unwrap().is_some()
  }
  /// Orb is closing on purpose: the engine ending now is not a crash.
  /// The window will say once that Orb moved from Electron (migrate.rs).
  pub fn set_migrated(&self) {
    self.migrated.store(true, Ordering::SeqCst);
  }

  pub fn screen_locked(&self) -> bool {
    self.screen_locked.load(Ordering::SeqCst)
  }

  pub fn begin_quit(&self) {
    self.quitting.store(true, Ordering::SeqCst);
  }
  pub fn quitting(&self) -> bool {
    self.quitting.load(Ordering::SeqCst)
  }

  /// A text of the app in the language of the settings.
  pub fn t(&self, key: &str, vars: &[(&str, String)]) -> String {
    protocol::translate(&self.texts.lock().unwrap(), key, vars)
  }
  fn t_name(&self, key: &str) -> String {
    self.t(key, &[("name", "Orb".into())])
  }

  fn spawn(self: &Arc<Self>) -> Result<(), String> {
    let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
    // The page server of a previous engine is gone: its port must not be proxied (it may belong to someone else now).
    crate::pages::set_port(None);
    let mut cmd = Command::new(&self.cfg.node);
    // Node reads NODE_OPTIONS (--require, --import: code run inside the engine), NODE_PATH and the rest of NODE_* from the
    // environment; Electron had them off (its fuse). None of the user's reaches the engine or what it starts.
    for name in protocol::env_matching(protocol::node_vars::<Vec<String>>) {
      cmd.env_remove(name);
    }
    cmd
      .arg(self.cfg.src.join("engine").join("engine.mjs"))
      .env("ORB_ENGINE_STDIO", "1")
      .env("ORB_NODE", &self.cfg.node)
      .env("ORB_MCP_SCRIPT", self.cfg.src.join("mcp").join("server.mjs"))
      .env("ORB_RENDERER", self.cfg.src.join("renderer"))
      // ORB_DEV_CONTROL: only a build from the code started with ORB_DEV_CONTROL=1, whatever the environment says.
      .env("ORB_DEV_CONTROL", if self.cfg.dev_control { "1" } else { "0" })
      // Agent HTML pages are framed through Orb's own scheme (pages.rs); a debug build also lets the dev server frame them.
      .env("ORB_PAGES_ORIGIN", crate::pages::ORIGIN)
      .env("ORB_PAGES_DEV", if cfg!(debug_assertions) { "1" } else { "0" })
      .current_dir(&self.cfg.src);
    // The vault's channel for this engine only (vault_host.rs): without it the engine does not start.
    let (vault_name, serve_vault) = crate::vault_host::channel()?;
    cmd.env("ORB_VAULT_PIPE", &vault_name);
    #[cfg(windows)]
    {
      use std::os::windows::process::CommandExt;
      cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Out>();
    let log = self.clone();
    let process = Process::spawn(cmd, move |o| drop(tx.send(o)), move |bytes| log.append_log(bytes)).map_err(|e| e.to_string())?;
    // Assigned right after the start: the engine starts nothing of its own before 'locate' (the moment in between is
    // accepted). If it fails, its processes would outlive a killed Orb: said in the log and to the user once started.
    #[cfg(windows)]
    match &self.job {
      Some(job) => {
        if let Err(e) = process.with_child(|c| job.assign(c)).unwrap_or(Ok(())) {
          self.job_failed.store(true, Ordering::SeqCst);
          self.append_log(format!("\n[orb] el motor no entró en el Job Object: {e}\n").as_bytes());
        }
      }
      None => self.append_log(b"\n[orb] sin Job Object para el motor\n"),
    }
    if let Some(pid) = process.with_child(|c| c.id()) {
      serve_vault(pid);
    }
    *self.proc.lock().unwrap() = Some((generation, process));
    let me = self.clone();
    tauri::async_runtime::spawn(async move {
      while let Some(o) = rx.recv().await {
        match o {
          Out::Line(line) => me.on_line(&line),
          Out::TooLong(n) => me.append_log(format!("\n[orb] línea del motor de {n} bytes descartada (máx. {} MB)\n", crate::pipes::MAX_LINE >> 20).as_bytes()),
          Out::Exit(code) => {
            me.on_exit(generation, code);
            break;
          }
        }
      }
    });
    Ok(())
  }

  /// Starts the engine, finds the workspace and starts it there. `restarted`: the exit code of the crash that led here.
  pub async fn boot(self: Arc<Self>, restarted: Option<Option<i32>>) {
    if !self.is_running() {
      if let Err(e) = self.spawn() {
        self.status.send_replace(Status::Failed(format!("{}: {e}", self.t_name("sys.main.engineStartStopped"))));
        return;
      }
    }
    if self.home().is_none() {
      let located = self
        .request(
          "locate",
          json!({ "userData": self.cfg.user_data, "packaged": self.cfg.packaged, "separateData": self.cfg.separate_data,
                  "documents": self.cfg.documents, "profile": self.cfg.profile }),
          Duration::from_secs(30),
        )
        .await;
      match located {
        Ok(v) => *self.home.lock().unwrap() = v.get("home").and_then(Value::as_str).map(PathBuf::from),
        Err(e) => {
          self.status.send_replace(Status::Failed(e));
          return;
        }
      }
    }
    self.refresh_texts().await;
    if self.home().is_none() {
      self.status.send_replace(Status::NoHome);
      return;
    }
    if self.start(false).await.is_ok() {
      if let Some(code) = restarted {
        self.emit_event("engine:restarted", json!({ "code": code }));
      }
    }
  }

  /// The texts of the app's dialogs and errors, in the language of the settings (again after config:changed).
  pub async fn refresh_texts(&self) {
    if let Ok(Value::Object(m)) = self.request("texts", json!({ "home": self.home() }), Duration::from_secs(10)).await {
      *self.texts.lock().unwrap() = m.into_iter().filter_map(|(k, v)| v.as_str().map(|s| (k, s.to_string()))).collect();
    }
  }

  /// 'start' in the workspace; resolves when the engine says it has started (or why it could not). `new_secret`: the user
  /// chose to start with a new key after the sealed ones could not be opened (secretUnreadable).
  pub async fn start(&self, new_secret: bool) -> Result<Value, String> {
    let mut rx = self.status.subscribe();
    *self.start_code.lock().unwrap() = None;
    self.status.send_replace(Status::Starting);
    // hostSecret: this PC's secret is opened by the vault in this app (orb-vault › machine.rs, DPAPI); the engine asks it
    // and gets only the keys made from it.
    // The agents' browser lives in the engine, with this app's hidden pages (browser 'host': browser.rs).
    // screenLocked: an engine that restarts while Orb's lock screen is up (a crash) comes back locked.
    let start = json!({ "type": "start", "screenLocked": self.screen_locked(), "home": self.home(), "version": self.cfg.version, "secret": null, "hostSecret": true, "newSecret": new_secret, "browser": "host", "userData": self.cfg.user_data });
    if !self.send(&start) {
      let e = self.t_name("sys.main.engineOff");
      self.status.send_replace(Status::Failed(e.clone()));
      return Err(e);
    }
    let s = rx.wait_for(|s| !matches!(s, Status::Starting)).await.map(|s| s.clone()).unwrap_or(Status::Stopped);
    match s {
      Status::Ready(v) => Ok(v),
      Status::Failed(e) => Err(e),
      _ => Err(self.t_name("sys.main.engineStartStopped")),
    }
  }

  /// A message for the engine that needs no answer and may be dropped (the agents' browser pages' events): never more
  /// than 32 MB of them waiting for an engine that cannot keep up.
  pub fn notify(&self, message: &Value) -> bool {
    self.proc.lock().unwrap().as_ref().map(|(_, p)| p.send_droppable(protocol::encode(message), 32 * 1024 * 1024)).unwrap_or(false)
  }

  fn send(&self, message: &Value) -> bool {
    self.proc.lock().unwrap().as_ref().map(|(_, p)| p.send(protocol::encode(message))).unwrap_or(false)
  }

  /// One of the app's messages that the engine answers with { type: 'reply', id }.
  pub async fn request(&self, kind: &str, fields: Value, timeout: Duration) -> Reply {
    let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
    let (tx, rx) = oneshot::channel();
    self.pending.lock().unwrap().insert(id, tx);
    // Whatever way this future ends (an answer, its own timeout, or dropped by call()'s outer timeout), its entry goes.
    struct Unpend<'a>(&'a Mutex<HashMap<u64, oneshot::Sender<Reply>>>, u64);
    impl Drop for Unpend<'_> {
      fn drop(&mut self) {
        if let Ok(mut p) = self.0.lock() {
          p.remove(&self.1);
        }
      }
    }
    let _unpend = Unpend(&self.pending, id);
    let mut message = match fields {
      Value::Object(m) => m,
      _ => Map::new(),
    };
    message.insert("type".into(), json!(kind));
    message.insert("id".into(), json!(id));
    if !self.send(&Value::Object(message)) {
      self.pending.lock().unwrap().remove(&id);
      return Err(self.t_name("sys.main.engineOff"));
    }
    match tokio::time::timeout(timeout, rx).await {
      Ok(Ok(reply)) => reply,
      Ok(Err(_)) => Err(self.t_name("sys.main.engineStopped")),
      Err(_) => {
        self.pending.lock().unwrap().remove(&id);
        Err(self.t_name("sys.main.engineTimeout"))
      }
    }
  }

  /// Why the last start failed, when the window offers something for it.
  pub fn start_code(&self) -> Option<String> {
    self.start_code.lock().unwrap().clone()
  }

  /// The window's «Reintentar» (and «Empezar con una clave nueva») after the start failed: the engine started again if it
  /// is gone, the workspace looked for again if that failed, or 'start' again.
  pub async fn retry(self: Arc<Self>, new_secret: bool) -> Result<(), String> {
    match self.status() {
      Status::Failed(_) | Status::Stopped => {}
      _ => return Ok(()),
    }
    if !self.is_running() {
      self.restarts.store(0, Ordering::SeqCst);
      self.status.send_replace(Status::Booting);
      self.clone().boot(None).await;
    } else if self.home().is_none() {
      self.status.send_replace(Status::Booting);
      self.clone().boot(None).await;
    } else {
      let _ = self.start(new_secret).await;
    }
    match self.status() {
      Status::Failed(e) => Err(e),
      _ => Ok(()),
    }
  }

  /// Orb is not closing after all (the installer of a new version could not be started after the engine was stopped
  /// for it): the engine starts again, as after a crash.
  pub async fn resume(self: Arc<Self>) {
    self.quitting.store(false, Ordering::SeqCst);
    if self.is_running() {
      return;
    }
    self.restarts.store(0, Ordering::SeqCst);
    self.status.send_replace(if self.home().is_some() { Status::Starting } else { Status::Booting });
    self.boot(Some(None)).await;
  }

  /// A call of the window (or of the app: app.state before closing): waits until the engine has started. `timeout` is
  /// the whole call's, the wait for the start included (an engine stuck starting never hangs a call, or closing Orb).
  pub async fn call(&self, method: &str, params: Value, timeout: Duration) -> Reply {
    let work = async {
      let mut rx = self.status.subscribe();
      let s = rx.wait_for(|s| !matches!(s, Status::Booting | Status::Starting)).await.map(|s| s.clone()).unwrap_or(Status::Stopped);
      match s {
        Status::Ready(_) => self.request("call", json!({ "method": method, "params": params }), timeout).await,
        Status::Failed(e) => Err(e),
        _ => Err(self.t_name("sys.main.engineOff")),
      }
    };
    tokio::time::timeout(timeout, work).await.unwrap_or_else(|_| Err(self.t_name("sys.main.engineTimeout")))
  }

  /// Hands an event to the emitter thread (`emit_queue`), never to the window: the reader of the engine's output does
  /// not wait for the UI thread, and a burst of events reaches the page as one message.
  fn emit_event(&self, event: &str, payload: Value) {
    crate::trace::tally("ui.emit", 0);
    let item = json!({ "event": event, "payload": payload });
    let queue = EMIT_QUEUE.get_or_init(|| emit_queue(self.app.clone()));
    // The thread is gone (it never started, or died): straight to the window as before, never lost.
    if let Err(std::sync::mpsc::SendError(item)) = queue.send(item) {
      let _ = self.app.emit_to("main", "engine:event", item);
    }
  }

  fn on_line(self: &Arc<Self>, line: &str) {
    crate::trace::tally("engine.line.bytes", line.len() as u64);
    match protocol::decode(line) {
      Incoming::Reply { id, result } => {
        if let Some(tx) = self.pending.lock().unwrap().remove(&id) {
          let _ = tx.send(result);
        }
      }
      Incoming::Started { result, code } => {
        *self.start_code.lock().unwrap() = code;
        self.status.send_replace(match result {
          Ok(v) => {
            crate::window::set_title(&self.app, v.get("name").and_then(Value::as_str));
            if self.migrated.swap(false, Ordering::SeqCst) {
              self.emit_event("notice", json!({ "body": self.t_name("sys.main.migratedFromElectron"), "tone": "info" }));
            }
            if self.job_failed.load(Ordering::SeqCst) {
              self.emit_event("notice", json!({ "body": self.t_name("sys.main.noJob"), "tone": "warning" }));
            }
            Status::Ready(v)
          }
          Err(e) => Status::Failed(e),
        });
      }
      Incoming::Event { event, payload } => {
        // Orb's own lock screen (idle, or Windows locked): notices stop showing the agents' text.
        if let Some(locked) = protocol::screen_lock_of(&event, &payload) {
          self.screen_locked.store(locked, Ordering::SeqCst);
        }
        if event == "html:server" {
          crate::pages::set_port(payload.get("port").and_then(Value::as_u64));
        }
        if event == "chat:new" {
          let log = crate::window::hidden(&self.app).then(|| self.cfg.user_data.join("avisos-e2e.jsonl"));
          crate::notify::chat_new(&self.app, &payload, log);
        }
        if event == "config:changed" {
          crate::window::set_title(&self.app, payload.get("assistantName").and_then(Value::as_str));
          let me = self.clone();
          tauri::async_runtime::spawn(async move { me.refresh_texts().await });
        }
        if event == "backup:progress" {
          crate::updater::backup_progress(&self.app, &payload);
        }
        self.emit_event(&event, payload);
      }
      Incoming::Host { id, method, params } => {
        let me = self.clone();
        tauri::async_runtime::spawn(async move {
          let reply = match crate::host::handle(&me.app, &method, &params).await {
            Ok(result) => json!({ "type": "hostReply", "id": id, "ok": true, "result": result }),
            Err(e) => json!({ "type": "hostReply", "id": id, "ok": false, "error": e.message, "code": e.code }),
          };
          me.send(&reply);
        });
      }
      Incoming::Unknown => {}
    }
  }

  fn on_exit(self: &Arc<Self>, generation: u64, code: Option<i32>) {
    {
      let mut proc = self.proc.lock().unwrap();
      if proc.as_ref().map(|(g, _)| *g) != Some(generation) {
        return;
      }
      *proc = None;
    }
    crate::pages::set_port(None);
    // The agents' browser pages and its little window belonged to the engine that went.
    crate::browser::close_all();
    if let Some(w) = self.app.get_webview_window("pip") {
      let _ = w.hide();
    }
    let stopped = self.t_name("sys.main.engineStopped");
    for (_, tx) in self.pending.lock().unwrap().drain() {
      let _ = tx.send(Err(stopped.clone()));
    }
    if self.quitting() {
      return;
    }
    self.append_log(format!("\n[orb] el motor terminó (código {code:?})\n").as_bytes());
    if matches!(self.status(), Status::Starting | Status::Booting) {
      self.status.send_replace(Status::Failed(self.t_name("sys.main.engineStartStopped")));
    }
    // A crash of the engine is not the end of the app: it is started again (at most 3 times per session).
    if self.restarts.fetch_add(1, Ordering::SeqCst) < 3 {
      let me = self.clone();
      if me.home().is_some() {
        me.status.send_replace(Status::Starting);
      } else {
        me.status.send_replace(Status::Booting);
      }
      tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(1)).await;
        me.boot(Some(code)).await;
      });
    } else {
      self.status.send_replace(Status::Stopped);
      self.emit_event("engine:stopped", json!({ "code": code }));
    }
  }

  /// The first-run setup: the engine creates the workspace and remembers it; then it starts there.
  pub async fn setup(&self, data: Value) -> Reply {
    // Only when the engine said there is no workspace: never after it failed to look for one (the real one may exist).
    if self.home().is_some() || self.status() != Status::NoHome {
      return Err(self.t("sys.main.alreadySetup", &[]));
    }
    let mut fields = match data {
      Value::Object(m) => m,
      _ => Map::new(),
    };
    fields.retain(|k, _| ["base", "assistantName", "userName", "language"].contains(&k.as_str()));
    fields.insert("userData".into(), json!(self.cfg.user_data));
    let v = self.request("setup", Value::Object(fields), Duration::from_secs(60)).await?;
    let home = v.get("home").and_then(Value::as_str).map(PathBuf::from).ok_or_else(|| self.t("sys.main.notHome", &[]))?;
    *self.home.lock().unwrap() = Some(home.clone());
    self.refresh_texts().await;
    self.start(false).await?;
    Ok(json!({ "home": home }))
  }

  /// Another workspace: remembered (only an Orb workspace) for the restart that follows.
  pub async fn switch_home(&self, target: &str) -> Result<(), String> {
    let v = self.request("switchHome", json!({ "userData": self.cfg.user_data, "target": target }), Duration::from_secs(10)).await?;
    if v.get("ok").and_then(Value::as_bool) == Some(true) {
      Ok(())
    } else {
      Err(self.t("sys.main.notHome", &[]))
    }
  }

  /// Orb is closing: 'shutdown', and at most `wait` for the engine to finish its last writes; the Job Object ends what
  /// is left when Orb's process goes.
  pub fn shutdown(&self, wait: Duration) {
    self.quitting.store(true, Ordering::SeqCst);
    self.send(&json!({ "type": "shutdown" }));
    let end = std::time::Instant::now() + wait;
    while std::time::Instant::now() < end {
      let gone = self.proc.lock().unwrap().as_ref().map(|(_, p)| p.exited()).unwrap_or(true);
      if gone {
        return;
      }
      std::thread::sleep(Duration::from_millis(50));
    }
    if let Some((_, p)) = self.proc.lock().unwrap().as_ref() {
      p.kill();
    }
  }

  fn log_file(&self) -> PathBuf {
    match self.home() {
      Some(h) => h.join("core").join("ejecuciones").join("motor-salida.log"),
      None => self.cfg.user_data.join("motor-salida.log"),
    }
  }

  /// One line of the app's own in the engine's log (motor-salida.log), for what nobody would see otherwise.
  pub fn log_line(&self, line: &str) {
    self.append_log(format!("
[orb] {line}
").as_bytes());
  }

  fn append_log(&self, bytes: &[u8]) {
    let file = self.log_file();
    if let Some(dir) = file.parent() {
      let _ = std::fs::create_dir_all(dir);
    }
    // At LOG_MAX it becomes motor-salida.1.log (the one before is dropped): an engine flooding stderr never fills the disk.
    if std::fs::metadata(&file).map(|m| m.len() > LOG_MAX).unwrap_or(false) {
      let _ = std::fs::rename(&file, file.with_extension("1.log"));
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(file) {
      let _ = f.write_all(bytes);
    }
  }
}

/// The engine's state for the commands.
pub fn get(app: &AppHandle) -> Arc<Engine> {
  app.state::<Arc<Engine>>().inner().clone()
}

#[cfg(windows)]
mod job {
  use std::os::windows::io::AsRawHandle;
  use windows::Win32::Foundation::HANDLE;
  use windows::Win32::System::JobObjects::*;

  /// A Job Object that kills its processes when its last handle closes (Orb's process ending, even killed). Programs
  /// that must outlive Orb (a terminal, an editor) are started by Rust itself, outside it (host.rs).
  pub struct Job(HANDLE);
  unsafe impl Send for Job {}
  unsafe impl Sync for Job {}

  impl Job {
    pub fn new() -> windows::core::Result<Self> {
      unsafe {
        let job = CreateJobObjectW(None, None)?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        // No BREAKAWAY_OK: nothing the engine or an agent starts may leave the job (CREATE_BREAKAWAY_FROM_JOB) and outlive
        // Orb. What must outlive it (a terminal, an editor) Rust starts itself (host.rs).
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(job, JobObjectExtendedLimitInformation, &info as *const _ as _, std::mem::size_of_val(&info) as u32)?;
        Ok(Self(job))
      }
    }

    pub fn assign(&self, child: &std::process::Child) -> windows::core::Result<()> {
      unsafe { AssignProcessToJobObject(self.0, HANDLE(child.as_raw_handle() as _)) }
    }
  }
  // The handle is never closed: it lives as long as Orb's process, and closing it is what kills the engine.
}

static EMIT_QUEUE: std::sync::OnceLock<std::sync::mpsc::Sender<Value>> = std::sync::OnceLock::new();

/// The most events sent to the window in one message: a burst is cut here so one eval never grows without bound.
const EMIT_BATCH: usize = 64;
/// ... and at about this many bytes (a single bigger event still goes out alone).
const EMIT_BATCH_BYTES: usize = 2 << 20;

/// How long the emitter waits after the first event of a batch for more to arrive. The window's thread is slow
/// when the PC is busy, but `emit_to` only queues a script, so without this pause the channel is always drained
/// the instant it is read and events leave one by one. A few ms is under a frame and lets a burst travel together.
const EMIT_WINDOW: std::time::Duration = std::time::Duration::from_millis(4);

/// A cheap size estimate of an event (its strings), so the batch can be cut by bytes without serializing it twice.
fn approx_bytes(v: &Value) -> usize {
  match v {
    Value::String(s) => s.len() + 2,
    Value::Array(a) => a.iter().map(approx_bytes).sum::<usize>() + 2,
    Value::Object(o) => o.iter().map(|(k, v)| k.len() + 3 + approx_bytes(v)).sum::<usize>() + 2,
    _ => 8,
  }
}

/// Builds one batch starting at `first`: whatever is already queued, then whatever arrives within `window`, cut at
/// EMIT_BATCH events or EMIT_BATCH_BYTES. Order is the channel's order and nothing is dropped.
fn collect_batch(rx: &std::sync::mpsc::Receiver<Value>, first: Value, window: std::time::Duration) -> Vec<Value> {
  let deadline = std::time::Instant::now() + window;
  let mut bytes = approx_bytes(&first);
  let mut batch = vec![first];
  while batch.len() < EMIT_BATCH && bytes < EMIT_BATCH_BYTES {
    let next = match rx.try_recv() {
      Ok(v) => v,
      Err(std::sync::mpsc::TryRecvError::Empty) => {
        let left = deadline.saturating_duration_since(std::time::Instant::now());
        if left.is_zero() { break; }
        match rx.recv_timeout(left) {
          Ok(v) => v,
          Err(_) => break,
        }
      }
      Err(_) => break,
    };
    bytes += approx_bytes(&next);
    batch.push(next);
  }
  batch
}

/// A thread that sends the engine's events to the window in order. Every `emit_to` is a script evaluated on the UI
/// thread (WebView2); when that thread is slow (the PC busy) the events would pile up there one by one, each with its
/// own evaluation. Here whatever has queued up (plus what arrives in the next few ms) goes out together as one
/// `engine:events` array (tauri-bridge.js fires them in order), so the UI thread has one evaluation to do, not dozens.
fn emit_queue(app: AppHandle) -> std::sync::mpsc::Sender<Value> {
  let (tx, rx) = std::sync::mpsc::channel::<Value>();
  let spawned = std::thread::Builder::new().name("engine-emit".into()).spawn(move || {
    while let Ok(first) = rx.recv() {
      let batch = collect_batch(&rx, first, EMIT_WINDOW);
      crate::trace::tally("ui.emit.batch", batch.len() as u64);
      let _ = app.emit_to("main", "engine:events", batch);
    }
  });
  if let Err(e) = spawned {
    eprintln!("[orb] engine-emit thread: {e}");
  }
  tx
}

#[cfg(test)]
mod emit_batch_tests {
  use super::*;
  use std::sync::mpsc::channel;
  use std::time::Duration;

  #[test]
  fn queued_events_go_in_order_in_one_batch() {
    let (tx, rx) = channel::<Value>();
    for i in 0..10 { tx.send(serde_json::json!({ "n": i })).unwrap(); }
    let first = rx.recv().unwrap();
    let batch = collect_batch(&rx, first, Duration::from_millis(1));
    let order: Vec<i64> = batch.iter().map(|v| v["n"].as_i64().unwrap()).collect();
    assert_eq!(order, (0..10).collect::<Vec<_>>());
  }

  #[test]
  fn events_arriving_within_the_window_join_the_batch() {
    let (tx, rx) = channel::<Value>();
    tx.send(serde_json::json!({ "n": 0 })).unwrap();
    let t = std::thread::spawn(move || {
      std::thread::sleep(Duration::from_millis(5));
      tx.send(serde_json::json!({ "n": 1 })).unwrap();
    });
    let first = rx.recv().unwrap();
    let batch = collect_batch(&rx, first, Duration::from_millis(500));
    t.join().unwrap();
    assert_eq!(batch.len(), 2);
  }

  #[test]
  fn a_burst_is_cut_at_the_batch_size_and_nothing_is_lost() {
    let (tx, rx) = channel::<Value>();
    for i in 0..(EMIT_BATCH + 5) { tx.send(serde_json::json!({ "n": i })).unwrap(); }
    drop(tx);
    let first = rx.recv().unwrap();
    let a = collect_batch(&rx, first, Duration::from_millis(1));
    assert_eq!(a.len(), EMIT_BATCH);
    let first = rx.recv().unwrap();
    let b = collect_batch(&rx, first, Duration::from_millis(1));
    assert_eq!(b.len(), 5);
    assert_eq!(b[0]["n"].as_i64().unwrap(), EMIT_BATCH as i64);
  }

  #[test]
  fn a_lone_event_leaves_after_the_window() {
    let (_tx, rx) = channel::<Value>();
    let t = std::time::Instant::now();
    let batch = collect_batch(&rx, serde_json::json!({ "n": 0 }), Duration::from_millis(4));
    assert_eq!(batch.len(), 1);
    assert!(t.elapsed() < Duration::from_millis(200));
  }
}

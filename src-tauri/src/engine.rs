// The engine: the bundled node.exe running src/engine/engine.mjs with ORB_ENGINE_STDIO=1, one JSON message per line on
// its stdin/stdout (src-tauri/src/pipes.rs). The same life as under Electron's main.mjs:
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
  #[cfg(windows)]
  job: Option<job::Job>,
}

impl Engine {
  pub fn new(app: AppHandle, cfg: Config) -> Arc<Self> {
    Arc::new(Self {
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
      job: job::Job::new().map_err(|e| eprintln!("motor: sin Job Object: {e}")).ok(),
    })
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
    let mut cmd = Command::new(&self.cfg.node);
    cmd
      .arg(self.cfg.src.join("engine").join("engine.mjs"))
      .env("ORB_ENGINE_STDIO", "1")
      .env("ORB_NODE", &self.cfg.node)
      .env("ORB_MCP_SCRIPT", self.cfg.src.join("mcp").join("server.mjs"))
      .env("ORB_RENDERER", self.cfg.src.join("renderer"))
      // ORB_DEV_CONTROL (3.1): only a build from the code started with ORB_DEV_CONTROL=1, whatever the environment says.
      .env("ORB_DEV_CONTROL", if self.cfg.dev_control { "1" } else { "0" })
      .current_dir(&self.cfg.src);
    #[cfg(windows)]
    {
      use std::os::windows::process::CommandExt;
      cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Out>();
    let log = self.clone();
    let process = Process::spawn(cmd, move |o| drop(tx.send(o)), move |bytes| log.append_log(bytes)).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    if let Some(job) = &self.job {
      if let Err(e) = process.with_child(|c| job.assign(c)).unwrap_or(Ok(())) {
        eprintln!("motor: Job Object: {e}");
      }
    }
    *self.proc.lock().unwrap() = Some((generation, process));
    let me = self.clone();
    tauri::async_runtime::spawn(async move {
      while let Some(o) = rx.recv().await {
        match o {
          Out::Line(line) => me.on_line(&line),
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
    if let Err(e) = self.spawn() {
      self.status.send_replace(Status::Failed(format!("{}: {e}", self.t_name("sys.main.engineStartStopped"))));
      return;
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
    if self.start().await.is_ok() {
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

  /// 'start' in the workspace; resolves when the engine says it has started (or why it could not).
  pub async fn start(&self) -> Result<Value, String> {
    let mut rx = self.status.subscribe();
    self.status.send_replace(Status::Starting);
    // D3: no secret yet (host.unseal comes with the secrets step): the engine uses the plain key of a new workspace and
    // refuses one whose key Electron sealed (engine.mjs › start).
    let start = json!({ "type": "start", "home": self.home(), "version": self.cfg.version, "secret": null, "browser": null, "userData": self.cfg.user_data });
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

  fn send(&self, message: &Value) -> bool {
    self.proc.lock().unwrap().as_ref().map(|(_, p)| p.send(protocol::encode(message))).unwrap_or(false)
  }

  /// One of the app's messages that the engine answers with { type: 'reply', id }.
  pub async fn request(&self, kind: &str, fields: Value, timeout: Duration) -> Reply {
    let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
    let (tx, rx) = oneshot::channel();
    self.pending.lock().unwrap().insert(id, tx);
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

  /// A call of the window (or of the app: app.state before closing): waits until the engine has started.
  pub async fn call(&self, method: &str, params: Value, timeout: Duration) -> Reply {
    let mut rx = self.status.subscribe();
    let s = rx.wait_for(|s| !matches!(s, Status::Booting | Status::Starting)).await.map(|s| s.clone()).unwrap_or(Status::Stopped);
    match s {
      Status::Ready(_) => self.request("call", json!({ "method": method, "params": params }), timeout).await,
      Status::Failed(e) => Err(e),
      _ => Err(self.t_name("sys.main.engineOff")),
    }
  }

  fn emit_event(&self, event: &str, payload: Value) {
    let _ = self.app.emit_to("main", "engine:event", json!({ "event": event, "payload": payload }));
  }

  fn on_line(self: &Arc<Self>, line: &str) {
    match protocol::decode(line) {
      Incoming::Reply { id, result } => {
        if let Some(tx) = self.pending.lock().unwrap().remove(&id) {
          let _ = tx.send(result);
        }
      }
      Incoming::Started(result) => {
        self.status.send_replace(match result {
          Ok(v) => {
            crate::window::set_title(&self.app, v.get("name").and_then(Value::as_str));
            Status::Ready(v)
          }
          Err(e) => Status::Failed(e),
        });
      }
      Incoming::Event { event, payload } => {
        if event == "config:changed" {
          crate::window::set_title(&self.app, payload.get("assistantName").and_then(Value::as_str));
          let me = self.clone();
          tauri::async_runtime::spawn(async move { me.refresh_texts().await });
        }
        self.emit_event(&event, payload);
      }
      Incoming::Host { id, method, params } => {
        let me = self.clone();
        tauri::async_runtime::spawn(async move {
          let reply = match crate::host::handle(&me.app, &method, &params).await {
            Ok(result) => json!({ "type": "hostReply", "id": id, "ok": true, "result": result }),
            Err(error) => json!({ "type": "hostReply", "id": id, "ok": false, "error": error }),
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
    if self.home().is_some() {
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
    self.start().await?;
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

  fn append_log(&self, bytes: &[u8]) {
    let file = self.log_file();
    if let Some(dir) = file.parent() {
      let _ = std::fs::create_dir_all(dir);
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
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;
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

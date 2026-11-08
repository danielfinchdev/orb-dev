// Timing marks for the e2e build only (ORB_TRACE=1 with ORB_USER_DATA): where Orb's threads spend their time, written as
// JSON lines to <ORB_USER_DATA>\trace-e2e.jsonl with milliseconds since the app started. A watchdog posts a no-op to the
// UI thread every 50 ms and writes down every time it waited more than 100 ms, so a stall shows next to what the other
// marks were doing then (the agents' browser thread, its events per second, closing a page). Nothing of this is compiled
// into the release build.
#[cfg(feature = "e2e")]
mod imp {
  use serde_json::{json, Value};
  use std::io::Write as _;
  use std::sync::{Mutex, OnceLock};
  use std::time::{Duration, Instant};
  use tauri::AppHandle;

  struct Trace {
    start: Instant,
    file: Mutex<std::fs::File>,
  }
  static TRACE: OnceLock<Option<Trace>> = OnceLock::new();

  fn get() -> Option<&'static Trace> {
    TRACE
      .get_or_init(|| {
        if std::env::var("ORB_TRACE").as_deref() != Ok("1") {
          return None;
        }
        let dir = std::env::var_os("ORB_USER_DATA").filter(|v| !v.is_empty())?;
        let file = std::fs::OpenOptions::new().create(true).append(true).open(std::path::Path::new(&dir).join("trace-e2e.jsonl")).ok()?;
        Some(Trace { start: Instant::now(), file: Mutex::new(file) })
      })
      .as_ref()
  }

  pub fn on() -> bool {
    get().is_some()
  }

  pub fn mark(what: &str, detail: Value) {
    if let Some(t) = get() {
      // w: the wall clock (Unix ms), to set the marks beside a test's own timings.
      let w = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
      let line = json!({ "t": t.start.elapsed().as_millis() as u64, "w": w, "thread": std::thread::current().name().unwrap_or("?"), "what": what, "detail": detail });
      let _ = writeln!(t.file.lock().unwrap(), "{line}");
    }
  }

  /// Counts something (events, bytes, microseconds spent) and writes the totals once a second per key.
  pub fn tally(what: &str, n: u64) {
    if get().is_none() {
      return;
    }
    static TALLY: OnceLock<Mutex<std::collections::HashMap<String, (Instant, u64, u64)>>> = OnceLock::new();
    let flush = {
      let mut m = TALLY.get_or_init(Default::default).lock().unwrap();
      let e = m.entry(what.to_string()).or_insert((Instant::now(), 0, 0));
      e.1 += 1;
      e.2 += n;
      if e.0.elapsed() >= Duration::from_secs(1) {
        let out = (e.1, e.2);
        *e = (Instant::now(), 0, 0);
        Some(out)
      } else {
        None
      }
    };
    if let Some((count, sum)) = flush {
      mark("tally", json!({ "key": what, "count": count, "sum": sum }));
    }
  }

  pub fn watch_ui(app: &AppHandle) {
    if !on() {
      return;
    }
    // A panic (caught or not) is written down first, next to the other marks.
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
      mark("panic", json!({ "info": info.to_string() }));
      previous(info);
    }));
    // The engine alone (no UI thread): app.state straight from Rust every 250 ms.
    let handle = app.clone();
    let _ = std::thread::Builder::new().name("trace-engine".into()).spawn(move || loop {
      std::thread::sleep(Duration::from_millis(250));
      let engine = crate::engine::get(&handle);
      let t0 = Instant::now();
      let ok = tauri::async_runtime::block_on(engine.call("app.state", json!({}), Duration::from_secs(30))).is_ok();
      let ms = t0.elapsed().as_millis() as u64;
      if ms > 100 {
        mark("engine.stall", json!({ "ms": ms, "ok": ok }));
      }
    });
    let app = app.clone();
    let _ = std::thread::Builder::new().name("trace-ui".into()).spawn(move || loop {
      // A control: how late a plain thread wakes up (the whole PC busy) next to how late the UI thread answers.
      let slept = Instant::now();
      std::thread::sleep(Duration::from_millis(50));
      let late = slept.elapsed().as_millis() as u64;
      if late > 150 {
        mark("sched.stall", json!({ "ms": late }));
      }
      let (tx, rx) = std::sync::mpsc::channel();
      let sent = Instant::now();
      if app.run_on_main_thread(move || { let _ = tx.send(()); }).is_err() {
        return;
      }
      let _ = rx.recv();
      let waited = sent.elapsed().as_millis() as u64;
      if waited > 100 {
        mark("ui.stall", json!({ "ms": waited }));
      }
    });
  }
}

#[cfg(not(feature = "e2e"))]
mod imp {
  pub fn on() -> bool {
    false
  }
  pub fn mark(_: &str, _: serde_json::Value) {}
  pub fn watch_ui(_: &tauri::AppHandle) {}
  pub fn tally(_: &str, _: u64) {}
}

pub use imp::{mark, on, tally, watch_ui};

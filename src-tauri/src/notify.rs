// Notices while Orb's window is in the background: a new message of the chat (finished tasks, approvals, the assistant's
// answers), as Electron's main.mjs did. Windows' own notification (WinRT ToastNotification), because only it says when it
// is clicked: the click brings Orb to the front on that conversation ('ui:navigate'). An installed Orb shows them as
// itself (the installer sets the AUMID dev.orb.app on its shortcuts); a build run from the code has no shortcut, so
// Windows shows them as PowerShell's. A test build with its window hidden writes them to <test data>\avisos-e2e.jsonl
// instead of showing them (nobody at the PC).
//   - Never in the way of the engine: the engine's messages are handled on one thread, so a notice only goes into a
//     small table, one per conversation (a later one replaces the one still waiting); one thread of its own looks at
//     the window (which waits for Orb's UI thread) and shows them (WinRT's Show waits too).
//   - Never a flood, never a lost one: at most one per conversation every 3 s and 12 a minute in all; what comes faster
//     waits and the conversation's latest is shown when its turn comes (an approval asked right after an answer is not
//     dropped). Each conversation's replaces its previous one in the Action Center (tag = the conversation, group = Orb).
//   - Private: while Windows is locked (the lock screen may show notices) only the title, never the agent's text.
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// The tag of a chat:new: its conversation (plain and short), or the chat.
pub fn tag_of(payload: &Value) -> String {
  match payload.get("conversation") {
    Some(c) if !c.is_null() => format!("c{}", c.to_string().chars().filter(|ch| ch.is_ascii_alphanumeric()).take(40).collect::<String>()),
    _ => "chat".to_string(),
  }
}

/// What a chat:new turns into: (title, body, where a click goes, its tag), or nothing when the window is in front.
pub fn notice(payload: &Value, focused: bool, assistant: &str, notice_title: &str) -> Option<(String, String, Value, String)> {
  if focused {
    return None;
  }
  let title = if payload.get("role").and_then(Value::as_str) == Some("orb") { assistant.to_string() } else { notice_title.to_string() };
  let body: String = payload.get("body").and_then(Value::as_str).unwrap_or("").chars().take(240).collect();
  let target = match payload.get("conversation") {
    Some(c) if !c.is_null() => json!({ "view": "chat", "id": c }),
    _ => json!({ "view": "chat" }),
  };
  Some((title, body, target, tag_of(payload)))
}

/// How many notices may go: one per tag every PER_TAG, and at most PER_MINUTE in any minute.
pub struct Limiter {
  last: HashMap<String, Instant>,
  recent: VecDeque<Instant>,
}
const PER_TAG: Duration = Duration::from_secs(3);
const PER_MINUTE: usize = 12;

impl Limiter {
  pub fn new() -> Self {
    Self { last: HashMap::new(), recent: VecDeque::new() }
  }
  /// When a notice of `tag` may go: None = now.
  pub fn wait(&mut self, tag: &str, now: Instant) -> Option<Instant> {
    while self.recent.front().is_some_and(|t| now.duration_since(*t) >= Duration::from_secs(60)) {
      self.recent.pop_front();
    }
    let by_tag = self.last.get(tag).map(|t| *t + PER_TAG).filter(|t| *t > now);
    let by_minute = (self.recent.len() >= PER_MINUTE).then(|| self.recent[self.recent.len() - PER_MINUTE] + Duration::from_secs(60));
    by_tag.into_iter().chain(by_minute).max()
  }
  /// A notice of `tag` was shown now.
  pub fn record(&mut self, tag: &str, now: Instant) {
    if self.last.len() > 500 {
      self.last.retain(|_, t| now.duration_since(*t) < PER_TAG);
    }
    self.last.insert(tag.to_string(), now);
    self.recent.push_back(now);
  }
  #[cfg(test)]
  pub fn allow(&mut self, tag: &str, now: Instant) -> bool {
    if self.wait(tag, now).is_some() {
      return false;
    }
    self.record(tag, now);
    true
  }
}

struct Pending {
  title: String,
  body: String,
  tag: String,
  target: Value,
}

/// A chat:new as it came from the engine, still to be looked at.
struct Job {
  payload: Value,
  test_log: Option<PathBuf>,
  at: Instant,
}

/// What waits to be shown: the latest chat:new of each conversation (at most MAX_WAITING conversations).
static WAITING: OnceLock<Mutex<HashMap<String, Job>>> = OnceLock::new();
static WAKE: OnceLock<mpsc::SyncSender<()>> = OnceLock::new();
const MAX_WAITING: usize = 200;

/// Called from the engine's line reader: only put in the table here (a short lock, never a wait). Asking the window
/// whether it is in front (or its title) waits for Orb's UI thread, so that and the rest happen on the notices' own
/// thread; a busy window never holds up the engine's messages.
pub fn chat_new(app: &AppHandle, payload: &Value, test_log: Option<PathBuf>) {
  let wake = WAKE.get_or_init(|| {
    let (tx, rx) = mpsc::sync_channel::<()>(1);
    let handle = app.clone();
    let _ = std::thread::Builder::new().name("avisos".into()).spawn(move || run(handle, rx));
    tx
  });
  let tag = tag_of(payload);
  {
    let mut waiting = WAITING.get_or_init(Default::default).lock().unwrap();
    if waiting.len() >= MAX_WAITING && !waiting.contains_key(&tag) {
      // So many conversations at once: the one waiting longest makes room (it was going to be late anyway).
      if let Some(oldest) = waiting.iter().min_by_key(|(_, j)| j.at).map(|(k, _)| k.clone()) {
        waiting.remove(&oldest);
      }
    }
    let at = waiting.get(&tag).map(|j| j.at).unwrap_or_else(Instant::now); // its place in the line is kept
    waiting.insert(tag, Job { payload: payload.clone(), test_log, at });
  }
  let _ = wake.try_send(());
}

/// The notices' thread: shows what is due, oldest first, and sleeps until the next one is.
fn run(handle: AppHandle, wake: mpsc::Receiver<()>) {
  let mut limit = Limiter::new();
  loop {
    let now = Instant::now();
    let mut next: Option<Instant> = None;
    let due: Vec<(String, Job)> = {
      let mut waiting = WAITING.get_or_init(Default::default).lock().unwrap();
      let mut tags: Vec<(String, Instant)> = waiting.iter().map(|(k, j)| (k.clone(), j.at)).collect();
      tags.sort_by_key(|(_, at)| *at);
      let mut out = Vec::new();
      for (tag, _) in tags {
        match limit.wait(&tag, now) {
          None => {
            if let Some(job) = waiting.remove(&tag) {
              limit.record(&tag, now); // counted now: the next of this tag waits its 3 s even if this one is not shown
              out.push((tag, job));
            }
          }
          Some(t) => next = Some(next.map_or(t, |n| n.min(t))),
        }
      }
      out
    };
    for (_, job) in due {
      deliver(&handle, job);
    }
    let r = match next {
      Some(t) => wake.recv_timeout(t.saturating_duration_since(Instant::now())),
      None => wake.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected),
    };
    if let Err(mpsc::RecvTimeoutError::Disconnected) = r {
      return;
    }
  }
}

fn deliver(handle: &AppHandle, job: Job) {
  let Some(p) = prepare(handle, &job.payload) else { return };
  if let Some(file) = job.test_log {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(file) {
      let _ = writeln!(f, "{}", json!({ "title": p.title, "body": p.body, "target": p.target, "tag": p.tag }));
    }
    return;
  }
  if let Err(e) = show(handle, p) {
    crate::engine::get(handle).log_line(&format!("aviso: {e}"));
  }
}

/// The notice for a chat:new, or nothing (the window in front).
fn prepare(app: &AppHandle, payload: &Value) -> Option<Pending> {
  let w = app.get_webview_window("main")?;
  let assistant = w.title().ok().filter(|t| !t.trim().is_empty()).unwrap_or_else(|| "Orb".into());
  let engine = crate::engine::get(app);
  let header = engine.t("sys.main.notice", &[("name", assistant.clone())]);
  // In front: focused, shown and not minimised (a hidden window may still say it has the focus).
  let in_front = w.is_focused().unwrap_or(false) && w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false);
  let (title, mut body, target, tag) = notice(payload, in_front, &assistant, &header)?;
  if crate::power::session_locked() {
    body = engine.t("sys.main.noticePrivate", &[]);
  }
  Some(Pending { title, body, tag, target })
}

#[cfg(windows)]
fn show(app: &AppHandle, p: Pending) -> windows::core::Result<()> {
  use windows::core::{Interface, HSTRING};
  use windows::Data::Xml::Dom::{IXmlNode, XmlDocument};
  use windows::Foundation::TypedEventHandler;
  use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};
  let id = if cfg!(debug_assertions) { HSTRING::from(POWERSHELL_APP_ID) } else { HSTRING::from(app.config().identifier.as_str()) };
  // Built with the DOM (texts set as text, never parsed as XML).
  let doc = XmlDocument::new()?;
  let toast = doc.CreateElement(&HSTRING::from("toast"))?;
  let visual = doc.CreateElement(&HSTRING::from("visual"))?;
  let binding = doc.CreateElement(&HSTRING::from("binding"))?;
  binding.SetAttribute(&HSTRING::from("template"), &HSTRING::from("ToastGeneric"))?;
  for text in [&p.title, &p.body] {
    if text.is_empty() {
      continue;
    }
    let el = doc.CreateElement(&HSTRING::from("text"))?;
    el.SetInnerText(&HSTRING::from(text.as_str()))?;
    binding.AppendChild(&el.cast::<IXmlNode>()?)?;
  }
  visual.AppendChild(&binding.cast::<IXmlNode>()?)?;
  toast.AppendChild(&visual.cast::<IXmlNode>()?)?;
  doc.AppendChild(&toast.cast::<IXmlNode>()?)?;
  let notification = ToastNotification::CreateToastNotification(&doc)?;
  notification.SetTag(&HSTRING::from(p.tag.as_str()))?;
  notification.SetGroup(&HSTRING::from("orb"))?;
  let handle = app.clone();
  let target = p.target.clone();
  notification.Activated(&TypedEventHandler::new(move |_, _| {
    if let Some(w) = handle.get_webview_window("main") {
      let _ = w.unminimize();
      let _ = w.show();
      let _ = w.set_focus();
    }
    let _ = handle.emit_to("main", "engine:event", json!({ "event": "ui:navigate", "payload": target.clone() }));
    Ok(())
  }))?;
  ToastNotificationManager::CreateToastNotifierWithId(&id)?.Show(&notification)
}

#[cfg(not(windows))]
fn show(_: &AppHandle, _: Pending) -> Result<(), String> {
  Ok(())
}

/// Windows PowerShell's AUMID: a build run from the code has no shortcut of its own to show notices as.
#[cfg(windows)]
const POWERSHELL_APP_ID: &str = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_notice_only_in_the_background_with_its_conversation() {
    let p = json!({ "role": "orb", "body": "Hecho", "conversation": 12 });
    assert_eq!(notice(&p, true, "Nova", "Aviso de Nova"), None);
    assert_eq!(notice(&p, false, "Nova", "Aviso de Nova"), Some(("Nova".into(), "Hecho".into(), json!({ "view": "chat", "id": 12 }), "c12".into())));
    let long = "x".repeat(500);
    let (title, body, target, tag) = notice(&json!({ "role": "system", "body": long }), false, "Nova", "Aviso de Nova").unwrap();
    assert_eq!((title.as_str(), body.chars().count()), ("Aviso de Nova", 240));
    assert_eq!((target, tag.as_str()), (json!({ "view": "chat" }), "chat"));
    // A tag is always short and plain, whatever the conversation's id looks like.
    let (_, _, _, odd) = notice(&json!({ "conversation": "a<b>\"c\"&".repeat(20) }), false, "N", "A").unwrap();
    assert!(odd.len() <= 41 && odd.chars().all(|c| c.is_ascii_alphanumeric()));
  }

  #[test]
  fn at_most_one_per_conversation_every_3_s_and_12_a_minute() {
    let mut l = Limiter::new();
    let t0 = Instant::now();
    assert!(l.allow("c1", t0));
    assert!(!l.allow("c1", t0 + Duration::from_millis(500)));
    assert!(l.allow("c2", t0 + Duration::from_millis(500)));
    assert!(l.allow("c1", t0 + Duration::from_secs(3)));
    // A flood of conversations: 12 in the minute, then none until it passes.
    let mut shown = 3;
    for i in 0..30 {
      if l.allow(&format!("x{i}"), t0 + Duration::from_secs(4)) {
        shown += 1;
      }
    }
    assert_eq!(shown, PER_MINUTE);
    assert!(!l.allow("y", t0 + Duration::from_secs(59)));
    assert!(l.allow("y", t0 + Duration::from_secs(61)));
  }

  /// Review D-fix B6 / D9 B10: what comes too fast is not dropped: the limiter says when it may go.
  #[test]
  fn too_fast_waits_for_its_turn_instead_of_being_dropped() {
    let mut l = Limiter::new();
    let t0 = Instant::now();
    assert_eq!(l.wait("c1", t0), None);
    l.record("c1", t0);
    assert_eq!(l.wait("c1", t0 + Duration::from_secs(1)), Some(t0 + PER_TAG), "the approval right after an answer: in 3 s");
    for i in 0..(PER_MINUTE - 1) {
      l.record(&format!("x{i}"), t0 + Duration::from_secs(5));
    }
    assert_eq!(l.wait("z", t0 + Duration::from_secs(6)), Some(t0 + Duration::from_secs(60)), "the minute is full: when the oldest leaves it");
    assert_eq!(l.wait("z", t0 + Duration::from_secs(60)), None);
  }
}

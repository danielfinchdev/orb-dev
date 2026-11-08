// Notices while Orb's window is in the background: a new message of the chat (finished tasks, approvals, the assistant's
// answers), as Electron's main.mjs did. Windows' own notification (WinRT, the crate tauri-plugin-notification uses
// inside), because only it says when it is clicked: the click brings Orb to the front on that conversation
// ('ui:navigate'). An installed Orb shows them as itself (the installer sets the AUMID dev.orb.app on its shortcuts); a
// build run from the code has no shortcut, so Windows shows them as PowerShell's. A test build with its window hidden
// writes them to <test data>\avisos-e2e.jsonl instead of showing them (nobody at the PC).
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

/// What a chat:new turns into: (title, body, where a click goes), or nothing when the window is in front.
pub fn notice(payload: &Value, focused: bool, assistant: &str, notice_title: &str) -> Option<(String, String, Value)> {
  if focused {
    return None;
  }
  let title = if payload.get("role").and_then(Value::as_str) == Some("orb") { assistant.to_string() } else { notice_title.to_string() };
  let body: String = payload.get("body").and_then(Value::as_str).unwrap_or("").chars().take(240).collect();
  let target = match payload.get("conversation") {
    Some(c) if !c.is_null() => json!({ "view": "chat", "id": c }),
    _ => json!({ "view": "chat" }),
  };
  Some((title, body, target))
}

pub fn chat_new(app: &AppHandle, payload: &Value, test_log: Option<PathBuf>) {
  let Some(w) = app.get_webview_window("main") else { return };
  let assistant = w.title().ok().filter(|t| !t.trim().is_empty()).unwrap_or_else(|| "Orb".into());
  let engine = crate::engine::get(app);
  let header = engine.t("sys.main.notice", &[("name", assistant.clone())]);
  // In front: focused, shown and not minimised (a hidden window may still say it has the focus).
  let in_front = w.is_focused().unwrap_or(false) && w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false);
  let Some((title, body, target)) = notice(payload, in_front, &assistant, &header) else { return };
  if let Some(file) = test_log {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(file) {
      let _ = writeln!(f, "{}", json!({ "title": title, "body": body, "target": target }));
    }
    return;
  }
  #[cfg(windows)]
  {
    use tauri_winrt_notification::Toast;
    let id = if cfg!(debug_assertions) { Toast::POWERSHELL_APP_ID.to_string() } else { app.config().identifier.clone() };
    let handle = app.clone();
    let shown = Toast::new(&id)
      .title(&title)
      .text1(&body)
      .on_activated(move |_| {
        if let Some(w) = handle.get_webview_window("main") {
          let _ = w.unminimize();
          let _ = w.show();
          let _ = w.set_focus();
        }
        let _ = handle.emit_to("main", "engine:event", json!({ "event": "ui:navigate", "payload": target.clone() }));
        Ok(())
      })
      .show();
    if let Err(e) = shown {
      eprintln!("aviso: {e}");
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_notice_only_in_the_background_with_its_conversation() {
    let p = json!({ "role": "orb", "body": "Hecho", "conversation": 12 });
    assert_eq!(notice(&p, true, "Nova", "Aviso de Nova"), None);
    assert_eq!(notice(&p, false, "Nova", "Aviso de Nova"), Some(("Nova".into(), "Hecho".into(), json!({ "view": "chat", "id": 12 }))));
    let long = "x".repeat(500);
    let (title, body, target) = notice(&json!({ "role": "system", "body": long }), false, "Nova", "Aviso de Nova").unwrap();
    assert_eq!((title.as_str(), body.chars().count()), ("Aviso de Nova", 240));
    assert_eq!(target, json!({ "view": "chat" }));
  }
}

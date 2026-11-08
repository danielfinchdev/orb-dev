// The pure parts of the bridge between the window, Rust and the engine, kept apart so `cargo test` covers them: the JSON
// lines of the engine's stdio channel (src/engine/stdio.mjs), the window's method names, the app's texts, the
// interface's zoom, the WebView2 arguments and the checks of what the engine asks the app to do (src/engine/host.mjs ›
// checkHostRequest: the same rules).
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// One message, one line (serde_json never leaves a raw line break inside a string).
pub fn encode(message: &Value) -> Vec<u8> {
  let mut line = serde_json::to_vec(message).unwrap_or_else(|_| b"{}".to_vec());
  line.push(b'\n');
  line
}

/// A line of the engine's stdout.
#[derive(Debug, PartialEq)]
pub enum Incoming {
  /// The answer to one of the app's messages (a window call, locate, setup, texts…).
  Reply { id: u64, result: Result<Value, String> },
  /// The answer to `start`.
  Started(Result<Value, String>),
  /// An event for the window (and for the app: config:changed…).
  Event { event: String, payload: Value },
  /// The engine asks the app for something only the app can do (host.*).
  Host { id: Value, method: String, params: Value },
  /// Not a message of the protocol: ignored.
  Unknown,
}

fn outcome(m: &Value) -> Result<Value, String> {
  if m.get("ok").and_then(Value::as_bool) == Some(true) {
    Ok(m.get("result").cloned().unwrap_or(Value::Null))
  } else {
    Err(m.get("error").and_then(Value::as_str).unwrap_or("error del motor").to_string())
  }
}

pub fn decode(line: &str) -> Incoming {
  let m: Value = match serde_json::from_str(line.trim()) {
    Ok(v @ Value::Object(_)) => v,
    _ => return Incoming::Unknown,
  };
  match m.get("type").and_then(Value::as_str) {
    Some("reply") => match m.get("id").and_then(Value::as_u64) {
      Some(id) => Incoming::Reply { id, result: outcome(&m) },
      None => Incoming::Unknown,
    },
    Some("started") => Incoming::Started(outcome(&m)),
    Some("event") => match m.get("event").and_then(Value::as_str) {
      Some(event) => Incoming::Event { event: event.to_string(), payload: m.get("payload").cloned().unwrap_or(Value::Null) },
      None => Incoming::Unknown,
    },
    Some("host") => match (m.get("id"), m.get("method").and_then(Value::as_str)) {
      (Some(id), Some(method)) => Incoming::Host { id: id.clone(), method: method.to_string(), params: m.get("params").cloned().unwrap_or(json!({})) },
      _ => Incoming::Unknown,
    },
    _ => Incoming::Unknown,
  }
}

/// The window's engine methods: `^[a-z]+(\.[A-Za-z]+){1,3}$`, as Electron's main.mjs (ENGINE_METHOD).
pub fn valid_method(method: &str) -> bool {
  let mut parts = method.split('.');
  let first = parts.next().unwrap_or("");
  if first.is_empty() || !first.bytes().all(|b| b.is_ascii_lowercase()) {
    return false;
  }
  let rest: Vec<&str> = parts.collect();
  (1..=3).contains(&rest.len()) && rest.iter().all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_alphabetic()))
}

/// A text of the app (sys.main.*, sys.dialog.*, sent by the engine in the language of the settings) with its {vars}. A
/// missing key shows as the key itself, as src/core/i18n.mjs does.
pub fn translate(texts: &HashMap<String, String>, key: &str, vars: &[(&str, String)]) -> String {
  let mut text = texts.get(key).cloned().unwrap_or_else(|| key.to_string());
  for (name, value) in vars {
    text = text.replace(&format!("{{{name}}}"), value);
  }
  text
}

// Size of the interface on this PC (Ajustes → Interfaz, Ctrl + / Ctrl - / Ctrl 0, Ctrl + wheel), kept in interfaz.json.
// 1 = «Normal», a bit bigger than WebView2's 100% (Electron's main.mjs: the same numbers).
pub const ZOOM_BASE: f64 = 1.15;
const ZOOM_MIN: f64 = 0.6;
const ZOOM_MAX: f64 = 1.8;
const ZOOM_STEP: f64 = 0.1;

pub fn clamp_zoom(value: f64) -> f64 {
  let v = if value.is_finite() && value > 0.0 { value } else { 1.0 };
  (v.clamp(ZOOM_MIN, ZOOM_MAX) * 100.0).round() / 100.0
}

pub fn zoom_step(current: f64, dir: &str) -> f64 {
  match dir {
    "in" => clamp_zoom(current + ZOOM_STEP),
    "out" => clamp_zoom(current - ZOOM_STEP),
    _ => 1.0,
  }
}

/// The zoom saved in interfaz.json ({"zoom": 1.1}); 1 when there is none or it cannot be read.
pub fn read_zoom(text: &str) -> f64 {
  serde_json::from_str::<Value>(text).ok().and_then(|v| v.get("zoom").and_then(Value::as_f64)).map(clamp_zoom).unwrap_or(1.0)
}

/// Arguments of Orb's WebView2: Tauri's own (no Edge-only extras in the window), and, only in a build with the `e2e`
/// feature (tests and measurements), the DevTools port and no pausing of frames when the window is covered.
pub fn browser_args(cdp_port: Option<u16>) -> String {
  match cdp_port {
    Some(port) => format!("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion --remote-debugging-port={port}"),
    None => "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection".to_string(),
  }
}

/// WebView2 reads WEBVIEW2_* variables (extra arguments such as a DevTools port, another data folder, another runtime)
/// over what the app sets. Anything could have left them in the user's environment, so Orb drops them all before it
/// creates a webview or starts the engine. Returns the names removed.
pub fn webview2_vars<I: IntoIterator<Item = String>>(names: I) -> Vec<String> {
  names.into_iter().filter(|n| n.to_ascii_uppercase().starts_with("WEBVIEW2_")).collect()
}

/// What the engine may ask the app to do, once checked.
#[derive(Debug, PartialEq)]
pub enum HostRequest {
  OpenUrl(String),
  OpenPath(PathBuf),
  Spawn { cmd: String, args: Vec<String>, cwd: PathBuf },
}

const LOOPBACK: [&str; 3] = ["localhost", "127.0.0.1", "[::1]"];

/// A web page over https, a page of this PC (a project's preview) or Warp's link to open a tab in a folder; folders only,
/// never a file to run; a program as an absolute path or a bare name with its arguments as a list (never a shell line)
/// and an existing folder to start in. The same rules as src/engine/host.mjs › checkHostRequest.
pub fn check_host(method: &str, params: &Value, is_dir: impl Fn(&Path) -> bool) -> Result<HostRequest, String> {
  let text = |k: &str| params.get(k).and_then(Value::as_str).unwrap_or("").to_string();
  match method {
    "host.openUrl" => {
      let u = tauri::Url::parse(&text("url")).map_err(|_| "enlace no válido".to_string())?;
      let host = u.host_str().unwrap_or("");
      let local = matches!(u.scheme(), "http" | "https") && LOOPBACK.contains(&host);
      let warp = u.scheme() == "warp" && host == "action" && u.path() == "/new_tab";
      if u.scheme() != "https" && !local && !warp {
        return Err("solo enlaces https".into());
      }
      Ok(HostRequest::OpenUrl(u.to_string()))
    }
    "host.openPath" => {
      let p = PathBuf::from(text("path"));
      if !p.is_absolute() || !is_dir(&p) {
        return Err("solo carpetas".into());
      }
      Ok(HostRequest::OpenPath(p))
    }
    "host.spawnDetached" => {
      let cmd = text("cmd");
      let bare = !cmd.contains('/') && !cmd.contains('\\');
      if cmd.is_empty() || cmd.len() > 1000 || cmd.contains(['\r', '\n', '\0']) || !(Path::new(&cmd).is_absolute() || bare) {
        return Err("programa no válido".into());
      }
      let args = match params.get("args").unwrap_or(&json!([])) {
        Value::Array(a) if a.len() <= 50 => a
          .iter()
          .map(|x| x.as_str().filter(|s| s.len() <= 4000 && !s.contains('\0')).map(str::to_string))
          .collect::<Option<Vec<_>>>()
          .ok_or_else(|| "argumentos no válidos".to_string())?,
        _ => return Err("argumentos no válidos".into()),
      };
      let cwd = PathBuf::from(text("cwd"));
      if !cwd.is_absolute() || !is_dir(&cwd) {
        return Err("carpeta no válida".into());
      }
      Ok(HostRequest::Spawn { cmd, args, cwd })
    }
    _ => Err(format!("host: {method} desconocido")),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn lines_encode_and_decode() {
    assert_eq!(encode(&json!({"a": "uno\ndos"})), b"{\"a\":\"uno\\ndos\"}\n".to_vec());
    assert_eq!(decode(r#"{"type":"reply","id":3,"ok":true,"result":{"x":1}}"#), Incoming::Reply { id: 3, result: Ok(json!({"x": 1})) });
    assert_eq!(decode(r#"{"type":"reply","id":4,"ok":false,"error":"no"}"#), Incoming::Reply { id: 4, result: Err("no".into()) });
    assert_eq!(decode(r#"{"type":"started","ok":true,"result":{"name":"Orb"}}"#), Incoming::Started(Ok(json!({"name": "Orb"}))));
    assert_eq!(decode(r#"{"type":"event","event":"chat:new","payload":{"body":"hola"}}"#), Incoming::Event { event: "chat:new".into(), payload: json!({"body": "hola"}) });
    assert_eq!(
      decode(r#"{"type":"host","id":7,"method":"host.openUrl","params":{"url":"https://x.y"}}"#),
      Incoming::Host { id: json!(7), method: "host.openUrl".into(), params: json!({"url": "https://x.y"}) }
    );
    for line in ["", "hola", "[1,2]", "null", "{roto", r#"{"type":"reply"}"#, r#"{"type":"event"}"#, r#"{"type":"otro"}"#] {
      assert_eq!(decode(line), Incoming::Unknown, "{line}");
    }
  }

  #[test]
  fn window_methods() {
    for ok in ["app.state", "projects.list", "chat.send", "a.b.c.d", "master.check"] {
      assert!(valid_method(ok), "{ok}");
    }
    for bad in ["app", "App.state", "app.", ".state", "app.st4te", "a.b.c.d.e", "app.state;x", "", "app..state", "host.openUrl x"] {
      assert!(!valid_method(bad), "{bad}");
    }
  }

  #[test]
  fn texts_with_vars_and_missing_keys() {
    let texts = HashMap::from([("sys.dialog.closeMany".to_string(), "Hay {n} tareas en curso".to_string())]);
    assert_eq!(translate(&texts, "sys.dialog.closeMany", &[("n", "3".into())]), "Hay 3 tareas en curso");
    assert_eq!(translate(&texts, "sys.main.engineOff", &[]), "sys.main.engineOff");
  }

  #[test]
  fn zoom_limits_and_steps() {
    assert_eq!(clamp_zoom(5.0), 1.8);
    assert_eq!(clamp_zoom(0.1), 0.6);
    assert_eq!(clamp_zoom(f64::NAN), 1.0);
    assert_eq!(zoom_step(1.0, "in"), 1.1);
    assert_eq!(zoom_step(1.1, "out"), 1.0);
    assert_eq!(zoom_step(1.7, "in"), 1.8);
    assert_eq!(zoom_step(1.8, "in"), 1.8);
    assert_eq!(zoom_step(1.4, "reset"), 1.0);
    assert_eq!(read_zoom(r#"{"zoom":1.3}"#), 1.3);
    assert_eq!(read_zoom("roto"), 1.0);
    assert_eq!(read_zoom(r#"{"zoom":"x"}"#), 1.0);
  }

  #[test]
  fn devtools_port_only_when_asked_and_webview2_vars_dropped() {
    assert!(!browser_args(None).contains("remote-debugging"));
    assert!(browser_args(Some(9400)).ends_with("--remote-debugging-port=9400"));
    assert!(!browser_args(Some(9400)).contains("allow-origins"));
    let names = ["PATH", "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "webview2_user_data_folder", "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", "ORB_USER_DATA"];
    assert_eq!(
      webview2_vars(names.iter().map(|s| s.to_string())),
      vec!["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "webview2_user_data_folder", "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER"]
    );
  }

  #[test]
  fn host_requests_are_checked() {
    let dir = std::env::temp_dir();
    let is_dir = |p: &Path| p == dir.as_path();
    let ok = |m: &str, p: Value| check_host(m, &p, is_dir);
    assert_eq!(ok("host.openUrl", json!({"url": "https://github.com/x"})), Ok(HostRequest::OpenUrl("https://github.com/x".into())));
    assert!(ok("host.openUrl", json!({"url": "http://localhost:5173/"})).is_ok());
    assert!(ok("host.openUrl", json!({"url": "http://127.0.0.1:3000/app"})).is_ok());
    assert!(ok("host.openUrl", json!({"url": "warp://action/new_tab?path=C%3A%5Cx"})).is_ok());
    for url in ["http://ejemplo.com", "file:///C:/Windows/System32/calc.exe", "javascript:alert(1)", "warp://otra/cosa", "ms-settings:", "no es un enlace"] {
      assert!(ok("host.openUrl", json!({ "url": url })).is_err(), "{url}");
    }
    assert_eq!(ok("host.openPath", json!({"path": dir})), Ok(HostRequest::OpenPath(dir.clone())));
    assert!(ok("host.openPath", json!({"path": "relativa"})).is_err());
    assert!(ok("host.openPath", json!({"path": "C:\\otra\\archivo.exe"})).is_err());
    assert_eq!(
      ok("host.spawnDetached", json!({"cmd": "powershell.exe", "args": ["-NoExit"], "cwd": dir})),
      Ok(HostRequest::Spawn { cmd: "powershell.exe".into(), args: vec!["-NoExit".into()], cwd: dir.clone() })
    );
    assert!(ok("host.spawnDetached", json!({"cmd": "C:\\apps\\wt.exe", "args": [], "cwd": dir})).is_ok());
    assert!(ok("host.spawnDetached", json!({"cmd": "sub\\prog.exe", "args": [], "cwd": dir})).is_err());
    assert!(ok("host.spawnDetached", json!({"cmd": "cmd.exe", "args": "/c calc", "cwd": dir})).is_err());
    assert!(ok("host.spawnDetached", json!({"cmd": "cmd.exe", "args": [1], "cwd": dir})).is_err());
    assert!(ok("host.spawnDetached", json!({"cmd": "cmd.exe\n", "args": [], "cwd": dir})).is_err());
    assert!(ok("host.spawnDetached", json!({"cmd": "cmd.exe", "args": [], "cwd": "C:\\no-existe"})).is_err());
    assert!(ok("host.borrarTodo", json!({})).is_err());
  }
}

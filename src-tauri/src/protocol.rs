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
  /// The answer to `start`; `code`: why it did not start, when the window offers something for it (secretBusy:
  /// «Reintentar»; secretUnreadable: also «Empezar con una clave nueva»).
  Started { result: Result<Value, String>, code: Option<String> },
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
    Some("started") => Incoming::Started {
      result: outcome(&m),
      code: m.get("code").and_then(Value::as_str).filter(|c| matches!(*c, "secretBusy" | "secretUnreadable")).map(str::to_string),
    },
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

/// The window's engine methods: `^[a-z]+(\.[A-Za-z]+){1,3}$`.
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
// 1 = «Normal», a bit bigger than WebView2's 100% (the same numbers as Orb 3.8.0).
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

/// core itself, or its secrets or anything inside them (real paths, lower case): guarded by the master password.
pub fn guarded_core(target: &str, core: &str, secrets: &str) -> bool {
  target == core || target == secrets || target.starts_with(&format!("{secrets}\\"))
}

/// Node's own variables (NODE_OPTIONS, NODE_PATH, NODE_EXTRA_CA_CERTS…), dropped from the engine's environment: Node
/// would run --require / --import code from them inside the engine. And OpenSSL's (OPENSSL_CONF, OPENSSL_MODULES…): a
/// configuration file can load engines or providers, DLLs, into the engine. ORB_NODE is the app's (set for every start).
pub fn node_vars<I: IntoIterator<Item = String>>(names: I) -> Vec<String> {
  names
    .into_iter()
    .filter(|n| {
      let u = n.to_ascii_uppercase();
      u.starts_with("NODE_") || u.starts_with("OPENSSL_") || u == "SSLKEYLOGFILE"
    })
    .collect()
}

/// What the engine may ask the app to do, once checked. The app picks the program of a terminal, an editor or an action
/// itself (tools.rs): the engine only names the kind.
#[derive(Debug, PartialEq)]
pub enum HostRequest {
  OpenUrl(String),
  OpenPath(PathBuf),
  OpenTerminal { dir: PathBuf, choice: String },
  OpenEditor { which: String, dir: PathBuf },
  RunAction { command: String, dir: PathBuf, choice: String },
  /// The secret as hex; `v10`: as Electron's safeStorage seals it (for Orb 3.8.0's clave.enc), not ORB2.
  Seal { text: String, v10: bool },
  Unseal(Vec<u8>),
}

const LOOPBACK: [&str; 3] = ["localhost", "127.0.0.1", "[::1]"];
pub const TERMINAL_CHOICES: [&str; 5] = ["auto", "warp", "wt", "powershell", "cmd"];

/// A folder of this PC: absolute with a drive letter, never a network or device path (\\server\share, \\?\…, \\.\…):
/// only looking at one of those already sends this user's Windows credentials to that server.
pub fn local_path(p: &str) -> bool {
  let b = p.as_bytes();
  !p.is_empty()
    && p.len() < 2000
    && !p.contains('\0')
    && b.len() >= 3
    && b[0].is_ascii_alphabetic()
    && b[1] == b':'
    && (b[2] == b'\\' || b[2] == b'/')
}

fn choice(params: &Value) -> String {
  let c = params.get("choice").and_then(Value::as_str).unwrap_or("auto");
  if TERMINAL_CHOICES.contains(&c) { c } else { "auto" }.to_string()
}

/// A web page over https, a page of this PC (a project's preview) or Warp's link to open a tab in a folder; existing
/// folders of this PC only, never a file to run; a terminal, an editor or an action by kind; the secret (64 hex characters
/// to seal, a base64 blob of at most 16 KB to open). The same rules as src/engine/host.mjs › checkHostRequest.
pub fn check_host(method: &str, params: &Value, is_dir: impl Fn(&Path) -> bool) -> Result<HostRequest, String> {
  let text = |k: &str| params.get(k).and_then(Value::as_str).unwrap_or("").to_string();
  let folder = |k: &str, error: &str| {
    let d = text(k);
    if !local_path(&d) || !is_dir(Path::new(&d)) {
      return Err(error.to_string());
    }
    Ok(PathBuf::from(d))
  };
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
    "host.openPath" => Ok(HostRequest::OpenPath(folder("path", "solo carpetas")?)),
    "host.openTerminal" => Ok(HostRequest::OpenTerminal { dir: folder("dir", "carpeta no válida")?, choice: choice(params) }),
    "host.openEditor" => {
      let which = text("which");
      if !matches!(which.as_str(), "cursor" | "vscode") {
        return Err("editor no válido".into());
      }
      Ok(HostRequest::OpenEditor { which, dir: folder("dir", "carpeta no válida")? })
    }
    "host.runAction" => {
      let command = text("command");
      if command.trim().is_empty() || command.len() > 2000 || command.contains('\0') {
        return Err("acción no válida".into());
      }
      Ok(HostRequest::RunAction { command, dir: folder("dir", "carpeta no válida")?, choice: choice(params) })
    }
    "host.seal" => {
      let t = text("text");
      if t.len() != 64 || !t.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        return Err("secreto no válido".into());
      }
      let v10 = match params.get("format").and_then(|f| f.as_str()) {
        None | Some("orb2") => false,
        Some("v10") => true,
        Some(_) => return Err("formato no válido".into()),
      };
      Ok(HostRequest::Seal { text: t, v10 })
    }
    "host.unseal" => {
      use base64::Engine as _;
      let d = text("data");
      let blob = if d.is_empty() || d.len() > 22_000 { None } else { base64::engine::general_purpose::STANDARD.decode(d).ok() };
      match blob {
        Some(b) if !b.is_empty() && b.len() <= crate::secrets::MAX_BLOB => Ok(HostRequest::Unseal(b)),
        _ => Err("datos no válidos".into()),
      }
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
    assert_eq!(decode(r#"{"type":"started","ok":true,"result":{"name":"Orb"}}"#), Incoming::Started { result: Ok(json!({"name": "Orb"})), code: None });
    assert_eq!(
      decode(r#"{"type":"started","ok":false,"error":"x","code":"secretUnreadable"}"#),
      Incoming::Started { result: Err("x".into()), code: Some("secretUnreadable".into()) }
    );
    assert_eq!(decode(r#"{"type":"started","ok":false,"error":"x","code":"otro"}"#), Incoming::Started { result: Err("x".into()), code: None });
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
  fn node_variables_never_reach_the_engine() {
    let names = ["PATH", "NODE_OPTIONS", "node_path", "NODE_EXTRA_CA_CERTS", "NODE_TLS_REJECT_UNAUTHORIZED", "ORB_NODE", "NODEJS_X", "OPENSSL_CONF", "openssl_modules", "SSLKEYLOGFILE", "OPENSSLX"];
    assert_eq!(
      node_vars(names.iter().map(|s| s.to_string())),
      vec!["NODE_OPTIONS", "node_path", "NODE_EXTRA_CA_CERTS", "NODE_TLS_REJECT_UNAUTHORIZED", "OPENSSL_CONF", "openssl_modules", "SSLKEYLOGFILE"]
    );
  }

  #[test]
  fn host_requests_are_checked() {
    let dir = PathBuf::from("C:\\carpeta");
    let is_dir = |p: &Path| p == Path::new("C:\\carpeta");
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
    // Network and device paths are refused before anything looks at them.
    let anything = |_: &Path| true;
    for p in ["\\\\servidor\\recurso", "\\\\?\\C:\\carpeta", "\\\\.\\C:", "//servidor/x", "\\carpeta", "C:carpeta"] {
      assert!(check_host("host.openPath", &json!({ "path": p }), anything).is_err(), "{p}");
      assert!(check_host("host.openTerminal", &json!({ "dir": p }), anything).is_err(), "{p}");
    }
    // By kind: the engine never names a program (an extra field is ignored).
    assert_eq!(
      ok("host.openTerminal", json!({"dir": dir, "choice": "cmd", "cmd": "C:\\malo.exe"})),
      Ok(HostRequest::OpenTerminal { dir: dir.clone(), choice: "cmd".into() })
    );
    assert_eq!(ok("host.openTerminal", json!({"dir": dir, "choice": "otra"})), Ok(HostRequest::OpenTerminal { dir: dir.clone(), choice: "auto".into() }));
    assert_eq!(ok("host.openEditor", json!({"which": "vscode", "dir": dir})), Ok(HostRequest::OpenEditor { which: "vscode".into(), dir: dir.clone() }));
    assert!(ok("host.openEditor", json!({"which": "notepad", "dir": dir})).is_err());
    assert_eq!(
      ok("host.runAction", json!({"command": "npm run dev", "dir": dir, "choice": "wt"})),
      Ok(HostRequest::RunAction { command: "npm run dev".into(), dir: dir.clone(), choice: "wt".into() })
    );
    assert!(ok("host.runAction", json!({"command": "  ", "dir": dir})).is_err());
    assert!(ok("host.runAction", json!({"command": "x", "dir": "C:\\no-existe"})).is_err());
    assert!(ok("host.spawnDetached", json!({"cmd": "cmd.exe", "args": [], "cwd": dir})).is_err());
    // The secret.
    let hex = "ab".repeat(32);
    assert_eq!(ok("host.seal", json!({ "text": hex })), Ok(HostRequest::Seal { text: hex.clone(), v10: false }));
    assert_eq!(ok("host.seal", json!({ "text": hex, "format": "v10" })), Ok(HostRequest::Seal { text: hex.clone(), v10: true }));
    assert!(ok("host.seal", json!({ "text": hex, "format": "v11" })).is_err());
    for t in ["", "xyz", &"AB".repeat(32), &"ab".repeat(33)] {
      assert!(ok("host.seal", json!({ "text": t })).is_err(), "{t}");
    }
    assert_eq!(ok("host.unseal", json!({"data": "T1JCMnh5eg=="})), Ok(HostRequest::Unseal(b"ORB2xyz".to_vec())));
    for d in ["", "no es base64!", &"A".repeat(30_000)] {
      assert!(ok("host.unseal", json!({ "data": d })).is_err());
    }
    assert!(ok("host.borrarTodo", json!({})).is_err());
  }
}

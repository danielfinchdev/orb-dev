// The pure rules of the agents' browser (browser.rs), kept apart so `cargo test` covers them: which addresses its pages
// may load, which DevTools methods the engine may call on them, its user agent, and the checks of the engine's host.browser.*
// and host.pip.* requests. The limits of Orb's agents' browser (as in 3.8.0): only http(s) pages, no
// other scheme (file:, an app's own protocol, Orb's own pages), and nothing beyond what the shared actions need.
use serde_json::{json, Value};
use std::time::{Duration, Instant};

/// At most this many pages at once (src/core/browser-protocol.mjs › MAX_TABS is 4; one more of margin while a page that
/// made room is still closing).
pub const MAX_PAGES: usize = 5;
/// The little window's sizes, in logical pixels (as Electron's: normal, big, a pill).
pub const PIP_SIZES: [(&str, f64, f64); 3] = [("normal", 400.0, 292.0), ("grande", 820.0, 560.0), ("pildora", 290.0, 46.0)];
/// A frame for the little window: a JPEG in base64, at most this long.
pub const MAX_FRAME: usize = 3 * 1024 * 1024;

/// Hosts that are Orb's own (Tauri serves its window and its IPC on them): never loaded in an agent's page.
const ORB_HOSTS: [&str; 3] = ["tauri.localhost", "ipc.localhost", "asset.localhost"];

/// One of Orb's own hosts, written any way (case, a final dot, a name under it). Cosmetic in practice: the agents'
/// environment is another browser and *.localhost is loopback, but the rule says what it means.
fn orb_host(host: &str) -> bool {
  let h = host.trim_end_matches('.').to_ascii_lowercase();
  ORB_HOSTS.iter().any(|o| h == *o || h.ends_with(&format!(".{o}")))
}

/// The ports of the engine's own servers (the phone's access, dev-control), as the engine said at the last page it opened
/// (review D8 B1): an agent's page never reaches them on this PC's loopback.
static OWN_PORTS: std::sync::Mutex<Vec<u16>> = std::sync::Mutex::new(Vec::new());
pub fn set_own_ports(params: &Value) {
  let ports: Vec<u16> = params.get("blockPorts").and_then(Value::as_array).map(|a| a.iter().filter_map(|p| p.as_u64().and_then(|p| u16::try_from(p).ok())).take(16).collect()).unwrap_or_default();
  *OWN_PORTS.lock().unwrap() = ports;
}
fn loopback(host: &str) -> bool {
  let h = host.trim_end_matches('.').trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
  h == "localhost" || h.ends_with(".localhost") || h == "::1" || h.parse::<std::net::Ipv4Addr>().is_ok_and(|ip| ip.is_loopback() || ip.is_unspecified()) || h == "::"
}
pub fn own_ports() -> Vec<u16> {
  OWN_PORTS.lock().unwrap().clone()
}
fn own_port(u: &tauri::Url) -> bool {
  let Some(port) = u.port_or_known_default().filter(|p| OWN_PORTS.lock().unwrap().contains(p)) else { return false };
  u.host_str().is_some_and(|h| loopback(h) || resolves_here(h, port))
}
/// Review final B2: a name that resolves to this PC (localtest.me, *.nip.io, a hosts entry, ::ffff:127.0.0.1) is loopback
/// too. Looked up only for Orb's own ports; a name that does not resolve now cannot be reached either.
fn resolves_here(host: &str, port: u16) -> bool {
  use std::net::ToSocketAddrs;
  let h = host.trim_start_matches('[').trim_end_matches(']');
  (h, port).to_socket_addrs().is_ok_and(|mut a| a.any(|s| { let ip = s.ip().to_canonical(); ip.is_loopback() || ip.is_unspecified() }))
}

/// An address the page itself may go to. The main frame: http(s) pages (a local preview included) and the empty page;
/// a frame inside it may also be about:srcdoc, data: or blob: (Chromium keeps those in the page's origin rules). Never
/// file:, another app's protocol (mailto:, ms-settings:, steam:…), the browser's own pages, or Orb's own hosts.
pub fn url_allowed(url: &str, main_frame: bool) -> bool {
  let Ok(u) = tauri::Url::parse(url) else { return false };
  match u.scheme() {
    "http" | "https" => !u.host_str().map(orb_host).unwrap_or(true) && !own_port(&u),
    "about" => main_frame && url == "about:blank" || !main_frame && matches!(u.path(), "blank" | "srcdoc"),
    "data" | "blob" | "javascript" => !main_frame,
    _ => false,
  }
}

/// The DevTools methods the engine's driver uses (src/engine/browser-cdp.mjs), and nothing else: no Browser.* or
/// Target.* (other pages, downloads, closing the browser), no Network.*/Fetch.*/Storage.* (cookies, headers), no
/// Page.setDownloadBehavior.
const CDP_METHODS: [&str; 25] = [
  "Page.enable",
  "Runtime.enable",
  "Log.enable",
  "Page.getFrameTree",
  "Page.navigate",
  "Page.reload",
  "Page.getNavigationHistory",
  "Page.navigateToHistoryEntry",
  "Page.createIsolatedWorld",
  "Runtime.evaluate",
  "Page.addScriptToEvaluateOnNewDocument",
  "Page.removeScriptToEvaluateOnNewDocument",
  "Page.handleJavaScriptDialog",
  "Page.getLayoutMetrics",
  "Page.captureScreenshot",
  "Page.startScreencast",
  "Page.stopScreencast",
  "Page.screencastFrameAck",
  "Page.crash",
  "Input.dispatchMouseEvent",
  "Input.dispatchKeyEvent",
  "Input.insertText",
  "Emulation.setDeviceMetricsOverride",
  "Emulation.setFocusEmulationEnabled",
  "Emulation.setEmulatedMedia",
];

/// The DevTools events browser.rs listens to on every page and passes to the engine (WebView2 needs each one by name).
pub const CDP_EVENTS: [&str; 14] = [
  "Page.frameNavigated",
  "Page.navigatedWithinDocument",
  "Page.frameStartedLoading",
  "Page.frameStoppedLoading",
  "Page.loadEventFired",
  "Page.javascriptDialogOpening",
  "Page.screencastFrame",
  "Runtime.executionContextsCleared",
  "Runtime.executionContextDestroyed",
  "Runtime.consoleAPICalled",
  "Runtime.exceptionThrown",
  "Log.entryAdded",
  "Inspector.targetCrashed",
  "Inspector.detached",
];

/// What a page's event may weigh before it is read at all (a screencast frame excepted, as big as a frame may be).
pub const MAX_EVENT_JSON: usize = 64 * 1024;
const MAX_TEXT: usize = 1000;
const MAX_URL: usize = 2048;
pub const MAX_TITLE: usize = 300;

/// How many of a page's events may reach the engine (review D7–D8 A1): about 100 a second with bursts of 200; the rest
/// are dropped and counted (said once a second: Orb.dropped). A page's title at most every 250 ms. Screencast frames
/// are not counted (the engine acknowledges each one: at most a few a second).
pub struct EventGate {
  tokens: f64,
  at: Instant,
  dropped: u64,
  reported: Instant,
  title: Option<Instant>,
  /// This second's events, all and of the console (counted as they arrive, admitted or not), and the bytes read.
  window: (Instant, u32, u32, u64),
  flooded: bool,
}
/// A page past these in one second is flooding: WebView2 hands every event (and its whole JSON, read or not) to the
/// agents' browser thread before any filter, so it is stopped at the source (browser.rs ends its renderer and tells the
/// agent). Few but huge events count too: a page logging 2 MB strings sends some 80 a second, 160 MB.
const FLOOD_ALL: u32 = 1000;
const FLOOD_CONSOLE: u32 = 200;
const FLOOD_BYTES: u64 = 16 * 1024 * 1024;
const RATE: f64 = 100.0;
const BURST: f64 = 200.0;

impl EventGate {
  pub fn new(now: Instant) -> Self {
    Self { tokens: BURST, at: now, dropped: 0, reported: now, title: None, window: (now, 0, 0, 0), flooded: false }
  }
  /// True once, when the page starts flooding (see FLOOD_ALL, FLOOD_CONSOLE); call for every event that arrives.
  pub fn flooding(&mut self, method: &str, now: Instant) -> bool {
    self.roll(now);
    self.window.1 += 1;
    if matches!(method, "Runtime.consoleAPICalled" | "Runtime.exceptionThrown" | "Log.entryAdded") {
      self.window.2 += 1;
    }
    self.check()
  }
  /// True once, when the bytes of the events read this second pass FLOOD_BYTES; call with each event's size.
  pub fn flooding_bytes(&mut self, bytes: usize, now: Instant) -> bool {
    self.roll(now);
    self.window.3 += bytes as u64;
    self.check()
  }
  fn roll(&mut self, now: Instant) {
    if now.duration_since(self.window.0) >= Duration::from_secs(1) {
      self.window = (now, 0, 0, 0);
    }
  }
  fn check(&mut self) -> bool {
    if !self.flooded && (self.window.1 > FLOOD_ALL || self.window.2 > FLOOD_CONSOLE || self.window.3 > FLOOD_BYTES) {
      self.flooded = true;
      return true;
    }
    false
  }
  /// Stopped for flooding: nothing more of it is read.
  pub fn flooded(&self) -> bool {
    self.flooded
  }
  pub fn admit(&mut self, method: &str, now: Instant) -> bool {
    if method == "Page.screencastFrame" {
      return true;
    }
    self.tokens = (self.tokens + now.duration_since(self.at).as_secs_f64() * RATE).min(BURST);
    self.at = now;
    let title_ok = method != "Orb.title" || self.title.is_none_or(|t| now.duration_since(t) >= Duration::from_millis(250));
    if self.tokens >= 1.0 && title_ok {
      self.tokens -= 1.0;
      if method == "Orb.title" {
        self.title = Some(now);
      }
      true
    } else {
      self.dropped += 1;
      false
    }
  }
  /// How many were dropped since the last report, at most once a second.
  pub fn report(&mut self, now: Instant) -> Option<u64> {
    if self.dropped == 0 || now.duration_since(self.reported) < Duration::from_secs(1) {
      return None;
    }
    self.reported = now;
    Some(std::mem::take(&mut self.dropped))
  }
}

fn cut(s: &str, n: usize) -> String {
  s.chars().take(n).collect()
}

/// A page's DevTools event as the engine gets it (src/engine/browser-cdp.mjs reads only these fields), or nothing:
/// too big to read (only a console error's existence is kept), a console line that is not an error or a warning, and
/// texts and addresses cut short. `json`: WebView2's ParameterObjectAsJson.
pub fn shrink_event(method: &str, json: &str) -> Option<Value> {
  let limit = if method == "Page.screencastFrame" { MAX_FRAME * 14 / 10 + 4096 } else { MAX_EVENT_JSON };
  if json.len() > limit {
    // Too big to read: of the console only that there was an error (its level is the first field CDP writes).
    let head = &json[..json.len().min(256)];
    let level = ["error", "assert", "warning"].into_iter().find(|l| head.contains(&format!("\"type\":\"{l}\"")) || head.contains(&format!("\"level\":\"{l}\"")));
    return match (method, level) {
      ("Runtime.consoleAPICalled", Some(l)) => Some(json!({ "type": l, "args": [{ "value": format!("(mensaje de {} KB, no leído)", json.len() / 1024) }] })),
      ("Log.entryAdded", Some(l)) => Some(json!({ "entry": { "level": l, "text": format!("(mensaje de {} KB, no leído)", json.len() / 1024) } })),
      ("Runtime.exceptionThrown", _) => Some(json!({ "exceptionDetails": { "text": format!("(error de {} KB, no leído)", json.len() / 1024), "lineNumber": 0 } })),
      _ => None,
    };
  }
  let p: Value = serde_json::from_str(json).ok()?;
  if !forward_event(method, &p) {
    return None;
  }
  let text = |v: Option<&Value>| cut(v.and_then(Value::as_str).unwrap_or(""), MAX_TEXT);
  let url = |v: Option<&Value>| cut(v.and_then(Value::as_str).unwrap_or(""), MAX_URL);
  Some(match method {
    "Runtime.consoleAPICalled" => {
      let joined: String = p.get("args").and_then(Value::as_array).map(|a| a.iter().map(|x| x.get("value").map(|v| v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string())).or_else(|| x.get("description").and_then(Value::as_str).map(str::to_string)).unwrap_or_default()).collect::<Vec<_>>().join(" ")).unwrap_or_default();
      let top = p.pointer("/stackTrace/callFrames/0");
      let frames = top.map(|f| json!([{ "url": url(f.get("url")), "lineNumber": f.get("lineNumber").and_then(Value::as_i64).unwrap_or(0) }])).unwrap_or(json!([]));
      json!({ "type": p.get("type"), "args": [{ "value": cut(&joined, MAX_TEXT) }], "stackTrace": { "callFrames": frames } })
    }
    "Runtime.exceptionThrown" => {
      let d = p.get("exceptionDetails").cloned().unwrap_or(json!({}));
      json!({ "exceptionDetails": { "text": text(d.get("text")), "exception": { "description": text(d.pointer("/exception/description")) }, "url": url(d.get("url")), "lineNumber": d.get("lineNumber").and_then(Value::as_i64).unwrap_or(0) } })
    }
    "Log.entryAdded" => {
      let e = p.get("entry").cloned().unwrap_or(json!({}));
      json!({ "entry": { "level": e.get("level"), "text": text(e.get("text")), "url": url(e.get("url")), "lineNumber": e.get("lineNumber").and_then(Value::as_i64).unwrap_or(0) } })
    }
    "Page.frameNavigated" => {
      let f = p.get("frame").cloned().unwrap_or(json!({}));
      json!({ "frame": { "id": f.get("id"), "parentId": f.get("parentId"), "url": url(f.get("url")) } })
    }
    "Page.navigatedWithinDocument" => json!({ "frameId": p.get("frameId"), "url": url(p.get("url")) }),
    _ => p,
  })
}

/// Whether a DevTools event goes to the engine: of the page's console, only errors and warnings (what
/// orb_browser_console shows); a page that logs in a loop does not flood the engine's channel.
pub fn forward_event(method: &str, params: &Value) -> bool {
  match method {
    "Runtime.consoleAPICalled" => matches!(params.get("type").and_then(Value::as_str), Some("error" | "assert" | "warning")),
    "Log.entryAdded" => matches!(params.pointer("/entry/level").and_then(Value::as_str), Some("error" | "warning")),
    _ => true,
  }
}

/// WebView2's own user agent (Edge's), without a token that names an app embedding it: a page sees a plain Edge.
pub fn user_agent(default: &str) -> String {
  default
    .split(' ')
    .filter(|t| {
      let l = t.to_ascii_lowercase();
      !["orb/", "orb-", "tauri", "wry", "electron", "webview2"].iter().any(|p| l.starts_with(p))
    })
    .collect::<Vec<_>>()
    .join(" ")
}

/// The fields each DevTools method may carry (what the engine's driver sends: src/engine/browser-cdp.mjs,
/// host-browser.mjs), and their limits: Rust is the boundary even if the engine were not (review D7–D8 M5). No world with
/// universal access, no navigation of another frame, nothing bigger than the 1280×800 view at scale 1, no capture
/// beyond the view, no script run at once on every document.
fn check_params(method: &str, p: &Value) -> Result<(), String> {
  let allowed: &[&str] = match method {
    "Page.navigate" => &["url"],
    "Page.reload" => &["ignoreCache"],
    "Page.navigateToHistoryEntry" => &["entryId"],
    "Page.createIsolatedWorld" => &["frameId", "worldName"],
    "Runtime.evaluate" => &["expression", "contextId", "returnByValue", "awaitPromise"],
    "Page.addScriptToEvaluateOnNewDocument" => &["source"],
    "Page.removeScriptToEvaluateOnNewDocument" => &["identifier"],
    "Page.handleJavaScriptDialog" => &["accept", "promptText"],
    "Page.captureScreenshot" => &["format", "quality", "clip"],
    "Page.startScreencast" => &["format", "quality", "maxWidth", "maxHeight", "everyNthFrame"],
    "Page.screencastFrameAck" => &["sessionId"],
    "Input.dispatchMouseEvent" => &["type", "x", "y", "button", "buttons", "clickCount", "modifiers", "deltaX", "deltaY"],
    "Input.dispatchKeyEvent" => &["type", "key", "code", "text", "unmodifiedText", "windowsVirtualKeyCode", "nativeVirtualKeyCode", "modifiers", "autoRepeat"],
    "Input.insertText" => &["text"],
    "Emulation.setDeviceMetricsOverride" => &["width", "height", "deviceScaleFactor", "mobile"],
    "Emulation.setFocusEmulationEnabled" => &["enabled"],
    "Emulation.setEmulatedMedia" => &["media", "features"],
    _ => &[],
  };
  let obj = p.as_object().ok_or("parámetros no válidos")?;
  if let Some(k) = obj.keys().find(|k| !allowed.contains(&k.as_str())) {
    return Err(format!("parámetro no permitido: {}", cut(k, 40)));
  }
  let num = |k: &str| p.get(k).and_then(Value::as_f64);
  let within = |w: Option<f64>, h: Option<f64>| w.is_none_or(|w| (0.0..=1280.0).contains(&w)) && h.is_none_or(|h| (0.0..=800.0).contains(&h));
  let ok = match method {
    "Emulation.setDeviceMetricsOverride" => within(num("width"), num("height")) && num("deviceScaleFactor").is_none_or(|s| (0.0..=1.0).contains(&s)) && p.get("mobile").and_then(Value::as_bool) != Some(true),
    "Page.startScreencast" => within(num("maxWidth"), num("maxHeight")),
    "Page.captureScreenshot" => p.get("clip").is_none_or(|c| within(c.get("width").and_then(Value::as_f64), c.get("height").and_then(Value::as_f64)) && c.get("scale").and_then(Value::as_f64).is_none_or(|s| s > 0.0 && s <= 1.0)),
    "Page.addScriptToEvaluateOnNewDocument" => p.get("source").and_then(Value::as_str).is_some_and(|s| s.len() <= 256 * 1024),
    "Runtime.evaluate" => p.get("expression").and_then(Value::as_str).is_some_and(|s| s.len() <= 1024 * 1024),
    "Input.insertText" => p.get("text").and_then(Value::as_str).is_some_and(|s| s.len() <= 64 * 1024),
    _ => true,
  };
  if ok {
    Ok(())
  } else {
    Err("parámetros fuera de los límites".into())
  }
}

#[derive(Debug, PartialEq)]
pub enum BrowserRequest {
  Open,
  Close(u32),
  Cdp { page: u32, method: String, params: String },
  PipShow(String),
  PipHide,
  PipState(Value),
  PipFrame(String),
}

fn page(params: &Value) -> Result<u32, String> {
  params.get("page").and_then(Value::as_u64).filter(|&n| n > 0 && n < u32::MAX as u64).map(|n| n as u32).ok_or_else(|| "página no válida".to_string())
}

/// The engine's requests for the agents' browser and its little window, checked: a known page, an allowed DevTools method
/// (Page.navigate only to an allowed address), a known size, a JPEG frame.
pub fn check_browser(method: &str, params: &Value) -> Option<Result<BrowserRequest, String>> {
  Some(match method {
    "host.browser.open" => {
      set_own_ports(params);
      Ok(BrowserRequest::Open)
    }
    "host.browser.close" => page(params).map(BrowserRequest::Close),
    "host.browser.cdp" => (|| {
      let page = page(params)?;
      let m = params.get("method").and_then(Value::as_str).unwrap_or("");
      if !CDP_METHODS.contains(&m) {
        return Err(format!("método no permitido: {}", m.chars().take(60).collect::<String>()));
      }
      let p = params.get("params").cloned().unwrap_or(Value::Object(Default::default()));
      if !p.is_object() {
        return Err("parámetros no válidos".into());
      }
      if m == "Page.navigate" && !url_allowed(p.get("url").and_then(Value::as_str).unwrap_or(""), true) {
        return Err("ERR_BLOCKED_BY_CLIENT".into());
      }
      check_params(m, &p)?;
      Ok(BrowserRequest::Cdp { page, method: m.to_string(), params: p.to_string() })
    })(),
    "host.pip.show" => {
      let mode = params.get("mode").and_then(Value::as_str).unwrap_or("normal");
      if PIP_SIZES.iter().any(|(n, _, _)| *n == mode) {
        Ok(BrowserRequest::PipShow(mode.to_string()))
      } else {
        Err("tamaño no válido".into())
      }
    }
    "host.pip.hide" => Ok(BrowserRequest::PipHide),
    "host.pip.state" => match params.get("state") {
      Some(s @ Value::Object(_)) if s.to_string().len() < 16_000 => Ok(BrowserRequest::PipState(s.clone())),
      _ => Err("estado no válido".into()),
    },
    "host.pip.frame" => {
      let d = params.get("data").and_then(Value::as_str).unwrap_or("");
      // A JPEG starts with FF D8 FF: «/9j/» in base64.
      if d.starts_with("/9j/") && d.len() <= MAX_FRAME && d.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=') {
        Ok(BrowserRequest::PipFrame(d.to_string()))
      } else {
        Err("imagen no válida".into())
      }
    }
    _ => return None,
  })
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  #[test]
  fn only_web_pages_load() {
    for url in ["https://ejemplo.com/", "http://127.0.0.1:5173/app", "http://localhost:3000", "about:blank"] {
      assert!(url_allowed(url, true), "{url}");
    }
    for url in [
      "file:///C:/Windows/win.ini",
      "file://servidor/recurso",
      "mailto:a@b.c",
      "ms-settings:privacy",
      "steam://run/1",
      "edge://settings",
      "chrome://version",
      "javascript:alert(1)",
      "data:text/html,<h1>x</h1>",
      "blob:https://ejemplo.com/x",
      "about:srcdoc",
      "http://tauri.localhost/",
      "https://ipc.localhost/plugin:x",
      "http://TAURI.localhost/index.html",
      "http://tauri.localhost./",
      "http://x.ipc.localhost/",
      "view-source:https://ejemplo.com",
      "no es una dirección",
    ] {
      assert!(!url_allowed(url, true), "{url}");
    }
    // Inside the page (frames): what Chromium already treats as the page's own, never file: or an app's protocol.
    for url in ["about:srcdoc", "about:blank", "data:text/html,x", "blob:https://ejemplo.com/x", "https://ejemplo.com/"] {
      assert!(url_allowed(url, false), "{url}");
    }
    set_own_ports(&serde_json::json!({ "blockPorts": [8765] }));
    for url in ["http://127.0.0.1:8765/api/me", "http://localhost:8765/", "http://[::1]:8765/", "http://0.0.0.0:8765/", "http://app.localhost:8765/", "http://[::ffff:127.0.0.1]:8765/"] {
      assert!(!url_allowed(url, true), "{url}");
    }
    assert!(url_allowed("http://127.0.0.1:8766/", true) && url_allowed("https://ejemplo.com:8765/", true));
    set_own_ports(&serde_json::json!({}));
    for url in ["file:///C:/x.html", "ms-settings:", "http://tauri.localhost/", "edge://flags"] {
      assert!(!url_allowed(url, false), "{url}");
    }
  }

  #[test]
  fn devtools_methods_are_limited() {
    let ok = |m: &str, p: Value| check_browser("host.browser.cdp", &json!({ "page": 1, "method": m, "params": p })).unwrap();
    assert!(ok("Runtime.evaluate", json!({ "expression": "1" })).is_ok());
    assert!(ok("Page.navigate", json!({ "url": "https://ejemplo.com" })).is_ok());
    for m in ["Browser.setDownloadBehavior", "Browser.close", "Target.createTarget", "Target.setAutoAttach", "Network.getAllCookies", "Storage.getCookies", "Fetch.enable", "Page.setDownloadBehavior", "Browser.grantPermissions", ""] {
      assert!(ok(m, json!({})).is_err(), "{m}");
    }
    for url in ["file:///C:/Windows/win.ini", "ms-settings:", "http://tauri.localhost/"] {
      assert_eq!(ok("Page.navigate", json!({ "url": url })), Err("ERR_BLOCKED_BY_CLIENT".into()), "{url}");
    }
    assert!(ok("Page.enable", json!([1])).is_err());
    // Their fields too (review D7–D8 M5).
    assert!(ok("Page.createIsolatedWorld", json!({ "frameId": "F", "worldName": "orb" })).is_ok());
    assert!(ok("Page.createIsolatedWorld", json!({ "frameId": "F", "grantUniveralAccess": true })).is_err());
    assert!(ok("Page.navigate", json!({ "url": "https://ejemplo.com", "frameId": "otro" })).is_err());
    assert!(ok("Page.addScriptToEvaluateOnNewDocument", json!({ "source": "1", "runImmediately": true })).is_err());
    assert!(ok("Emulation.setDeviceMetricsOverride", json!({ "width": 1280, "height": 800, "deviceScaleFactor": 1, "mobile": false })).is_ok());
    assert!(ok("Emulation.setDeviceMetricsOverride", json!({ "width": 20000, "height": 800, "deviceScaleFactor": 1 })).is_err());
    assert!(ok("Emulation.setDeviceMetricsOverride", json!({ "width": 1280, "height": 800, "deviceScaleFactor": 4 })).is_err());
    assert!(ok("Page.captureScreenshot", json!({ "format": "jpeg", "quality": 70, "clip": { "x": 0, "y": 0, "width": 1280, "height": 800, "scale": 0.8 } })).is_ok());
    assert!(ok("Page.captureScreenshot", json!({ "captureBeyondViewport": true })).is_err());
    assert!(ok("Page.captureScreenshot", json!({ "clip": { "x": 0, "y": 0, "width": 99999, "height": 800, "scale": 1 } })).is_err());
    assert!(ok("Page.startScreencast", json!({ "format": "jpeg", "quality": 70, "maxWidth": 1280, "maxHeight": 800, "everyNthFrame": 1 })).is_ok());
    assert!(ok("Page.startScreencast", json!({ "maxWidth": 8000, "maxHeight": 8000 })).is_err());
    assert!(ok("Page.bringToFront", json!({})).is_err(), "nunca el foco del sistema");
    assert!(check_browser("host.browser.cdp", &json!({ "page": 0, "method": "Page.enable" })).unwrap().is_err());
    assert!(check_browser("host.browser.cdp", &json!({ "method": "Page.enable" })).unwrap().is_err());
    assert_eq!(check_browser("host.browser.close", &json!({ "page": 3 })), Some(Ok(BrowserRequest::Close(3))));
    assert_eq!(check_browser("host.openUrl", &json!({})), None);
  }

  #[test]
  fn a_page_cannot_flood_orb_with_events() {
    let t0 = Instant::now();
    let mut g = EventGate::new(t0);
    let passed = (0..1000).filter(|_| g.admit("Runtime.exceptionThrown", t0)).count();
    assert_eq!(passed, BURST as usize, "a burst, then nothing");
    assert!(g.admit("Page.screencastFrame", t0), "frames are not counted");
    assert_eq!(g.report(t0), None, "said at most once a second");
    assert_eq!(g.report(t0 + Duration::from_secs(1)), Some(800));
    assert_eq!(g.report(t0 + Duration::from_secs(3)), None);
    // Refilled at RATE a second.
    let later = t0 + Duration::from_secs(1);
    assert_eq!((0..1000).filter(|_| g.admit("Page.frameStartedLoading", later)).count(), RATE as usize);
    // Flooding: once past the console's or all events' limit in a second, said once.
    let mut f = EventGate::new(t0);
    assert!(!(0..FLOOD_CONSOLE).any(|_| f.flooding("Runtime.consoleAPICalled", t0)));
    assert!(f.flooding("Runtime.consoleAPICalled", t0));
    assert!(!f.flooding("Runtime.consoleAPICalled", t0), "once");
    let mut f = EventGate::new(t0);
    assert!(!(0..FLOOD_CONSOLE).any(|i| f.flooding("Runtime.consoleAPICalled", t0 + Duration::from_millis(i as u64 * 10))), "200 spread over 2 s is not a flood");
    assert!(!(0..FLOOD_ALL).any(|_| f.flooding("Page.navigatedWithinDocument", t0 + Duration::from_secs(3))));
    assert!(f.flooding("Page.navigatedWithinDocument", t0 + Duration::from_secs(3)));
    assert!(f.flooded());
    // Few but huge: 2 MB console lines (the e2e page sends some 80 a second) flood by their bytes.
    let mut f = EventGate::new(t0);
    assert!(!(0..8).any(|i| f.flooding_bytes(2_000_000, t0 + Duration::from_millis(i * 10))));
    assert!(f.flooding_bytes(2_000_000, t0 + Duration::from_millis(90)));
    assert!(!f.flooding_bytes(2_000_000, t0 + Duration::from_millis(95)), "once");
    let mut f = EventGate::new(t0);
    assert!(!(0..40).any(|i| f.flooding_bytes(1_000_000, t0 + Duration::from_millis(i * 100))), "10 MB a second is not a flood");
    assert!(!f.flooded());
    // A title at most every 250 ms.
    let mut g = EventGate::new(t0);
    assert!(g.admit("Orb.title", t0));
    assert!(!g.admit("Orb.title", t0 + Duration::from_millis(100)));
    assert!(g.admit("Orb.title", t0 + Duration::from_millis(300)));
    // Too big to read: never parsed; a console error is still said, a log line not at all.
    let big = format!(r#"{{"type":"error","args":[{{"type":"string","value":"{}"}}]}}"#, "x".repeat(MAX_EVENT_JSON));
    let e = shrink_event("Runtime.consoleAPICalled", &big).unwrap();
    assert_eq!(e["type"], "error");
    assert!(e["args"][0]["value"].as_str().unwrap().contains("no leído"));
    assert_eq!(shrink_event("Runtime.consoleAPICalled", &big.replacen("error", "log", 1)), None);
    assert_eq!(shrink_event("Page.navigatedWithinDocument", &format!(r#"{{"frameId":"F","url":"https://a/{}"}}"#, "x".repeat(MAX_EVENT_JSON))), None);
    // Read: only what the driver uses, texts and addresses cut.
    let e = shrink_event("Runtime.consoleAPICalled", &json!({ "type": "warning", "args": [{ "value": "a".repeat(5000) }, { "description": "Error: b" }], "stackTrace": { "callFrames": [{ "url": format!("https://x/{}", "u".repeat(5000)), "lineNumber": 4, "secret": 1 }] }, "executionContextId": 9 }).to_string()).unwrap();
    assert_eq!(e["args"][0]["value"].as_str().unwrap().chars().count(), 1000);
    assert_eq!(e["stackTrace"]["callFrames"][0]["url"].as_str().unwrap().len(), 2048);
    assert!(e.get("executionContextId").is_none());
    assert_eq!(shrink_event("Runtime.consoleAPICalled", &json!({ "type": "log", "args": [] }).to_string()), None);
    let n = shrink_event("Page.frameNavigated", &json!({ "frame": { "id": "F", "url": format!("data:text/html,{}", "z".repeat(3000)), "securityOrigin": "x" } }).to_string()).unwrap();
    assert_eq!(n["frame"]["url"].as_str().unwrap().len(), 2048);
    assert!(n["frame"].get("securityOrigin").is_none());
    assert!(shrink_event("Page.screencastFrame", &json!({ "data": "/9j/".repeat(20000), "sessionId": 1 }).to_string()).is_some(), "a frame is as big as a frame may be");
  }

  #[test]
  fn little_window_requests() {
    assert_eq!(check_browser("host.pip.show", &json!({ "mode": "grande" })), Some(Ok(BrowserRequest::PipShow("grande".into()))));
    assert!(check_browser("host.pip.show", &json!({ "mode": "enorme" })).unwrap().is_err());
    assert!(check_browser("host.pip.frame", &json!({ "data": "/9j/4AAQSkZJRg==" })).unwrap().is_ok());
    for d in ["iVBORw0KGgo=", "/9j/<script>", ""] {
      assert!(check_browser("host.pip.frame", &json!({ "data": d })).unwrap().is_err(), "{d}");
    }
    assert!(check_browser("host.pip.state", &json!({ "state": { "mode": "normal" } })).unwrap().is_ok());
    assert!(check_browser("host.pip.state", &json!({ "state": "x" })).unwrap().is_err());
  }

  #[test]
  fn console_floods_stay_out_and_the_user_agent_is_edge() {
    assert!(forward_event("Runtime.consoleAPICalled", &json!({ "type": "error" })));
    assert!(!forward_event("Runtime.consoleAPICalled", &json!({ "type": "log" })));
    assert!(!forward_event("Log.entryAdded", &json!({ "entry": { "level": "verbose" } })));
    assert!(forward_event("Page.frameNavigated", &json!({})));
    let edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0";
    assert_eq!(user_agent(edge), edge);
    assert_eq!(user_agent(&format!("{edge} Orb/3.8.1 WebView2/1.0")), edge);
  }
}

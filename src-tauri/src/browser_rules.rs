// The pure rules of the agents' browser (browser.rs), kept apart so `cargo test` covers them: which addresses its pages
// may load, which DevTools methods the engine may call on them, its user agent, and the checks of the engine's host.browser.*
// and host.pip.* requests. The same limits as Electron's agents' browser (src/main/browser.mjs): only http(s) pages, no
// other scheme (file:, an app's own protocol, Orb's own pages), and nothing beyond what the shared actions need.
use serde_json::Value;

/// At most this many pages at once (src/core/browser-protocol.mjs › MAX_TABS is 4; one more of margin while a page that
/// made room is still closing).
pub const MAX_PAGES: usize = 5;
/// The little window's sizes, in logical pixels (as Electron's: normal, big, a pill).
pub const PIP_SIZES: [(&str, f64, f64); 3] = [("normal", 400.0, 292.0), ("grande", 820.0, 560.0), ("pildora", 290.0, 46.0)];
/// A frame for the little window: a JPEG in base64, at most this long.
pub const MAX_FRAME: usize = 3 * 1024 * 1024;

/// Hosts that are Orb's own (Tauri serves its window and its IPC on them): never loaded in an agent's page.
const ORB_HOSTS: [&str; 3] = ["tauri.localhost", "ipc.localhost", "asset.localhost"];

/// An address the page itself may go to. The main frame: http(s) pages (a local preview included) and the empty page;
/// a frame inside it may also be about:srcdoc, data: or blob: (Chromium keeps those in the page's origin rules). Never
/// file:, another app's protocol (mailto:, ms-settings:, steam:…), the browser's own pages, or Orb's own hosts.
pub fn url_allowed(url: &str, main_frame: bool) -> bool {
  let Ok(u) = tauri::Url::parse(url) else { return false };
  match u.scheme() {
    "http" | "https" => !u.host_str().map(|h| ORB_HOSTS.contains(&h.to_ascii_lowercase().as_str())).unwrap_or(true),
    "about" => main_frame && url == "about:blank" || !main_frame && matches!(u.path(), "blank" | "srcdoc"),
    "data" | "blob" | "javascript" => !main_frame,
    _ => false,
  }
}

/// The DevTools methods the engine's driver uses (src/engine/browser-cdp.mjs), and nothing else: no Browser.* or
/// Target.* (other pages, downloads, closing the browser), no Network.*/Fetch.*/Storage.* (cookies, headers), no
/// Page.setDownloadBehavior.
const CDP_METHODS: [&str; 26] = [
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
  "Page.bringToFront",
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
    "host.browser.open" => Ok(BrowserRequest::Open),
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
      "view-source:https://ejemplo.com",
      "no es una dirección",
    ] {
      assert!(!url_allowed(url, true), "{url}");
    }
    // Inside the page (frames): what Chromium already treats as the page's own, never file: or an app's protocol.
    for url in ["about:srcdoc", "about:blank", "data:text/html,x", "blob:https://ejemplo.com/x", "https://ejemplo.com/"] {
      assert!(url_allowed(url, false), "{url}");
    }
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
    assert!(check_browser("host.browser.cdp", &json!({ "page": 0, "method": "Page.enable" })).unwrap().is_err());
    assert!(check_browser("host.browser.cdp", &json!({ "method": "Page.enable" })).unwrap().is_err());
    assert_eq!(check_browser("host.browser.close", &json!({ "page": 3 })), Some(Ok(BrowserRequest::Close(3))));
    assert_eq!(check_browser("host.openUrl", &json!({})), None);
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

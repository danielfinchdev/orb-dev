// The window's way to the HTML pages an agent shows in the chat (src/engine/host/html-pages.mjs). The pages come from a
// tiny server of the engine on 127.0.0.1, but the window never frames that address: its CSP would then have to allow
// every local port (where an agent's dev server may listen). Instead the window frames Orb's own scheme
// (orbpage → http://orbpage.localhost/p/<id> on Windows), and this module fetches that one path from exactly the port
// the engine reported (event html:server), nothing else. A request for any other path, method or port is refused here.
use std::borrow::Cow;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::sync::atomic::{AtomicU16, Ordering};
use std::time::Duration;
use tauri::http::{header::HeaderName, header::HeaderValue, Request, Response, StatusCode};
use tauri::UriSchemeResponder;

pub const SCHEME: &str = "orbpage";
/// What the engine puts in front of /p/<id> (ORB_PAGES_ORIGIN): WebView2 serves a custom scheme as http://<scheme>.localhost.
#[cfg(windows)]
pub const ORIGIN: &str = "http://orbpage.localhost";
#[cfg(not(windows))]
pub const ORIGIN: &str = "orbpage://localhost";

/// A page is at most 512 KB (MAX_HTML); the headers are small.
const MAX_RESPONSE: usize = 1024 * 1024;
static PORT: AtomicU16 = AtomicU16::new(0);

/// The engine's html:server event: the port of its page server, or 0 when it stopped.
pub fn set_port(port: Option<u64>) {
  PORT.store(port.and_then(|p| u16::try_from(p).ok()).unwrap_or(0), Ordering::SeqCst);
}

/// Exactly /p/ and 32 lowercase hex digits: no query, no dot segments, nothing the engine does not serve.
pub fn valid_path(path: &str) -> bool {
  path.strip_prefix("/p/").is_some_and(|id| id.len() == 32 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')))
}

/// Status, headers and body of the engine's HTTP/1.0 answer. Framing headers are dropped (the body is whole).
pub fn parse_response(raw: &[u8]) -> Option<(u16, Vec<(String, String)>, Vec<u8>)> {
  let end = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
  let head = std::str::from_utf8(&raw[..end]).ok()?;
  let mut lines = head.split("\r\n");
  let status = lines.next()?.split(' ').nth(1)?.parse::<u16>().ok()?;
  let headers = lines
    .filter_map(|l| l.split_once(':'))
    .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
    .filter(|(k, _)| !matches!(k.to_ascii_lowercase().as_str(), "content-length" | "connection" | "transfer-encoding" | "keep-alive"))
    .collect();
  Some((status, headers, raw[end + 4..].to_vec()))
}

fn plain(status: u16) -> Response<Cow<'static, [u8]>> {
  let mut r = Response::new(Cow::Borrowed(&b""[..]));
  *r.status_mut() = StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY);
  r
}

fn fetch(port: u16, path: &str) -> Option<Vec<u8>> {
  let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
  let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(3)).ok()?;
  stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
  stream.set_write_timeout(Some(Duration::from_secs(5))).ok()?;
  // HTTP/1.0: the server answers with the body whole and closes, so there is no chunked framing to parse. The Host is
  // exactly what the engine checks against DNS rebinding.
  stream.write_all(format!("GET {path} HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nAccept: text/html\r\n\r\n").as_bytes()).ok()?;
  let mut raw = Vec::new();
  stream.take(MAX_RESPONSE as u64 + 1).read_to_end(&mut raw).ok()?;
  (raw.len() <= MAX_RESPONSE).then_some(raw)
}

fn serve(request: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
  let port = PORT.load(Ordering::SeqCst);
  let uri = request.uri();
  if request.method() != "GET" || uri.query().is_some() || !valid_path(uri.path()) || port == 0 {
    return plain(404);
  }
  let Some((status, headers, body)) = fetch(port, uri.path()).and_then(|raw| parse_response(&raw)) else {
    return plain(502);
  };
  let mut r = Response::new(Cow::Owned(body));
  *r.status_mut() = StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY);
  // A page without its sandbox policy must never be served (whoever answered on that port), so any header that does not
  // convert, or a missing / non-sandboxed CSP, is a failure and not a page.
  for (k, v) in headers {
    match (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(&v)) {
      (Ok(k), Ok(v)) => {
        r.headers_mut().append(k, v);
      }
      _ => return plain(502),
    }
  }
  let sandboxed = r.headers().get("content-security-policy").and_then(|v| v.to_str().ok()).is_some_and(|v| v.starts_with("sandbox"));
  if !sandboxed {
    return plain(502);
  }
  r
}

/// The scheme handler: the fetch blocks, so it runs on its own thread.
pub fn handle(request: Request<Vec<u8>>, responder: UriSchemeResponder) {
  std::thread::spawn(move || responder.respond(serve(&request)));
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn only_the_engines_page_path_is_fetched() {
    let id = "0123456789abcdef0123456789abcdef";
    assert!(valid_path(&format!("/p/{id}")));
    for bad in ["/", "/p/", "/p/../x", "/p/0123", &format!("/p/{id}/"), &format!("/p/{}", id.to_uppercase()), &format!("/q/{id}"), &format!("//p/{id}"), "/p/0123456789abcdef0123456789abcdeg"] {
      assert!(!valid_path(bad), "{bad}");
    }
  }

  #[test]
  fn parses_the_answer_and_drops_framing_headers() {
    let raw = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Security-Policy: sandbox allow-scripts\r\nContent-Length: 5\r\nConnection: close\r\n\r\n<b>x";
    let (status, headers, body) = parse_response(raw).unwrap();
    assert_eq!(status, 200);
    assert_eq!(body, b"<b>x");
    assert!(headers.iter().any(|(k, v)| k == "Content-Security-Policy" && v.starts_with("sandbox")));
    assert!(!headers.iter().any(|(k, _)| k.eq_ignore_ascii_case("content-length") || k.eq_ignore_ascii_case("connection")));
    assert!(parse_response(b"HTTP/1.1 200 OK\r\n").is_none());
    assert!(parse_response(b"garbage\r\n\r\n").is_none());
  }

  #[test]
  fn refuses_other_methods_paths_and_a_stopped_server() {
    let id = "0123456789abcdef0123456789abcdef";
    let get = |m: &str, uri: String| Request::builder().method(m).uri(uri).body(Vec::new()).unwrap();
    set_port(Some(0));
    assert_eq!(serve(&get("GET", format!("http://orbpage.localhost/p/{id}"))).status(), 404);
    set_port(Some(1));
    assert_eq!(serve(&get("POST", format!("http://orbpage.localhost/p/{id}"))).status(), 404);
    assert_eq!(serve(&get("GET", format!("http://orbpage.localhost/p/{id}?x=1"))).status(), 404);
    assert_eq!(serve(&get("GET", "http://orbpage.localhost/etc".into())).status(), 404);
    set_port(Some(70000));
    assert_eq!(PORT.load(Ordering::SeqCst), 0);
    set_port(None);
    assert_eq!(PORT.load(Ordering::SeqCst), 0);
  }
}

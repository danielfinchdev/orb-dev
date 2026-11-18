//! Small checks that keep the window closed in on itself: which addresses it may show or listen to, and which environment
//! variables could point its browser engine somewhere else.

pub const ORIGIN: &str = "http://orbinst.localhost";

/// True only for an address of this program's own origin: the origin itself or a path under it. A longer host name that merely
/// starts with the same letters (`http://orbinst.localhost.evil.example/`) is not ours.
pub fn is_own_url(url: &str) -> bool {
  match url.strip_prefix(ORIGIN) {
    Some(rest) => rest.is_empty() || rest.starts_with(['/', '?', '#']),
    None => false,
  }
}

/// Every variable whose name starts with WEBVIEW2_ (WebView2 reads several: extra browser arguments such as a debugging port,
/// another browser, another data folder, release channel...). A real installer starts from a clean environment; a test run keeps them.
pub const WEBVIEW2_PREFIX: &str = "WEBVIEW2_";

pub fn scrub_webview2_env() {
  let names: Vec<std::ffi::OsString> = std::env::vars_os().map(|(k, _)| k).filter(|k| k.to_string_lossy().to_ascii_uppercase().starts_with(WEBVIEW2_PREFIX)).collect();
  for name in names {
    std::env::remove_var(name);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn only_the_exact_origin_is_ours() {
    assert!(is_own_url("http://orbinst.localhost/"));
    assert!(is_own_url("http://orbinst.localhost/index.html?x=1"));
    assert!(is_own_url("http://orbinst.localhost"));
    assert!(!is_own_url("http://orbinst.localhost.evil.example/"));
    assert!(!is_own_url("http://orbinst.localhostx/"));
    assert!(!is_own_url("https://orbinst.localhost/"));
    assert!(!is_own_url("http://evil.example/http://orbinst.localhost/"));
    assert!(!is_own_url(""));
  }

  #[test]
  fn every_webview2_variable_is_cleared_and_others_stay() {
    for n in ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "WEBVIEW2_RELEASE_CHANNEL_PREFERENCE", "webview2_lower_case", "WEBVIEW2_SOMETHING_NEW"] {
      std::env::set_var(n, "x");
    }
    std::env::set_var("ORB_GUARD_TEST_KEEP", "x");
    scrub_webview2_env();
    assert!(!std::env::vars_os().any(|(k, _)| k.to_string_lossy().to_ascii_uppercase().starts_with("WEBVIEW2_")));
    assert!(std::env::var_os("ORB_GUARD_TEST_KEEP").is_some());
  }
}

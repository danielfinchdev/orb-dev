//! Is the WebView2 runtime installed? Read-only: Evergreen's version lives in the "pv" value of EdgeUpdate's client key.
use windows_registry::{CURRENT_USER, LOCAL_MACHINE};

const CLIENT_GUID: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

/// True when any of the values read is a real version (Edge's updater writes "0.0.0.0" for a runtime that was removed).
pub fn present(values: &[Option<String>]) -> bool {
  values.iter().flatten().any(|v| {
    let v = v.trim();
    !v.is_empty() && v != "0.0.0.0" && v.chars().next().is_some_and(|c| c.is_ascii_digit())
  })
}

/// The values of the machine's two registry views and the user's.
pub fn read_values() -> Vec<Option<String>> {
  let read = |root: &windows_registry::Key, path: String| root.open(path).ok().and_then(|k| k.get_string("pv").ok());
  vec![
    read(LOCAL_MACHINE, format!(r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{CLIENT_GUID}")),
    read(LOCAL_MACHINE, format!(r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{CLIENT_GUID}")),
    read(CURRENT_USER, format!(r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{CLIENT_GUID}")),
  ]
}

pub fn installed() -> bool {
  present(&read_values())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn s(v: &str) -> Option<String> {
    Some(v.to_string())
  }

  #[test]
  fn a_real_version_in_any_place_counts() {
    assert!(present(&[None, None, s("131.0.2903.112")]));
    assert!(present(&[s("120.0.1"), None, None]));
  }

  #[test]
  fn nothing_or_a_removed_runtime_does_not() {
    assert!(!present(&[]));
    assert!(!present(&[None, None, None]));
    assert!(!present(&[s(""), s("0.0.0.0"), s("  ")]));
    assert!(!present(&[s("not a version")]));
  }
}

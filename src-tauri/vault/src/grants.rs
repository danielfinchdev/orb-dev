// A connector's keys go from the vault straight to its launcher (src/mcp/launch.mjs), never through the engine: the
// engine asks for a grant (server.rs › grant) and hands the launcher only its random name; the launcher trades it here,
// once, within a minute, on a pipe of its own (any process of this Windows user may connect, but a grant is 256 random
// bits, used up on the first try and gone after GRANT_MS).
use crate::crypto;
use crate::locked::Locked;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, Read, Write};
use std::sync::Mutex;

pub const GRANT_MS: u64 = 60_000;
const MAX_GRANTS: usize = 64;

pub struct Grants {
  name: String,
  map: Mutex<HashMap<String, (u64, Locked)>>,
}

impl Grants {
  pub fn new(name: String) -> Self {
    Self { name, map: Mutex::new(HashMap::new()) }
  }
  pub fn name(&self) -> &str {
    &self.name
  }
  /// The env (a JSON object) kept for one trade. → the grant's name.
  pub fn add(&self, env: &Value, now: u64) -> String {
    let mut bytes = serde_json::to_vec(env).unwrap_or_default();
    let held = Locked::from_slice(&bytes);
    zeroize::Zeroize::zeroize(&mut bytes);
    let token: String = crypto::random(32).as_slice().iter().map(|b| format!("{b:02x}")).collect();
    let mut map = self.map.lock().unwrap();
    map.retain(|_, g| g.0 > now);
    while map.len() >= MAX_GRANTS {
      let oldest = map.iter().min_by_key(|(_, g)| g.0).map(|(k, _)| k.clone()).unwrap();
      map.remove(&oldest);
    }
    map.insert(token.clone(), (now + GRANT_MS, held));
    token
  }
  /// One launcher: a line {"grant": name} → {"env": {...}} or {"env": null}.
  pub fn trade(&self, input: &mut impl BufRead, output: &mut impl Write, now: u64) -> std::io::Result<()> {
    let mut line = Vec::with_capacity(256);
    input.by_ref().take(4096).read_until(b'\n', &mut line)?;
    let token = serde_json::from_slice::<Value>(&line).ok().and_then(|v| v.get("grant").and_then(Value::as_str).map(String::from)).unwrap_or_default();
    let got = self.map.lock().unwrap().remove(&token).filter(|g| g.0 > now);
    let mut out = Locked::with_capacity(got.as_ref().map_or(0, |g| g.1.len()) + 16);
    out.extend(b"{\"env\":");
    match &got {
      Some((_, env)) => out.extend(env.as_slice()),
      None => out.extend(b"null"),
    }
    out.extend(b"}\n");
    output.write_all(out.as_slice())?;
    output.flush()
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn once_and_in_time() {
    let g = Grants::new("x".into());
    let t = g.add(&serde_json::json!({ "K": "v" }), 1000);
    let trade = |token: &str, now| {
      let mut out = Vec::new();
      g.trade(&mut format!("{{\"grant\":\"{token}\"}}\n").as_bytes(), &mut out, now).unwrap();
      String::from_utf8(out).unwrap()
    };
    assert_eq!(trade(&t, 1001), "{\"env\":{\"K\":\"v\"}}\n");
    assert_eq!(trade(&t, 1002), "{\"env\":null}\n", "used up");
    let late = g.add(&serde_json::json!({ "K": "v" }), 1000);
    assert_eq!(trade(&late, 1000 + GRANT_MS + 1), "{\"env\":null}\n", "too late");
  }
}

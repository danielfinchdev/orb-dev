// The master password and Orb's own secrets, the same files and rules Orb 3.8 kept from Node (src/core/master.mjs tells
// the whole story; this is its body now, out of the engine):
//   maestra.json     the data key wrapped by scrypt(password) (its own salt and cost; a check HMAC)
//   maestra-pc.json  the data key wrapped by a key from this PC's secret (says, authenticated, whether a password exists)
//   secretos.json    the secrets: one JSON map sealed with the data key (the phones' verifier of the password too)
//   intentos.json    wrong tries per channel: growing waits; when it cannot be written nothing is checked (fail closed)
// The data key, this PC's secret and every key made from a password live only here, in locked memory, and never leave:
// the engine asks for one secret at a time (get/set), for a password to be checked, or for a connector's keys to be
// handed to its launcher (grants.rs). The secrets map is opened for each request and wiped right after.
use crate::crypto::{self, b64, b64url, unb64};
use crate::locked::{wipe_value, Locked};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub const MASTER: &str = "maestra.json";
pub const MACHINE: &str = "maestra-pc.json";
pub const VAULT: &str = "secretos.json";
pub const TRIES: &str = "intentos.json";
pub const KEPT: [&str; 3] = [MASTER, MACHINE, VAULT];
pub const MIN_LENGTH: usize = 10;
pub const MAX_LENGTH: usize = 256;
pub const UNLOCK_MS: u64 = 5 * 60_000;
pub const FRESH_MS: u64 = 2 * 60_000;
pub const FREE_TRIES: u64 = 5;
const WAIT_FIRST_S: u64 = 30;
const WAIT_MAX_S: u64 = 15 * 60;
pub const PAIR_ID: &str = "master/pair";
const HAD_ID: &str = "master/had";

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Code {
  Short,
  Long,
  Exists,
  Lost,
  Locked,
  Damaged,
}
impl Code {
  pub fn as_str(self) -> &'static str {
    match self {
      Self::Short => "short",
      Self::Long => "long",
      Self::Exists => "exists",
      Self::Lost => "lost",
      Self::Locked => "locked",
      Self::Damaged => "damaged",
    }
  }
}

/// The costs: Orb's own, or the tests' cheap ones (the orb-vault binary with --test only; never Orb.exe).
#[derive(Clone, Copy)]
pub struct Costs {
  pub test: bool,
}
impl Costs {
  fn kdf(self) -> (u64, u32, u32) {
    if self.test { (1 << 12, 8, 1) } else { (1 << 17, 8, 1) }
  }
  fn pair(self) -> (u64, u32, u32) {
    if self.test { (1 << 11, 8, 1) } else { (1 << 16, 8, 1) }
  }
  fn kdf_min(self) -> u64 {
    if self.test { 1 << 10 } else { 1 << 15 }
  }
  fn pair_min(self) -> u64 {
    if self.test { 1 << 10 } else { 1 << 15 }
  }
}

/// maestra.json's cost: a file someone left there can neither make it cheap nor hang Orb.
pub fn kdf_ok(kdf: &Value, costs: Costs) -> bool {
  let n = kdf.get("N").and_then(Value::as_u64);
  let salt = kdf.get("salt").and_then(Value::as_str).and_then(crate::crypto::unb64);
  matches!(n, Some(n) if n >= costs.kdf_min() && n <= 1 << 20 && n.is_power_of_two())
    && kdf.get("r").and_then(Value::as_u64) == Some(8)
    && kdf.get("p").and_then(Value::as_u64) == Some(1)
    && salt.is_some_and(|s| s.len() == 16)
}
/// The verifier's cost (mobile-crypto.mjs › pairKdfOk).
pub fn pair_kdf_ok(kdf: &Value, costs: Costs) -> bool {
  let n = kdf.get("N").and_then(Value::as_u64);
  let salt = kdf.get("salt").and_then(Value::as_str).and_then(crate::crypto::unb64);
  matches!(n, Some(n) if n >= costs.pair_min() && n <= 1 << 18 && n.is_power_of_two())
    && kdf.get("r").and_then(Value::as_u64) == Some(8)
    && kdf.get("p").and_then(Value::as_u64) == Some(1)
    && salt.is_some_and(|s| s.len() == 16)
}

/// A password as typed (already NFC): 10 to 256 characters.
pub fn check_password(p: &str) -> Result<(), Code> {
  let n = p.chars().count();
  if n < MIN_LENGTH {
    Err(Code::Short)
  } else if n > MAX_LENGTH {
    Err(Code::Long)
  } else {
    Ok(())
  }
}

fn aad_password(key_id: &str) -> String {
  format!("orb-master:password|{key_id}")
}
fn aad_machine(key_id: &str, had: bool) -> String {
  format!("orb-master:machine|{key_id}|{}", if had { "password" } else { "none" })
}
fn aad_vault(key_id: &str) -> String {
  format!("orb-secretos-v2|{key_id}")
}

fn read_json(file: &Path) -> Option<Value> {
  let text = std::fs::read_to_string(file).ok()?;
  serde_json::from_str(&text).ok()
}
fn write_json(file: &Path, value: &Value) -> std::io::Result<()> {
  if let Some(dir) = file.parent() {
    std::fs::create_dir_all(dir)?;
  }
  let tmp = PathBuf::from(format!("{}.{}.tmp", file.display(), std::process::id()));
  let text = format!("{}\n", serde_json::to_string_pretty(value).unwrap_or_default());
  std::fs::write(&tmp, text)?;
  std::fs::rename(&tmp, file).inspect_err(|_| drop(std::fs::remove_file(&tmp)))
}
fn wrapped(v: &Option<Value>) -> Option<&str> {
  v.as_ref()?.get("wrapped")?.as_str().filter(|s| !s.is_empty())
}
fn str_of<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
  v.get(k)?.as_str()
}

/// JavaScript's Date#toISOString of milliseconds since 1970 (UTC), and back.
pub fn iso(ms: u64) -> String {
  let (s, milli) = (ms / 1000, ms % 1000);
  let (days, rem) = ((s / 86_400) as i64, s % 86_400);
  let (y, m, d) = civil(days);
  format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{milli:03}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}
pub fn parse_iso(text: &str) -> Option<u64> {
  let b = text.as_bytes();
  if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' || !text.ends_with('Z') {
    return None;
  }
  let num = |r: std::ops::Range<usize>| text.get(r)?.parse::<i64>().ok();
  let (y, mo, d, h, mi, s) = (num(0..4)?, num(5..7)?, num(8..10)?, num(11..13)?, num(14..16)?, num(17..19)?);
  let ms = if b[19] == b'.' { text.get(20..text.len() - 1)?.get(..3).and_then(|x| x.parse::<i64>().ok()).unwrap_or(0) } else { 0 };
  let days = days_from_civil(y, mo, d);
  let t = days * 86_400_000 + h * 3_600_000 + mi * 60_000 + s * 1000 + ms;
  u64::try_from(t).ok()
}
fn civil(z: i64) -> (i64, i64, i64) {
  let z = z + 719_468;
  let era = z.div_euclid(146_097);
  let doe = z - era * 146_097;
  let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
  let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  let mp = (5 * doy + 2) / 153;
  let d = doy - (153 * mp + 2) / 5 + 1;
  let m = if mp < 10 { mp + 3 } else { mp - 9 };
  (yoe + era * 400 + i64::from(m <= 2), m, d)
}
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
  let y = if m <= 2 { y - 1 } else { y };
  let era = y.div_euclid(400);
  let yoe = y - era * 400;
  let mp = (m + 9) % 12;
  let doy = (153 * mp + 2) / 5 + d - 1;
  let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  era * 146_097 + doe - 719_468
}
fn wait_seconds(fails: u64) -> u64 {
  let extra = fails.saturating_sub(FREE_TRIES).min(20) as u32;
  (WAIT_FIRST_S.saturating_mul(1u64 << extra)).min(WAIT_MAX_S)
}

/// The secrets map, opened for one request (its strings are wiped when it goes).
pub struct Items(pub Map<String, Value>);
impl Drop for Items {
  fn drop(&mut self) {
    for v in self.0.values_mut() {
      wipe_value(v);
    }
  }
}

/// What an attempt says (src/core/master.mjs › attempt).
#[derive(Debug, PartialEq)]
pub enum Tried {
  Ok,
  Wrong { left: u64, until: Option<u64> },
  Wait(u64),
  Tries,
  None,
}
impl Tried {
  pub fn to_json(&self) -> Value {
    match self {
      Self::Ok => json!({ "ok": true }),
      Self::Wrong { left, until } => {
        let mut v = json!({ "ok": false, "reason": "wrong", "left": left });
        if let Some(u) = until {
          v["until"] = json!(iso(*u));
        }
        v
      }
      Self::Wait(u) => json!({ "ok": false, "reason": "wait", "until": iso(*u) }),
      Self::Tries => json!({ "ok": false, "reason": "tries" }),
      Self::None => json!({ "ok": false, "reason": "none" }),
    }
  }
}

enum Cache {
  Unread,
  Empty,
  Sealed(String),
}

pub struct Vault {
  pub dir: PathBuf,
  costs: Costs,
  secret: Option<Locked>,
  dek: Option<Locked>,
  key_id: Option<String>,
  cache: Cache,
  tokens: HashMap<String, (u64, Option<String>)>,
  fails: HashMap<String, u64>,
  fails_until: HashMap<String, u64>,
  had_machine: bool,
  /// Something in the folder changed (the engine copies it outside core: src/core/master.mjs › mirrorTo).
  pub changed: bool,
  /// Channels that just reached another FREE_TRIES wrong tries in a row (the engine tells the owner).
  pub notices: Vec<(String, u64)>,
}

impl Vault {
  pub fn new(dir: PathBuf, secret: Option<Locked>, costs: Costs) -> Self {
    Self {
      dir,
      costs,
      secret: secret.filter(|s| s.len() >= 32),
      dek: None,
      key_id: None,
      cache: Cache::Unread,
      tokens: HashMap::new(),
      fails: HashMap::new(),
      fails_until: HashMap::new(),
      had_machine: false,
      changed: false,
      notices: Vec::new(),
    }
  }
  pub fn costs(&self) -> Costs {
    self.costs
  }
  fn file(&self, name: &str) -> PathBuf {
    self.dir.join(name)
  }
  pub fn has_password(&self) -> bool {
    wrapped(&read_json(&self.file(MASTER))).is_some()
  }
  pub fn unlocked(&self) -> bool {
    self.dek.is_some()
  }
  pub fn key_id(&self) -> Option<&str> {
    self.key_id.as_deref()
  }
  pub fn had_password(&mut self) -> bool {
    if self.had_machine {
      return true;
    }
    if self.dek.is_none() {
      return false;
    }
    match self.items() {
      Ok(items) => items.0.get(HAD_ID).is_some_and(|v| !v.is_null() && v != &json!(false)),
      Err(_) => true, // a vault that does not open: assume so
    }
  }
  pub fn state(&mut self) -> Value {
    let m = read_json(&self.file(MASTER));
    let file = wrapped(&m).is_some();
    let had = file || self.had_password() || read_json(&self.file(MACHINE)).is_some_and(|v| v.get("password") == Some(&json!(true)));
    let changed = m.as_ref().and_then(|m| m.get("changed").filter(|v| !v.is_null()).or_else(|| m.get("created").filter(|v| !v.is_null()))).cloned().unwrap_or(Value::Null);
    json!({ "exists": had, "lost": had && !file, "locked": self.dek.is_none(), "changedAt": changed })
  }

  fn use_key(&mut self, key: Locked) {
    self.key_id = Some(crypto::key_id(key.as_slice()));
    self.dek = Some(key);
    self.cache = Cache::Unread;
  }

  /// At the engine's start: the data key from this PC's wrap; a workspace with nothing gets a new one. → open or not.
  pub fn open_with_machine(&mut self) -> Result<bool, Code> {
    if self.dek.is_some() {
      return Ok(true);
    }
    let pc = read_json(&self.file(MACHINE));
    if let (Some(w), Some(secret)) = (wrapped(&pc), &self.secret) {
      let p = pc.as_ref().unwrap();
      let had = p.get("password") == Some(&json!(true));
      let key_id = str_of(p, "keyId").unwrap_or_default().to_string();
      let mk = crypto::machine_key(secret.as_slice());
      if let Some(key) = crypto::unseal(mk.as_slice(), w, &aad_machine(&key_id, had)) {
        if key.len() == 32 && crypto::key_id(key.as_slice()) == key_id {
          self.use_key(key);
          self.had_machine = had;
          return Ok(true);
        }
      }
    }
    if pc.is_some() || std::fs::metadata(self.file(MACHINE)).is_ok() || self.has_password() || self.file(VAULT).exists() {
      return Ok(false);
    }
    self.use_key(crypto::random(32));
    self.write_items(&Map::new()).map_err(|_| Code::Damaged)?;
    self.seal_for_machine();
    Ok(true)
  }

  pub fn seal_for_machine(&mut self) -> bool {
    if self.dek.is_none() || self.secret.is_none() {
      return false;
    }
    let had = self.had_password();
    let (dek, key_id, secret) = (self.dek.as_ref().unwrap(), self.key_id.clone().unwrap(), self.secret.as_ref().unwrap());
    let mk = crypto::machine_key(secret.as_slice());
    let w = crypto::seal(mk.as_slice(), dek.as_slice(), &aad_machine(&key_id, had));
    if write_json(&self.file(MACHINE), &json!({ "v": 2, "keyId": key_id, "password": had, "wrapped": w })).is_err() {
      return false;
    }
    self.had_machine = had;
    self.changed = true;
    true
  }

  // ---- the secrets
  pub fn items(&mut self) -> Result<Items, Code> {
    let dek = self.dek.as_ref().ok_or(Code::Locked)?;
    if matches!(self.cache, Cache::Unread) {
      self.cache = match read_json(&self.file(VAULT)).and_then(|v| str_of(&v, "box").filter(|b| !b.is_empty()).map(String::from)) {
        Some(b) => Cache::Sealed(b),
        None => Cache::Empty,
      };
    }
    let sealed = match &self.cache {
      Cache::Sealed(b) => b,
      _ => return Ok(Items(Map::new())),
    };
    let plain = crypto::unseal(dek.as_slice(), sealed, &aad_vault(self.key_id.as_deref().unwrap_or_default())).ok_or(Code::Damaged)?;
    match serde_json::from_slice::<Value>(plain.as_slice()) {
      Ok(Value::Object(m)) => Ok(Items(m)),
      Ok(mut other) => {
        wipe_value(&mut other);
        Ok(Items(Map::new()))
      }
      Err(_) => Err(Code::Damaged),
    }
  }
  pub fn write_items(&mut self, items: &Map<String, Value>) -> Result<(), Code> {
    let dek = self.dek.as_ref().ok_or(Code::Locked)?;
    let key_id = self.key_id.clone().unwrap_or_default();
    let mut plain = serde_json::to_vec(items).map_err(|_| Code::Damaged)?;
    let sealed = crypto::seal(dek.as_slice(), &plain, &aad_vault(&key_id));
    zeroize::Zeroize::zeroize(&mut plain);
    write_json(&self.file(VAULT), &json!({ "v": 2, "keyId": key_id, "box": sealed })).map_err(|_| Code::Damaged)?;
    self.cache = Cache::Sealed(sealed);
    self.changed = true;
    Ok(())
  }
  pub fn get(&mut self, id: &str) -> Result<Value, Code> {
    let mut items = self.items()?;
    Ok(items.0.remove(id).unwrap_or(Value::Null))
  }
  pub fn set(&mut self, id: &str, value: Value) -> Result<(), Code> {
    let mut items = self.items()?;
    let old = if value.is_null() { items.0.remove(id) } else { items.0.insert(id.to_string(), value) };
    if let Some(mut old) = old {
      wipe_value(&mut old);
    }
    self.write_items(&items.0)
  }
  pub fn ids(&mut self, prefix: &str) -> Result<Vec<String>, Code> {
    Ok(self.items()?.0.keys().filter(|k| k.starts_with(prefix)).cloned().collect())
  }

  // ---- the waits
  fn tries(&self) -> Option<Map<String, Value>> {
    match std::fs::read_to_string(self.file(TRIES)) {
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => Some(Map::new()),
      Err(_) => None,
      Ok(text) => match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(m)) => Some(m),
        _ => None,
      },
    }
  }
  fn fails_of(&self, channel: &str) -> u64 {
    let mem = self.fails.get(channel).copied().unwrap_or(0);
    let file = match self.tries() {
      Some(t) => t.get(channel).and_then(|c| c.get("fails")).and_then(Value::as_f64).filter(|f| f.is_finite() && *f > 0.0).map(|f| f as u64).unwrap_or(0),
      None => FREE_TRIES + 5,
    };
    mem.max(file)
  }
  pub fn wait_of(&self, channel: &str, now: u64) -> u64 {
    let t = self.tries();
    let mut until = t.as_ref().and_then(|t| t.get(channel)).and_then(|c| c.get("until")).and_then(Value::as_str).and_then(parse_iso).unwrap_or(0);
    if t.is_none() {
      until = std::fs::metadata(self.file(TRIES))
        .and_then(|m| m.modified())
        .ok()
        .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64 + WAIT_MAX_S * 1000)
        .unwrap_or(now + WAIT_MAX_S * 1000);
    }
    until = until.max(self.fails_until.get(channel).copied().unwrap_or(0));
    if until > now { until } else { 0 }
  }
  fn note_try(&mut self, channel: &str, ok: bool, now: u64) -> bool {
    let mut all = self.tries().unwrap_or_default();
    if ok {
      all.remove(channel);
      self.fails.insert(channel.into(), 0);
      self.fails_until.insert(channel.into(), 0);
    } else {
      let fails = self.fails_of(channel) + 1;
      let until = if fails >= FREE_TRIES { now + wait_seconds(fails) * 1000 } else { 0 };
      self.fails.insert(channel.into(), fails);
      self.fails_until.insert(channel.into(), until);
      all.insert(channel.into(), json!({ "fails": fails, "until": if until > 0 { json!(iso(until)) } else { Value::Null } }));
      if fails % FREE_TRIES == 0 {
        self.notices.push((channel.into(), fails));
      }
    }
    write_json(&self.file(TRIES), &Value::Object(all)).is_ok()
  }
  fn can_count(&self) -> bool {
    match self.tries() {
      None => false,
      Some(t) => write_json(&self.file(TRIES), &Value::Object(t)).is_ok(),
    }
  }
  /// Before a try: Some(refusal) when it may not be tried now.
  pub fn begin_try(&self, channel: &str, now: u64) -> Option<Tried> {
    let until = self.wait_of(channel, now);
    if until > 0 {
      return Some(Tried::Wait(until));
    }
    if !self.can_count() {
      return Some(Tried::Tries);
    }
    None
  }
  /// After it: counted, and what it says.
  pub fn end_try(&mut self, channel: &str, ok: bool, now: u64) -> Tried {
    if !self.note_try(channel, ok, now) && !ok {
      return Tried::Tries;
    }
    if ok {
      return Tried::Ok;
    }
    let fails = self.fails_of(channel);
    let wait = self.wait_of(channel, now);
    Tried::Wrong { left: FREE_TRIES.saturating_sub(fails), until: (wait > 0).then_some(wait) }
  }

  // ---- the password. Slow (scrypt) parts are split out so the engine's quick requests never wait for them:
  // `master_file` and `key_for_kek` around a scrypt the caller runs without holding this vault.
  pub fn master_file(&self) -> Option<Value> {
    read_json(&self.file(MASTER))
  }
  /// The data key for a key made from the password (maestra.json read before scrypt), or None. Only THE data key
  /// counts: the one open here (constant time), or, with none open, one that opens the secrets that are here.
  pub fn key_for_kek(&self, m: &Value, kek: &[u8]) -> Option<Locked> {
    let key_id = str_of(m, "keyId")?;
    let check = unb64(str_of(m, "check").unwrap_or_default())?;
    if !crypto::same(&check, &crypto::check_of(kek)) {
      return None;
    }
    let key = crypto::unseal(kek, str_of(m, "wrapped")?, &aad_password(key_id))?;
    if key.len() != 32 || crypto::key_id(key.as_slice()) != key_id {
      return None;
    }
    if let Some(dek) = &self.dek {
      return crypto::same(key.as_slice(), dek.as_slice()).then_some(key);
    }
    if let Some(v) = read_json(&self.file(VAULT)) {
      if let Some(b) = str_of(&v, "box").filter(|b| !b.is_empty()) {
        crypto::unseal(key.as_slice(), b, &aad_vault(&crypto::key_id(key.as_slice())))?;
      }
    }
    Some(key)
  }
  /// A right password just opened `key` (None when it was open already): wrapped for this PC; the phones' verifier
  /// made when it is missing (a password made before it existed).
  pub fn after_verify(&mut self, key: Option<Locked>, verifier: impl FnOnce() -> Option<Value>) {
    if self.dek.is_none() {
      if let Some(k) = key {
        self.use_key(k);
        self.had_machine = true;
        self.seal_for_machine();
      }
    }
    if let Ok(items) = self.items() {
      if !items.0.contains_key(PAIR_ID) {
        drop(items);
        if let Some(v) = verifier() {
          let _ = self.set(PAIR_ID, v);
        }
      }
    }
  }

  /// maestra.json, the verifier and the marks «there is a password» from the slow parts made by the caller.
  pub fn wrap_with(&mut self, kek: &Locked, kdf: Value, verifier: Value, created: Option<String>, now: u64) -> Result<(), Code> {
    let at = iso(now);
    let mut items = self.items()?;
    items.0.insert(PAIR_ID.into(), verifier);
    items.0.insert(HAD_ID.into(), json!({ "at": at }));
    self.write_items(&items.0)?;
    drop(items);
    let (dek, key_id) = (self.dek.as_ref().ok_or(Code::Locked)?, self.key_id.clone().unwrap_or_default());
    let w = crypto::seal(kek.as_slice(), dek.as_slice(), &aad_password(&key_id));
    let check = b64(&crypto::check_of(kek.as_slice()));
    let file = json!({ "v": 2, "keyId": key_id, "kdf": kdf, "check": check, "wrapped": w, "created": created.unwrap_or_else(|| at.clone()), "changed": at });
    write_json(&self.file(MASTER), &file).map_err(|_| Code::Damaged)?;
    self.seal_for_machine();
    self.changed = true;
    Ok(())
  }
  /// The cost of a new maestra.json, with a new salt.
  pub fn new_kdf(&self) -> Value {
    let (n, r, p) = self.costs.kdf();
    json!({ "alg": "scrypt", "N": n, "r": r, "p": p, "salt": b64(crypto::random(16).as_slice()) })
  }
  pub fn new_pair_kdf(&self) -> Value {
    let (n, r, p) = self.costs.pair();
    json!({ "N": n, "r": r, "p": p, "salt": b64url(crypto::random(16).as_slice()) })
  }
  /// The first password: whether it may be made now (and the data key opened for it).
  pub fn may_create(&mut self) -> Result<(), Code> {
    if self.has_password() {
      return Err(Code::Exists);
    }
    if self.dek.is_none() && !self.open_with_machine()? {
      return Err(Code::Locked);
    }
    if self.had_password() {
      return Err(Code::Lost);
    }
    Ok(())
  }
  /// «He olvidado la contraseña» (the caller checked the recovery code): a new data key, the kept secrets sealed with it.
  pub fn rotate(&mut self, keep: &[String]) -> Result<(), Code> {
    if self.dek.is_none() {
      return Err(Code::Locked);
    }
    let mut items = self.items()?;
    let kept: Map<String, Value> = keep.iter().filter_map(|id| items.0.remove(id).map(|v| (id.clone(), v))).collect();
    let kept = Items(kept);
    self.use_key(crypto::random(32));
    self.write_items(&kept.0)
  }
  /// «Borrar secretos y empezar de cero»: the sealed files go, a new data key and an empty vault.
  pub fn wipe_all(&mut self) -> Result<(), Code> {
    for f in KEPT {
      let _ = std::fs::remove_file(self.file(f));
    }
    self.had_machine = false;
    self.use_key(crypto::random(32));
    self.write_items(&Map::new())
  }
  pub fn clear_tries(&mut self) {
    let _ = std::fs::remove_file(self.file(TRIES));
    self.fails.clear();
    self.fails_until.clear();
  }

  // ---- the window's unlock tokens (memory only)
  pub fn issue(&mut self, purpose: Option<String>, now: u64) -> Value {
    self.tokens.retain(|_, t| t.0 > now);
    let token: String = crypto::random(24).as_slice().iter().map(|b| format!("{b:02x}")).collect();
    let until = now + if purpose.is_some() { FRESH_MS } else { UNLOCK_MS };
    self.tokens.insert(token.clone(), (until, purpose));
    json!({ "unlock": token, "until": until })
  }
  pub fn check_token(&mut self, token: &str, purpose: Option<&str>, consume: bool, now: u64) -> bool {
    let ok = self.tokens.get(token).is_some_and(|t| t.0 > now && t.1.as_deref() == purpose);
    if ok && consume {
      self.tokens.remove(token);
    }
    ok
  }
  pub fn lock(&mut self) {
    self.tokens.clear();
  }

  /// This PC's private key for the phones (the vault's remote_keys), for the linking's key confirmation.
  pub fn pc_private(&mut self) -> Option<Locked> {
    let mut items = self.items().ok()?;
    let mut k = items.0.remove("remote_keys")?;
    let out = k.get("priv").and_then(Value::as_str).and_then(crypto::unb64).map(|mut b| {
      let l = Locked::from_slice(&b);
      zeroize::Zeroize::zeroize(&mut b);
      l
    });
    wipe_value(&mut k);
    out
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn dates_like_javascript() {
    assert_eq!(iso(Date::parse("2026-11-07T10:00:00.000Z")), "2026-11-07T10:00:00.000Z");
    assert_eq!(iso(0), "1970-01-01T00:00:00.000Z");
    assert_eq!(iso(951_782_400_123), "2000-02-29T00:00:00.123Z");
    assert_eq!(parse_iso("2000-02-29T00:00:00.123Z"), Some(951_782_400_123));
    assert_eq!(parse_iso("2026-11-07T10:00:00Z"), Some(1_794_045_600_000));
    assert_eq!(parse_iso("nada"), None);
  }
  struct Date;
  impl Date {
    fn parse(s: &str) -> u64 {
      parse_iso(s).unwrap()
    }
  }
  #[test]
  fn waits_grow() {
    assert_eq!([5, 6, 7, 10, 99].map(wait_seconds), [30, 60, 120, 900, 900]);
  }
}

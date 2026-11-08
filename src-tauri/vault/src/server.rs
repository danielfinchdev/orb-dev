// The engine's requests to the vault, one JSON object per line on a channel only the engine holds (transport.rs), one
// answer per line: { ok: true, r, changed?, notices? } or { ok: false, code }. Synchronous on the engine's side (the
// engine keeps its own API as it was: src/core/master.mjs); what takes time (scrypt) runs as a job the engine polls, so
// its event loop never waits for a password check and the quick requests are answered meanwhile.
// Every buffer that carried a password or a secret (the request line, the parsed request, the answer) is wiped after use.
use crate::crypto::{self, b64url, unb64};
use crate::grants::Grants;
use crate::machine::{self, Sealer};
use crate::locked::{wipe_value, Locked};
use crate::vault::{self, check_password, Code, Costs, Tried, Vault, PAIR_ID};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// What every connection shares: the costs, whose clock counts, and the connectors' grants (their own pipe).
pub struct Server {
  pub costs: Costs,
  /// The tests' copy only (orb-vault --test): the engine's clock (a test moves it forward); Orb.exe uses its own.
  pub caller_clock: bool,
  pub grants: Arc<Grants>,
  /// How this PC's secret is sealed (machine.rs): DPAPI in Orb.exe, the fake in the tests' copy.
  pub sealer: Arc<dyn Sealer>,
}

struct Handle {
  vault: Mutex<Vault>,
  /// One slow change at a time (two windows' clicks, a phone linking while the password changes).
  serial: Mutex<()>,
}

type Answer = Result<Value, Code>;
enum Job {
  Running,
  Done(Answer, Arc<Handle>),
}

struct Session<'a> {
  server: &'a Server,
  vaults: HashMap<u64, Arc<Handle>>,
  next: u64,
  jobs: Arc<Mutex<HashMap<u64, Job>>>,
  /// This PC's secret once opened ('machine'): this PC's wrap of the data key ('open' with machine: true). Never sent.
  machine: Option<Locked>,
}

static JOB_IDS: AtomicU64 = AtomicU64::new(0);
const MAX_LINE: usize = 1 << 20;

fn now_ms() -> u64 {
  std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Serves one engine until it closes its end. → Ok when it closed, Err on a broken channel.
pub fn serve(server: &Server, input: &mut impl BufRead, output: &mut impl Write) -> std::io::Result<()> {
  let mut session = Session { server, vaults: HashMap::new(), next: 0, jobs: Arc::new(Mutex::new(HashMap::new())), machine: None };
  let mut line = Vec::with_capacity(4096);
  loop {
    line.clear();
    let n = input.by_ref().take(MAX_LINE as u64 + 1).read_until(b'\n', &mut line)?;
    if n == 0 {
      return Ok(());
    }
    let mut out = if line.len() > MAX_LINE {
      json!({ "ok": false, "code": "big" })
    } else {
      match serde_json::from_slice::<Value>(&line) {
        Ok(mut req) => {
          let a = session.handle(&req);
          wipe_value(&mut req);
          a
        }
        Err(_) => json!({ "ok": false, "code": "json" }),
      }
    };
    zeroize::Zeroize::zeroize(&mut line);
    let mut bytes = serde_json::to_vec(&out).unwrap_or_else(|_| b"{\"ok\":false,\"code\":\"json\"}".to_vec());
    wipe_value(&mut out);
    bytes.push(b'\n');
    let sent = output.write_all(&bytes).and_then(|_| output.flush());
    zeroize::Zeroize::zeroize(&mut bytes);
    sent?;
  }
}

fn s<'a>(req: &'a Value, k: &str) -> &'a str {
  req.get(k).and_then(Value::as_str).unwrap_or_default()
}

impl Session<'_> {
  fn now(&self, req: &Value) -> u64 {
    match req.get("now").and_then(Value::as_u64) {
      Some(t) if self.server.caller_clock => t,
      _ => now_ms(),
    }
  }

  fn handle(&mut self, req: &Value) -> Value {
    let op = s(req, "op");
    let answer: Answer = match op {
      "hello" => Ok(json!({ "grants": self.server.grants.name(), "test": self.server.costs.test })),
      "kdfOk" => Ok(json!(vault::kdf_ok(req.get("kdf").unwrap_or(&Value::Null), self.server.costs))),
      "machine" => return self.machine(req),
      "open" => {
        let given = req.get("secret").and_then(Value::as_str).and_then(unb64).map(|mut b| {
          let l = Locked::from_slice(&b);
          zeroize::Zeroize::zeroize(&mut b);
          l
        });
        let secret = if req.get("machine") == Some(&json!(true)) { self.machine.clone() } else { given };
        let dir = PathBuf::from(s(req, "dir"));
        if !dir.is_absolute() {
          Err(Code::Damaged)
        } else {
          self.next += 1;
          self.vaults.insert(self.next, Arc::new(Handle { vault: Mutex::new(Vault::new(dir, secret, self.server.costs)), serial: Mutex::new(()) }));
          Ok(json!(self.next))
        }
      }
      "job" => return self.poll(req.get("id").and_then(Value::as_u64).unwrap_or(0)),
      _ => {
        let Some(h) = req.get("h").and_then(Value::as_u64).and_then(|h| self.vaults.get(&h)).cloned() else {
          return json!({ "ok": false, "code": "handle" });
        };
        if op == "close" {
          self.vaults.remove(&req["h"].as_u64().unwrap_or(0));
          Ok(json!(true))
        } else if matches!(op, "create" | "verify" | "change" | "forgot" | "reset") {
          return self.start_job(op, req, h);
        } else {
          let now = self.now(req);
          let a = quick(op, req, &mut h.vault.lock().unwrap(), now, self.server);
          return finish(a, &h);
        }
      }
    };
    match answer {
      Ok(r) => json!({ "ok": true, "r": r }),
      Err(c) => json!({ "ok": false, "code": c.as_str() }),
    }
  }

  /// This PC's secret (machine.rs › load): kept for 'open', and only the keys made from it go back to the engine
  /// (approvals, backups). The tests' copy takes a test's sealing knobs (fake) and, asked to, says the secret (reveal).
  fn machine(&mut self, req: &Value) -> Value {
    let test = self.server.costs.test;
    if !test && (req.get("fake").is_some() || req.get("reveal").is_some()) {
      return json!({ "ok": false, "code": "damaged" });
    }
    let (dir, copy) = (PathBuf::from(s(req, "dir")), PathBuf::from(s(req, "copy")));
    if !dir.is_absolute() || !copy.is_absolute() {
      return json!({ "ok": false, "code": "damaged" });
    }
    let fake;
    let sealer: &dyn Sealer = if test && req.get("fake").is_some() {
      fake = machine::Fake::from_json(req.get("fake"));
      &fake
    } else {
      self.server.sealer.as_ref()
    };
    match machine::load(&dir, &copy, sealer, req.get("allowNew") == Some(&json!(true))) {
      Ok(o) => {
        let warns: Vec<Value> = o.warns.iter().map(|(c, d)| json!({ "code": c, "detail": d })).collect();
        let mut r = json!({ "approval": crypto::b64(crypto::approval_key(o.secret.as_slice()).as_slice()), "backup": crypto::b64(crypto::backup_key(o.secret.as_slice()).as_slice()), "warns": warns });
        if test && req.get("reveal") == Some(&json!(true)) {
          r["hex"] = json!(crypto::hex_of(o.secret.as_slice()).as_str().unwrap_or_default());
        }
        self.machine = Some(o.secret);
        json!({ "ok": true, "r": r })
      }
      Err(f) => json!({ "ok": false, "code": f.code(), "detail": f.detail() }),
    }
  }

  fn start_job(&mut self, op: &str, req: &Value, h: Arc<Handle>) -> Value {
    let id = JOB_IDS.fetch_add(1, Ordering::SeqCst) + 1;
    let now = self.now(req);
    let mut req = req.clone();
    let jobs = self.jobs.clone();
    jobs.lock().unwrap().insert(id, Job::Running);
    let caller_clock = self.server.caller_clock;
    let op = op.to_string();
    std::thread::spawn(move || {
      let clock = move || if caller_clock { now } else { now_ms() };
      let a = slow(&op, &req, &h, clock);
      wipe_value(&mut req);
      jobs.lock().unwrap().insert(id, Job::Done(a, h));
    });
    json!({ "ok": true, "job": id })
  }
  fn poll(&mut self, id: u64) -> Value {
    let mut jobs = self.jobs.lock().unwrap();
    match jobs.get(&id) {
      None => json!({ "ok": false, "code": "job" }),
      Some(Job::Running) => json!({ "ok": true, "running": true }),
      Some(Job::Done(..)) => {
        let Some(Job::Done(a, h)) = jobs.remove(&id) else { unreachable!() };
        drop(jobs);
        finish(a, &h)
      }
    }
  }
}

/// The answer with what the engine must do after it: copy the folder outside core (changed), tell the owner (notices).
fn finish(a: Answer, h: &Handle) -> Value {
  let mut v = h.vault.lock().unwrap();
  let mut out = match a {
    Ok(r) => json!({ "ok": true, "r": r }),
    Err(c) => json!({ "ok": false, "code": c.as_str() }),
  };
  if std::mem::take(&mut v.changed) {
    out["changed"] = json!(true);
  }
  let notices = std::mem::take(&mut v.notices);
  if !notices.is_empty() {
    out["notices"] = json!(notices);
  }
  out
}

fn quick(op: &str, req: &Value, v: &mut Vault, now: u64, server: &Server) -> Answer {
  match op {
    "has" => Ok(json!(v.has_password())),
    "unlocked" => Ok(json!(v.unlocked())),
    "keyId" => Ok(json!(v.key_id())),
    "had" => Ok(json!(v.had_password())),
    "state" => Ok(v.state()),
    "openMachine" => Ok(json!(v.open_with_machine()?)),
    "sealMachine" => Ok(json!(v.seal_for_machine())),
    "get" => v.get(s(req, "id")),
    "set" => v.set(s(req, "id"), req.get("value").cloned().unwrap_or(Value::Null)).map(|_| json!(true)),
    "ids" => Ok(json!(v.ids(s(req, "prefix"))?)),
    "wait" => Ok(json!(v.wait_of(s(req, "channel"), now))),
    "tryBegin" => Ok(v.begin_try(s(req, "channel"), now).map(|t| t.to_json()).unwrap_or(Value::Null)),
    "tryEnd" => Ok(v.end_try(s(req, "channel"), req.get("ok") == Some(&json!(true)), now).to_json()),
    "issue" => v.issue(req.get("purpose").and_then(Value::as_str).map(String::from), now),
    "check" => Ok(json!(v.check_token(s(req, "token"), req.get("purpose").and_then(Value::as_str), req.get("consume") == Some(&json!(true)), now))),
    "lock" => {
      v.lock();
      Ok(json!(true))
    }
    "pairInfo" => {
      let ver = v.get(PAIR_ID).unwrap_or(Value::Null);
      let ok = ver.get("pub").and_then(Value::as_str).and_then(unb64).is_some_and(|p| p.len() == 32) && vault::pair_kdf_ok(ver.get("kdf").unwrap_or(&Value::Null), server.costs);
      Ok(if ok { ver["kdf"].clone() } else { Value::Null })
    }
    "pairFinish" => pair_finish(req, v, now),
    "grant" => grant(req, v, now, server),
    _ => Err(Code::Damaged),
  }
}

/// A phone's key confirmation (src/engine/remote.mjs › finishPair): K from the code, ECDH(phone, PC) and ECDH(verifier,
/// PC), with the waits of the 'pair' channel. The verifier and K never leave the vault. → the attempt's answer, with the
/// PC's own MAC when right.
fn pair_finish(req: &Value, v: &mut Vault, now: u64) -> Answer {
  let ver = v.get(PAIR_ID)?;
  let verifier = ver.get("pub").and_then(Value::as_str).and_then(unb64).filter(|p| p.len() == 32);
  let pc = v.pc_private();
  let (Some(verifier), Some(pc)) = (verifier, pc) else { return Ok(json!({ "ok": false, "reason": "noVerifier" })) };
  let kdf = req.get("kdf").cloned().unwrap_or(Value::Null);
  let (dev, pc_pub, mac) = (unb64(s(req, "devPub")), unb64(s(req, "pcPub")), unb64(s(req, "mac")));
  let (Some(dev), Some(pc_pub)) = (dev, pc_pub) else { return Ok(json!({ "ok": false, "reason": "bad" })) };
  let x = crypto::Pake {
    via: s(req, "via"),
    dev_pub: &dev,
    pc_pub: &pc_pub,
    sid: s(req, "sid"),
    n: kdf.get("N").and_then(Value::as_u64).unwrap_or(0),
    r: kdf.get("r").and_then(Value::as_u64).unwrap_or(0),
    p: kdf.get("p").and_then(Value::as_u64).unwrap_or(0),
    salt: kdf.get("salt").and_then(Value::as_str).unwrap_or_default(),
    secret: s(req, "secret"),
  };
  let Some(k) = crypto::pake_key(&x, pc.as_slice(), &verifier) else { return Ok(json!({ "ok": false, "reason": "bad" })) };
  if let Some(refusal) = v.begin_try("pair", now) {
    return Ok(refusal.to_json());
  }
  let ok = mac.is_some_and(|m| crypto::same(&m, &crypto::pake_mac(k.as_slice(), "orb-pake:movil")));
  let tried = v.end_try("pair", ok, now);
  let mut out = tried.to_json();
  if tried == Tried::Ok {
    out["pcMac"] = json!(b64url(&crypto::pake_mac(k.as_slice(), &format!("orb-pake:pc:{}", s(req, "id")))));
  }
  Ok(out)
}

/// A connector's keys for its launcher only (src/mcp/launch.mjs): a one-time grant on the grants' pipe. Only while they
/// are still tied to the program the connector starts (its binding, src/core/connector-secrets.mjs).
fn grant(req: &Value, v: &mut Vault, now: u64, server: &Server) -> Answer {
  let bind = s(req, "bind");
  let vars = req.get("vars").and_then(Value::as_object);
  if !bind.starts_with("mcpbind/") || vars.is_none_or(|m| m.values().any(|id| !id.as_str().is_some_and(|i| i.starts_with("mcp/")))) {
    return Err(Code::Damaged);
  }
  let mut items = v.items()?;
  if items.0.get(bind).and_then(Value::as_str) != Some(s(req, "binding")) || s(req, "binding").is_empty() {
    return Ok(Value::Null);
  }
  let mut env = serde_json::Map::new();
  for (name, id) in vars.unwrap() {
    if let Some(Value::String(val)) = items.0.remove(id.as_str().unwrap_or_default()) {
      env.insert(name.clone(), Value::String(val));
    }
  }
  drop(items);
  if env.is_empty() {
    return Ok(Value::Null);
  }
  let mut env = Value::Object(env);
  let token = server.grants.add(&env, now_ms().max(now));
  wipe_value(&mut env);
  Ok(json!({ "grant": token, "pipe": server.grants.name() }))
}

fn password(req: &Value, k: &str) -> Locked {
  Locked::from_slice(s(req, k).as_bytes())
}

/// What may be checked as a password at all (src/core/master.mjs › keyFor).
fn plausible(p: &Locked) -> bool {
  !p.is_empty() && p.as_str().is_some_and(|t| t.chars().count() <= vault::MAX_LENGTH * 4)
}

fn kek_for(m: &Option<Value>, p: &Locked, costs: Costs) -> Option<Locked> {
  let m = m.as_ref()?;
  m.get("wrapped")?.as_str()?;
  m.get("keyId")?.as_str()?;
  let kdf = m.get("kdf")?;
  if !vault::kdf_ok(kdf, costs) || !plausible(p) {
    return None;
  }
  let salt = unb64(kdf["salt"].as_str()?)?;
  crypto::scrypt(p.as_slice(), &salt, kdf["N"].as_u64()?, 8, 1)
}

fn verifier_of(p: &Locked, kdf: Value) -> Option<Value> {
  let salt = unb64(kdf["salt"].as_str()?)?;
  let seed = crypto::scrypt(p.as_slice(), &salt, kdf["N"].as_u64()?, kdf["r"].as_u64()? as u32, kdf["p"].as_u64()? as u32)?;
  Some(json!({ "kdf": kdf, "pub": b64url(&crypto::verifier_pub(seed.as_slice())) }))
}

/// The password's wrap and the phones' verifier from a new password (two scrypts, the vault not held meanwhile).
fn wrap(h: &Handle, p: &Locked, created: Option<String>, now: u64) -> Answer {
  let (kdf, pair) = {
    let v = h.vault.lock().unwrap();
    (v.new_kdf(), v.new_pair_kdf())
  };
  let salt = unb64(kdf["salt"].as_str().unwrap_or_default()).unwrap_or_default();
  let kek = crypto::scrypt(p.as_slice(), &salt, kdf["N"].as_u64().unwrap_or(0), 8, 1).ok_or(Code::Damaged)?;
  let verifier = verifier_of(p, pair).ok_or(Code::Damaged)?;
  h.vault.lock().unwrap().wrap_with(&kek, kdf, verifier, created, now)?;
  Ok(json!({ "ok": true }))
}

/// One check of a password on a channel, with its waits (src/core/master.mjs › verify).
fn verify(h: &Handle, p: &Locked, channel: &str, now: u64) -> Answer {
  let (m, costs) = {
    let v = h.vault.lock().unwrap();
    if !v.has_password() {
      return Ok(Tried::None.to_json());
    }
    if let Some(refusal) = v.begin_try(channel, now) {
      return Ok(refusal.to_json());
    }
    (v.master_file(), v.costs())
  };
  let kek = kek_for(&m, p, costs);
  let mut v = h.vault.lock().unwrap();
  let key = match (&m, &kek) {
    (Some(m), Some(kek)) => v.key_for_kek(m, kek.as_slice()),
    _ => None,
  };
  let ok = key.is_some();
  let tried = v.end_try(channel, ok, now);
  if tried != Tried::Ok {
    return Ok(tried.to_json());
  }
  let pair = v.new_pair_kdf();
  v.after_verify(key, || verifier_of(p, pair));
  v.may_issue = true;
  Ok(tried.to_json())
}

fn checked(p: &Locked) -> Result<(), Code> {
  check_password(p.as_str().ok_or(Code::Short)?)
}

fn slow(op: &str, req: &Value, h: &Handle, now: impl Fn() -> u64) -> Answer {
  let _one = h.serial.lock().unwrap();
  match op {
    "create" => {
      let p = password(req, "password");
      checked(&p)?;
      h.vault.lock().unwrap().may_create()?;
      wrap(h, &p, None, now())?;
      h.vault.lock().unwrap().may_issue = true;
      Ok(json!(true))
    }
    "verify" => {
      let channel = match s(req, "channel") {
        c @ ("pc" | "pair" | "recovery") => c,
        _ => "pc",
      };
      verify(h, &password(req, "password"), channel, now())
    }
    "change" => {
      let next = password(req, "next");
      checked(&next)?;
      let r = verify(h, &password(req, "current"), "pc", now())?;
      if r.get("ok") != Some(&json!(true)) {
        return Ok(r);
      }
      let created = h.vault.lock().unwrap().master_file().and_then(|m| m.get("created").and_then(Value::as_str).map(String::from));
      wrap(h, &next, created, now())?;
      let mut v = h.vault.lock().unwrap();
      v.lock();
      v.may_issue = true;
      Ok(json!({ "ok": true }))
    }
    "forgot" | "reset" => {
      let next = password(req, "next");
      checked(&next)?;
      {
        let mut v = h.vault.lock().unwrap();
        if op == "forgot" {
          let keep: Vec<String> = req.get("keep").and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
          v.rotate(&keep)?;
        } else {
          v.wipe_all()?;
        }
      }
      wrap(h, &next, None, now())?;
      let mut v = h.vault.lock().unwrap();
      v.clear_tries();
      v.lock();
      v.may_issue = true;
      Ok(json!({ "ok": true }))
    }
    _ => Err(Code::Damaged),
  }
}

// A phone linked without the master password: a one-use code the PC shows after Windows Hello (or the password).
// The code lives only here, in memory: 8 characters to type (about 40 bits) and a 128-bit secret that goes in the QR, each
// code with its own random salt. It dies at 5 minutes, at the third wrong answer, at its first use, when it is cancelled and
// when Orb locks. Nothing about it is written to disk or to a log.
// The key confirmation is the linking's PAKE (crypto.rs > pake_key) without the password's part: K comes from the code and
// ECDH(phone, PC). A phone that scanned the QR uses the 128-bit secret; a typed code is stretched with scrypt and the code's
// salt first. A right MAC does not finish the link: the PC's own MAC is kept back until the owner says yes at the PC to the
// phone's name (confirm), and without that yes there is no link.
use crate::crypto::{self, b64url, unb64};
use crate::locked::Locked;
use crate::server::s;
use crate::vault::{Code, Strength, Vault};
use serde_json::{json, Value};

/// The purpose of the one-use token (Hello's or the password's) that makes a code.
pub const PURPOSE: &str = "linkCode";
pub const LIFE_MS: u64 = 5 * 60_000;
/// How long the PC waits for the owner's yes once the phone proved it has the code (the phone gives up at 2 minutes).
pub const CONFIRM_MS: u64 = 100_000;
pub const MAX_FAILS: u32 = 3;
/// The letters of the pairing code on screen (no 0/O, no 1/I/L).
const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTVWXYZ23456789";
const TYPED_N: u64 = 1 << 14;

struct Waiting {
  until: u64,
  id: String,
  dev_pub: Vec<u8>,
  pc_mac: [u8; 32],
}

struct Live {
  /// What the QR carries (base64url of 16 random bytes) and what a typed code is stretched into.
  qr: Locked,
  typed: Locked,
  salt: Vec<u8>,
  until: u64,
  fails: u32,
  waiting: Option<Waiting>,
}

/// In memory only. One code at a time: making another replaces it.
#[derive(Default)]
pub struct State {
  cur: Option<Live>,
}

impl State {
  fn live(&mut self, now: u64) -> Option<&mut Live> {
    if self.cur.as_ref().is_some_and(|l| l.until <= now) {
      self.cur = None;
    }
    self.cur.as_mut()
  }
}

fn pick(n: usize) -> Locked {
  let mut out = Locked::with_capacity(n);
  // Rejection sampling: every letter equally likely.
  let limit = ALPHABET.len() * (256 / ALPHABET.len());
  while out.len() < n {
    let b = crypto::random(16);
    for &x in b.as_slice() {
      if (x as usize) < limit && out.len() < n {
        out.extend(&[ALPHABET[x as usize % ALPHABET.len()]]);
      }
    }
  }
  out
}

/// The code as the phone's keyboard gives it: upper case, no separators.
pub fn normalize(text: &str) -> String {
  text.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_uppercase()).collect()
}

/// What a typed code becomes on both sides (src/shared/mobile-crypto.mjs > linkSecret).
pub fn typed_secret(code: &str, salt: &[u8]) -> Option<Locked> {
  let k = crypto::scrypt(normalize(code).as_bytes(), salt, TYPED_N, 8, 1)?;
  let mut text = Locked::with_capacity(7 + 44);
  text.extend(b"corto4:");
  text.extend(b64url(k.as_slice()).as_bytes());
  Some(text)
}

/// A new code, for a token of Hello's or the password's strength made for it (used up here). -> its parts, once.
pub fn make(v: &mut Vault, token: &str, now: u64) -> Result<Value, Code> {
  if !v.check_strength(token, Some(PURPOSE), Some(Strength::Hello), true, now) {
    return Err(Code::Locked);
  }
  if v.pc_private().is_none() {
    return Ok(json!({ "ok": false, "reason": "noKeys" }));
  }
  let code = pick(8);
  let secret = crypto::random(16);
  let salt = crypto::random(16);
  let Some(typed) = typed_secret(code.as_str().unwrap_or_default(), salt.as_slice()) else { return Err(Code::Damaged) };
  let qr = Locked::from_slice(b64url(secret.as_slice()).as_bytes());
  let until = now + LIFE_MS;
  let out = json!({ "ok": true, "code": code.as_str().unwrap_or_default(), "secret": qr.as_str().unwrap_or_default(), "salt": b64url(salt.as_slice()), "until": until });
  v.link.cur = Some(Live { qr, typed, salt: salt.as_slice().to_vec(), until, fails: 0, waiting: None });
  Ok(out)
}

/// What a phone that only has the typed code needs to stretch it: the salt (not a secret) and when the code ends.
pub fn info(v: &mut Vault, now: u64) -> Value {
  match v.link.live(now) {
    Some(l) => json!({ "ok": true, "salt": b64url(&l.salt), "until": l.until }),
    None => json!({ "ok": false, "reason": "gone" }),
  }
}

fn secret_of(l: &Live, via: &str) -> Option<Locked> {
  match via {
    "link" => Some(Locked::from_slice(l.qr.as_slice())),
    "linkcode" => Some(Locked::from_slice(l.typed.as_slice())),
    _ => None,
  }
}

/// The key that opens a phone's first message, for the way it says it read the code (QR or typed). Counts nothing: the engine
/// reports a proof that does not open (fail).
pub fn probe(v: &mut Vault, via: &str, dev_pub: &[u8], now: u64) -> Result<Value, Code> {
  let Some(secret) = v.link.live(now).and_then(|l| secret_of(l, via)) else { return Ok(json!({ "ok": false, "reason": "gone" })) };
  let Some(pc) = v.pc_private() else { return Ok(json!({ "ok": false, "reason": "gone" })) };
  let Some(key) = crypto::pairing_key(pc.as_slice(), dev_pub, secret.as_str().unwrap_or_default()) else { return Ok(json!({ "ok": false, "reason": "bad" })) };
  Ok(json!({ "ok": true, "key": b64url(key.as_slice()) }))
}

fn wrong(v: &mut Vault) -> Value {
  let Some(l) = v.link.cur.as_mut() else { return json!({ "ok": false, "reason": "gone" }) };
  l.fails += 1;
  if l.fails >= MAX_FAILS {
    v.link.cur = None;
    return json!({ "ok": false, "reason": "dead", "left": 0 });
  }
  json!({ "ok": false, "reason": "wrong", "left": MAX_FAILS - l.fails })
}

/// A wrong try the engine saw (a proof that did not open): the third kills the code.
pub fn fail(v: &mut Vault, now: u64) -> Value {
  if v.link.live(now).is_none() {
    return json!({ "ok": false, "reason": "gone" });
  }
  wrong(v)
}

/// The phone's key confirmation. Right: the code now waits for the owner's yes (the PC's MAC stays here until then).
/// Wrong: one more fail. -> { ok, waiting } | { ok: false, reason: gone | busy | wrong | dead | bad, left }.
pub fn finish(v: &mut Vault, req: &Value, now: u64) -> Result<Value, Code> {
  let Some(l) = v.link.live(now) else { return Ok(json!({ "ok": false, "reason": "gone" })) };
  if l.waiting.as_ref().is_some_and(|w| w.until > now) {
    return Ok(json!({ "ok": false, "reason": "busy" }));
  }
  let Some(secret) = secret_of(l, s(req, "via")) else { return Ok(json!({ "ok": false, "reason": "bad" })) };
  let (dev, pc_pub, mac) = (unb64(s(req, "devPub")), unb64(s(req, "pcPub")), unb64(s(req, "mac")));
  let (Some(dev), Some(pc_pub)) = (dev, pc_pub) else { return Ok(json!({ "ok": false, "reason": "bad" })) };
  let id = s(req, "id").to_string();
  let Some(pc) = v.pc_private() else { return Ok(json!({ "ok": false, "reason": "gone" })) };
  // No password in this exchange: its KDF fields are fixed and empty.
  let x = crypto::Pake { via: s(req, "via"), dev_pub: &dev, pc_pub: &pc_pub, sid: s(req, "sid"), n: 0, r: 0, p: 0, salt: "", secret: secret.as_str().unwrap_or_default() };
  let Some(k) = crypto::pake_key(&x, pc.as_slice(), None) else { return Ok(json!({ "ok": false, "reason": "bad" })) };
  if !mac.is_some_and(|m| crypto::same(&m, &crypto::pake_mac(k.as_slice(), "orb-pake:movil"))) {
    return Ok(wrong(v));
  }
  let pc_mac = crypto::pake_mac(k.as_slice(), &format!("orb-pake:pc:{id}"));
  if let Some(l) = v.link.cur.as_mut() {
    l.waiting = Some(Waiting { until: now + CONFIRM_MS, id, dev_pub: dev, pc_mac });
  }
  Ok(json!({ "ok": true, "waiting": true, "until": now + CONFIRM_MS }))
}

/// The owner's answer at the PC. Yes: the code is used up and the PC's MAC for that very exchange comes out. No (or too late):
/// the code dies. An id that is not the one waiting changes nothing.
pub fn confirm(v: &mut Vault, id: &str, dev_pub: &[u8], accept: bool, now: u64) -> Value {
  let Some(l) = v.link.live(now) else { return json!({ "ok": false, "reason": "gone" }) };
  let right = l.waiting.as_ref().is_some_and(|w| w.id == id && w.dev_pub == dev_pub);
  if !right {
    return json!({ "ok": false, "reason": "none" });
  }
  let w = l.waiting.take().expect("checked");
  v.link.cur = None;
  if !accept {
    return json!({ "ok": false, "reason": "declined" });
  }
  if w.until <= now {
    return json!({ "ok": false, "reason": "expired" });
  }
  json!({ "ok": true, "pcMac": b64url(&w.pc_mac) })
}

pub fn cancel(v: &mut Vault) {
  v.link = State::default();
}

#[cfg(test)]
#[path = "link_tests.rs"]
mod tests;

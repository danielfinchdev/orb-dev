// Windows Hello as a proof of presence checked inside the vault. Hello wraps nothing: when it is turned on, the public half of a
// Hello key (RSA-2048, made by Windows, signing only after the user's gesture) is kept in secretos.json as `master/hello`,
// authenticated by the data key. Every unlock is then: Rust draws a new 32-byte nonce, Hello signs
// "orb-hello-v1" ‖ orbId ‖ purpose ‖ nonce, and Rust verifies it against the stored key before it issues a token of
// HELLO strength (vault.rs › Strength). One nonce is pending at a time, it dies after NONCE_MS and it is spent when the answer
// comes, right or wrong, so a signature somebody else asked Hello for (the key belongs to the Windows user, not to Orb)
// is worth nothing here.
// The OS side is the `Hello` trait (the real one is Windows' KeyCredentialManager; the tests' copy is fake_hello.rs).
use crate::crypto::{self, b64, unb64};
use crate::vault::{Code, Strength, Vault};
use rsa::pkcs1::DecodeRsaPublicKey;
use rsa::pkcs1v15::{Signature, VerifyingKey};
use rsa::sha2::Sha256;
use rsa::signature::Verifier;
use rsa::traits::PublicKeyParts;
use rsa::RsaPublicKey;
use serde_json::{json, Value};
use std::sync::Mutex;

pub const HELLO_ID: &str = "master/hello";
/// The only key Orb takes: RSA-2048, PKCS#1 v1.5, SHA-256.
pub const ALG: &str = "rsa2048-pkcs1-sha256";
const TAG: &[u8] = b"orb-hello-v1";
pub const NONCE_MS: u64 = 2 * 60_000;
/// Prompts that ended in a cancel or a failure, in a row, before Orb stops asking for a while.
pub const FREE_PROMPTS: u64 = 3;
pub const PROMPT_WAIT_MS: u64 = 30_000;
/// The purpose of the Hello step of «Lo he olvidado todo»: its token is good for nothing else, and no other way makes it.
pub const REBUILD: &str = "rebuild-master";
/// The purpose of the one-use password token that turns Hello on.
pub const ENABLE: &str = "hello.enable";
/// Purposes of the secrets (SECRET_PURPOSES in src/domain/security/permissions.mjs): Hello never opens them.
pub const NO_HELLO_PURPOSES: [&str; 2] = ["secretSave", "secretSaved"];

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum HelloError {
  /// The user closed the prompt (or did not answer).
  Cancelled,
  /// The key is gone or was made again (Hello was reset): it has to be turned on again.
  Changed,
  Failed,
  /// No Hello on this PC (or this build).
  Unavailable,
}

pub struct HelloKey {
  /// RSAPublicKey, PKCS#1 DER.
  pub public: Vec<u8>,
  pub alg: String,
  /// Whether the key sits in a security chip.
  pub tpm: bool,
}

/// What Windows does for Orb: Windows Hello in Orb.exe, a fake in the tests' vault.
pub trait Hello: Send + Sync {
  fn available(&self) -> bool;
  /// A new key for this account (the old one goes). The OS asks the user for the gesture.
  fn create(&self, account: &str) -> Result<HelloKey, HelloError>;
  /// The signature (PKCS#1 v1.5, SHA-256) of the message, after the user's gesture.
  fn sign(&self, account: &str, message: &[u8]) -> Result<Vec<u8>, HelloError>;
  fn delete(&self, account: &str);
}

/// No Hello (what Orb.exe has until the Windows side exists, and the tests' vault without --fake-hello).
pub struct Absent;
impl Hello for Absent {
  fn available(&self) -> bool {
    false
  }
  fn create(&self, _: &str) -> Result<HelloKey, HelloError> {
    Err(HelloError::Unavailable)
  }
  fn sign(&self, _: &str, _: &[u8]) -> Result<Vec<u8>, HelloError> {
    Err(HelloError::Unavailable)
  }
  fn delete(&self, _: &str) {}
}

fn plain_name(s: &str, max: usize) -> bool {
  !s.is_empty() && s.len() <= max && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b':'))
}
pub fn valid_account(s: &str) -> bool {
  plain_name(s, 64)
}

/// What gets signed. The parts are told apart by a NUL (none of them may hold one), so no two requests share bytes.
/// The window's token signs "window"; the one-use tokens sign "fresh:<purpose>".
pub fn message(orb_id: &str, purpose: Option<&str>, nonce: &[u8]) -> Option<Vec<u8>> {
  if !plain_name(orb_id, 128) {
    return None;
  }
  let p = match purpose {
    None => "window".to_string(),
    Some(p) if plain_name(p, 64) => format!("fresh:{p}"),
    Some(_) => return None,
  };
  let mut m = Vec::with_capacity(TAG.len() + orb_id.len() + p.len() + nonce.len() + 3);
  m.extend_from_slice(TAG);
  m.push(0);
  m.extend_from_slice(orb_id.as_bytes());
  m.push(0);
  m.extend_from_slice(p.as_bytes());
  m.push(0);
  m.extend_from_slice(nonce);
  Some(m)
}

/// A Hello public key as Orb takes it: RSA, exactly 2048 bits.
pub fn parse_public(der: &[u8]) -> Option<RsaPublicKey> {
  let key = RsaPublicKey::from_pkcs1_der(der).ok()?;
  (key.n().bits() == 2048 && key.size() == 256).then_some(key)
}

/// Strict PKCS#1 v1.5 / SHA-256: the signature is exactly one modulus long and the padding is compared whole.
pub fn verify(public_der: &[u8], message: &[u8], signature: &[u8]) -> bool {
  let Some(key) = parse_public(public_der) else { return false };
  if signature.len() != 256 {
    return false;
  }
  let Ok(sig) = Signature::try_from(signature) else { return false };
  VerifyingKey::<Sha256>::new(key).verify(message, &sig).is_ok()
}

/// A nonce waiting for its signature.
struct Pending {
  until: u64,
  message: Vec<u8>,
  public: Vec<u8>,
  key_id: String,
  purpose: Option<String>,
}

/// In memory only: the pending nonce and the prompts that failed in a row.
#[derive(Default)]
pub struct State {
  pending: Option<Pending>,
  fails: u64,
  wait_until: u64,
  /// An enable is waiting for the OS key (one at a time).
  enabling: bool,
}
impl State {
  pub(crate) fn drop_pending(&mut self) {
    self.pending = None;
  }
}

/// What the signing step needs.
pub struct Begun {
  pub account: String,
  pub message: Vec<u8>,
}

fn refused(reason: &str) -> Value {
  json!({ "ok": false, "reason": reason })
}

fn entry(v: &mut Vault) -> Result<Option<Value>, Code> {
  let e = v.get(HELLO_ID)?;
  Ok(if e.is_object() { Some(e) } else { None })
}
fn text<'a>(e: &'a Value, k: &str) -> &'a str {
  e.get(k).and_then(Value::as_str).unwrap_or_default()
}

/// The account of the key kept here, if any (so the OS key can be deleted when the entry goes).
pub fn account(v: &mut Vault) -> Option<String> {
  entry(v).ok().flatten().map(|e| text(&e, "cuenta").to_string()).filter(|a| valid_account(a))
}

pub fn state(v: &mut Vault, hello: &dyn Hello, now: u64) -> Result<Value, Code> {
  let available = hello.available();
  let wait = if v.hello.wait_until > now { json!(crate::vault::iso(v.hello.wait_until)) } else { Value::Null };
  Ok(match entry(v)? {
    None => json!({ "available": available, "enabled": false }),
    Some(e) => {
      let valid = text(&e, "alg") == ALG && unb64(text(&e, "pub")).is_some_and(|d| parse_public(&d).is_some());
      json!({ "available": available, "enabled": true, "valid": valid, "tpm": e.get("tpm") == Some(&json!(true)), "at": e.get("at").cloned().unwrap_or(Value::Null), "waitUntil": wait })
    }
  })
}

fn error_reason(e: HelloError) -> &'static str {
  match e {
    HelloError::Cancelled => "cancelled",
    HelloError::Changed => "changed",
    HelloError::Failed => "failed",
    HelloError::Unavailable => "unavailable",
  }
}

/// Turns Hello on (the caller checked the password). The OS key is made without the vault held (the prompt waits for
/// the person) and must be what Orb takes, or it goes again.
pub fn enable(vault: &std::sync::Mutex<Vault>, hello: &dyn Hello, account_name: &str, now: impl Fn() -> u64) -> Result<Value, Code> {
  if !valid_account(account_name) {
    return Err(Code::Damaged);
  }
  let (old, key_id) = {
    let mut v = vault.lock().unwrap();
    if !v.unlocked() {
      return Err(Code::Locked);
    }
    if v.hello.enabling {
      return Ok(refused("busy"));
    }
    v.hello.enabling = true;
    (account(&mut v), v.key_id().map(String::from))
  };
  let done = |v: &Mutex<Vault>| {
    let mut v = v.lock().unwrap();
    if v.key_id().map(String::from) == key_id {
      v.hello.enabling = false;
    }
  };
  if !hello.available() {
    done(vault);
    return Ok(refused("unavailable"));
  }
  let key = match hello.create(account_name) {
    Ok(k) => k,
    Err(e) => {
      done(vault);
      return Ok(refused(error_reason(e)));
    }
  };
  if key.alg != ALG || parse_public(&key.public).is_none() {
    hello.delete(account_name);
    done(vault);
    return Ok(refused("alg"));
  }
  let at = crate::vault::iso(now());
  let stored = {
    let mut v = vault.lock().unwrap();
    // The data key changed while the prompt was open: the key made now belongs to a vault that is gone.
    if v.key_id().map(String::from) != key_id {
      hello.delete(account_name);
      return Ok(refused("changed"));
    }
    v.hello.enabling = false;
    let r = v.set(HELLO_ID, json!({ "cuenta": account_name, "pub": b64(&key.public), "alg": ALG, "tpm": key.tpm, "at": at }));
    if r.is_ok() {
      v.hello = State::default();
    }
    r
  };
  if let Err(c) = stored {
    hello.delete(account_name);
    return Err(c);
  }
  if let Some(old) = old.filter(|o| o != account_name) {
    hello.delete(&old);
  }
  Ok(json!({ "ok": true, "tpm": key.tpm, "at": at }))
}

/// Turns Hello off: the entry and the OS key go, and what was pending with them.
pub fn disable(v: &mut Vault, hello: &dyn Hello) -> Result<Value, Code> {
  let old = account(v);
  v.set(HELLO_ID, Value::Null)?;
  v.hello = State::default();
  if let Some(a) = old {
    hello.delete(&a);
  }
  Ok(json!({ "ok": true }))
}

/// Step 1 of an unlock: the nonce. Err(answer) when no prompt may be launched now.
pub fn begin(v: &mut Vault, orb_id: &str, purpose: Option<&str>, now: u64) -> Result<Result<Begun, Value>, Code> {
  if v.hello.wait_until > now {
    return Ok(Err(json!({ "ok": false, "reason": "wait", "until": crate::vault::iso(v.hello.wait_until) })));
  }
  let Some(e) = entry(v)? else { return Ok(Err(refused("none"))) };
  if v.hello.pending.as_ref().is_some_and(|p| p.until > now) {
    return Ok(Err(refused("busy")));
  }
  v.hello.pending = None;
  let account = text(&e, "cuenta");
  let public = unb64(text(&e, "pub")).filter(|d| parse_public(d).is_some());
  let (Some(public), true) = (public, text(&e, "alg") == ALG && valid_account(account)) else { return Ok(Err(refused("changed"))) };
  let nonce = crypto::random(32);
  let Some(message) = message(orb_id, purpose, nonce.as_slice()) else { return Err(Code::Damaged) };
  v.hello.pending = Some(Pending { until: now + NONCE_MS, message: message.clone(), public, key_id: v.key_id().unwrap_or_default().to_string(), purpose: purpose.map(String::from) });
  Ok(Ok(Begun { account: account.to_string(), message }))
}

/// Step 3: the answer. The nonce is spent whatever it says; only a signature of that very message by the stored key
/// makes a token. Cancelling or failing counts toward the prompt limit.
pub fn finish(v: &mut Vault, begun: &[u8], answer: Result<Vec<u8>, HelloError>, now: u64) -> Result<Value, Code> {
  // Only the nonce this very answer belongs to is spent; an answer for another one counts for nothing.
  if v.hello.pending.as_ref().is_none_or(|p| p.message != begun) {
    return Ok(refused("nonce"));
  }
  let pending = v.hello.pending.take();
  let fail = |v: &mut Vault, reason: &str| {
    v.hello.fails += 1;
    if v.hello.fails >= FREE_PROMPTS {
      v.hello.fails = 0;
      v.hello.wait_until = now + PROMPT_WAIT_MS;
    }
    refused(reason)
  };
  let Some(p) = pending else { return Ok(refused("nonce")) };
  if p.until <= now {
    return Ok(fail(v, "expired"));
  }
  if v.key_id() != Some(p.key_id.as_str()) {
    return Ok(refused("changed"));
  }
  let sig = match answer {
    Ok(s) => s,
    Err(HelloError::Unavailable) => return Ok(refused("unavailable")),
    Err(e) => return Ok(fail(v, error_reason(e))),
  };
  if !verify(&p.public, &p.message, &sig) {
    return Ok(fail(v, "changed"));
  }
  v.hello.fails = 0;
  v.hello.wait_until = 0;
  let mut out = v.issue_with(p.purpose, Strength::Hello, now);
  out["ok"] = json!(true);
  Ok(out)
}

#[cfg(test)]
#[path = "hello_tests.rs"]
mod tests;

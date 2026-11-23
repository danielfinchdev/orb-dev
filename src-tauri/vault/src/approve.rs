// A linked phone approves the sensitive actions of this PC with its fingerprint. The phone keeps an ECDSA P-256 key in its
// Keystore that signs only after a strong biometric; its public half is registered here (secretos.json, `master/approve/<deviceId>`,
// authenticated by the data key), and only from this PC, with the password or the code typed right then.
// An approval is a challenge Rust draws (a new 32-byte nonce, one use, two minutes) and the phone signs
//   len32(tag) tag ‖ len32(action) action ‖ len32(hash) SHA-256(summary of the parameters) ‖ len32(nonce) nonce ‖ len32(orbId) orbId ‖
//   len32(deviceId) deviceId ‖ len32(pcPub) this PC's public key ‖ len32(8) expiry (ms, big endian)
// (every field carries its length, so no two requests share bytes). A valid signature spends the challenge and makes a one-use token of
// MOBILE strength whose purpose names the action and the parameters, so it opens nothing else (vault.rs › Strength).
// The same challenge kinds register the key (the first signature proves the phone holds it behind its biometric) and approve
// «Lo he olvidado todo» (a state machine kept here: Hello step, phone step, then the new password and code in one request).
use crate::crypto::{self, b64, unb64};
use crate::server::{checked, password, s, wrap, Handle};
use crate::vault::{Code, Strength, Vault, APPROVE_PREFIX};
use p256::ecdsa::signature::Verifier;
use p256::ecdsa::{Signature, VerifyingKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub const TAG: &[u8] = b"orb-approve-v1";
pub const CHALLENGE_MS: u64 = 2 * 60_000;
/// The purpose of the one-use password token that registers a phone.
pub const REGISTER: &str = "approve.register";
/// What the registration signs (its parameters: the phone's name as the PC showed it).
pub const ENROLL_ACTION: &str = "approve.enroll";
/// What the last step of «Lo he olvidado todo» signs.
pub const REBUILD_ACTION: &str = "master.rebuild";
const MAX_PENDING: usize = 8;
const MAX_SUMMARY: usize = 16_000;

#[derive(Debug, Clone, PartialEq)]
enum Kind {
  Enroll(String),
  Approve,
  Rebuild,
}

struct Pending {
  until: u64,
  nonce: Vec<u8>,
  kind: Kind,
  device_id: String,
  message: Vec<u8>,
  purpose: String,
  key_id: String,
}

/// The rebuild's second step, once the phone said yes.
#[derive(Default)]
enum Rebuild {
  #[default]
  Idle,
  Approved { until: u64, key_id: String, device: String },
}

/// In memory only: the challenges waiting for their signature and the rebuild's step.
#[derive(Default)]
pub struct State {
  pending: Vec<Pending>,
  rebuild: Rebuild,
  /// The mobile tokens each phone made (token, deviceId): unlinking the phone takes them back.
  issued: Vec<(String, String)>,
}
impl State {
  /// The phone's yes to the rebuild is spent here, once: no yes, an old one or one for another data key is refused.
  pub(crate) fn take_rebuild(&mut self, key_id: Option<&str>, now: u64) -> bool {
    match std::mem::take(&mut self.rebuild) {
      Rebuild::Approved { until, key_id: k, .. } => until > now && key_id == Some(k.as_str()),
      Rebuild::Idle => false,
    }
  }
}

fn plain_name(s: &str, max: usize) -> bool {
  !s.is_empty() && s.len() <= max && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b':'))
}

fn field(out: &mut Vec<u8>, bytes: &[u8]) {
  out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
  out.extend_from_slice(bytes);
}

/// The bytes the phone signs. None when a name is not one this protocol takes.
pub fn message(action: &str, hash: &[u8], nonce: &[u8], orb_id: &str, device_id: &str, pc_pub: &[u8], expires: u64) -> Option<Vec<u8>> {
  if !plain_name(action, 64) || !plain_name(orb_id, 128) || !plain_name(device_id, 64) || hash.len() != 32 || nonce.len() != 32 || pc_pub.len() != 32 {
    return None;
  }
  let mut m = Vec::with_capacity(256);
  for f in [TAG, action.as_bytes(), hash, nonce, orb_id.as_bytes(), device_id.as_bytes(), pc_pub, &expires.to_be_bytes()] {
    field(&mut m, f);
  }
  Some(m)
}

pub fn summary_hash(summary: &str) -> [u8; 32] {
  Sha256::digest(summary.as_bytes()).into()
}

fn hex(bytes: &[u8]) -> String {
  bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The purpose of the token an approval makes: the action and the parameters it was signed for (the engine builds the same text).
pub fn purpose_of(action: &str, hash: &[u8]) -> String {
  format!("approve:{action}:{}", hex(hash))
}

/// A phone's public key as Orb takes it: an uncompressed P-256 point.
pub fn parse_public(sec1: &[u8]) -> Option<VerifyingKey> {
  if sec1.len() != 65 || sec1[0] != 4 {
    return None;
  }
  VerifyingKey::from_sec1_bytes(sec1).ok()
}

/// ECDSA P-256 over SHA-256, the signature in DER (what the Keystore makes).
pub fn verify(public: &[u8], message: &[u8], signature: &[u8]) -> bool {
  let Some(key) = parse_public(public) else { return false };
  let Ok(sig) = Signature::from_der(signature) else { return false };
  key.verify(message, &sig).is_ok()
}

fn refused(reason: &str) -> Value {
  json!({ "ok": false, "reason": reason })
}

fn id_of(device_id: &str) -> String {
  format!("{APPROVE_PREFIX}{device_id}")
}

/// The registered phones: id, name and when.
pub fn list(v: &mut Vault) -> Result<Vec<Value>, Code> {
  let mut out = Vec::new();
  for id in v.ids(APPROVE_PREFIX)? {
    let e = v.get(&id)?;
    if let Some(device) = id.strip_prefix(APPROVE_PREFIX) {
      if parse_public(&e.get("pub").and_then(Value::as_str).and_then(unb64).unwrap_or_default()).is_some() {
        out.push(json!({ "id": device, "name": e.get("name").cloned().unwrap_or(Value::Null), "at": e.get("at").cloned().unwrap_or(Value::Null) }));
      }
    }
  }
  Ok(out)
}

fn public_of(v: &mut Vault, device_id: &str) -> Result<Option<Vec<u8>>, Code> {
  let e = v.get(&id_of(device_id))?;
  Ok(e.get("pub").and_then(Value::as_str).and_then(unb64).filter(|p| parse_public(p).is_some()))
}

/// This PC's public key for the phones (X25519), the one the phone got when it linked.
fn pc_public(v: &mut Vault) -> Option<Vec<u8>> {
  let k = v.pc_private()?;
  let arr: [u8; 32] = k.as_slice().try_into().ok()?;
  Some(x25519_dalek::PublicKey::from(&x25519_dalek::StaticSecret::from(arr)).as_bytes().to_vec())
}

/// A new challenge for `device_id`. The one with the same device and kind it replaces goes; at most MAX_PENDING wait.
fn challenge(v: &mut Vault, kind: Kind, orb_id: &str, device_id: &str, action: &str, summary: &str, now: u64) -> Result<Value, Code> {
  if summary.len() > MAX_SUMMARY {
    return Ok(refused("big"));
  }
  let Some(pc) = pc_public(v) else { return Ok(refused("noKeys")) };
  let hash = summary_hash(summary);
  let nonce = crypto::random(32);
  let until = now + CHALLENGE_MS;
  let Some(message) = message(action, &hash, nonce.as_slice(), orb_id, device_id, &pc, until) else { return Err(Code::Damaged) };
  let key_id = v.key_id().unwrap_or_default().to_string();
  let st = &mut v.approve;
  st.pending.retain(|p| p.until > now && !(p.device_id == device_id && p.kind == kind));
  while st.pending.len() >= MAX_PENDING {
    st.pending.remove(0);
  }
  st.pending.push(Pending { until, nonce: nonce.as_slice().to_vec(), kind, device_id: device_id.to_string(), message: message.clone(), purpose: purpose_of(action, &hash), key_id });
  Ok(json!({ "ok": true, "nonce": b64(nonce.as_slice()), "payload": b64(&message), "summary": summary, "until": until, "deviceId": device_id }))
}

/// Step 1 of a registration (the caller spent the password's one-use token): the challenge the phone signs with its new key.
pub fn begin_enroll(v: &mut Vault, orb_id: &str, device_id: &str, name: &str, now: u64) -> Result<Value, Code> {
  if name.is_empty() || name.chars().count() > 60 {
    return Err(Code::Damaged);
  }
  let summary = json!({ "name": name }).to_string();
  challenge(v, Kind::Enroll(name.to_string()), orb_id, device_id, ENROLL_ACTION, &summary, now)
}

/// An approval the phone will be asked for (`summary`: canonical text of the parameters, which the phone shows and hashes).
pub fn ask(v: &mut Vault, orb_id: &str, device_id: &str, action: &str, summary: &str, now: u64) -> Result<Value, Code> {
  if public_of(v, device_id)?.is_none() {
    return Ok(refused("unknown"));
  }
  if action == ENROLL_ACTION || action == REBUILD_ACTION {
    return Err(Code::Damaged);
  }
  challenge(v, Kind::Approve, orb_id, device_id, action, summary, now)
}

/// The rebuild's challenge (the caller spent Hello's rebuild token): only for a registered phone.
pub fn ask_rebuild(v: &mut Vault, orb_id: &str, device_id: &str, now: u64) -> Result<Value, Code> {
  if public_of(v, device_id)?.is_none() {
    return Ok(refused("unknown"));
  }
  v.approve.rebuild = Rebuild::Idle;
  challenge(v, Kind::Rebuild, orb_id, device_id, REBUILD_ACTION, "{}", now)
}

/// Takes the challenge this answer belongs to, spent whatever the answer says. Only the device it was made for may answer.
fn take(v: &mut Vault, device_id: &str, nonce_b64: &str, want: fn(&Kind) -> bool, now: u64) -> Result<Pending, &'static str> {
  let nonce = unb64(nonce_b64).ok_or("nonce")?;
  let at = v.approve.pending.iter().position(|p| crypto::same(&p.nonce, &nonce) && p.device_id == device_id).ok_or("nonce")?;
  let p = v.approve.pending.remove(at);
  if !want(&p.kind) {
    return Err("nonce");
  }
  if p.until <= now {
    return Err("expired");
  }
  if v.key_id() != Some(p.key_id.as_str()) {
    return Err("changed");
  }
  Ok(p)
}

/// The phone's answer to an approval (or to the rebuild's challenge). → { ok, kind: 'approve', unlock, until, strength: 'mobile' }
/// or { ok, kind: 'rebuild' } when right.
pub fn sign(v: &mut Vault, device_id: &str, nonce_b64: &str, signature_b64: &str, now: u64) -> Result<Value, Code> {
  let p = match take(v, device_id, nonce_b64, |k| matches!(k, Kind::Approve | Kind::Rebuild), now) {
    Ok(p) => p,
    Err(r) => return Ok(refused(r)),
  };
  let Some(public) = public_of(v, device_id)? else { return Ok(refused("unknown")) };
  if !unb64(signature_b64).is_some_and(|s| verify(&public, &p.message, &s)) {
    return Ok(refused("bad"));
  }
  if p.kind == Kind::Rebuild {
    v.approve.rebuild = Rebuild::Approved { until: now + CHALLENGE_MS, key_id: p.key_id, device: device_id.to_string() };
    return Ok(json!({ "ok": true, "kind": "rebuild" }));
  }
  let mut out = v.issue_with(Some(p.purpose), Strength::Mobile, now);
  if let Some(t) = out.get("unlock").and_then(Value::as_str) {
    let t = t.to_string();
    let alive: Vec<(String, String)> = std::mem::take(&mut v.approve.issued).into_iter().filter(|(k, _)| v.token_alive(k, now)).collect();
    v.approve.issued = alive;
    v.approve.issued.push((t, device_id.to_string()));
  }
  out["ok"] = json!(true);
  out["kind"] = json!("approve");
  Ok(out)
}

/// The phone's answer to a registration: the key it made signs the first challenge, and then it is kept.
pub fn enroll(v: &mut Vault, device_id: &str, nonce_b64: &str, public_b64: &str, signature_b64: &str, now: u64) -> Result<Value, Code> {
  let p = match take(v, device_id, nonce_b64, |k| matches!(k, Kind::Enroll(_)), now) {
    Ok(p) => p,
    Err(r) => return Ok(refused(r)),
  };
  let Kind::Enroll(name) = p.kind else { return Ok(refused("nonce")) };
  let public = unb64(public_b64).filter(|k| parse_public(k).is_some());
  let (Some(public), Some(sig)) = (public, unb64(signature_b64)) else { return Ok(refused("bad")) };
  if !verify(&public, &p.message, &sig) {
    return Ok(refused("bad"));
  }
  v.set(&id_of(device_id), json!({ "pub": b64(&public), "name": name, "at": crate::vault::iso(now) }))?;
  Ok(json!({ "ok": true, "name": name }))
}

/// A phone that was unlinked (or asked to be forgotten): its key goes, and what was pending for it.
pub fn forget(v: &mut Vault, device_id: &str) -> Result<Value, Code> {
  v.approve.pending.retain(|p| p.device_id != device_id);
  let (mine, rest): (Vec<_>, Vec<_>) = std::mem::take(&mut v.approve.issued).into_iter().partition(|(_, d)| d == device_id);
  v.approve.issued = rest;
  v.drop_tokens(&mine.into_iter().map(|(t, _)| t).collect::<Vec<_>>());
  if matches!(&v.approve.rebuild, Rebuild::Approved { device, .. } if device == device_id) {
    v.approve.rebuild = Rebuild::Idle;
  }
  v.set(&id_of(device_id), Value::Null)?;
  Ok(json!(true))
}

/// Every phone's key (every phone was unlinked).
pub fn forget_all(v: &mut Vault) -> Result<Value, Code> {
  let all: Vec<String> = v.approve.issued.iter().map(|(t, _)| t.clone()).collect();
  v.drop_tokens(&all);
  v.approve = State::default();
  for id in v.ids(APPROVE_PREFIX)? {
    v.set(&id, Value::Null)?;
  }
  Ok(json!(true))
}

/// The last step of «Lo he olvidado todo»: the phone said yes (and the PC's Hello said it first), so the data key this PC opens by
/// itself is wrapped by a new password and a new generated code, both in this one request. The data key stays (no phone is
/// unlinked). Without that yes, or without a data key open here, nothing is made.
pub(crate) fn rebuild(req: &Value, h: &Handle, now: u64) -> Result<Value, Code> {
  let next = password(req, "next");
  checked(&next)?;
  let (normal, generated) = crate::vault::code::normalize(s(req, "code"));
  if !generated {
    return Err(Code::Phrase);
  }
  let created = {
    let mut v = h.vault.lock().unwrap();
    let key_id = v.key_id().map(String::from);
    if !v.approve.take_rebuild(key_id.as_deref(), now) {
      return Ok(refused("approval"));
    }
    if !v.unlocked() {
      return Err(Code::Locked);
    }
    v.master_file().and_then(|m| m.get("created").and_then(Value::as_str).map(String::from))
  };
  // The code goes first and comes back if the password cannot be written: never one new and one old.
  let old_code = std::fs::read(h.vault.lock().unwrap().dir.join(crate::vault::CODE)).ok();
  crate::code_ops::write_code(h, &normal, Some(s(req, "copyId")).filter(|c| !c.is_empty()), now)?;
  if let Err(e) = wrap(h, &next, created, now) {
    let file = h.vault.lock().unwrap().dir.join(crate::vault::CODE);
    match old_code {
      Some(bytes) => drop(std::fs::write(&file, bytes)),
      None => drop(std::fs::remove_file(&file)),
    }
    return Err(e);
  }
  let mut v = h.vault.lock().unwrap();
  v.clear_tries();
  v.lock();
  v.may_issue = true;
  Ok(json!({ "ok": true }))
}

#[cfg(test)]
#[path = "approve_tests.rs"]
mod tests;

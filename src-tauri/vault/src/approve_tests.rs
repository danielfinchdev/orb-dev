use super::*;
use crate::crypto::b64url;
use crate::fake_hello::{Fake, Mode};
use crate::locked::Locked;
use crate::server::slow;
use crate::vault::{Costs, Vault};
use p256::ecdsa::signature::Signer;
use p256::ecdsa::{Signature as Sig, SigningKey};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

const NOW: u64 = 1_800_000_000_000;
const ORB: &str = "orb-test";
const CODE_NEW: &str = "ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345-6789";
const PASSWORD: &str = "una contraseña larga";

/// The tests' phone: a P-256 key that signs with no biometric at all.
struct Phone(SigningKey);
impl Phone {
  fn new(seed: u8) -> Self {
    Phone(SigningKey::from_slice(&[seed; 32]).unwrap())
  }
  fn public(&self) -> String {
    b64(self.0.verifying_key().to_encoded_point(false).as_bytes())
  }
  fn sign(&self, message: &[u8]) -> String {
    let sig: Sig = self.0.sign(message);
    b64(sig.to_der().as_bytes())
  }
  /// Signs what a challenge says to sign.
  fn answer(&self, challenge: &Value) -> String {
    self.sign(&unb64(challenge["payload"].as_str().unwrap()).unwrap())
  }
}

fn new_vault(tag: &str) -> (Handle, PathBuf, Fake) {
  let dir = std::env::temp_dir().join(format!("orb-vault-approve-{tag}-{}-{}", std::process::id(), b64url(crypto::random(4).as_slice())));
  let h = Handle { vault: Mutex::new(Vault::new(dir.clone(), Some(Locked::from_slice(&[3u8; 32])), Costs { test: true })), serial: Mutex::new(()) };
  let fake = Fake::new(Mode::Ok);
  assert_eq!(h.vault.lock().unwrap().open_with_machine(), Ok(true));
  slow("create", &json!({ "password": PASSWORD }), &h, &fake, || NOW).unwrap();
  // this PC's keys for the phones, as the engine makes them at its first use
  h.vault.lock().unwrap().set("remote_keys", json!({ "priv": b64(&[5u8; 32]) })).unwrap();
  (h, dir, fake)
}
fn tidy(d: &PathBuf) {
  let _ = std::fs::remove_dir_all(d);
}
/// A one-use password token for `purpose`, as the engine makes it after checking the password.
fn password_token(v: &mut Vault, purpose: &str) -> String {
  v.may_issue = true;
  v.issue(Some(purpose.to_string()), NOW).unwrap()["unlock"].as_str().unwrap().to_string()
}
fn enroll_phone(v: &mut Vault, device: &str, phone: &Phone) {
  let c = begin_enroll(v, ORB, device, "Pixel de Dani", NOW).unwrap();
  assert_eq!(c["ok"], json!(true));
  let r = enroll(v, device, c["nonce"].as_str().unwrap(), &phone.public(), &phone.answer(&c), NOW).unwrap();
  assert_eq!(r["ok"], json!(true), "{r}");
}
const SUMMARY: &str = r#"{"name":"github"}"#;

#[test]
fn the_message_tells_every_field_apart_by_its_length() {
  let (hash, nonce, pc) = ([1u8; 32], [2u8; 32], [3u8; 32]);
  let a = message("secrets.connector", &hash, &nonce, "orb-1", "dev-1", &pc, 7).unwrap();
  // the same bytes cut in another place are another request
  assert_ne!(a, message("secrets.connecto", &hash, &nonce, "rorb-1", "dev-1", &pc, 7).unwrap());
  assert_ne!(a, message("secrets.connector", &hash, &nonce, "orb-1", "dev-1", &pc, 8).unwrap());
  assert_ne!(a, message("secrets.connector", &hash, &nonce, "orb-2", "dev-1", &pc, 7).unwrap());
  assert!(a.starts_with(&[0, 0, 0, 14]));
  assert_eq!(&a[4..18], TAG);
  assert!(message("a b", &hash, &nonce, "orb-1", "dev-1", &pc, 7).is_none(), "no spaces or separators in a name");
  assert!(message("x", &hash[..31], &nonce, "orb-1", "dev-1", &pc, 7).is_none());
}

#[test]
fn registering_takes_a_one_use_password_token_made_for_it() {
  let (h, dir, _) = new_vault("register");
  let srv = crate::server::tests_server(Arc::new(Fake::new(Mode::Ok)));
  let mut v = h.vault.lock().unwrap();
  let ask = |v: &mut Vault, token: &str| crate::server::tests_quick("approveBegin", json!({ "token": token, "deviceId": "dev-1", "name": "Pixel", "orbId": ORB }), v, &srv);
  assert_eq!(ask(&mut v, "nope").err(), Some(Code::Locked), "no token");
  v.may_issue = true;
  let window = v.issue(None, NOW).unwrap()["unlock"].as_str().unwrap().to_string();
  assert_eq!(ask(&mut v, &window).err(), Some(Code::Locked), "the window's token is not it");
  let other = password_token(&mut v, "hello.enable");
  assert_eq!(ask(&mut v, &other).err(), Some(Code::Locked), "another purpose is not it");
  let hello = v.issue_with(Some(REGISTER.to_string()), Strength::Hello, NOW)["unlock"].as_str().unwrap().to_string();
  assert_eq!(ask(&mut v, &hello).err(), Some(Code::Locked), "Hello's strength does not register a phone");
  let good = password_token(&mut v, REGISTER);
  let c = ask(&mut v, &good).unwrap();
  assert_eq!(c["ok"], json!(true));
  assert_eq!(c["summary"], json!(r#"{"name":"Pixel"}"#));
  assert_eq!(ask(&mut v, &good).err(), Some(Code::Locked), "used up");
  drop(v);
  tidy(&dir);
}

#[test]
fn a_phone_registers_only_by_signing_with_the_key_it_gives() {
  let (h, dir, _) = new_vault("enroll");
  let mut v = h.vault.lock().unwrap();
  let (phone, other) = (Phone::new(7), Phone::new(9));
  let c = begin_enroll(&mut v, ORB, "dev-1", "Pixel de Dani", NOW).unwrap();
  let nonce = c["nonce"].as_str().unwrap();
  // somebody else's public key, or a signature of the other key: nothing is kept
  let r = enroll(&mut v, "dev-1", nonce, &other.public(), &phone.answer(&c), NOW).unwrap();
  assert_eq!(r["reason"], json!("bad"));
  assert!(list(&mut v).unwrap().is_empty());
  assert_eq!(enroll(&mut v, "dev-1", nonce, &phone.public(), &phone.answer(&c), NOW).unwrap()["reason"], json!("nonce"), "the challenge died with the wrong answer");
  // another device cannot answer it
  let c = begin_enroll(&mut v, ORB, "dev-1", "Pixel de Dani", NOW).unwrap();
  assert_eq!(enroll(&mut v, "dev-2", c["nonce"].as_str().unwrap(), &phone.public(), &phone.answer(&c), NOW).unwrap()["reason"], json!("nonce"));
  // late
  let c = begin_enroll(&mut v, ORB, "dev-1", "Pixel de Dani", NOW).unwrap();
  let late = enroll(&mut v, "dev-1", c["nonce"].as_str().unwrap(), &phone.public(), &phone.answer(&c), NOW + CHALLENGE_MS).unwrap();
  assert_eq!(late["reason"], json!("expired"));
  // not a P-256 point
  let c = begin_enroll(&mut v, ORB, "dev-1", "Pixel de Dani", NOW).unwrap();
  assert_eq!(enroll(&mut v, "dev-1", c["nonce"].as_str().unwrap(), &b64(&[4u8; 65]), &phone.answer(&c), NOW).unwrap()["reason"], json!("bad"));
  // right
  enroll_phone(&mut v, "dev-1", &phone);
  let l = list(&mut v).unwrap();
  assert_eq!(l.len(), 1);
  assert_eq!((l[0]["id"].as_str(), l[0]["name"].as_str()), (Some("dev-1"), Some("Pixel de Dani")));
  // the entry is a vault secret the engine's generic ops cannot touch (server.rs), and it survives a reopen
  assert!(v.ids(APPROVE_PREFIX).unwrap().contains(&"master/approve/dev-1".to_string()));
  drop(v);
  tidy(&dir);
}

#[test]
fn a_right_signature_spends_the_challenge_and_gives_a_token_for_that_action_only() {
  let (h, dir, _) = new_vault("sign");
  let mut v = h.vault.lock().unwrap();
  let phone = Phone::new(7);
  enroll_phone(&mut v, "dev-1", &phone);
  let c = ask(&mut v, ORB, "dev-1", "secrets.connector", SUMMARY, NOW).unwrap();
  assert_eq!(c["ok"], json!(true));
  let sig = phone.answer(&c);
  let nonce = c["nonce"].as_str().unwrap().to_string();
  let r = sign(&mut v, "dev-1", &nonce, &sig, NOW + 1000).unwrap();
  assert_eq!((r["ok"].clone(), r["strength"].clone(), r["kind"].clone()), (json!(true), json!("mobile"), json!("approve")));
  let token = r["unlock"].as_str().unwrap().to_string();
  let purpose = purpose_of("secrets.connector", &summary_hash(SUMMARY));
  let now = NOW + 2000;
  // the vault's `check` takes it only by name: for that purpose, as a phone's token, once
  assert!(!v.check_strength(&token, Some(&purpose), Some(Strength::Password), false, now), "not a password's");
  assert!(!v.check_strength(&token, Some(&purpose), Some(Strength::Hello), false, now), "not Hello's");
  assert!(!v.check_strength(&token, None, Some(Strength::Mobile), false, now), "no window token");
  assert!(!v.check_strength(&token, Some(&purpose_of("secrets.connector", &summary_hash(r#"{"name":"otro"}"#))), Some(Strength::Mobile), false, now), "other parameters");
  assert!(!v.check_strength(&token, Some(&purpose_of("agentKeys.save", &summary_hash(SUMMARY))), Some(Strength::Mobile), false, now), "other action");
  assert!(v.check_strength(&token, Some(&purpose), Some(Strength::Mobile), true, now));
  assert!(!v.check_strength(&token, Some(&purpose), Some(Strength::Mobile), true, now), "one use");
  // the challenge is spent: the same signature again opens nothing
  assert_eq!(sign(&mut v, "dev-1", &nonce, &sig, NOW + 1000).unwrap()["reason"], json!("nonce"));
  drop(v);
  tidy(&dir);
}

#[test]
fn what_is_signed_is_what_was_asked_for() {
  let (h, dir, _) = new_vault("tamper");
  let mut v = h.vault.lock().unwrap();
  let (phone, other) = (Phone::new(7), Phone::new(9));
  enroll_phone(&mut v, "dev-1", &phone);
  enroll_phone(&mut v, "dev-2", &other);
  let pc = pc_public(&mut v).unwrap();
  // a valid signature of the same phone over another orbId, action, parameters or expiry (all built the same way) is worth nothing
  let c = ask(&mut v, ORB, "dev-1", "secrets.connector", SUMMARY, NOW).unwrap();
  let nonce_bytes = unb64(c["nonce"].as_str().unwrap()).unwrap();
  let fake = |action: &str, summary: &str, orb: &str, until: u64| message(action, &summary_hash(summary), &nonce_bytes, orb, "dev-1", &pc, until).unwrap();
  let until = c["until"].as_u64().unwrap();
  assert_eq!(unb64(c["payload"].as_str().unwrap()).unwrap(), fake("secrets.connector", SUMMARY, ORB, until), "Rust builds the documented bytes");
  for forged in [fake("agentKeys.save", SUMMARY, ORB, until), fake("secrets.connector", r#"{"name":"otro"}"#, ORB, until), fake("secrets.connector", SUMMARY, "orb-otro", until), fake("secrets.connector", SUMMARY, ORB, until + 1)] {
    let c2 = ask(&mut v, ORB, "dev-1", "secrets.connector", SUMMARY, NOW).unwrap();
    // (the same nonce is not reused: each ask is a new challenge, so a forged message fails against the new payload as well)
    assert_eq!(sign(&mut v, "dev-1", c2["nonce"].as_str().unwrap(), &phone.sign(&forged), NOW).unwrap()["reason"], json!("bad"));
  }
  // another phone's key
  let c = ask(&mut v, ORB, "dev-1", "secrets.connector", SUMMARY, NOW).unwrap();
  assert_eq!(sign(&mut v, "dev-1", c["nonce"].as_str().unwrap(), &other.answer(&c), NOW).unwrap()["reason"], json!("bad"));
  // another phone answering the challenge made for this one
  let c = ask(&mut v, ORB, "dev-1", "secrets.connector", SUMMARY, NOW).unwrap();
  assert_eq!(sign(&mut v, "dev-2", c["nonce"].as_str().unwrap(), &other.answer(&c), NOW).unwrap()["reason"], json!("nonce"));
  // late, and a phone that was never registered
  let c = ask(&mut v, ORB, "dev-1", "secrets.connector", SUMMARY, NOW).unwrap();
  assert_eq!(sign(&mut v, "dev-1", c["nonce"].as_str().unwrap(), &phone.answer(&c), NOW + CHALLENGE_MS).unwrap()["reason"], json!("expired"));
  assert_eq!(ask(&mut v, ORB, "dev-3", "secrets.connector", SUMMARY, NOW).unwrap()["reason"], json!("unknown"));
  // the registration's and the rebuild's actions are never an ordinary approval
  assert!(ask(&mut v, ORB, "dev-1", ENROLL_ACTION, "{}", NOW).is_err());
  assert!(ask(&mut v, ORB, "dev-1", REBUILD_ACTION, "{}", NOW).is_err());
  drop(v);
  tidy(&dir);
}

#[test]
fn a_registration_signature_does_not_approve_and_an_approval_does_not_register() {
  let (h, dir, _) = new_vault("kinds");
  let mut v = h.vault.lock().unwrap();
  let phone = Phone::new(7);
  let c = begin_enroll(&mut v, ORB, "dev-1", "Pixel", NOW).unwrap();
  assert_eq!(sign(&mut v, "dev-1", c["nonce"].as_str().unwrap(), &phone.answer(&c), NOW).unwrap()["reason"], json!("nonce"), "an enroll challenge is not an approval");
  enroll_phone(&mut v, "dev-1", &phone);
  let c = ask(&mut v, ORB, "dev-1", "secrets.connector", SUMMARY, NOW).unwrap();
  let r = enroll(&mut v, "dev-1", c["nonce"].as_str().unwrap(), &Phone::new(9).public(), &Phone::new(9).answer(&c), NOW).unwrap();
  assert_eq!(r["reason"], json!("nonce"), "an approval challenge cannot swap the key");
  assert_eq!(list(&mut v).unwrap().len(), 1);
  drop(v);
  tidy(&dir);
}

#[test]
fn unlinking_and_new_data_keys_delete_the_registrations() {
  let (h, dir, _) = new_vault("forget");
  let phone = Phone::new(7);
  {
    let mut v = h.vault.lock().unwrap();
    enroll_phone(&mut v, "dev-1", &phone);
    enroll_phone(&mut v, "dev-2", &phone);
    let pending = ask(&mut v, ORB, "dev-1", "secrets.connector", SUMMARY, NOW).unwrap();
    forget(&mut v, "dev-1").unwrap();
    assert_eq!(list(&mut v).unwrap().len(), 1);
    assert_eq!(sign(&mut v, "dev-1", pending["nonce"].as_str().unwrap(), &phone.answer(&pending), NOW).unwrap()["reason"], json!("nonce"));
    // linking again with the same id would not bring it back
    assert_eq!(ask(&mut v, ORB, "dev-1", "secrets.connector", SUMMARY, NOW).unwrap()["reason"], json!("unknown"));
    forget_all(&mut v).unwrap();
    assert!(list(&mut v).unwrap().is_empty());
    enroll_phone(&mut v, "dev-1", &phone);
    // a new data key (the code's rotation) and starting from scratch leave none
    let keep = v.keep_on_rotate().unwrap();
    assert!(!keep.iter().any(|k| k.starts_with(APPROVE_PREFIX)));
    v.rotate(&keep).unwrap();
    assert!(list(&mut v).unwrap().is_empty(), "rotate");
    // (every phone is unlinked then and the engine makes this PC's keys again)
    v.set("remote_keys", json!({ "priv": b64(&[5u8; 32]) })).unwrap();
    enroll_phone(&mut v, "dev-1", &phone);
    v.wipe_all().unwrap();
    assert!(list(&mut v).unwrap().is_empty(), "wipe_all");
  }
  tidy(&dir);
}

#[test]
fn locking_drops_what_was_waiting_for_a_signature() {
  let (h, dir, _) = new_vault("lock");
  let mut v = h.vault.lock().unwrap();
  let phone = Phone::new(7);
  enroll_phone(&mut v, "dev-1", &phone);
  let c = ask(&mut v, ORB, "dev-1", "secrets.connector", SUMMARY, NOW).unwrap();
  v.lock();
  assert_eq!(sign(&mut v, "dev-1", c["nonce"].as_str().unwrap(), &phone.answer(&c), NOW).unwrap()["reason"], json!("nonce"));
  drop(v);
  tidy(&dir);
}

fn hello_rebuild_token(v: &mut Vault) -> String {
  v.issue_with(Some(crate::hello::REBUILD.to_string()), Strength::Hello, NOW)["unlock"].as_str().unwrap().to_string()
}
fn run_rebuild(h: &Handle, fake: &Fake, now: u64) -> Result<Value, Code> {
  slow("rebuildFinish", &json!({ "next": "una contraseña nueva", "code": CODE_NEW }), h, fake, move || now)
}

#[test]
fn forgetting_everything_goes_hello_then_the_phone_then_the_new_password_and_code() {
  let (h, dir, fake) = new_vault("rebuild");
  let srv = crate::server::tests_server(Arc::new(Fake::new(Mode::Ok)));
  let phone = Phone::new(7);
  let begin = |h: &Handle, token: &str, device: &str| crate::server::tests_quick("rebuildBegin", json!({ "token": token, "deviceId": device, "orbId": ORB }), &mut h.vault.lock().unwrap(), &srv);
  // with no phone registered nothing is made: the token is not even used up, and there is nothing to finish
  let t = hello_rebuild_token(&mut h.vault.lock().unwrap());
  assert_eq!(begin(&h, &t, "dev-1").unwrap()["reason"], json!("unknown"));
  assert_eq!(run_rebuild(&h, &fake, NOW).unwrap()["reason"], json!("approval"));
  assert_eq!(slow("verify", &json!({ "password": PASSWORD, "channel": "pc" }), &h, &fake, || NOW).unwrap()["ok"], json!(true), "the password is as it was");
  enroll_phone(&mut h.vault.lock().unwrap(), "dev-1", &phone);
  // a password cannot make the rebuild token, and no other token starts it
  {
    let mut v = h.vault.lock().unwrap();
    v.may_issue = true;
    assert_eq!(v.issue(Some(crate::hello::REBUILD.to_string()), NOW).err(), Some(Code::Locked));
    v.may_issue = true;
    let pw = v.issue(None, NOW).unwrap()["unlock"].as_str().unwrap().to_string();
    drop(v);
    assert_eq!(begin(&h, &pw, "dev-1").err(), Some(Code::Locked));
    assert_eq!(begin(&h, "nope", "dev-1").err(), Some(Code::Locked));
  }
  // the phone has not said yes yet: no new password, no code
  let c = begin(&h, &t, "dev-1").unwrap();
  assert_eq!(c["ok"], json!(true), "{c}");
  assert_eq!(begin(&h, &t, "dev-1").err(), Some(Code::Locked), "Hello's token is used up");
  assert_eq!(run_rebuild(&h, &fake, NOW).unwrap()["reason"], json!("approval"));
  assert!(!h.vault.lock().unwrap().code_file().is_some());
  // another phone's answer, or an old one, does not count either
  let wrong = sign(&mut h.vault.lock().unwrap(), "dev-1", c["nonce"].as_str().unwrap(), &Phone::new(9).answer(&c), NOW).unwrap();
  assert_eq!(wrong["reason"], json!("bad"));
  let t2 = hello_rebuild_token(&mut h.vault.lock().unwrap());
  let c = begin(&h, &t2, "dev-1").unwrap();
  let r = sign(&mut h.vault.lock().unwrap(), "dev-1", c["nonce"].as_str().unwrap(), &phone.answer(&c), NOW + 1000).unwrap();
  assert_eq!((r["ok"].clone(), r["kind"].clone()), (json!(true), json!("rebuild")));
  assert!(r.get("unlock").is_none(), "the rebuild's yes is no token");
  assert_eq!(run_rebuild(&h, &fake, NOW + CHALLENGE_MS + 5000).unwrap()["reason"], json!("approval"), "the yes runs out");
  // again, and in time: both at once
  let t3 = hello_rebuild_token(&mut h.vault.lock().unwrap());
  let c = begin(&h, &t3, "dev-1").unwrap();
  sign(&mut h.vault.lock().unwrap(), "dev-1", c["nonce"].as_str().unwrap(), &phone.answer(&c), NOW + 1000).unwrap();
  let done = run_rebuild(&h, &fake, NOW + 2000).unwrap();
  assert_eq!(done["ok"], json!(true), "{done}");
  assert_eq!(run_rebuild(&h, &fake, NOW + 2000).unwrap()["reason"], json!("approval"), "the yes is spent");
  assert_eq!(slow("verify", &json!({ "password": "una contraseña nueva", "channel": "pc" }), &h, &fake, || NOW + 3000).unwrap()["ok"], json!(true));
  assert!(h.vault.lock().unwrap().code_file().is_some(), "a new generated code wraps the data key");
  assert_eq!(slow("verify", &json!({ "password": PASSWORD, "channel": "pc" }), &h, &fake, || NOW + 3000).unwrap()["ok"], json!(false), "the old password is gone");
  // the data key and the phones' registrations stay (the phones are not unlinked)
  assert_eq!(list(&mut h.vault.lock().unwrap()).unwrap().len(), 1);
  tidy(&dir);
}

#[test]
fn the_rebuild_takes_only_a_generated_code() {
  let (h, dir, fake) = new_vault("phrase");
  let phone = Phone::new(7);
  {
    let mut v = h.vault.lock().unwrap();
    enroll_phone(&mut v, "dev-1", &phone);
    let t = hello_rebuild_token(&mut v);
    let c = ask_rebuild(&mut v, ORB, "dev-1", NOW).unwrap();
    assert!(v.check_strength(&t, Some(crate::hello::REBUILD), Some(Strength::Hello), true, NOW));
    sign(&mut v, "dev-1", c["nonce"].as_str().unwrap(), &phone.answer(&c), NOW).unwrap();
  }
  let r = slow("rebuildFinish", &json!({ "next": "una contraseña nueva", "code": "una frase cualquiera" }), &h, &fake, || NOW);
  assert_eq!(r.err(), Some(Code::Phrase));
  tidy(&dir);
}

#[test]
fn the_engine_s_generic_ops_never_touch_the_registrations_and_check_names_the_strength() {
  let (h, dir, _) = new_vault("generic");
  let srv = crate::server::tests_server(Arc::new(Fake::new(Mode::Ok)));
  let phone = Phone::new(7);
  let mut v = h.vault.lock().unwrap();
  enroll_phone(&mut v, "dev-1", &phone);
  let q = |v: &mut Vault, op: &str, req: Value| crate::server::tests_quick(op, req, v, &srv);
  assert_eq!(q(&mut v, "get", json!({ "id": "master/approve/dev-1" })).err(), Some(Code::Damaged));
  assert_eq!(q(&mut v, "set", json!({ "id": "master/approve/dev-1", "value": { "pub": "x" } })).err(), Some(Code::Damaged));
  assert_eq!(q(&mut v, "set", json!({ "id": "master/approve/dev-9", "value": { "pub": "x" } })).err(), Some(Code::Damaged));
  assert!(!q(&mut v, "ids", json!({ "prefix": "" })).unwrap().to_string().contains("approve"));
  assert_eq!(q(&mut v, "approveList", json!({})).unwrap()[0]["id"], json!("dev-1"));
  let c = ask(&mut v, ORB, "dev-1", "secrets.connector", SUMMARY, NOW).unwrap();
  let r = sign(&mut v, "dev-1", c["nonce"].as_str().unwrap(), &phone.answer(&c), NOW).unwrap();
  let (token, purpose) = (r["unlock"].as_str().unwrap().to_string(), purpose_of("secrets.connector", &summary_hash(SUMMARY)));
  for need in [None, Some("hello")] {
    let mut req = json!({ "token": token, "purpose": purpose });
    if let Some(n) = need {
      req["need"] = json!(n);
    }
    assert_eq!(q(&mut v, "check", req).unwrap(), json!(false), "a phone's token is not a password's or Hello's");
  }
  assert_eq!(q(&mut v, "check", json!({ "token": token, "purpose": purpose, "need": "mobile", "consume": true })).unwrap(), json!(true));
  drop(v);
  tidy(&dir);
}

#[test]
fn unlinking_a_phone_takes_back_its_tokens_and_its_rebuild_yes() {
  let (h, dir, _) = new_vault("tokens");
  let (a, b) = (Phone::new(7), Phone::new(9));
  let mut v = h.vault.lock().unwrap();
  enroll_phone(&mut v, "dev-1", &a);
  enroll_phone(&mut v, "dev-2", &b);
  let purpose = purpose_of("secrets.connector", &summary_hash(SUMMARY));
  let mut tokens = Vec::new();
  for (d, p) in [("dev-1", &a), ("dev-2", &b)] {
    let c = ask(&mut v, ORB, d, "secrets.connector", SUMMARY, NOW).unwrap();
    tokens.push(sign(&mut v, d, c["nonce"].as_str().unwrap(), &p.answer(&c), NOW).unwrap()["unlock"].as_str().unwrap().to_string());
  }
  let c = ask_rebuild(&mut v, ORB, "dev-1", NOW).unwrap();
  sign(&mut v, "dev-1", c["nonce"].as_str().unwrap(), &a.answer(&c), NOW).unwrap();
  forget(&mut v, "dev-1").unwrap();
  assert!(!v.check_strength(&tokens[0], Some(&purpose), Some(Strength::Mobile), false, NOW), "its token is gone");
  assert!(v.check_strength(&tokens[1], Some(&purpose), Some(Strength::Mobile), false, NOW), "the other phone's stays");
  let kid = v.key_id().map(String::from);
  assert!(!v.approve.take_rebuild(kid.as_deref(), NOW), "its rebuild yes is gone");
  forget_all(&mut v).unwrap();
  assert!(!v.check_strength(&tokens[1], Some(&purpose), Some(Strength::Mobile), false, NOW));
  drop(v);
  tidy(&dir);
}

#[test]
fn a_rebuild_that_cannot_write_the_password_leaves_the_old_code() {
  let (h, dir, fake) = new_vault("half");
  let phone = Phone::new(7);
  {
    let mut v = h.vault.lock().unwrap();
    enroll_phone(&mut v, "dev-1", &phone);
    let c = ask_rebuild(&mut v, ORB, "dev-1", NOW).unwrap();
    sign(&mut v, "dev-1", c["nonce"].as_str().unwrap(), &phone.answer(&c), NOW).unwrap();
  }
  // a directory where maestra.json goes: the password cannot be written
  std::fs::remove_file(dir.join(crate::vault::MASTER)).unwrap();
  std::fs::create_dir(dir.join(crate::vault::MASTER)).unwrap();
  assert!(run_rebuild(&h, &fake, NOW + 1).is_err());
  assert!(!dir.join(crate::vault::CODE).exists(), "no code was left behind");
  tidy(&dir);
}

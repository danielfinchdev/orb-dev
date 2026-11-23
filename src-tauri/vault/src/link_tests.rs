use super::*;
use crate::crypto::{b64, pake_key, pake_mac, Pake};
use crate::locked::Locked;
use crate::vault::Costs;
use serde_json::json;
use std::path::PathBuf;

const NOW: u64 = 1_800_000_000_000;
const PC_PRIV: [u8; 32] = [5u8; 32];

fn new_vault(tag: &str) -> (Vault, PathBuf) {
  let dir = std::env::temp_dir().join(format!("orb-vault-link-{tag}-{}-{}", std::process::id(), b64url(crypto::random(4).as_slice())));
  let mut v = Vault::new(dir.clone(), Some(Locked::from_slice(&[3u8; 32])), Costs { test: true });
  assert_eq!(v.open_with_machine(), Ok(true));
  v.set("remote_keys", json!({ "priv": b64(&PC_PRIV) })).unwrap();
  (v, dir)
}
fn tidy(d: &PathBuf) {
  let _ = std::fs::remove_dir_all(d);
}
fn token(v: &mut Vault, strength: Strength, purpose: &str) -> String {
  v.issue_with(Some(purpose.to_string()), strength, NOW)["unlock"].as_str().unwrap().to_string()
}
fn dev_pub() -> Vec<u8> {
  // a valid X25519 public key: the base point's multiple of any secret
  x25519_dalek::PublicKey::from(&x25519_dalek::StaticSecret::from([9u8; 32])).as_bytes().to_vec()
}
fn made(v: &mut Vault) -> Value {
  let t = token(v, Strength::Hello, PURPOSE);
  let r = make(v, &t, NOW).unwrap();
  assert_eq!(r["ok"], json!(true));
  r
}
/// The phone's MAC for an exchange: the same K both sides derive (it comes from the code and ECDH(phone, PC)).
fn phone_mac(via: &str, secret: &str, sid: &str, dev: &[u8]) -> String {
  let pc_pub = x25519_dalek::PublicKey::from(&x25519_dalek::StaticSecret::from(PC_PRIV));
  let x = Pake { via, dev_pub: dev, pc_pub: pc_pub.as_bytes(), sid, n: 0, r: 0, p: 0, salt: "", secret };
  let k = pake_key(&x, &PC_PRIV, None).unwrap();
  b64(&pake_mac(k.as_slice(), "orb-pake:movil"))
}
fn finish_req(via: &str, secret: &str, sid: &str, id: &str, mac: Option<String>) -> Value {
  let dev = dev_pub();
  let pc_pub = x25519_dalek::PublicKey::from(&x25519_dalek::StaticSecret::from(PC_PRIV));
  let mac = mac.unwrap_or_else(|| phone_mac(via, secret, sid, &dev));
  json!({ "via": via, "devPub": b64(&dev), "pcPub": b64(pc_pub.as_bytes()), "sid": sid, "mac": mac, "id": id })
}

#[test]
fn a_code_has_eight_letters_a_128_bit_secret_and_its_own_salt() {
  let (mut v, dir) = new_vault("shape");
  let a = made(&mut v);
  let b = made(&mut v);
  let code = a["code"].as_str().unwrap();
  assert_eq!(code.len(), 8);
  assert!(code.bytes().all(|c| ALPHABET.contains(&c)));
  assert_eq!(unb64(a["secret"].as_str().unwrap()).unwrap().len(), 16);
  assert_ne!(a["salt"], b["salt"], "a salt per code");
  assert_ne!(a["secret"], b["secret"]);
  assert_eq!(a["until"], json!(NOW + LIFE_MS));
  assert_eq!(info(&mut v, NOW)["salt"], b["salt"], "the live one is the last made");
  tidy(&dir);
}

#[test]
fn only_a_hello_or_password_token_made_for_it_makes_a_code() {
  let (mut v, dir) = new_vault("token");
  assert_eq!(make(&mut v, "nope", NOW).err(), Some(Code::Locked), "no token");
  let other = token(&mut v, Strength::Password, "rails");
  assert_eq!(make(&mut v, &other, NOW).err(), Some(Code::Locked), "another purpose");
  v.may_issue = true;
  let window = v.issue(None, NOW).unwrap()["unlock"].as_str().unwrap().to_string();
  assert_eq!(make(&mut v, &window, NOW).err(), Some(Code::Locked), "the window's token has no purpose");
  let phone = token(&mut v, Strength::Mobile, PURPOSE);
  assert_eq!(make(&mut v, &phone, NOW).err(), Some(Code::Locked), "a phone's approval does not make codes");
  let hello = token(&mut v, Strength::Hello, PURPOSE);
  assert_eq!(make(&mut v, &hello, NOW).unwrap()["ok"], json!(true));
  assert_eq!(make(&mut v, &hello, NOW).err(), Some(Code::Locked), "used up");
  let password = token(&mut v, Strength::Password, PURPOSE);
  assert_eq!(make(&mut v, &password, NOW).unwrap()["ok"], json!(true));
  tidy(&dir);
}

#[test]
fn the_qr_secret_links_only_after_the_owner_says_yes() {
  let (mut v, dir) = new_vault("qr");
  let c = made(&mut v);
  let secret = c["secret"].as_str().unwrap().to_string();
  let dev = dev_pub();
  let p = probe(&mut v, "link", &dev, NOW).unwrap();
  assert_eq!(p["ok"], json!(true));
  assert_eq!(unb64(p["key"].as_str().unwrap()).unwrap().len(), 32);
  let f = finish(&mut v, &finish_req("link", &secret, "sid-1", "dev-1", None), NOW).unwrap();
  assert_eq!(f["waiting"], json!(true));
  // nothing comes out until the owner answers, and a confirmation for another exchange changes nothing
  assert_eq!(confirm(&mut v, "dev-2", &dev, true, NOW)["reason"], json!("none"));
  assert_eq!(confirm(&mut v, "dev-1", &[1u8; 32], true, NOW)["reason"], json!("none"));
  let ok = confirm(&mut v, "dev-1", &dev, true, NOW + 1000);
  assert_eq!(ok["ok"], json!(true));
  let pc_mac = unb64(ok["pcMac"].as_str().unwrap()).unwrap();
  let pc_pub = x25519_dalek::PublicKey::from(&x25519_dalek::StaticSecret::from(PC_PRIV));
  let x = Pake { via: "link", dev_pub: &dev, pc_pub: pc_pub.as_bytes(), sid: "sid-1", n: 0, r: 0, p: 0, salt: "", secret: &secret };
  let k = pake_key(&x, &PC_PRIV, None).unwrap();
  assert_eq!(pc_mac, pake_mac(k.as_slice(), "orb-pake:pc:dev-1"));
  assert_eq!(info(&mut v, NOW)["ok"], json!(false), "one use");
  tidy(&dir);
}

/// The phones' side is src/shared/mobile-crypto.mjs > linkSecret: this value comes from it (same text, same letters).
#[test]
fn a_typed_code_gives_the_secret_the_phone_works_out() {
  let salt: Vec<u8> = (1..=16).collect();
  assert_eq!(typed_secret("abcd-efgh", &salt).unwrap().as_str().unwrap(), "corto4:rPnLoUvFVfy_IovMAGuaHnrO3SgDzh4WMJ0k_ktBItk");
}

#[test]
fn a_typed_code_is_stretched_with_its_salt() {
  let (mut v, dir) = new_vault("typed");
  let c = made(&mut v);
  let salt = unb64(c["salt"].as_str().unwrap()).unwrap();
  // with the QR's secret by hand the typed way does not open, and the typed way needs the 8 letters and the salt
  let typed = typed_secret(c["code"].as_str().unwrap(), &salt).unwrap();
  let typed = typed.as_str().unwrap().to_string();
  assert!(typed.starts_with("corto4:"));
  let lower = format!("{}-{}", &c["code"].as_str().unwrap()[..4].to_lowercase(), &c["code"].as_str().unwrap()[4..]);
  assert_eq!(typed_secret(&lower, &salt).unwrap().as_str().unwrap(), typed, "case and the dash do not matter");
  assert_eq!(probe(&mut v, "linkcode", &dev_pub(), NOW).unwrap()["ok"], json!(true));
  let f = finish(&mut v, &finish_req("linkcode", &typed, "sid-t", "dev-t", None), NOW).unwrap();
  assert_eq!(f["waiting"], json!(true), "{f}");
  tidy(&dir);
}

#[test]
fn the_typed_secret_does_not_open_the_qr_way_and_the_other_way_round() {
  let (mut v, dir) = new_vault("ways");
  let c = made(&mut v);
  let salt = unb64(c["salt"].as_str().unwrap()).unwrap();
  let typed = typed_secret(c["code"].as_str().unwrap(), &salt).unwrap().as_str().unwrap().to_string();
  let f = finish(&mut v, &finish_req("link", &typed, "s", "d", None), NOW).unwrap();
  assert_eq!(f["reason"], json!("wrong"));
  let f = finish(&mut v, &finish_req("linkcode", c["secret"].as_str().unwrap(), "s", "d", None), NOW).unwrap();
  assert_eq!(f["reason"], json!("wrong"));
  assert_eq!(finish(&mut v, &finish_req("password", "x", "s", "d", None), NOW).unwrap()["reason"], json!("bad"), "no other way");
  tidy(&dir);
}

#[test]
fn the_third_wrong_answer_kills_the_code() {
  let (mut v, dir) = new_vault("fails");
  let c = made(&mut v);
  let secret = c["secret"].as_str().unwrap().to_string();
  let bad = |v: &mut Vault| finish(v, &finish_req("link", &secret, "s", "d", Some(b64(&[0u8; 32]))), NOW).unwrap();
  assert_eq!(bad(&mut v)["left"], json!(2));
  assert_eq!(fail(&mut v, NOW)["left"], json!(1), "a proof that did not open counts the same");
  let last = bad(&mut v);
  assert_eq!(last["reason"], json!("dead"));
  // even the right answer is too late
  let good = finish(&mut v, &finish_req("link", &secret, "s", "d", None), NOW).unwrap();
  assert_eq!(good["reason"], json!("gone"));
  assert_eq!(probe(&mut v, "link", &dev_pub(), NOW).unwrap()["reason"], json!("gone"));
  tidy(&dir);
}

#[test]
fn an_old_code_is_gone() {
  let (mut v, dir) = new_vault("old");
  let c = made(&mut v);
  let secret = c["secret"].as_str().unwrap().to_string();
  assert_eq!(info(&mut v, NOW + LIFE_MS - 1)["ok"], json!(true));
  let late = NOW + LIFE_MS;
  assert_eq!(probe(&mut v, "link", &dev_pub(), late).unwrap()["reason"], json!("gone"));
  assert_eq!(finish(&mut v, &finish_req("link", &secret, "s", "d", None), late).unwrap()["reason"], json!("gone"));
  tidy(&dir);
}

#[test]
fn a_used_code_cannot_be_used_again() {
  let (mut v, dir) = new_vault("reuse");
  let c = made(&mut v);
  let secret = c["secret"].as_str().unwrap().to_string();
  let dev = dev_pub();
  finish(&mut v, &finish_req("link", &secret, "s1", "d1", None), NOW).unwrap();
  assert_eq!(confirm(&mut v, "d1", &dev, true, NOW)["ok"], json!(true));
  assert_eq!(finish(&mut v, &finish_req("link", &secret, "s2", "d2", None), NOW).unwrap()["reason"], json!("gone"));
  assert_eq!(confirm(&mut v, "d1", &dev, true, NOW)["reason"], json!("gone"));
  tidy(&dir);
}

#[test]
fn without_the_owners_yes_there_is_no_link() {
  let (mut v, dir) = new_vault("no");
  let c = made(&mut v);
  let secret = c["secret"].as_str().unwrap().to_string();
  let dev = dev_pub();
  finish(&mut v, &finish_req("link", &secret, "s1", "d1", None), NOW).unwrap();
  // a second phone with the right code has to wait: one at a time
  assert_eq!(finish(&mut v, &finish_req("link", &secret, "s2", "d2", None), NOW + 1).unwrap()["reason"], json!("busy"));
  let no = confirm(&mut v, "d1", &dev, false, NOW + 2);
  assert_eq!(no["reason"], json!("declined"));
  assert!(no.get("pcMac").is_none());
  assert_eq!(info(&mut v, NOW)["ok"], json!(false), "a no spends the code");
  // too late a yes gives nothing either
  let c = made(&mut v);
  let secret = c["secret"].as_str().unwrap().to_string();
  finish(&mut v, &finish_req("link", &secret, "s1", "d1", None), NOW).unwrap();
  let late = confirm(&mut v, "d1", &dev, true, NOW + CONFIRM_MS);
  assert_eq!(late["reason"], json!("expired"));
  assert!(late.get("pcMac").is_none());
  tidy(&dir);
}

#[test]
fn locking_cancels_the_code() {
  let (mut v, dir) = new_vault("lock");
  let c = made(&mut v);
  let secret = c["secret"].as_str().unwrap().to_string();
  finish(&mut v, &finish_req("link", &secret, "s1", "d1", None), NOW).unwrap();
  v.lock();
  assert_eq!(info(&mut v, NOW)["ok"], json!(false));
  assert_eq!(confirm(&mut v, "d1", &dev_pub(), true, NOW)["reason"], json!("gone"));
  let c = made(&mut v);
  cancel(&mut v);
  assert_eq!(probe(&mut v, "link", &dev_pub(), NOW).unwrap()["reason"], json!("gone"), "{c}");
  tidy(&dir);
}

#[test]
fn the_code_is_never_written_and_never_given_back() {
  let (mut v, dir) = new_vault("disk");
  let c = made(&mut v);
  let (code, secret) = (c["code"].as_str().unwrap().to_string(), c["secret"].as_str().unwrap().to_string());
  let salt = unb64(c["salt"].as_str().unwrap()).unwrap();
  let typed = typed_secret(&code, &salt).unwrap().as_str().unwrap().to_string();
  finish(&mut v, &finish_req("link", &secret, "s1", "d1", None), NOW).unwrap();
  let answers = [info(&mut v, NOW), probe(&mut v, "link", &dev_pub(), NOW).unwrap(), fail(&mut v, NOW), confirm(&mut v, "d1", &dev_pub(), true, NOW)];
  for a in answers.iter().map(|a| a.to_string()) {
    for part in [&code, &secret, &typed] {
      assert!(!a.contains(part.as_str()), "an answer holds the code: {a}");
    }
  }
  for entry in std::fs::read_dir(&dir).unwrap().flatten() {
    let bytes = std::fs::read(entry.path()).unwrap_or_default();
    let text = String::from_utf8_lossy(&bytes).to_string();
    for part in [&code, &secret, &typed] {
      assert!(!text.contains(part.as_str()), "{:?} holds the code", entry.path());
    }
  }
  tidy(&dir);
}

#[test]
fn the_server_ops_need_the_token_and_never_touch_the_password_exchange() {
  let (h, dir) = {
    let (v, dir) = new_vault("ops");
    (crate::server::Handle { vault: std::sync::Mutex::new(v), serial: std::sync::Mutex::new(()) }, dir)
  };
  let srv = crate::server::tests_server(std::sync::Arc::new(crate::fake_hello::Fake::new(crate::fake_hello::Mode::Ok)));
  let q = |op: &str, req: Value| crate::server::tests_quick(op, req, &mut h.vault.lock().unwrap(), &srv);
  assert_eq!(q("linkNew", json!({ "token": "x" })).err(), Some(Code::Locked));
  let t = token(&mut h.vault.lock().unwrap(), Strength::Hello, PURPOSE);
  let made = q("linkNew", json!({ "token": t })).unwrap();
  assert_eq!(made["ok"], json!(true));
  assert_eq!(q("linkInfo", json!({})).unwrap()["ok"], json!(true));
  assert_eq!(q("linkCancel", json!({})).unwrap(), json!(true));
  assert_eq!(q("linkInfo", json!({})).unwrap()["ok"], json!(false));
  drop(h);
  tidy(&dir);
}

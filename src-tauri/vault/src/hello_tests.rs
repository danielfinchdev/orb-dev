use super::*;
use crate::fake_hello::{Fake, Mode};
use crate::vault::{Costs, FRESH_MS, UNLOCK_MS};
use rsa::pkcs1::EncodeRsaPublicKey;
use std::sync::Mutex;

const NOW: u64 = 1_800_000_000_000;

fn setup(mode: Mode) -> (Mutex<Vault>, Fake, std::path::PathBuf) {
  let dir = std::env::temp_dir().join(format!("orb-vault-hello-{}-{}", std::process::id(), crypto::b64url(crypto::random(4).as_slice())));
  let mut v = Vault::new(dir.clone(), None, Costs { test: true });
  assert_eq!(v.open_with_machine(), Ok(true));
  (Mutex::new(v), Fake::new(mode), dir)
}
fn enabled(mode: Mode) -> (Mutex<Vault>, Fake, std::path::PathBuf) {
  let (v, f, dir) = setup(mode);
  assert_eq!(enable(&v, &f, "orb-test", || NOW).unwrap()["ok"], json!(true));
  (v, f, dir)
}
fn begun(v: &Mutex<Vault>, purpose: Option<&str>, now: u64) -> Begun {
  begin(&mut v.lock().unwrap(), "orb-1", purpose, now).unwrap().ok().expect("a nonce")
}
fn end(v: &Mutex<Vault>, b: &Begun, a: Result<Vec<u8>, HelloError>, now: u64) -> Value {
  finish(&mut v.lock().unwrap(), &b.message, a, now).unwrap()
}
fn nonce_of(m: &[u8]) -> Vec<u8> {
  m[m.len() - 32..].to_vec()
}

#[test]
fn a_good_signature_gives_a_hello_token_that_is_not_a_password_one() {
  let (v, f, dir) = enabled(Mode::Ok);
  let b = begun(&v, None, NOW);
  let out = end(&v, &b, f.sign(&b.account, &b.message), NOW + 1000);
  assert_eq!(out["ok"], json!(true));
  assert_eq!(out["strength"], json!("hello"));
  let token = out["unlock"].as_str().unwrap().to_string();
  let mut g = v.lock().unwrap();
  assert!(g.check_token(&token, None, false, NOW + 2000), "valid as a window token");
  assert!(g.check_strength(&token, None, Some(Strength::Hello), false, NOW + 2000));
  assert!(!g.check_strength(&token, None, Some(Strength::Password), false, NOW + 2000), "not as a password's");
  assert_eq!(g.strength_of(&token, NOW + 2000), Some(Strength::Hello));
  assert!(!g.check_token(&token, None, false, NOW + UNLOCK_MS + 1001));
  g.may_issue = true;
  let pw = g.issue(None, NOW).unwrap();
  assert_eq!(pw["strength"], json!("password"));
  assert!(g.check_strength(pw["unlock"].as_str().unwrap(), None, Some(Strength::Password), false, NOW));
  drop(g);
  let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn the_public_key_is_only_in_the_sealed_vault() {
  let (v, _, dir) = enabled(Mode::Ok);
  let text = std::fs::read_to_string(dir.join(crate::vault::VAULT)).unwrap();
  let entry = v.lock().unwrap().get(HELLO_ID).unwrap();
  assert_eq!(entry["alg"], json!(ALG));
  assert_eq!(entry["cuenta"], json!("orb-test"));
  assert!(!text.contains(entry["pub"].as_str().unwrap()), "authenticated and sealed by the data key");
  let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_signature_of_another_nonce_purpose_or_orb_is_refused() {
  let (v, f, dir) = enabled(Mode::Ok);
  // (the message to sign instead, built from the real nonce)
  let cases: [(&str, Option<&str>); 4] = [("orb-1", Some("backup.restore")), ("orb-1", None), ("orb-2", Some("secrets.view")), ("orb-1", Some("secrets.view"))];
  let mut now = NOW;
  for (i, (orb, purpose)) in cases.iter().enumerate() {
    let b = begun(&v, Some("secrets.view"), now);
    let nonce = if i == 3 { crypto::random(32).as_slice().to_vec() } else { nonce_of(&b.message) };
    let wrong = message(orb, *purpose, &nonce).unwrap();
    let out = end(&v, &b, Ok(f.sign_raw(&wrong)), now + 1);
    assert_eq!(out["ok"], json!(false), "case {i}");
    assert!(out.get("unlock").is_none());
    now += PROMPT_WAIT_MS + 10; // past any wait the failures made
  }
  let b = begun(&v, Some("secrets.view"), now);
  assert_eq!(end(&v, &b, f.sign(&b.account, &b.message), now + 1)["ok"], json!(true), "the right one still works");
  let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_key_of_another_algorithm_or_size_is_not_taken() {
  let (v, _, dir) = setup(Mode::BadAlg);
  let f = Fake::new(Mode::BadAlg);
  assert_eq!(enable(&v, &f, "orb-test", || NOW).unwrap()["reason"], json!("alg"));
  assert!(v.lock().unwrap().get(HELLO_ID).unwrap().is_null(), "nothing is kept");
  assert!(f.accounts.lock().unwrap().is_empty(), "and the OS key goes again");
  let small = rsa::RsaPrivateKey::new(&mut rand_core::OsRng, 1024).unwrap();
  let f = Fake::with_key(Mode::Ok, small);
  assert_eq!(enable(&v, &f, "orb-test", || NOW).unwrap()["reason"], json!("alg"));
  assert!(v.lock().unwrap().get(HELLO_ID).unwrap().is_null());
  let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn verification_is_strict() {
  let f = Fake::new(Mode::Ok);
  let key = f.create("a").unwrap();
  let m = b"orb-hello-v1".to_vec();
  let sig = f.sign_raw(&m);
  assert!(verify(&key.public, &m, &sig));
  assert!(!verify(&key.public, b"other", &sig));
  let mut bad = sig.clone();
  bad[100] ^= 1;
  assert!(!verify(&key.public, &m, &bad));
  assert!(!verify(&key.public, &m, &sig[1..]), "short");
  let mut long = sig.clone();
  long.push(0);
  assert!(!verify(&key.public, &m, &long), "long");
  assert!(!verify(&key.public[1..], &m, &sig), "garbage key");
  let small = rsa::RsaPrivateKey::new(&mut rand_core::OsRng, 1024).unwrap();
  let small_pub = small.to_public_key().to_pkcs1_der().unwrap();
  assert!(parse_public(small_pub.as_bytes()).is_none());
}

#[test]
fn a_nonce_is_used_once_and_dies_in_two_minutes() {
  let (v, f, dir) = enabled(Mode::Ok);
  let b = begun(&v, None, NOW);
  let sig = f.sign(&b.account, &b.message).unwrap();
  assert_eq!(end(&v, &b, Ok(sig.clone()), NOW + 10)["ok"], json!(true));
  assert_eq!(end(&v, &b, Ok(sig.clone()), NOW + 20)["ok"], json!(false), "the same answer twice");
  // the old signature on a new nonce
  let b2 = begun(&v, None, NOW + 30);
  assert_ne!(nonce_of(&b.message), nonce_of(&b2.message));
  assert_eq!(end(&v, &b2, Ok(sig), NOW + 40)["ok"], json!(false));
  // late
  let b3 = begun(&v, None, NOW + 100_000);
  let late = f.sign(&b3.account, &b3.message);
  assert_eq!(end(&v, &b3, late, NOW + 100_000 + NONCE_MS)["reason"], json!("expired"));
  let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn only_one_nonce_is_pending() {
  let (v, f, dir) = enabled(Mode::Ok);
  let b = begun(&v, None, NOW);
  let second = begin(&mut v.lock().unwrap(), "orb-1", None, NOW + 1).unwrap();
  assert_eq!(second.err().unwrap()["reason"], json!("busy"));
  assert_eq!(end(&v, &b, f.sign(&b.account, &b.message), NOW + 2)["ok"], json!(true), "the first one still counts");
  let _ = begun(&v, None, NOW + 3);
  let after = begin(&mut v.lock().unwrap(), "orb-1", None, NOW + 3 + NONCE_MS).unwrap();
  assert!(after.is_ok(), "a dead nonce does not block");
  let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn cancelling_gives_no_token_spends_the_nonce_and_three_in_a_row_wait() {
  let (v, f, dir) = enabled(Mode::Ok);
  f.set_mode(Mode::Cancel);
  for i in 0..3 {
    let b = begun(&v, None, NOW + i);
    let out = end(&v, &b, f.sign(&b.account, &b.message), NOW + i);
    assert_eq!(out["reason"], json!("cancelled"));
    assert!(out.get("unlock").is_none());
    assert_eq!(end(&v, &b, Ok(f.sign_raw(&b.message)), NOW + i)["reason"], json!("nonce"), "spent");
  }
  let wait = begin(&mut v.lock().unwrap(), "orb-1", None, NOW + 10_000).unwrap().err().unwrap();
  assert_eq!(wait["reason"], json!("wait"));
  assert_eq!(state(&mut v.lock().unwrap(), &f, NOW + 10_000).unwrap()["waitUntil"], json!(crate::vault::iso(NOW + 2 + PROMPT_WAIT_MS)));
  f.set_mode(Mode::Ok);
  let b = begun(&v, None, NOW + 2 + PROMPT_WAIT_MS);
  assert_eq!(end(&v, &b, f.sign(&b.account, &b.message), NOW + 2 + PROMPT_WAIT_MS)["ok"], json!(true), "after the wait");
  let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_success_clears_the_failures_in_a_row() {
  let (v, f, dir) = enabled(Mode::Ok);
  f.set_mode(Mode::Cancel);
  for _ in 0..2 {
    let b = begun(&v, None, NOW);
    end(&v, &b, f.sign(&b.account, &b.message), NOW);
  }
  f.set_mode(Mode::Ok);
  let b = begun(&v, None, NOW);
  assert_eq!(end(&v, &b, f.sign(&b.account, &b.message), NOW)["ok"], json!(true));
  f.set_mode(Mode::Fail);
  for _ in 0..2 {
    let b = begun(&v, None, NOW);
    end(&v, &b, f.sign(&b.account, &b.message), NOW);
  }
  assert!(begin(&mut v.lock().unwrap(), "orb-1", None, NOW).unwrap().is_ok(), "two again: no wait yet");
  let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn without_hello_there_is_nothing_to_unlock() {
  let (v, _, dir) = setup(Mode::Ok);
  assert_eq!(begin(&mut v.lock().unwrap(), "orb-1", None, NOW).unwrap().err().unwrap()["reason"], json!("none"));
  let f = Fake::new(Mode::NoHello);
  assert_eq!(enable(&v, &f, "orb-test", || NOW).unwrap()["reason"], json!("unavailable"));
  let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_changed_entry_fails_closed() {
  let (v, f, dir) = enabled(Mode::Ok);
  v.lock().unwrap().set(HELLO_ID, json!({ "cuenta": "orb-test", "pub": "AAAA", "alg": ALG, "at": "x" })).unwrap();
  assert_eq!(begin(&mut v.lock().unwrap(), "orb-1", None, NOW).unwrap().err().unwrap()["reason"], json!("changed"));
  assert_eq!(state(&mut v.lock().unwrap(), &f, NOW).unwrap()["valid"], json!(false));
  let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn the_rebuild_token_serves_nothing_else_and_only_hello_makes_it() {
  let (v, f, dir) = enabled(Mode::Ok);
  {
    let mut g = v.lock().unwrap();
    g.may_issue = true;
    assert!(g.issue(Some(REBUILD.into()), NOW).is_err(), "a password cannot make it");
    assert!(g.may_issue, "and the refusal does not spend the password's turn");
    g.may_issue = false;
  }
  let b = begun(&v, Some(REBUILD), NOW);
  let out = end(&v, &b, f.sign(&b.account, &b.message), NOW + 1);
  let t = out["unlock"].as_str().unwrap();
  let mut g = v.lock().unwrap();
  assert!(!g.check_token(t, None, false, NOW + 2), "not a window token");
  assert!(!g.check_token(t, Some("secrets.view"), false, NOW + 2), "not another purpose's");
  assert!(!g.check_strength(t, Some(REBUILD), Some(Strength::Password), false, NOW + 2));
  assert!(g.check_token(t, Some(REBUILD), false, NOW + FRESH_MS - 1));
  assert!(!g.check_token(t, Some(REBUILD), false, NOW + 1 + FRESH_MS + 1), "two minutes");
  drop(g);
  let b = begun(&v, Some(REBUILD), NOW + 10);
  let t = end(&v, &b, f.sign(&b.account, &b.message), NOW + 11)["unlock"].as_str().unwrap().to_string();
  let mut g = v.lock().unwrap();
  assert!(g.check_token(&t, Some(REBUILD), true, NOW + 12));
  assert!(!g.check_token(&t, Some(REBUILD), true, NOW + 13), "one use");
  drop(g);
  let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_new_data_key_forgets_hello() {
  for wipe in [false, true] {
    let (v, f, dir) = enabled(Mode::Ok);
    v.lock().unwrap().set("keep", json!(1)).unwrap();
    let b = begun(&v, None, NOW);
    {
      let mut g = v.lock().unwrap();
      if wipe {
        g.wipe_all().unwrap();
      } else {
        g.rotate(&["keep".into(), HELLO_ID.into()]).unwrap();
        assert_eq!(g.get("keep").unwrap(), json!(1), "the rest is kept");
      }
      assert!(g.get(HELLO_ID).unwrap().is_null(), "wipe: {wipe}");
    }
    assert_eq!(end(&v, &b, f.sign(&b.account, &b.message), NOW + 1)["ok"], json!(false), "the nonce of the old key is no more");
    assert_eq!(state(&mut v.lock().unwrap(), &f, NOW).unwrap()["enabled"], json!(false));
    let _ = std::fs::remove_dir_all(dir);
  }
}

#[test]
fn disabling_removes_the_entry_and_the_os_key() {
  let (v, f, dir) = enabled(Mode::Ok);
  assert_eq!(f.accounts.lock().unwrap().len(), 1);
  disable(&mut v.lock().unwrap(), &f).unwrap();
  assert!(f.accounts.lock().unwrap().is_empty());
  assert!(v.lock().unwrap().get(HELLO_ID).unwrap().is_null());
  let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn no_signature_nonce_or_key_is_in_an_answer_or_a_file() {
  let (v, f, dir) = enabled(Mode::Ok);
  f.set_mode(Mode::Cancel);
  let mut seen = Vec::new();
  let b = begun(&v, None, NOW);
  let sig = f.sign_raw(&b.message);
  seen.push(end(&v, &b, f.sign(&b.account, &b.message), NOW).to_string());
  f.set_mode(Mode::Ok);
  let b = begun(&v, None, NOW + 1);
  let good = f.sign(&b.account, &b.message).unwrap();
  seen.push(end(&v, &b, Ok(good.clone()), NOW + 2).to_string());
  seen.push(end(&v, &b, Ok(good.clone()), NOW + 3).to_string());
  seen.push(state(&mut v.lock().unwrap(), &f, NOW).unwrap().to_string());
  seen.push(enable(&v, &f, "orb-test", || NOW).unwrap().to_string());
  let entry = v.lock().unwrap().get(HELLO_ID).unwrap();
  for dirent in std::fs::read_dir(&dir).unwrap().flatten() {
    seen.push(std::fs::read_to_string(dirent.path()).unwrap_or_default());
  }
  let nonce = nonce_of(&b.message);
  let secrets = [b64(&sig), b64(&good), crypto::b64url(&good), crypto::hex_of(&nonce).as_str().unwrap_or_default().to_string(), b64(&nonce), crypto::b64url(&nonce), entry["pub"].as_str().unwrap().to_string()];
  for text in &seen {
    for secret in &secrets {
      assert!(!text.contains(secret.as_str()), "leak of {secret:.12}");
    }
  }
  let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn an_answer_for_another_nonce_spends_nothing() {
  let (v, f, dir) = enabled(Mode::Ok);
  let old = begun(&v, None, NOW);
  let _ = end(&v, &old, f.sign(&old.account, &old.message), NOW + 1);
  let b = begun(&v, None, NOW + 2);
  let out = end(&v, &old, Err(HelloError::Cancelled), NOW + 3);
  assert_eq!(out["reason"], json!("nonce"));
  assert_eq!(end(&v, &b, f.sign(&b.account, &b.message), NOW + 4)["ok"], json!(true), "the pending one is still there, and no try was counted");
  let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn locking_drops_the_pending_nonce() {
  let (v, f, dir) = enabled(Mode::Ok);
  let b = begun(&v, None, NOW);
  v.lock().unwrap().lock();
  assert_eq!(end(&v, &b, f.sign(&b.account, &b.message), NOW + 1)["ok"], json!(false));
  let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn two_enables_at_once_and_a_new_key_in_between() {
  let (v, f, dir) = setup(Mode::Ok);
  v.lock().unwrap().hello.enabling = true; // another enable is waiting for its prompt
  assert_eq!(enable(&v, &f, "orb-test", || NOW).unwrap()["reason"], json!("busy"));
  assert!(f.accounts.lock().unwrap().is_empty());
  v.lock().unwrap().hello = State::default();
  // the data key changes while the OS prompt is open
  struct Slow<'a>(&'a Fake, &'a Mutex<Vault>);
  impl Hello for Slow<'_> {
    fn available(&self) -> bool {
      true
    }
    fn create(&self, a: &str) -> Result<HelloKey, HelloError> {
      self.1.lock().unwrap().wipe_all().unwrap();
      self.0.create(a)
    }
    fn sign(&self, a: &str, m: &[u8]) -> Result<Vec<u8>, HelloError> {
      self.0.sign(a, m)
    }
    fn delete(&self, a: &str) {
      self.0.delete(a)
    }
  }
  let out = enable(&v, &Slow(&f, &v), "orb-test", || NOW).unwrap();
  assert_eq!(out["reason"], json!("changed"));
  assert!(f.accounts.lock().unwrap().is_empty(), "the stray OS key is deleted");
  assert!(v.lock().unwrap().get(HELLO_ID).unwrap().is_null());
  let _ = std::fs::remove_dir_all(dir);
}

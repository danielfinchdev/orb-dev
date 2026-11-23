use super::*;
use crate::crypto::{b64, b64url};
use crate::fake_hello::{Fake, Mode};
use crate::server::slow;
use crate::vault::{Costs, Vault, APPROVE_PREFIX, CODE, MASTER, MACHINE, VAULT};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const NOW: u64 = 1_800_000_000_000;
const CODE_A: &str = "ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345-6789";
const CODE_B: &str = "BCDE-FGHJ-KLMN-PQRS-TUVW-XYZ2-3456-789A";
const PASSWORD: &str = "una contraseña larga";

fn dir_of(tag: &str) -> PathBuf {
  std::env::temp_dir().join(format!("orb-vault-code-{tag}-{}-{}", std::process::id(), b64url(crypto::random(4).as_slice())))
}
fn handle(dir: &Path, secret: u8) -> Handle {
  Handle { vault: Mutex::new(Vault::new(dir.to_path_buf(), Some(Locked::from_slice(&[secret; 32])), Costs { test: true })), serial: Mutex::new(()) }
}
fn run(op: &str, req: Value, h: &Handle, hello: &Fake) -> Answer {
  slow(op, &req, h, hello, || NOW)
}
/// A PC with a password, a secret and (when `code`) a generated code wrapping the data key.
fn pc(tag: &str, secret: u8, code: Option<&str>) -> (Handle, PathBuf, Fake) {
  let dir = dir_of(tag);
  let h = handle(&dir, secret);
  let fake = Fake::new(Mode::Ok);
  assert_eq!(h.vault.lock().unwrap().open_with_machine(), Ok(true));
  run("create", json!({ "password": PASSWORD }), &h, &fake).unwrap();
  h.vault.lock().unwrap().set("conector/clave", json!("sk-secreto")).unwrap();
  if let Some(c) = code {
    assert_eq!(run("codeSet", json!({ "code": c, "password": PASSWORD }), &h, &fake).unwrap()["ok"], json!(true));
  }
  (h, dir, fake)
}
fn read(dir: &Path, name: &str) -> Value {
  serde_json::from_str(&std::fs::read_to_string(dir.join(name)).unwrap()).unwrap()
}
fn copy_files(from: &Path, to: &Path, names: &[&str]) {
  std::fs::create_dir_all(to).unwrap();
  for n in names {
    std::fs::copy(from.join(n), to.join(n)).unwrap();
  }
}
/// What src/domain/data/backup.mjs › setRecovery writes: the copies' wrap of a code or a phrase, sealed with this PC's backup key.
fn write_copy_wrap(path: &Path, secret: u8, phrase: &str) {
  let kdf = json!({ "alg": "scrypt", "N": 1 << 10, "r": 8, "p": 1, "salt": b64(crypto::random(16).as_slice()) });
  let (normal, _) = code::normalize(phrase);
  let kek = crypto::scrypt(normal.as_bytes(), &unb64(kdf["salt"].as_str().unwrap()).unwrap(), 1 << 10, 8, 1).unwrap();
  let bkey = crypto::backup_key(&[secret; 32]);
  let sealed = crypto::seal(bkey.as_slice(), kek.as_slice(), "orbbak:recovery");
  std::fs::write(path, serde_json::to_string(&json!({ "v": 1, "kdf": kdf, "kek": sealed })).unwrap()).unwrap();
}
/// Hello switched on without the OS prompt: its entry and the OS key's name.
fn with_hello(h: &Handle, fake: &Fake) {
  fake.accounts.lock().unwrap().push("orb-x".into());
  h.vault.lock().unwrap().set(crate::hello::HELLO_ID, json!({ "alg": crate::hello::ALG, "cuenta": "orb-x", "pub": "x" })).unwrap();
}
fn tidy(dirs: &[&Path]) {
  for d in dirs {
    let _ = std::fs::remove_dir_all(d);
  }
}

#[test]
fn the_code_file_wraps_the_data_key_and_shows_neither() {
  let (h, dir, _) = pc("file", 1, Some(CODE_A));
  let text = std::fs::read_to_string(dir.join(CODE)).unwrap();
  let file = read(&dir, CODE);
  assert_eq!(file["v"], json!(1));
  assert_eq!(file["keyId"].as_str(), h.vault.lock().unwrap().key_id());
  assert_eq!(file["kdf"]["alg"], json!("scrypt"));
  assert!(file["kdf"]["N"].as_u64().unwrap() >= 1 << 12);
  assert_eq!(file["kdf"]["salt"].as_str().and_then(unb64).map(|s| s.len()), Some(16));
  assert!(!text.contains("ABCDEFGH") && !text.contains(&code::normalize(CODE_A).0));
  assert_ne!(read(&dir, MASTER)["kdf"]["salt"], file["kdf"]["salt"], "its own salt");
  assert!(h.vault.lock().unwrap().state()["hasCode"].as_bool().unwrap());
  tidy(&[&dir]);
}

#[test]
fn a_changed_header_does_not_open() {
  let (_, dir, _) = pc("aad", 1, Some(CODE_A));
  for (field, value) in [("created", json!("2030-01-01T00:00:00.000Z")), ("v", json!(2))] {
    let mut file = read(&dir, CODE);
    file[field] = value;
    std::fs::write(dir.join(CODE), serde_json::to_string(&file).unwrap()).unwrap();
    let locked = handle(&dir, 1);
    let (n, _) = code::normalize(CODE_A);
    let v = locked.vault.lock().unwrap();
    let m = v.code_file().unwrap();
    let kek = code::kek_of(&n, &v.code_kdf(&m).unwrap()).unwrap();
    assert!(v.key_for_code(&m, kek.as_slice()).is_none(), "{field} is part of the additional data");
  }
  tidy(&[&dir]);
}

#[test]
fn a_clean_pc_with_the_copy_and_the_code_gets_the_secrets() {
  let (a, dir_a, fake) = pc("old", 1, Some(CODE_A));
  let key_id = a.vault.lock().unwrap().key_id().unwrap().to_string();
  let dir_b = dir_of("new");
  // the copy brings the sealed files, never this PC's wrap (another machine's secret)
  copy_files(&dir_a, &dir_b, &[MASTER, CODE, VAULT]);
  let b = handle(&dir_b, 2);
  assert!(!b.vault.lock().unwrap().open_with_machine().unwrap());
  let a_phrase = run("codeUnlock", json!({ "code": "una frase que no es el codigo" }), &b, &fake).unwrap();
  assert_eq!(a_phrase["reason"], json!("wrong"), "a phrase does not open the vault");
  assert!(!b.vault.lock().unwrap().unlocked());
  let answer = run("codeUnlock", json!({ "code": "abcd efgh jklm npqr stuv wxyz 2345 6789" }), &b, &fake).unwrap();
  assert_eq!(answer, json!({ "ok": true }));
  assert!(!answer.to_string().contains("ABCD"));
  let mut v = b.vault.lock().unwrap();
  assert_eq!(v.key_id(), Some(key_id.as_str()));
  assert_eq!(v.get("conector/clave").unwrap(), json!("sk-secreto"));
  assert!(v.issue(None, NOW).is_ok(), "a right code lets a window token be made");
  assert!(dir_b.join(MACHINE).exists(), "this PC wraps the data key for itself");
  let tries = std::fs::read_to_string(dir_b.join("intentos.json")).unwrap_or_default();
  assert!(!tries.contains("ABCD") && !tries.contains("frase"));
  drop(v);
  tidy(&[&dir_a, &dir_b]);
}

#[test]
fn forgetting_the_password_with_a_generated_code_keeps_the_data_key() {
  let (h, dir, fake) = pc("forgot", 1, Some(CODE_A));
  let before = h.vault.lock().unwrap().key_id().unwrap().to_string();
  let r = run("forgot", json!({ "code": CODE_A, "next": "otra contraseña larga", "keep": ["conector/clave"] }), &h, &fake).unwrap();
  assert_eq!(r, json!({ "ok": true, "rotated": false }));
  let mut v = h.vault.lock().unwrap();
  assert_eq!(v.key_id(), Some(before.as_str()));
  assert_eq!(v.get("conector/clave").unwrap(), json!("sk-secreto"));
  drop(v);
  assert_eq!(run("verify", json!({ "password": "otra contraseña larga", "channel": "pc" }), &h, &fake).unwrap()["ok"], json!(true));
  assert!(dir.join(CODE).exists());
  let wrong = run("forgot", json!({ "code": CODE_B, "next": "una tercera larga", "keep": [] }), &h, &fake).unwrap();
  assert_eq!(wrong["reason"], json!("wrong"));
  tidy(&[&dir]);
}

#[test]
fn forgetting_it_with_a_chosen_phrase_makes_a_new_data_key_as_today() {
  let (h, dir, fake) = pc("phrase", 1, None);
  write_copy_wrap(&dir.join("copia-clave.json"), 1, "mi frase de recuperacion");
  let before = h.vault.lock().unwrap().key_id().unwrap().to_string();
  let copy = dir.join("copia-clave.json").display().to_string();
  let wrong = run("forgot", json!({ "code": "otra frase distinta", "copy": copy, "next": "otra contraseña larga", "keep": [] }), &h, &fake).unwrap();
  assert_eq!(wrong["reason"], json!("wrong"));
  let r = run("forgot", json!({ "code": " mi frase de recuperacion ", "copy": copy, "next": "otra contraseña larga", "keep": [] }), &h, &fake).unwrap();
  assert_eq!(r, json!({ "ok": true, "rotated": true }));
  let mut v = h.vault.lock().unwrap();
  assert_ne!(v.key_id(), Some(before.as_str()));
  assert!(!dir.join(CODE).exists());
  assert_eq!(v.get("conector/clave").unwrap(), json!("sk-secreto"), "the vault, not the caller's list, decides what goes on");
  tidy(&[&dir]);
}

#[test]
fn a_3_8_9_code_is_checked_against_the_copy_wrap_and_migrates() {
  let (h, dir, fake) = pc("migrate", 1, None);
  let copy = dir.join("copia-clave.json");
  write_copy_wrap(&copy, 1, CODE_A);
  assert!(!dir.join(CODE).exists());
  let before = h.vault.lock().unwrap().key_id().unwrap().to_string();
  let copy = copy.display().to_string();
  let wrong = run("forgot", json!({ "code": CODE_B, "copy": copy, "next": "otra contraseña larga", "keep": [] }), &h, &fake).unwrap();
  assert_eq!(wrong["reason"], json!("wrong"));
  let r = run("forgot", json!({ "code": CODE_A, "copy": copy, "next": "otra contraseña larga", "keep": [] }), &h, &fake).unwrap();
  assert_eq!(r, json!({ "ok": true, "rotated": false }), "a generated code keeps the data key");
  assert_eq!(h.vault.lock().unwrap().key_id(), Some(before.as_str()));
  assert!(dir.join(CODE).exists(), "and now opens the vault itself");
  tidy(&[&dir]);
}

#[test]
fn with_no_code_at_all_there_is_nothing_to_try() {
  let (h, dir, fake) = pc("nocode", 1, None);
  let r = run("forgot", json!({ "code": CODE_A, "next": "otra contraseña larga", "keep": [] }), &h, &fake).unwrap();
  assert_eq!(r["reason"], json!("noCode"));
  tidy(&[&dir]);
}

#[test]
fn a_new_code_needs_the_password_or_the_old_code_and_a_phrase_is_not_one() {
  let (h, dir, fake) = pc("auth", 1, Some(CODE_A));
  let no_auth = run("codeSet", json!({ "code": CODE_B }), &h, &fake).unwrap();
  assert_eq!(no_auth["reason"], json!("needsAuth"), "a token is no proof");
  let wrong_pw = run("codeSet", json!({ "code": CODE_B, "password": "no es la contraseña" }), &h, &fake).unwrap();
  assert_eq!(wrong_pw["reason"], json!("wrong"));
  let wrong_code = run("codeSet", json!({ "code": CODE_B, "current": CODE_B }), &h, &fake).unwrap();
  assert_eq!(wrong_code["reason"], json!("wrong"));
  assert_eq!(run("codeSet", json!({ "code": "una frase", "password": PASSWORD }), &h, &fake).err(), Some(Code::Phrase));
  // the old code replaces itself: the new one opens, the old one no longer does
  assert_eq!(run("codeSet", json!({ "code": CODE_B, "current": CODE_A }), &h, &fake).unwrap(), json!({ "ok": true, "rekeyed": false }));
  let other = handle(&dir, 1);
  let b = run("codeUnlock", json!({ "code": CODE_B }), &other, &fake).unwrap();
  assert_eq!(b["ok"], json!(true));
  let again = handle(&dir, 9);
  assert_eq!(run("codeUnlock", json!({ "code": CODE_A }), &again, &fake).unwrap()["reason"], json!("wrong"));
  tidy(&[&dir]);
}

#[test]
fn a_new_data_key_needs_the_password_and_makes_the_old_code_useless() {
  let (h, dir, fake) = pc("rekey", 1, Some(CODE_A));
  let old = h.vault.lock().unwrap().key_id().unwrap().to_string();
  h.vault.lock().unwrap().set(&format!("{APPROVE_PREFIX}phone"), json!({ "pub": "x" })).unwrap();
  h.vault.lock().unwrap().set("remote_keys", json!({ "priv": "x" })).unwrap();
  assert_eq!(run("codeSet", json!({ "code": CODE_B, "current": CODE_A, "rekey": true }), &h, &fake).err(), Some(Code::NeedsPassword));
  with_hello(&h, &fake);
  let r = run("codeSet", json!({ "code": CODE_B, "password": PASSWORD, "rekey": true, "keep": ["conector/clave"] }), &h, &fake).unwrap();
  assert_eq!(r, json!({ "ok": true, "rekeyed": true }));
  let mut v = h.vault.lock().unwrap();
  assert_ne!(v.key_id(), Some(old.as_str()));
  assert_eq!(v.get("conector/clave").unwrap(), json!("sk-secreto"));
  assert_eq!(v.get(&format!("{APPROVE_PREFIX}phone")).unwrap(), Value::Null);
  assert_eq!(v.get("remote_keys").unwrap(), Value::Null);
  assert!(v.may_issue, "the window can be given a token again");
  assert_eq!(v.get(crate::hello::HELLO_ID).unwrap(), Value::Null);
  drop(v);
  assert!(fake.accounts.lock().unwrap().is_empty(), "the OS key goes with the old data key");
  assert_eq!(read(&dir, CODE)["keyId"].as_str(), h.vault.lock().unwrap().key_id());
  assert_eq!(read(&dir, MASTER)["keyId"].as_str(), h.vault.lock().unwrap().key_id());
  // the old code and a copy of the vault from before open nothing of the new one
  let fresh = handle(&dir, 9);
  assert_eq!(run("codeUnlock", json!({ "code": CODE_A }), &fresh, &fake).unwrap()["reason"], json!("wrong"));
  assert_eq!(run("codeUnlock", json!({ "code": CODE_B }), &fresh, &fake).unwrap()["ok"], json!(true));
  tidy(&[&dir]);
}

#[test]
fn a_phrase_takes_the_code_s_place() {
  let (h, dir, fake) = pc("drop", 1, Some(CODE_A));
  assert_eq!(run("codeSet", json!({ "drop": true }), &h, &fake).unwrap()["reason"], json!("needsAuth"));
  assert_eq!(run("codeSet", json!({ "drop": true, "password": PASSWORD }), &h, &fake).unwrap(), json!({ "ok": true }));
  assert!(!dir.join(CODE).exists());
  tidy(&[&dir]);
}

#[test]
fn at_the_start_the_wraps_of_another_data_key_go_or_are_set_aside() {
  let (a, dir_a, _) = pc("stale-a", 1, Some(CODE_A));
  let (b, dir_b, _) = pc("stale-b", 1, Some(CODE_B));
  assert_ne!(a.vault.lock().unwrap().key_id(), b.vault.lock().unwrap().key_id());
  // this PC (b) finds a's password wrap and code wrap in its folder
  std::fs::copy(dir_a.join(CODE), dir_b.join(CODE)).unwrap();
  std::fs::copy(dir_a.join(MASTER), dir_b.join(MASTER)).unwrap();
  let restart = handle(&dir_b, 1);
  assert!(restart.vault.lock().unwrap().open_with_machine().unwrap());
  let mut v = restart.vault.lock().unwrap();
  assert!(!dir_b.join(CODE).exists(), "a code wrap of another key is deleted");
  assert!(!dir_b.join(MASTER).exists() && dir_b.join("maestra.json.otra-clave").exists(), "a password wrap of another key is set aside, not deleted");
  assert_eq!(v.stale, vec!["code", "password"]);
  let st = v.state();
  assert_eq!(st["lost"], json!(true), "the lost-password logic is as before");
  drop(v);
  tidy(&[&dir_a, &dir_b]);
}

#[test]
fn a_restore_being_prepared_proves_the_copy_s_code_wrap_or_drops_it() {
  let (a, dir_a, fake) = pc("adopt-a", 1, Some(CODE_A));
  a.vault.lock().unwrap().set(crate::hello::HELLO_ID, json!({ "pub": "x" })).unwrap();
  a.vault.lock().unwrap().set(&format!("{APPROVE_PREFIX}phone"), json!({ "pub": "x" })).unwrap();
  let key_id = a.vault.lock().unwrap().key_id().unwrap().to_string();
  // with the code (a new PC): written again, wrapped for this PC, Hello and approvals gone
  let staged = dir_of("adopt-s");
  copy_files(&dir_a, &staged, &[MASTER, CODE, VAULT]);
  let old_code = read(&staged, CODE);
  let s = handle(&staged, 2);
  let r = run("adopt", json!({ "code": CODE_A }), &s, &fake).unwrap();
  assert_eq!(r["byCode"], json!(true));
  assert_eq!(r["keyId"].as_str(), Some(key_id.as_str()));
  assert_ne!(read(&staged, CODE)["kdf"]["salt"], old_code["kdf"]["salt"], "written again, not copied");
  assert!(staged.join(MACHINE).exists());
  let after = handle(&staged, 2);
  assert!(after.vault.lock().unwrap().open_with_machine().unwrap());
  let mut v = after.vault.lock().unwrap();
  assert_eq!(v.get("conector/clave").unwrap(), json!("sk-secreto"));
  assert_eq!(v.get(crate::hello::HELLO_ID).unwrap(), Value::Null);
  assert_eq!(v.get(&format!("{APPROVE_PREFIX}phone")).unwrap(), Value::Null);
  drop(v);
  // with a phrase or no code: the copy's code wrap is dropped, the rest marked to be cleaned the first time the key opens
  let staged2 = dir_of("adopt-s2");
  copy_files(&dir_a, &staged2, &[MASTER, CODE, VAULT]);
  let s2 = handle(&staged2, 2);
  let r2 = run("adopt", json!({ "code": "una frase que no abre" }), &s2, &fake).unwrap();
  assert_eq!(r2["byCode"], json!(false));
  assert!(!staged2.join(CODE).exists());
  assert!(staged2.join("restaurado.json").exists());
  let pw = handle(&staged2, 2);
  assert_eq!(run("verify", json!({ "password": PASSWORD, "channel": "pc" }), &pw, &fake).unwrap()["ok"], json!(true));
  let mut v = pw.vault.lock().unwrap();
  assert_eq!(v.get(crate::hello::HELLO_ID).unwrap(), Value::Null, "Hello does not come back from a copy");
  assert_eq!(v.get(&format!("{APPROVE_PREFIX}phone")).unwrap(), Value::Null);
  assert!(!staged2.join("restaurado.json").exists());
  drop(v);
  tidy(&[&dir_a, &staged, &staged2]);
}

#[test]
fn reset_takes_the_code_wrap_and_hello_with_it() {
  let (h, dir, fake) = pc("reset", 1, Some(CODE_A));
  with_hello(&h, &fake);
  run("reset", json!({ "next": "otra contraseña larga" }), &h, &fake).unwrap();
  assert!(!dir.join(CODE).exists());
  assert!(!h.vault.lock().unwrap().state()["hasCode"].as_bool().unwrap());
  assert!(fake.accounts.lock().unwrap().is_empty(), "the OS key goes too");
  tidy(&[&dir]);
}

#[test]
fn a_new_data_key_with_the_vault_closed_keeps_the_secrets_and_a_phrase_makes_no_code() {
  let (_a, dir, fake) = pc("rekey-closed", 1, Some(CODE_A));
  let closed = handle(&dir, 9); // another PC's secret: the data key is not open
  assert!(!closed.vault.lock().unwrap().unlocked());
  let r = run("codeSet", json!({ "code": CODE_B, "password": PASSWORD, "rekey": true, "keep": [] }), &closed, &fake).unwrap();
  assert_eq!(r, json!({ "ok": true, "rekeyed": true }));
  assert_eq!(closed.vault.lock().unwrap().get("conector/clave").unwrap(), json!("sk-secreto"), "the vault, not the caller, decides what goes on");
  // a phrase the copies know cannot authorize a code that opens the data key
  write_copy_wrap(&dir.join("copia-clave.json"), 9, "mi frase de recuperacion");
  std::fs::remove_file(dir.join(CODE)).unwrap();
  let copy = dir.join("copia-clave.json").display().to_string();
  let other = handle(&dir, 9);
  other.vault.lock().unwrap().open_with_machine().ok();
  let no = run("codeSet", json!({ "code": CODE_A, "current": "mi frase de recuperacion", "copy": copy }), &closed, &fake).unwrap();
  assert_eq!(no["reason"], json!("wrong"));
  assert!(!dir.join(CODE).exists());
  tidy(&[&dir]);
}

#[test]
fn a_code_replaced_by_an_older_version_does_not_leave_its_wrap_working() {
  let (h, dir, fake) = pc("stale-code", 1, None);
  let copy = dir.join("copia-clave.json");
  write_copy_wrap(&copy, 1, CODE_A);
  let copy_s = copy.display().to_string();
  // a 3.8.10 code: the vault's file goes with the copies' wrap it was made for
  let salt = code::copy_salt(&copy_s).unwrap();
  assert_eq!(run("codeSet", json!({ "code": CODE_A, "password": PASSWORD, "copy": copy_s, "copyId": salt }), &h, &fake).unwrap()["ok"], json!(true));
  assert_eq!(read(&dir, CODE)["copyId"].as_str(), Some(salt.as_str()));
  let right = run("codeUnlock", json!({ "code": CODE_A, "copy": copy_s }), &h, &fake).unwrap();
  assert_eq!(right, json!({ "ok": true }));
  assert!(dir.join(CODE).exists(), "the wrap that goes with the copies' stays");
  // 3.8.9 makes a new code: only copia-clave.json changes
  write_copy_wrap(&copy, 1, CODE_B);
  let old = run("codeUnlock", json!({ "code": CODE_A, "copy": copy_s }), &h, &fake).unwrap();
  assert_eq!(old["reason"], json!("wrong"), "the old code no longer opens anything");
  assert!(!dir.join(CODE).exists(), "its wrap is dropped");
  let new = run("codeUnlock", json!({ "code": CODE_B, "copy": copy_s }), &h, &fake).unwrap();
  assert_eq!(new, json!({ "ok": true }), "the copies' wrap decides");
  assert_eq!(read(&dir, CODE)["copyId"], read(&dir.clone(), "copia-clave.json")["kdf"]["salt"], "and the code file is written again for it");
  tidy(&[&dir]);
}

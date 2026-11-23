// What the recovery code does in the vault (the jobs the engine polls: scrypt runs without the vault held):
//   codeUnlock  the code opens the data key (a PC that cannot open it by itself, the lock screen)
//   forgot      «He olvidado la contraseña»: the code proves it; a generated one keeps the data key
//   codeSet     a new generated code (or a phrase that takes the code's place), asked for with the password or the old code
//   adopt       a restore being prepared: the copy's code wrap is proved with the code and written again, or dropped
// The code and every key made from it stay here; the answers say only whether it was right.
use crate::crypto::{self, unb64};
use crate::hello::{self, Hello};
use crate::locked::Locked;
use crate::server::{checked, password, s, verify, wrap, Handle};
use crate::vault::{code, Code, Tried};
use serde_json::{json, Value};

type Answer = Result<Value, Code>;

pub(crate) enum Source {
  /// maestra-codigo.json opened (the data key, when this PC could not open it already).
  Vault(Option<Locked>),
  /// Only the copies' recovery wrap (copia-clave.json) knew it.
  Copy,
}
pub(crate) struct Proved {
  pub source: Source,
  /// The code as the vault uses it (normalized).
  pub code: String,
  pub generated: bool,
}

/// The copies' recovery wrap, opened with this PC's backup key: its cost and the wrapped key (src/domain/data/backup.mjs › setRecovery).
fn recovery_of(path: &str, bkey: &Locked) -> Option<(Value, Locked)> {
  let raw: Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
  let kdf = raw.get("kdf")?.clone();
  let kek = crypto::unseal(bkey.as_slice(), raw.get("kek")?.as_str()?, "orbbak:recovery")?;
  Some((kdf, kek))
}

/// One try of a code on a channel, with the waits of the vault. Ok(Err(answer)): refused or wrong; Ok(Ok(proof)): it is right.
pub(crate) fn check_code(h: &Handle, typed: &str, copy: &str, channel: &str, now: u64) -> Result<Result<Proved, Value>, Code> {
  let (normal, generated) = code::normalize(typed);
  let (file, bkey) = {
    let v = h.vault.lock().unwrap();
    (v.code_file().and_then(|m| v.code_kdf(&m).map(|k| (m, k))), v.backup_key())
  };
  let rec = if file.is_none() { bkey.as_ref().and_then(|b| recovery_of(copy, b)) } else { None };
  if file.is_none() && rec.is_none() {
    return Ok(Err(json!({ "ok": false, "reason": "noCode" })));
  }
  if let Some(refusal) = h.vault.lock().unwrap().begin_try(channel, now) {
    return Ok(Err(refusal.to_json()));
  }
  let sane = !normal.is_empty() && typed.chars().count() <= 200;
  let mut key = None;
  let ok = match (&file, &rec) {
    (Some((m, kdf)), _) => {
      if sane && generated {
        if let Some(kek) = code::kek_of(&normal, kdf) {
          key = h.vault.lock().unwrap().key_for_code(m, kek.as_slice());
        }
      }
      key.is_some()
    }
    (None, Some((kdf, want))) => {
      let n = kdf.get("N").and_then(Value::as_u64);
      let salt = kdf.get("salt").and_then(Value::as_str).and_then(unb64);
      let plausible = matches!(n, Some(n) if n >= 2 && n <= 1 << 20 && n.is_power_of_two()) && kdf.get("r").and_then(Value::as_u64) == Some(8) && kdf.get("p").and_then(Value::as_u64) == Some(1);
      match (sane && plausible, salt) {
        (true, Some(salt)) => crypto::scrypt(normal.as_bytes(), &salt, n.unwrap_or(0), 8, 1).is_some_and(|kek| crypto::same(kek.as_slice(), want.as_slice())),
        _ => false,
      }
    }
    _ => false,
  };
  let tried = h.vault.lock().unwrap().end_try(channel, ok, now);
  if tried != Tried::Ok {
    return Ok(Err(tried.to_json()));
  }
  Ok(Ok(Proved { source: if file.is_some() { Source::Vault(key) } else { Source::Copy }, code: normal, generated }))
}

/// A generated code only the copies' wrap knew (a 3.8.9 code) now also opens the vault: maestra-codigo.json is written.
fn migrate(h: &Handle, p: &Proved, now: u64) -> Result<(), Code> {
  if !p.generated || !h.vault.lock().unwrap().unlocked() {
    return Ok(());
  }
  write_code(h, &p.code, now)
}
/// maestra-codigo.json for the open data key (the scrypt without the vault held).
fn write_code(h: &Handle, code_text: &str, now: u64) -> Result<(), Code> {
  let kdf = h.vault.lock().unwrap().new_code_kdf();
  let kek = code::kek_of(code_text, &kdf).ok_or(Code::Damaged)?;
  h.vault.lock().unwrap().put_code(&kek, kdf, now)
}

pub(crate) fn unlock(req: &Value, h: &Handle, now: u64) -> Answer {
  match check_code(h, s(req, "code"), s(req, "copy"), "recovery", now)? {
    Err(answer) => Ok(answer),
    Ok(p) => {
      match p.source {
        Source::Vault(Some(key)) => h.vault.lock().unwrap().open_with_code(key),
        Source::Vault(None) => {}
        Source::Copy => {
          // The copies' wrap proves the code but opens nothing here: with the data key closed there is nothing to unlock.
          if !h.vault.lock().unwrap().unlocked() {
            return Ok(json!({ "ok": false, "reason": "noKey" }));
          }
          migrate(h, &p, now)?;
        }
      }
      let mut v = h.vault.lock().unwrap();
      if !v.unlocked() {
        return Ok(json!({ "ok": false, "reason": "noKey" }));
      }
      v.may_issue = true;
      Ok(json!({ "ok": true }))
    }
  }
}

/// «He olvidado la contraseña». A generated code opens the data key and wraps it with the new password (no new data key,
/// no phone unlinked); a phrase the user chose proves the owner as it always did and the data key is new.
pub(crate) fn forgot(req: &Value, h: &Handle, hello: &dyn Hello, now: u64) -> Answer {
  let next = password(req, "next");
  checked(&next)?;
  let proved = match check_code(h, s(req, "code"), s(req, "copy"), "recovery", now)? {
    Err(answer) => return Ok(answer),
    Ok(p) => p,
  };
  let rotate = match &proved.source {
    Source::Vault(key) => {
      if let Some(k) = key {
        // Cloned out of the proof: open_with_code keeps the one it is handed.
        h.vault.lock().unwrap().open_with_code(Locked::from_slice(k.as_slice()));
      }
      false
    }
    Source::Copy if proved.generated => {
      if !h.vault.lock().unwrap().unlocked() {
        return Err(Code::Locked);
      }
      migrate(h, &proved, now)?;
      false
    }
    Source::Copy => true,
  };
  let old_hello;
  {
    let mut v = h.vault.lock().unwrap();
    if !v.unlocked() {
      return Err(Code::Locked);
    }
    old_hello = if rotate { hello::account(&mut v) } else { None };
    if rotate {
      let keep: Vec<String> = req.get("keep").and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
      v.rotate(&keep)?;
    }
  }
  if let Some(a) = old_hello {
    hello.delete(&a);
  }
  wrap(h, &next, None, now)?;
  let mut v = h.vault.lock().unwrap();
  v.clear_tries();
  v.lock();
  v.may_issue = true;
  Ok(json!({ "ok": true, "rotated": rotate }))
}

/// A new generated code, or a phrase in its place (`drop`). Asked for with the password or the current code, both
/// checked here. `rekey` also makes a new data key (every wrap rewritten, Hello and the approvals gone): that needs the
/// password itself, because maestra.json is wrapped again with it.
pub(crate) fn set(req: &Value, h: &Handle, hello: &dyn Hello, now: u64) -> Answer {
  let drop = req.get("drop") == Some(&json!(true));
  let rekey = !drop && req.get("rekey") == Some(&json!(true));
  let new_code = code::normalize(s(req, "code"));
  if !drop && !new_code.1 {
    return Err(Code::Phrase);
  }
  let with_password = !s(req, "password").is_empty();
  if with_password {
    let r = verify(h, &password(req, "password"), "pc", now)?;
    if r.get("ok") != Some(&json!(true)) {
      return Ok(r);
    }
  } else if !s(req, "current").is_empty() {
    if rekey {
      return Err(Code::NeedsPassword);
    }
    match check_code(h, s(req, "current"), s(req, "copy"), "recovery", now)? {
      Err(answer) => return Ok(answer),
      Ok(p) => {
        if let Source::Vault(Some(k)) = p.source {
          h.vault.lock().unwrap().open_with_code(k);
        } else {
          migrate(h, &p, now)?;
        }
      }
    }
  } else {
    return Ok(json!({ "ok": false, "reason": "needsAuth" }));
  }
  if !h.vault.lock().unwrap().unlocked() {
    return Err(Code::Locked);
  }
  if drop {
    h.vault.lock().unwrap().drop_code();
    return Ok(json!({ "ok": true }));
  }
  if rekey {
    if !with_password {
      return Err(Code::NeedsPassword);
    }
    let (old_hello, created) = {
      let mut v = h.vault.lock().unwrap();
      let old = hello::account(&mut v);
      let keep: Vec<String> = req.get("keep").and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
      let created = v.master_file().and_then(|m| m.get("created").and_then(Value::as_str).map(String::from));
      v.rotate(&keep)?;
      (old, created)
    };
    if let Some(a) = old_hello {
      hello.delete(&a);
    }
    wrap(h, &password(req, "password"), created, now)?;
    write_code(h, &new_code.0, now)?;
    let mut v = h.vault.lock().unwrap();
    v.lock();
    v.may_issue = true;
    return Ok(json!({ "ok": true, "rekeyed": true }));
  }
  write_code(h, &new_code.0, now)?;
  Ok(json!({ "ok": true, "rekeyed": false }))
}

/// A restore being prepared (the handle is the staged folder, never the one in use): what that copy's code wrap and
/// Hello entries may bring. A right code opens the copy's data key, the code wrap is written again for it, this PC wraps
/// it for itself and what the copy says about Hello and approvals goes. Without the code the copy's wrap is dropped, and
/// what only the data key can reach is marked to go the first time the key opens here.
pub(crate) fn adopt(req: &Value, h: &Handle, now: u64) -> Answer {
  let (normal, generated) = code::normalize(s(req, "code"));
  let file = {
    let v = h.vault.lock().unwrap();
    v.code_file().and_then(|m| v.code_kdf(&m).map(|k| (m, k)))
  };
  let mut key = None;
  if let (Some((m, kdf)), true, false) = (&file, generated, normal.is_empty()) {
    if let Some(kek) = code::kek_of(&normal, kdf) {
      key = h.vault.lock().unwrap().key_for_code(m, kek.as_slice());
    }
  }
  let by_code = key.is_some();
  {
    let mut v = h.vault.lock().unwrap();
    if let Some(k) = key {
      v.open_with_code(k);
      v.forget_unproven();
    } else {
      v.drop_restored_code();
      if v.open_existing_machine() {
        v.forget_unproven();
      } else {
        v.mark_restored();
      }
    }
  }
  if by_code {
    write_code(h, &normal, now)?;
  }
  let v = h.vault.lock().unwrap();
  Ok(json!({ "ok": true, "byCode": by_code, "keyId": v.key_id() }))
}

#[cfg(test)]
#[path = "code_tests.rs"]
mod tests;

// The generated recovery code opens the data key (maestra-codigo.json), next to the password's wrap (maestra.json):
//   { v: 1, keyId, kdf: { alg: "scrypt", N, r: 8, p: 1, salt }, check, wrapped, created }
//   KEK_vault = HKDF-SHA256(scrypt(code, salt), info "orb-vault-code-v1"); wrapped = seal(KEK_vault, data key) whose
//   additional data names the whole header (keyId, cost, salt, date), so no part of it can be swapped.
// Only a code Orb generated (32 characters, 160 bits) wraps the data key: a phrase the user chose is weak against an
// offline guess and stays good for the backups only. The code is typed into the engine and handed here; the data key
// never leaves.
use super::*;

/// Characters that count as white space for a typed code (JavaScript's `\s` and `trim()`).
fn is_space(c: char) -> bool {
  matches!(c, '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}
/// The part of NFKC that matters for a code: full-width ASCII (U+FF01..U+FF5E) and the spaces. The engine sends the text
/// already normalized (backup.mjs › normalizePassphrase), so this only guards a direct caller.
fn fold(c: char) -> char {
  match c {
    '\u{ff01}'..='\u{ff5e}' => char::from_u32(c as u32 - 0xfee0).unwrap_or(c),
    c if is_space(c) => ' ',
    c => c,
  }
}

/// What a code typed with or without dashes and spaces, in any case, becomes: its 32 characters in upper case when it
/// has the form of a generated one (→ true), anything else as written (NFKC, trimmed → false). The same result as
/// src/domain/data/backup.mjs › normalizePassphrase (test/fixtures/recovery-code-vectors.json holds both's cases).
pub fn normalize(text: &str) -> (String, bool) {
  let folded: String = text.chars().map(fold).collect();
  let s = folded.trim_matches(' ');
  let compact: String = s.chars().filter(|c| *c != ' ' && *c != '-').map(|c| c.to_ascii_uppercase()).collect();
  let in_alphabet = |c: char| c.is_ascii_uppercase() || ('2'..='9').contains(&c);
  let shape = compact.chars().count() == 32 && compact.chars().all(in_alphabet);
  let source = !s.is_empty() && s.chars().all(|c| c.is_ascii_alphabetic() || ('2'..='9').contains(&c) || c == ' ' || c == '-');
  if shape && source {
    (compact, true)
  } else {
    (s.to_string(), false)
  }
}

fn aad_code(m: &Value) -> Option<String> {
  let k = m.get("kdf")?;
  Some(format!(
    "orb-master:code|v{}|{}|{}|{}|{}|{}|{}|{}",
    m.get("v")?.as_u64()?,
    str_of(m, "keyId")?,
    str_of(k, "alg")?,
    k.get("N")?.as_u64()?,
    k.get("r")?.as_u64()?,
    k.get("p")?.as_u64()?,
    str_of(k, "salt")?,
    str_of(m, "created")?
  ))
}

/// The cost of maestra-codigo.json: never cheaper than a new one (a planted file cannot make it cheap), never a hang.
fn code_kdf_ok(kdf: &Value, costs: Costs) -> bool {
  let n = kdf.get("N").and_then(Value::as_u64);
  let salt = kdf.get("salt").and_then(Value::as_str).and_then(unb64);
  str_of(kdf, "alg") == Some("scrypt")
    && matches!(n, Some(n) if n >= costs.kdf().0 && n <= 1 << 20 && n.is_power_of_two())
    && kdf.get("r").and_then(Value::as_u64) == Some(8)
    && kdf.get("p").and_then(Value::as_u64) == Some(1)
    && salt.is_some_and(|s| s.len() == 16)
}

/// scrypt then HKDF of a generated code with a file's cost (the slow part: the caller holds no vault meanwhile).
pub fn kek_of(code: &str, kdf: &Value) -> Option<Locked> {
  let salt = unb64(str_of(kdf, "salt")?)?;
  let raw = crypto::scrypt(code.as_bytes(), &salt, kdf.get("N")?.as_u64()?, 8, 1)?;
  Some(crypto::code_kek(raw.as_slice()))
}

impl Vault {
  pub fn code_file(&self) -> Option<Value> {
    read_json(&self.file(CODE)).filter(|m| wrapped(&Some(m.clone())).is_some())
  }
  pub fn has_code(&self) -> bool {
    self.code_file().is_some()
  }
  /// The cost and salt of a new maestra-codigo.json.
  pub fn new_code_kdf(&self) -> Value {
    let (n, r, p) = self.costs.kdf();
    json!({ "alg": "scrypt", "N": n, "r": r, "p": p, "salt": b64(crypto::random(16).as_slice()) })
  }
  /// The kdf of the code file read before scrypt, when it is one this vault accepts.
  pub fn code_kdf(&self, m: &Value) -> Option<Value> {
    let k = m.get("kdf")?;
    (code_kdf_ok(k, self.costs) && aad_code(m).is_some()).then(|| k.clone())
  }
  /// THE data key from a code's KEK (maestra-codigo.json read before scrypt), or None.
  pub fn key_for_code(&self, m: &Value, kek: &[u8]) -> Option<Locked> {
    let key_id = str_of(m, "keyId")?;
    let check = unb64(str_of(m, "check").unwrap_or_default())?;
    if !crypto::same(&check, &crypto::check_of(kek)) {
      return None;
    }
    let key = crypto::unseal(kek, str_of(m, "wrapped")?, &aad_code(m)?)?;
    self.accept_key(key, key_id)
  }
  /// Writes maestra-codigo.json for the open data key from a KEK made by the caller.
  pub fn put_code(&mut self, kek: &Locked, kdf: Value, now: u64) -> Result<(), Code> {
    let (dek, key_id) = (self.dek.as_ref().ok_or(Code::Locked)?, self.key_id.clone().unwrap_or_default());
    let mut file = json!({ "v": 1, "keyId": key_id, "kdf": kdf, "check": b64(&crypto::check_of(kek.as_slice())), "created": iso(now) });
    let w = crypto::seal(kek.as_slice(), dek.as_slice(), &aad_code(&file).ok_or(Code::Damaged)?);
    file["wrapped"] = json!(w);
    write_json(&self.file(CODE), &file).map_err(|_| Code::Damaged)?;
    self.changed = true;
    Ok(())
  }
  pub fn drop_code(&mut self) {
    if std::fs::remove_file(self.file(CODE)).is_ok() {
      self.changed = true;
    }
  }

  /// With the data key open: what was wrapped for another data key does not count here. A code wrap of another key goes; a
  /// password wrap of another key is only set aside (.otra-clave), so «lost password» keeps working as it does today.
  pub(super) fn purge_stale(&mut self) {
    let Some(key_id) = self.key_id.clone() else { return };
    if read_json(&self.file(CODE)).is_some_and(|m| str_of(&m, "keyId") != Some(key_id.as_str())) {
      let _ = std::fs::remove_file(self.file(CODE));
      self.stale.push("code");
      self.changed = true;
    }
    if read_json(&self.file(MASTER)).is_some_and(|m| str_of(&m, "keyId").is_some_and(|k| k != key_id)) {
      let aside = (0..100).map(|i| self.file(&if i == 0 { format!("{MASTER}.otra-clave") } else { format!("{MASTER}.otra-clave-{i}") })).find(|p| !p.exists());
      if let Some(to) = aside {
        let _ = std::fs::rename(self.file(MASTER), to);
        self.stale.push("password");
        self.changed = true;
      }
    }
    if self.file(RESTORED).exists() {
      self.forget_unproven();
      let _ = std::fs::remove_file(self.file(RESTORED));
    }
  }
  /// Hello's key and the approvals a restored copy carried: the copy is not what enabled them.
  pub fn forget_unproven(&mut self) {
    let Ok(mut items) = self.items() else { return };
    let before = items.0.len();
    items.0.retain(|id, _| id != crate::hello::HELLO_ID && !id.starts_with(APPROVE_PREFIX));
    if items.0.len() != before {
      let _ = self.write_items(&items.0);
    }
  }
  /// A restored folder whose data key could not be opened here: the mark that drops the same things at its first open.
  pub fn mark_restored(&self) {
    let _ = write_json(&self.file(RESTORED), &json!({ "v": 1 }));
  }
  pub fn drop_restored_code(&self) {
    let _ = std::fs::remove_file(self.file(CODE));
  }
  /// A data key opened by a code (this PC had none open): from now on this PC opens it by itself.
  pub fn open_with_code(&mut self, key: Locked) {
    if self.dek.is_none() {
      self.use_key(key);
      self.had_machine = true;
      self.seal_for_machine();
      self.purge_stale();
    }
  }
  /// The machine's wrap of a folder that is not in use (a restore being prepared): opens only what is already there.
  pub fn open_existing_machine(&mut self) -> bool {
    if !self.file(VAULT).exists() && !self.file(MACHINE).exists() {
      return false;
    }
    self.open_with_machine().unwrap_or(false)
  }
  /// This PC's backup key (the copies' recovery wrap is sealed with it), or None when no secret is held.
  pub fn backup_key(&self) -> Option<Locked> {
    self.secret.as_ref().map(|s| crypto::backup_key(s.as_slice()))
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn normalization_vectors_are_the_same_as_node_s() {
    let v: Value = serde_json::from_str(include_str!("../../../../test/fixtures/recovery-code-vectors.json")).unwrap();
    for c in v["cases"].as_array().unwrap() {
      let input = c["in"].as_str().unwrap();
      let (out, generated) = normalize(input);
      assert_eq!(out, c["out"].as_str().unwrap(), "{input:?}");
      assert_eq!(generated, c["generated"].as_bool().unwrap(), "{input:?}");
    }
  }
}

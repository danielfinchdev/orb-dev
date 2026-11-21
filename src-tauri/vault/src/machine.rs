// This PC's secret (3.8.1, decision 20 d): what signs the approvals, wraps this PC's backups and wraps the data key for
// this PC (maestra-pc.json). It is opened here and stays here: the engine only gets the keys made from it
// (crypto::approval_key, crypto::backup_key). Sealed by Windows for this user (DPAPI) as ORB2 in core\datos\clave2.enc and
// in its copy outside the workspace (<app data>\claves\<key>.v2.enc), which brings core's back when core was deleted.
//
// Orb 3.8.0's key files (clave.enc and claves\<key>.enc, Electron's v10) are not read any more (the owner started from
// scratch): when only they are there, the start stops with Failure::Old and the window offers a new key; nothing is
// deleted. Never a new secret on its own: a key that cannot be read now stops the start (Busy: try again); sealed keys
// that none opens are the user's call (Unreadable: try again, or allow_new).
//
// Every write: a temporary file of its own, flushed to disk, then renamed over the old one (the file always exists and is
// whole); what is replaced is copied aside first. A lock (clave.lock) keeps two starts from doing it at once.
use crate::crypto;
use crate::locked::Locked;
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const ORB2: &[u8] = b"ORB2";
const ENTROPY: &[u8] = b"orb.clave.v2";
const MAX_BLOB: usize = 16 * 1024;
/// After «Empezar con una clave nueva»: the sealed keys that did not open then. When Windows opens one of them again the
/// user is offered to go back to it (Ajustes › Datos writes BACK_FILE: src/engine/api/data.mjs › backup.previousKey).
pub const PREVIOUS_FILE: &str = "clave-anterior.json";
pub const BACK_FILE: &str = "clave-volver.json";
/// A new key on purpose while this one opens (Ajustes › Datos writes it: src/engine/api/data.mjs › backup.newKey); used once.
pub const NEW_FILE: &str = "clave-nueva.json";

/// How this PC's secret is sealed: Windows' DPAPI in Orb.exe, a fake in the tests' vault.
pub trait Sealer: Send + Sync {
  /// ORB2 + the sealed text.
  fn seal(&self, text: &[u8]) -> Result<Vec<u8>, String>;
  /// The text of an ORB2 blob. Err: "io" is for now (try again); anything else is how the key is.
  fn unseal(&self, blob: &[u8]) -> Result<Locked, &'static str>;
}

pub struct Dpapi;
impl Sealer for Dpapi {
  fn seal(&self, text: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = ORB2.to_vec();
    out.extend(crate::dpapi::protect(text, ENTROPY)?);
    Ok(out)
  }
  fn unseal(&self, blob: &[u8]) -> Result<Locked, &'static str> {
    let rest = blob.strip_prefix(ORB2).ok_or("format")?;
    crate::dpapi::unprotect(rest, ENTROPY).map_err(|_| "dpapi")
  }
}

/// The tests' sealing (orb-vault --test only, never Orb.exe): ORB2 + the text in clear. A test's knobs (the request's
/// `fake`): unsealError (every unseal fails with that code), seal: "wrong" (a blob that opens to another text) or "fail",
/// delayMs (each unseal waits).
#[derive(Default, Clone)]
pub struct Fake {
  pub unseal_error: Option<&'static str>,
  pub seal: Option<&'static str>,
  pub delay_ms: u64,
}
impl Fake {
  pub fn from_json(v: Option<&Value>) -> Self {
    let code = |k: &str| match v.and_then(|v| v.get(k)).and_then(Value::as_str) {
      Some("io") => Some("io"),
      Some("dpapi") => Some("dpapi"),
      Some("format") => Some("format"),
      Some("wrong") => Some("wrong"),
      Some("fail") => Some("fail"),
      _ => None,
    };
    Fake { unseal_error: code("unsealError"), seal: code("seal"), delay_ms: v.and_then(|v| v.get("delayMs")).and_then(Value::as_u64).unwrap_or(0).min(5000) }
  }
}
impl Sealer for Fake {
  fn seal(&self, text: &[u8]) -> Result<Vec<u8>, String> {
    match self.seal {
      Some("fail") => Err("DPAPI".into()),
      Some("wrong") => Ok([ORB2, &[b'f'; 64][..]].concat()),
      _ => Ok([ORB2, text].concat()),
    }
  }
  fn unseal(&self, blob: &[u8]) -> Result<Locked, &'static str> {
    if self.delay_ms > 0 {
      std::thread::sleep(Duration::from_millis(self.delay_ms));
    }
    if let Some(code) = self.unseal_error {
      return Err(code);
    }
    blob.strip_prefix(ORB2).map(Locked::from_slice).ok_or("format")
  }
}

/// Why the secret could not be opened, for the engine (src/engine/engine.mjs › secretFromApp).
#[derive(Debug, PartialEq)]
pub enum Failure {
  Busy(String),
  Unreadable(String),
  Old(String),
}
impl Failure {
  pub fn code(&self) -> &'static str {
    match self {
      Failure::Busy(_) => "busy",
      Failure::Unreadable(_) => "unreadable",
      Failure::Old(_) => "old",
    }
  }
  pub fn detail(&self) -> &str {
    match self {
      Failure::Busy(d) | Failure::Unreadable(d) | Failure::Old(d) => d,
    }
  }
}

pub struct Opened {
  /// The 32 bytes of this PC's secret.
  pub secret: Locked,
  /// What the user should know: (code, detail). previousOpens, previousQuiet, newAvailable, previousBack, previousNew,
  /// previousFailed (src/engine/engine.mjs › KEY_NOTICES).
  pub warns: Vec<(&'static str, String)>,
}

enum Open {
  Absent,
  Busy(String),
  Bad(String),
  /// The secret's text: 64 lower-case hex characters.
  Hex(Locked),
}
impl Open {
  fn hex(&self) -> Option<&[u8]> {
    match self {
      Open::Hex(h) => Some(h.as_slice()),
      _ => None,
    }
  }
}

fn is_hex64(t: &[u8]) -> bool {
  t.len() == 64 && t.iter().all(|c| matches!(c, b'0'..=b'9' | b'a'..=b'f'))
}
fn same(a: Option<&[u8]>, b: &[u8]) -> bool {
  a.is_some_and(|a| crypto::same(a, b))
}
fn name(f: &Path) -> String {
  f.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

fn try_open(file: &Path, s: &dyn Sealer) -> Open {
  let mut bytes = match fs::read(file) {
    Ok(b) => b,
    Err(e) if matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory) => return Open::Absent,
    Err(e) => return Open::Busy(format!("{:?}", e.kind())),
  };
  let r = if bytes.len() > MAX_BLOB {
    Open::Bad("format".into())
  } else {
    match s.unseal(&bytes) {
      Ok(t) if is_hex64(t.as_slice()) => Open::Hex(t),
      Ok(_) => Open::Bad("text".into()),
      Err("io") => Open::Busy("io".into()),
      Err(code) => Open::Bad(code.into()),
    }
  };
  zeroize::Zeroize::zeroize(&mut bytes);
  r
}

/// What each file opened to, each file opened once.
struct Seen<'a> {
  s: &'a dyn Sealer,
  files: Vec<(PathBuf, Open)>,
}
impl Seen<'_> {
  fn get(&mut self, f: &Path) -> &Open {
    if let Some(i) = self.files.iter().position(|(p, _)| p == f) {
      return &self.files[i].1;
    }
    let r = try_open(f, self.s);
    self.files.push((f.to_path_buf(), r));
    &self.files.last().unwrap().1
  }
}

// ---- files

fn rand_hex(n: usize) -> String {
  crypto::hex_of(crypto::random(n).as_slice()).as_str().unwrap_or_default().to_string()
}
/// Now in UTC: (year, month, day, hour, minute, second, millisecond).
fn utc_now() -> (i64, u32, u32, u64, u64, u64, u32) {
  let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
  let secs = d.as_secs();
  let z = (secs / 86_400) as i64 + 719_468;
  let era = z.div_euclid(146_097);
  let doe = z.rem_euclid(146_097);
  let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
  let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  let mp = (5 * doy + 2) / 153;
  let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
  let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
  let year = yoe + era * 400 + i64::from(month <= 2);
  let sod = secs % 86_400;
  (year, month, day, sod / 3600, sod / 60 % 60, sod % 60, d.subsec_millis())
}
fn iso_now() -> String {
  let (y, mo, d, h, mi, s, ms) = utc_now();
  format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{ms:03}Z")
}
/// Milliseconds and a random tail: two files set aside in the same second never overwrite each other.
fn stamp() -> String {
  let (y, mo, d, h, mi, s, ms) = utc_now();
  format!("{y:04}{mo:02}{d:02}T{h:02}{mi:02}{s:02}{ms:03}Z{}", rand_hex(2))
}
fn aside(file: &Path, label: &str) -> PathBuf {
  let n = name(file);
  let base = n.strip_suffix(".enc").unwrap_or(&n);
  let label = if label.is_empty() { String::new() } else { format!(".{label}") };
  file.with_file_name(format!("{base}.{}{label}.enc", stamp()))
}
fn tmp_of(file: &Path) -> PathBuf {
  PathBuf::from(format!("{}.{}-{}.tmp", file.display(), std::process::id(), rand_hex(4)))
}
fn write_new(file: &Path, bytes: &[u8]) -> std::io::Result<()> {
  let mut f = fs::OpenOptions::new().write(true).create_new(true).open(file)?;
  f.write_all(bytes)?;
  f.sync_all()
}
/// Written to a temporary file of its own, flushed (a power cut never leaves an empty key) and renamed over the file.
fn write_whole(file: &Path, bytes: &[u8]) -> std::io::Result<()> {
  if let Some(dir) = file.parent() {
    fs::create_dir_all(dir)?;
  }
  let tmp = tmp_of(file);
  write_new(&tmp, bytes).and_then(|_| fs::rename(&tmp, file)).inspect_err(|_| {
    let _ = fs::remove_file(&tmp);
  })
}
/// A copy kept aside before the file is replaced (never moved: the old one stays in place until the new one is there).
fn keep_aside(file: &Path, label: &str) -> std::io::Result<PathBuf> {
  let to = aside(file, label);
  write_new(&to, &fs::read(file)?)?;
  Ok(to)
}

/// One app at a time around the key files. On Windows a handle open with no sharing: nobody else can open, rename or
/// delete the file while it is held, and Windows lets it go when the app ends, however it ends. Elsewhere, a file made
/// with create_new and taken over when older than 30 s.
struct Lock {
  file: PathBuf,
  handle: Option<fs::File>,
}
enum Taken {
  Yes(fs::File),
  Later,
  Never,
}
#[cfg(windows)]
fn take(file: &Path) -> Taken {
  use std::os::windows::fs::OpenOptionsExt;
  match fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).share_mode(0).open(file) {
    Ok(f) => Taken::Yes(f),
    Err(e) if matches!(e.raw_os_error(), Some(5 | 32 | 33)) => Taken::Later,
    Err(_) => Taken::Never,
  }
}
#[cfg(not(windows))]
fn take(file: &Path) -> Taken {
  match fs::OpenOptions::new().write(true).create_new(true).open(file) {
    Ok(f) => Taken::Yes(f),
    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
      let old = fs::metadata(file).and_then(|m| m.modified()).ok().and_then(|m| m.elapsed().ok()).is_some_and(|age| age > Duration::from_secs(30));
      if old {
        // Taken over atomically: only one of two apps that both see an old lock renames it away.
        let gone = PathBuf::from(format!("{}.{}-{}.old", file.display(), std::process::id(), rand_hex(4)));
        if fs::rename(file, &gone).is_ok() {
          let _ = fs::remove_file(&gone);
        }
      }
      Taken::Later
    }
    Err(_) => Taken::Never,
  }
}
impl Lock {
  fn get(dir: &Path, wait: Duration) -> Option<Lock> {
    let _ = fs::create_dir_all(dir);
    let file = dir.join("clave.lock");
    let end = Instant::now() + wait;
    loop {
      match take(&file) {
        Taken::Yes(mut f) => {
          let _ = f.set_len(0).and_then(|_| write!(f, "{}", std::process::id()));
          return Some(Lock { file, handle: Some(f) });
        }
        Taken::Never => return None,
        Taken::Later if Instant::now() > end => return None,
        Taken::Later => std::thread::sleep(Duration::from_millis(100)),
      }
    }
  }
}
impl Drop for Lock {
  fn drop(&mut self) {
    // Elsewhere removed while still open (no one else can have it); on Windows a file open with no sharing cannot be
    // deleted, so it goes right after the close (if another app took it in between, its handle keeps it).
    if cfg!(not(windows)) {
      let _ = fs::remove_file(&self.file);
    }
    drop(self.handle.take());
    if cfg!(windows) {
      let _ = fs::remove_file(&self.file);
    }
  }
}

/// A write cut before its rename (the first one of that file): a temporary that opens takes its place, but only when it
/// holds the secret the other sealed file opens to (or that one does not open).
fn adopt_tmp(file: &Path, s: &dyn Sealer, other: &Path) {
  if file.exists() {
    return;
  }
  let (Some(dir), base) = (file.parent(), format!("{}.", name(file))) else { return };
  let Ok(entries) = fs::read_dir(dir) else { return };
  let mut tmps: Vec<(SystemTime, PathBuf)> = entries
    .filter_map(Result::ok)
    .filter(|e| e.file_name().to_str().is_some_and(|n| n.starts_with(&base) && n.ends_with(".tmp")))
    .map(|e| (e.metadata().and_then(|m| m.modified()).unwrap_or(UNIX_EPOCH), e.path()))
    .collect();
  tmps.sort_by(|a, b| b.0.cmp(&a.0));
  let mut agreed: Option<Open> = None;
  for (_, tmp) in tmps {
    let Open::Hex(hex) = try_open(&tmp, s) else { continue };
    let other = agreed.get_or_insert_with(|| try_open(other, s));
    if other.hex().is_some_and(|o| !crypto::same(o, hex.as_slice())) {
      continue;
    }
    let _ = fs::rename(&tmp, file);
    return;
  }
}

/// The way back after «Empezar con una clave nueva» (PREVIOUS_FILE), and the way back from it (review D10 M6): going
/// back keeps the key in use aside and writes PREVIOUS_FILE again pointing at it ({ back: true }), so Ajustes › Datos can
/// offer «Volver a la clave nueva» quietly. → the secret's text to use now.
fn previous_key(dir: &Path, files: [&Path; 2], hex: Locked, s: &dyn Sealer, warns: &mut Vec<(&'static str, String)>) -> Locked {
  let record = dir.join(PREVIOUS_FILE);
  let back = dir.join(BACK_FILE);
  let Some(saved) = fs::read(&record).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else {
    let _ = fs::remove_file(&back);
    return hex;
  };
  let listed: Vec<PathBuf> = saved.get("files").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(PathBuf::from).collect()).unwrap_or_default();
  let to_new = saved.get("back") == Some(&json!(true));
  if !listed.iter().any(|f| f.exists()) {
    let _ = fs::remove_file(&record);
    let _ = fs::remove_file(&back);
    return hex;
  }
  // The most recent listed key that opens and is not the one in use. A file that is busy right now (not unreadable, not
  // gone) stops the search: going on to an older key behind its back could switch to the wrong one without a word.
  let mut found: Option<(Locked, &PathBuf)> = None;
  let mut busy = false;
  for f in &listed {
    match try_open(f, s) {
      Open::Hex(h) if !crypto::same(h.as_slice(), hex.as_slice()) => {
        found = Some((h, f));
        break;
      }
      Open::Busy(_) => {
        busy = true;
        break;
      }
      _ => {}
    }
  }
  if busy {
    if back.exists() {
      warns.push(("previousFailed", "clave ocupada".into()));
    }
    return hex;
  }
  let Some((old, chosen)) = found else {
    let _ = fs::remove_file(&back);
    return hex;
  };
  // A way back the user made by going one way is offered quietly (the button only); the first one is also said.
  if !back.exists() {
    let code = if to_new { "newAvailable" } else if saved.get("quiet") == Some(&json!(true)) { "previousQuiet" } else { "previousOpens" };
    warns.push((code, (if to_new { "clave nueva" } else { "clave anterior" }).into()));
    return hex;
  }
  let fresh = s.seal(old.as_slice()).ok().filter(|b| s.unseal(b).is_ok_and(|t| crypto::same(t.as_slice(), old.as_slice())));
  let Some(fresh) = fresh else {
    warns.push(("previousFailed", "no se pudo sellar".into()));
    return hex;
  };
  let mut kept = vec![];
  for (i, file) in files.iter().enumerate() {
    let r = (|| -> std::io::Result<()> {
      if file.exists() {
        kept.push(keep_aside(file, if to_new { "anterior" } else { "nueva" })?);
      }
      write_whole(file, &fresh)
    })();
    if let Err(e) = r {
      if i == 0 {
        warns.push(("previousFailed", e.to_string()));
        return hex;
      }
    }
  }
  let _ = fs::remove_file(&back);
  // The older keys stay pointed at (after the ones kept now), except the file this goes back to: it is the key in use.
  for f in listed.iter().filter(|f| *f != chosen && f.exists()) {
    if !kept.contains(f) {
      kept.push(f.clone());
    }
  }
  let note = json!({ "files": kept, "at": iso_now(), "back": !to_new, "quiet": true });
  if write_whole(&record, note.to_string().as_bytes()).is_err() {
    let _ = fs::remove_file(&record);
  }
  warns.push((if to_new { "previousNew" } else { "previousBack" }, (if to_new { "clave nueva" } else { "clave anterior" }).into()));
  old
}

/// «Empezar con una clave nueva» chosen with the key opening fine (NEW_FILE). The key in use is never deleted: it is kept
/// aside and PREVIOUS_FILE points at it (the new asides first, then what the record already listed), so previous_key
/// offers the way back. Order, so that a cut at any point loses no key and does not repeat the change at every start:
///   1. the new key is sealed and checked; 2. both files are copied aside; 3. PREVIOUS_FILE is written (with the signal's
///   time and the SHA-256 of the clave2.enc being replaced: a fingerprint of the file, not of the key); 4. clave2.enc is
///   replaced; 5. its copy is replaced; 6. the signal goes.
/// A cut before 4 leaves the same clave2.enc and the signal: the next start repeats from 1. A cut after 4 leaves the
/// signal, but the record carries the same time and the fingerprint of the file installed, and clave2.enc is exactly that: the
/// change is done (nothing is opened to know it): «newKeyDone» is said, the signal goes, and load() puts the copy right. A step that fails ends it with
/// the previous record put back as it was, the signal removed and the key in use unchanged («newKeyFailed»). Done: «newKeyDone».
fn new_key(dir: &Path, files: [&Path; 2], hex: Locked, s: &dyn Sealer, warns: &mut Vec<(&'static str, String)>) -> Locked {
  let signal = dir.join(NEW_FILE);
  let at = fs::read(&signal).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).and_then(|v| v.get("at").and_then(Value::as_str).map(String::from)).unwrap_or_default();
  let record = dir.join(PREVIOUS_FILE);
  let before = fs::read(&record).ok();
  let saved = before.as_ref().and_then(|b| serde_json::from_slice::<Value>(b).ok());
  let print = |f: &Path| fs::read(f).ok().map(|b| crypto::sha256_b64(&b));
  let current = print(files[0]);
  let done = saved.as_ref().is_some_and(|v| v.get("newKeyAt").and_then(Value::as_str) == Some(at.as_str()) && v.get("installed").and_then(Value::as_str).is_some_and(|i| current.as_deref() == Some(i)));
  if done {
    let _ = fs::remove_file(&signal);
    warns.push(("newKeyDone", "clave nueva".into()));
    return hex;
  }
  let restore = || match &before {
    Some(b) => {
      let _ = write_whole(&record, b);
    }
    None => {
      let _ = fs::remove_file(&record);
    }
  };
  let fail = |why: String, warns: &mut Vec<(&'static str, String)>| {
    let _ = fs::remove_file(&signal);
    warns.push(("newKeyFailed", why));
  };
  let fresh_hex = crypto::hex_of(crypto::random(32).as_slice());
  let Some(sealed) = s.seal(fresh_hex.as_slice()).ok().filter(|b| s.unseal(b).is_ok_and(|t| crypto::same(t.as_slice(), fresh_hex.as_slice()))) else {
    fail("no se pudo sellar".into(), warns);
    return hex;
  };
  let Some(replaced) = current else {
    fail("no se pudo leer la clave".into(), warns);
    return hex;
  };
  let mut kept = vec![];
  for (i, file) in files.iter().enumerate().filter(|(_, f)| f.exists()) {
    match keep_aside(file, "anterior") {
      Ok(to) => kept.push(to),
      Err(e) if i == 0 => {
        fail(e.to_string(), warns);
        return hex;
      }
      Err(_) => {}
    }
  }
  // what the record listed before stays after the new asides (the most recent first), without repeating
  let older: Vec<PathBuf> = saved.as_ref().and_then(|v| v.get("files")).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(PathBuf::from).filter(|f| f.exists() && !kept.contains(f)).collect()).unwrap_or_default();
  kept.extend(older);
  let note = json!({ "files": kept, "at": iso_now(), "quiet": true, "newKeyAt": at, "replaced": replaced, "installed": crypto::sha256_b64(&sealed) });
  if write_whole(&record, note.to_string().as_bytes()).is_err() {
    restore();
    fail("no se pudo guardar el registro".into(), warns);
    return hex;
  }
  if write_whole(files[0], &sealed).is_err() {
    restore();
    fail("no se pudo guardar la clave".into(), warns);
    return hex;
  }
  let _ = write_whole(files[1], &sealed);
  let _ = fs::remove_file(dir.join(BACK_FILE));
  let _ = fs::remove_file(&signal);
  warns.push(("newKeyDone", "clave nueva".into()));
  fresh_hex
}

/// The ORB2 copy outside the workspace beside 3.8.0's name: claves\<key>.enc → claves\<key>.v2.enc.
pub fn v2_of(copy: &Path) -> PathBuf {
  let n = name(copy);
  copy.with_file_name(format!("{}.v2.enc", n.strip_suffix(".enc").unwrap_or(&n)))
}

/// dir: core\datos; copy: <app data>\claves\<key>.enc (3.8.0's name; ORB2 goes beside it as <key>.v2.enc).
/// allow_new: the user chose to start with a new key. → this PC's secret, or why not.
pub fn load(dir: &Path, copy: &Path, s: &dyn Sealer, allow_new: bool) -> Result<Opened, Failure> {
  let enc2 = dir.join("clave2.enc");
  let copy2 = v2_of(copy);
  let plain = dir.join("clave.bin");
  let old = [dir.join("clave.enc"), copy.to_path_buf()];
  let _lock = Lock::get(dir, Duration::from_secs(10)).ok_or_else(|| Failure::Busy("clave.lock".into()))?;
  let mut warns = vec![];
  adopt_tmp(&enc2, s, &copy2);
  adopt_tmp(&copy2, s, &enc2);
  let mut seen = Seen { s, files: vec![] };
  let mut hex = None;
  for f in [&enc2, &copy2] {
    match seen.get(f) {
      Open::Busy(why) => return Err(Failure::Busy(format!("{}: {why}", name(f)))),
      Open::Hex(h) => {
        hex = Some(h.clone());
        break;
      }
      _ => {}
    }
  }
  let found = hex.is_some();
  let mut from_bin = false;
  let mut lost: Vec<PathBuf> = vec![];
  let hex = match hex {
    Some(h) => h,
    None => {
      let sealed: Vec<PathBuf> = seen.files.iter().filter(|(_, r)| !matches!(r, Open::Absent)).map(|(f, _)| f.clone()).collect();
      let old_there: Vec<String> = old.iter().filter(|f| f.exists()).map(|f| name(f)).collect();
      if !allow_new && !sealed.is_empty() {
        let why = seen.files.iter().map(|(f, r)| format!("{}: {}", name(f), match r { Open::Bad(w) | Open::Busy(w) => w.as_str(), _ => "no está" })).collect::<Vec<_>>().join(", ");
        return Err(Failure::Unreadable(why));
      }
      if !allow_new && !old_there.is_empty() {
        return Err(Failure::Old(old_there.join(", ")));
      }
      lost = sealed.clone();
      // A plain clave.bin (a workspace made without the app) becomes the sealed key, only when nothing sealed is there.
      let mut bin = if sealed.is_empty() && old_there.is_empty() { fs::read(&plain).ok().filter(|b| b.len() >= 32) } else { None };
      from_bin = bin.is_some();
      let raw = bin.as_ref().map(|b| Locked::from_slice(&b[..32])).unwrap_or_else(|| crypto::random(32));
      if let Some(b) = bin.as_mut() {
        zeroize::Zeroize::zeroize(b);
      }
      crypto::hex_of(raw.as_slice())
    }
  };
  // ORB2 in both files, checked before anything is replaced: it must open again to the same secret.
  let todo: Vec<PathBuf> = [&enc2, &copy2].into_iter().filter(|f| { let r = seen.get(f); !same(r.hex(), hex.as_slice()) && !matches!(r, Open::Busy(_)) }).cloned().collect();
  let mut kept = same(seen.get(&enc2).hex(), hex.as_slice());
  if !todo.is_empty() {
    let fresh = s.seal(hex.as_slice()).ok().filter(|b| s.unseal(b).is_ok_and(|t| crypto::same(t.as_slice(), hex.as_slice())));
    for file in todo.iter().filter(|_| fresh.is_some()) {
      let was = seen.get(file);
      let (absent, opened) = (matches!(was, Open::Absent), was.hex().is_some());
      let r = (|| -> std::io::Result<()> {
        if !absent {
          // Another secret, or one that does not open: kept.
          let to = keep_aside(file, if opened { "" } else { "ilegible" })?;
          for f in lost.iter_mut().filter(|f| *f == file) {
            *f = to.clone();
          }
        }
        write_whole(file, fresh.as_ref().unwrap())
      })();
      if r.is_ok() && *file == enc2 {
        kept = true;
      }
    }
  }
  // A secret that exists nowhere else (new, or from clave.bin) must be on disk before it is used.
  if !found && !kept {
    return Err(Failure::Busy("no se pudo guardar la clave".into()));
  }
  // The plain clave.bin goes only when it became the sealed key; one that was not used (sealed keys or Orb 3.8.0's were
  // there) is never deleted: it stays where it is.
  if kept && from_bin {
    let _ = fs::remove_file(&plain);
  }
  // The signal never outlives a start, except one cut half-way (new_key tells). It is acted on only when this start has a key
  // that opens, no start-up «clave nueva» came first and no way back is waiting: with both signals the way back is served
  // (the user's last wish is not known, and no new key is made without being sure of it).
  let make_new = found && !allow_new && dir.join(NEW_FILE).exists() && !dir.join(BACK_FILE).exists();
  if !make_new {
    let _ = fs::remove_file(dir.join(NEW_FILE));
  }
  let hex = if !lost.is_empty() && kept {
    let note = json!({ "files": lost, "at": iso_now() });
    let _ = write_whole(&dir.join(PREVIOUS_FILE), note.to_string().as_bytes());
    hex
  } else if make_new {
    new_key(dir, [&enc2, &copy2], hex, s, &mut warns)
  } else if found && !allow_new {
    previous_key(dir, [&enc2, &copy2], hex, s, &mut warns)
  } else {
    hex
  };
  let secret = crypto::unhex(hex.as_slice()).ok_or_else(|| Failure::Busy("clave".into()))?;
  Ok(Opened { secret, warns })
}

#[cfg(test)]
mod tests {
  use super::*;

  struct K {
    base: PathBuf,
    dir: PathBuf,
    copy: PathBuf,
  }
  impl K {
    fn new(tag: &str) -> K {
      let base = std::env::temp_dir().join(format!("orb-maquina-{tag}-{}-{}", std::process::id(), rand_hex(4)));
      let _ = fs::remove_dir_all(&base);
      K { dir: base.join("core").join("datos"), copy: base.join("claves").join("orb-1234abcd.enc"), base }
    }
    fn enc2(&self) -> PathBuf {
      self.dir.join("clave2.enc")
    }
    fn copy2(&self) -> PathBuf {
      v2_of(&self.copy)
    }
    fn files(&self) -> Vec<String> {
      let mut v: Vec<String> = fs::read_dir(&self.dir).map(|r| r.filter_map(Result::ok).map(|e| e.file_name().to_string_lossy().into_owned()).collect()).unwrap_or_default();
      v.sort();
      v
    }
  }
  impl Drop for K {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.base);
    }
  }
  fn ok() -> Fake {
    Fake::default()
  }
  fn hex(o: &Opened) -> String {
    crypto::hex_of(o.secret.as_slice()).as_str().unwrap().to_string()
  }
  fn read(f: &Path) -> String {
    String::from_utf8_lossy(&fs::read(f).unwrap()).into_owned()
  }

  #[test]
  fn same_secret_every_start_and_core_comes_back_from_the_copy() {
    let k = K::new("ida");
    let a = load(&k.dir, &k.copy, &ok(), false).unwrap();
    let s = hex(&a);
    assert_eq!(read(&k.enc2()), format!("ORB2{s}"));
    assert_eq!(read(&k.copy2()), format!("ORB2{s}"));
    assert_eq!(hex(&load(&k.dir, &k.copy, &ok(), false).unwrap()), s);
    assert_eq!(k.files(), ["clave2.enc"], "nothing aside, no temporaries, no lock left");
    fs::remove_dir_all(k.base.join("core")).unwrap();
    assert_eq!(hex(&load(&k.dir, &k.copy, &ok(), false).unwrap()), s, "core deleted: the copy outside brings it back");
    assert_eq!(read(&k.enc2()), format!("ORB2{s}"));
    // The keys the engine gets, as Node made them (src/platform/keys.mjs; vectors from Node's crypto).
    let one = Locked::from_slice(&[1u8; 32]);
    assert_eq!(crypto::b64(crypto::approval_key(one.as_slice()).as_slice()), "1eT6E7LGzx0Tt52NY7o7WxB0F1x62JosMHVCdAoVuBQ=");
    assert_eq!(crypto::b64(crypto::backup_key(one.as_slice()).as_slice()), "M/PB84cc6NvkNWcInMGjTOtymMK73IJ2hq4H1SKkvOU=");
  }

  #[test]
  fn a_plain_clave_bin_is_sealed_and_goes() {
    let k = K::new("bin");
    fs::create_dir_all(&k.dir).unwrap();
    fs::write(k.dir.join("clave.bin"), [7u8; 32]).unwrap();
    assert_eq!(hex(&load(&k.dir, &k.copy, &ok(), false).unwrap()), "07".repeat(32));
    assert!(!k.dir.join("clave.bin").exists());
  }

  #[test]
  fn orb_380_files_stop_the_start_and_stay_untouched() {
    let k = K::new("380");
    fs::create_dir_all(&k.dir).unwrap();
    fs::write(k.dir.join("clave.enc"), "v10xyz").unwrap();
    fs::write(k.dir.join("clave.bin"), [9u8; 32]).unwrap();
    let e = load(&k.dir, &k.copy, &ok(), false).err().unwrap();
    assert_eq!((e.code(), e.detail()), ("old", "clave.enc"));
    assert_eq!(k.files(), ["clave.bin", "clave.enc"], "nothing written or deleted");
    // The user chose a new key: a new secret, never the clave.bin beside 3.8.0's key; 3.8.0's file stays.
    let n = load(&k.dir, &k.copy, &ok(), true).unwrap();
    assert_ne!(hex(&n), "09".repeat(32));
    assert_eq!(read(&k.dir.join("clave.enc")), "v10xyz");
    assert_eq!(fs::read(k.dir.join("clave.bin")).unwrap(), [9u8; 32], "the unused clave.bin is not deleted");
  }

  #[test]
  fn a_key_that_cannot_be_read_now_stops_the_start_and_none_that_opens_is_the_users_call() {
    let k = K::new("ilegible");
    let s = hex(&load(&k.dir, &k.copy, &ok(), false).unwrap());
    let busy = Fake { unseal_error: Some("io"), ..ok() };
    assert_eq!(load(&k.dir, &k.copy, &busy, false).err().unwrap().code(), "busy");
    let bad = Fake { unseal_error: Some("dpapi"), ..ok() };
    assert_eq!(load(&k.dir, &k.copy, &bad, false).err().unwrap().code(), "unreadable");
    assert_eq!(read(&k.enc2()), format!("ORB2{s}"), "nothing written");
    // A new key: the old ones kept aside (never overwritten in place) and noted for the way back.
    fs::write(k.enc2(), "ORB2basura").unwrap();
    fs::write(k.copy2(), "ORB2basura").unwrap();
    let n = hex(&load(&k.dir, &k.copy, &ok(), true).unwrap());
    assert_ne!(n, s);
    assert!(k.files().iter().any(|f| f.starts_with("clave2.") && f.ends_with(".ilegible.enc")));
    assert!(k.dir.join(PREVIOUS_FILE).exists());
    assert_eq!(read(&k.enc2()), format!("ORB2{n}"));
  }

  #[test]
  fn writes_are_checked_first_and_a_cut_write_is_adopted() {
    let k = K::new("atomico");
    // A sealing that does not open again, or refused: a new secret is never used.
    assert_eq!(load(&k.dir, &k.copy, &Fake { seal: Some("wrong"), ..ok() }, false).err().unwrap().code(), "busy");
    assert_eq!(load(&k.dir, &k.copy, &Fake { seal: Some("fail"), ..ok() }, false).err().unwrap().code(), "busy");
    assert!(!k.enc2().exists());
    // A write cut before its rename: the temporary that opens is adopted.
    let s = "ab".repeat(32);
    fs::create_dir_all(&k.dir).unwrap();
    fs::write(k.dir.join("clave2.enc.123-abcd.tmp"), format!("ORB2{s}")).unwrap();
    assert_eq!(hex(&load(&k.dir, &k.copy, &ok(), false).unwrap()), s);
    assert!(!k.files().iter().any(|f| f.ends_with(".tmp")));
    // …but not one of ANOTHER secret while the copy agrees on one.
    fs::remove_file(k.enc2()).unwrap();
    fs::write(k.dir.join("clave2.enc.9-ffff.tmp"), format!("ORB2{}", "d".repeat(64))).unwrap();
    assert_eq!(hex(&load(&k.dir, &k.copy, &ok(), false).unwrap()), s);
  }

  #[test]
  fn two_starts_at_once_wait_for_each_other() {
    let k = K::new("lock");
    let s = hex(&load(&k.dir, &k.copy, &ok(), false).unwrap());
    let slow = Fake { delay_ms: 30, ..ok() };
    let all: Vec<String> = std::thread::scope(|sc| {
      let h: Vec<_> = (0..3).map(|_| sc.spawn(|| hex(&load(&k.dir, &k.copy, &slow, false).unwrap()))).collect();
      h.into_iter().map(|h| h.join().unwrap()).collect()
    });
    assert_eq!(all, [s.clone(), s.clone(), s]);
    assert_eq!(k.files(), ["clave2.enc"]);
  }

  #[test]
  fn the_way_back_to_the_key_from_before_a_new_one() {
    let k = K::new("vuelta");
    let old = hex(&load(&k.dir, &k.copy, &ok(), false).unwrap());
    let bad = Fake { unseal_error: Some("dpapi"), ..ok() };
    // Windows cannot open it now (a profile not synced yet): the user starts with a new key.
    assert_eq!(load(&k.dir, &k.copy, &bad, false).err().unwrap().code(), "unreadable");
    let fresh = hex(&load(&k.dir, &k.copy, &OldUnreadable(old.clone()), true).unwrap());
    assert_ne!(fresh, old);
    // Windows opens the old one again: offered, not used.
    let w = load(&k.dir, &k.copy, &ok(), false).unwrap();
    assert_eq!((hex(&w), w.warns.iter().map(|w| w.0).collect::<Vec<_>>()), (fresh.clone(), vec!["previousOpens"]));
    fs::write(k.dir.join(BACK_FILE), "{}").unwrap();
    let w = load(&k.dir, &k.copy, &ok(), false).unwrap();
    assert_eq!((hex(&w), w.warns[0].0), (old.clone(), "previousBack"));
    assert_eq!(read(&k.enc2()), format!("ORB2{old}"));
    assert_eq!(read(&k.copy2()), format!("ORB2{old}"));
    assert!(k.files().iter().any(|f| f.ends_with(".nueva.enc")));
    // And quietly back to the new one.
    let w = load(&k.dir, &k.copy, &ok(), false).unwrap();
    assert_eq!((hex(&w), w.warns[0].0), (old.clone(), "newAvailable"));
    fs::write(k.dir.join(BACK_FILE), "{}").unwrap();
    let w = load(&k.dir, &k.copy, &ok(), false).unwrap();
    assert_eq!((hex(&w), w.warns[0].0), (fresh.clone(), "previousNew"));
    let w = load(&k.dir, &k.copy, &ok(), false).unwrap();
    assert_eq!((hex(&w), w.warns[0].0), (fresh, "previousQuiet"));
  }

  #[test]
  fn a_new_key_on_purpose_keeps_the_old_one_aside_once_and_the_way_back_works() {
    let k = K::new("nueva");
    let old = hex(&load(&k.dir, &k.copy, &ok(), false).unwrap());
    fs::write(k.dir.join(NEW_FILE), r#"{"at":"2026-01-01T00:00:00Z"}"#).unwrap();
    let n = load(&k.dir, &k.copy, &ok(), false).unwrap();
    let fresh = hex(&n);
    assert_ne!(fresh, old);
    assert_eq!(read(&k.enc2()), format!("ORB2{fresh}"));
    assert_eq!(read(&k.copy2()), format!("ORB2{fresh}"));
    assert!(!k.dir.join(NEW_FILE).exists(), "the signal is used up");
    let aside: Vec<String> = k.files().into_iter().filter(|f| f.ends_with(".anterior.enc")).collect();
    assert!(!aside.is_empty());
    assert!(aside.iter().any(|f| read(&k.dir.join(f)) == format!("ORB2{old}")), "the old key is kept, not deleted");
    assert!(read(&k.dir.join(PREVIOUS_FILE)).contains("newKeyAt"));
    // A second start does not change it again; the old one is offered quietly.
    let w = load(&k.dir, &k.copy, &ok(), false).unwrap();
    assert_eq!((hex(&w), w.warns.iter().map(|w| w.0).collect::<Vec<_>>()), (fresh.clone(), vec!["previousQuiet"]));
    // The way back goes to the old key.
    fs::write(k.dir.join(BACK_FILE), "{}").unwrap();
    let w = load(&k.dir, &k.copy, &ok(), false).unwrap();
    assert_eq!((hex(&w), w.warns[0].0), (old.clone(), "previousBack"));
    assert_eq!(read(&k.enc2()), format!("ORB2{old}"));
    assert!(!k.dir.join(BACK_FILE).exists());
  }

  #[test]
  fn a_cut_new_key_neither_loses_a_key_nor_repeats() {
    let k = K::new("nueva-corte");
    let old = hex(&load(&k.dir, &k.copy, &ok(), false).unwrap());
    // A start that cannot seal: the key stays, the signal goes, nothing is repeated.
    fs::write(k.dir.join(NEW_FILE), r#"{"at":"t1"}"#).unwrap();
    let w = load(&k.dir, &k.copy, &Fake { seal: Some("fail"), ..ok() }, false).unwrap();
    assert_eq!((hex(&w), w.warns[0].0), (old.clone(), "newKeyFailed"));
    assert!(!k.dir.join(NEW_FILE).exists());
    assert_eq!(read(&k.enc2()), format!("ORB2{old}"));
    // Cut after the key was replaced but before the signal went: the signal is only removed.
    fs::write(k.dir.join(NEW_FILE), r#"{"at":"t2"}"#).unwrap();
    let fresh = hex(&load(&k.dir, &k.copy, &ok(), false).unwrap());
    assert_ne!(fresh, old);
    fs::write(k.dir.join(NEW_FILE), r#"{"at":"t2"}"#).unwrap();
    assert_eq!(hex(&load(&k.dir, &k.copy, &ok(), false).unwrap()), fresh, "the same signal does not change the key again");
    assert!(!k.dir.join(NEW_FILE).exists());
    // Cut before the key was replaced (the record points at the same key): the change is made.
    let before = fresh.clone();
    fs::write(k.dir.join(PREVIOUS_FILE), json!({ "files": [k.enc2()], "at": "x", "quiet": true, "newKeyAt": "t3" }).to_string()).unwrap();
    fs::write(k.dir.join(NEW_FILE), r#"{"at":"t3"}"#).unwrap();
    let again = hex(&load(&k.dir, &k.copy, &ok(), false).unwrap());
    assert_ne!(again, before);
    assert!(k.files().iter().any(|f| f.ends_with(".anterior.enc") && read(&k.dir.join(f)) == format!("ORB2{before}")));
  }

  #[test]
  fn new_key_signals_never_outlive_a_start_and_two_signals_serve_the_way_back() {
    let k = K::new("nueva-señales");
    let old = hex(&load(&k.dir, &k.copy, &ok(), false).unwrap());
    // done now: said once, and the record fingerprints the replaced file (not a key)
    fs::write(k.dir.join(NEW_FILE), r#"{"at":"a1"}"#).unwrap();
    let w = load(&k.dir, &k.copy, &ok(), false).unwrap();
    let fresh = hex(&w);
    assert_eq!(w.warns.iter().map(|w| w.0).collect::<Vec<_>>(), vec!["newKeyDone"]);
    assert!(read(&k.dir.join(PREVIOUS_FILE)).contains("\"replaced\""));
    // both signals: the way back is served, no new key, the new-key signal is consumed
    fs::write(k.dir.join(NEW_FILE), r#"{"at":"a2"}"#).unwrap();
    fs::write(k.dir.join(BACK_FILE), "{}").unwrap();
    let w = load(&k.dir, &k.copy, &ok(), false).unwrap();
    assert_eq!((hex(&w), w.warns[0].0), (old.clone(), "previousBack"));
    assert!(!k.dir.join(NEW_FILE).exists() && !k.dir.join(BACK_FILE).exists());
    assert_ne!(old, fresh);
    // a signal found while the start-up makes a new key (nothing opens) does not survive to make another one
    let k2 = K::new("nueva-arranque");
    let first = hex(&load(&k2.dir, &k2.copy, &ok(), false).unwrap());
    fs::write(k2.enc2(), "ORB2basura").unwrap();
    fs::write(k2.copy2(), "ORB2basura").unwrap();
    fs::write(k2.dir.join(NEW_FILE), r#"{"at":"b1"}"#).unwrap();
    let made = hex(&load(&k2.dir, &k2.copy, &ok(), true).unwrap());
    assert_ne!(made, first);
    assert!(!k2.dir.join(NEW_FILE).exists());
    let w = load(&k2.dir, &k2.copy, &ok(), false).unwrap();
    assert_eq!(hex(&w), made, "no second key");
    assert!(!w.warns.iter().any(|w| w.0 == "newKeyDone"));
  }

  #[test]
  fn a_second_new_key_keeps_what_the_record_listed_and_a_cut_before_the_copy_is_put_right() {
    let k = K::new("nueva-dos");
    let first = hex(&load(&k.dir, &k.copy, &ok(), false).unwrap());
    fs::write(k.dir.join(NEW_FILE), r#"{"at":"c1"}"#).unwrap();
    let second = hex(&load(&k.dir, &k.copy, &ok(), false).unwrap());
    let listed = |k: &K| -> Vec<String> { serde_json::from_str::<Value>(&read(&k.dir.join(PREVIOUS_FILE))).unwrap()["files"].as_array().unwrap().iter().map(|f| f.as_str().unwrap().to_string()).collect() };
    let one = listed(&k);
    std::thread::sleep(Duration::from_millis(5));
    fs::write(k.dir.join(NEW_FILE), r#"{"at":"c2"}"#).unwrap();
    let third = hex(&load(&k.dir, &k.copy, &ok(), false).unwrap());
    let two = listed(&k);
    assert!(two.len() > one.len() && one.iter().all(|f| two.contains(f)), "the earlier asides are still listed");
    assert_eq!(two.iter().filter(|f| two.iter().filter(|g| g == f).count() > 1).count(), 0, "no repeats");
    // the most recent aside (the second key) comes first, so the way back goes to it
    assert_eq!(read(Path::new(&two[0])), format!("ORB2{second}"));
    fs::write(k.dir.join(BACK_FILE), "{}").unwrap();
    let w = load(&k.dir, &k.copy, &ok(), false).unwrap();
    assert_eq!((hex(&w), w.warns[0].0), (second.clone(), "previousBack"));
    assert_ne!(first, second);
    assert_ne!(second, third);
    // cut between clave2.enc and its copy: the copy still holds the key before, the signal is still there
    let k3 = K::new("nueva-corte-copia");
    let old = hex(&load(&k3.dir, &k3.copy, &ok(), false).unwrap());
    fs::write(k3.dir.join(NEW_FILE), r#"{"at":"d1"}"#).unwrap();
    let fresh = hex(&load(&k3.dir, &k3.copy, &ok(), false).unwrap());
    fs::write(k3.copy2(), format!("ORB2{old}")).unwrap();
    fs::write(k3.dir.join(NEW_FILE), r#"{"at":"d1"}"#).unwrap();
    let w = load(&k3.dir, &k3.copy, &ok(), false).unwrap();
    assert_eq!((hex(&w), w.warns.iter().any(|w| w.0 == "newKeyDone")), (fresh.clone(), true), "a start after the cut still says it");
    assert_eq!(read(&k3.copy2()), format!("ORB2{fresh}"));
    assert!(!k3.dir.join(NEW_FILE).exists());
  }

  #[test]
  fn going_back_keeps_the_older_keys_pointed_at_and_a_busy_file_stops_it() {
    let k = K::new("tres");
    let k1 = hex(&load(&k.dir, &k.copy, &ok(), false).unwrap());
    fs::write(k.dir.join(NEW_FILE), r#"{"at":"e1"}"#).unwrap();
    let k2 = hex(&load(&k.dir, &k.copy, &ok(), false).unwrap());
    std::thread::sleep(Duration::from_millis(5));
    fs::write(k.dir.join(NEW_FILE), r#"{"at":"e2"}"#).unwrap();
    let k3 = hex(&load(&k.dir, &k.copy, &ok(), false).unwrap());
    assert!(k1 != k2 && k2 != k3 && k1 != k3);
    fs::write(k.dir.join(BACK_FILE), "{}").unwrap();
    let w = load(&k.dir, &k.copy, &ok(), false).unwrap();
    assert_eq!((hex(&w), w.warns[0].0), (k2.clone(), "previousBack"));
    let listed: Vec<String> = serde_json::from_str::<Value>(&read(&k.dir.join(PREVIOUS_FILE))).unwrap()["files"].as_array().unwrap().iter().map(|f| read(Path::new(f.as_str().unwrap()))).collect();
    assert!(listed.contains(&format!("ORB2{k3}")), "the key left is pointed at");
    assert!(listed.contains(&format!("ORB2{k1}")), "the oldest key is still pointed at");
    // …and going back to the new key works from there, still keeping the oldest
    fs::write(k.dir.join(BACK_FILE), "{}").unwrap();
    let w = load(&k.dir, &k.copy, &ok(), false).unwrap();
    assert_eq!((hex(&w), w.warns[0].0), (k3.clone(), "previousNew"));
    let listed: Vec<String> = serde_json::from_str::<Value>(&read(&k.dir.join(PREVIOUS_FILE))).unwrap()["files"].as_array().unwrap().iter().map(|f| read(Path::new(f.as_str().unwrap()))).collect();
    assert!(listed.contains(&format!("ORB2{k1}")));
  }

  /// Every key that is not the one in use is busy (a file of another app), as the sealer sees it.
  struct BusyExcept(String);
  impl Sealer for BusyExcept {
    fn seal(&self, text: &[u8]) -> Result<Vec<u8>, String> {
      Fake::default().seal(text)
    }
    fn unseal(&self, blob: &[u8]) -> Result<Locked, &'static str> {
      let t = Fake::default().unseal(blob)?;
      if t.as_slice() == self.0.as_bytes() {
        Ok(t)
      } else {
        Err("io")
      }
    }
  }

  #[test]
  fn a_busy_listed_key_stops_the_way_back_instead_of_choosing_an_older_one() {
    let k = K::new("ocupada");
    let k1 = hex(&load(&k.dir, &k.copy, &ok(), false).unwrap());
    fs::write(k.dir.join(NEW_FILE), r#"{"at":"f1"}"#).unwrap();
    let k2 = hex(&load(&k.dir, &k.copy, &ok(), false).unwrap());
    fs::write(k.dir.join(BACK_FILE), "{}").unwrap();
    // the key in use opens; the listed one is busy: nothing changes, it is said, the signal waits for another start
    let w = load(&k.dir, &k.copy, &BusyExcept(k2.clone()), false).unwrap();
    assert_eq!((hex(&w), w.warns.iter().map(|w| w.0).collect::<Vec<_>>()), (k2.clone(), vec!["previousFailed"]));
    assert_eq!(read(&k.enc2()), format!("ORB2{k2}"));
    assert!(k.dir.join(BACK_FILE).exists());
    let w = load(&k.dir, &k.copy, &ok(), false).unwrap();
    assert_eq!((hex(&w), w.warns[0].0), (k1, "previousBack"));
  }

  /// For the way-back test: the files holding this secret do not open (DPAPI), the rest do.
  struct OldUnreadable(String);
  impl Sealer for OldUnreadable {
    fn seal(&self, text: &[u8]) -> Result<Vec<u8>, String> {
      Fake::default().seal(text)
    }
    fn unseal(&self, blob: &[u8]) -> Result<Locked, &'static str> {
      let t = Fake::default().unseal(blob)?;
      if t.as_slice() == self.0.as_bytes() {
        Err("dpapi")
      } else {
        Ok(t)
      }
    }
  }
}

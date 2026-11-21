//! The installation as the window sees it: events for the screens (phases, log lines, the ending) and the two ways to
//! produce them. The real one checks and starts the setup; the test one only pretends, so it can show every ending.
use crate::embedded;
use crate::mode::{Forced, RealToken, TestOptions};
use crate::nsis::{self, Outcome, Refusal};
use crate::procs;
use crate::registry;
use crate::setup::{self, Source, StageError};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// What the user chose on the screens.
#[derive(Debug, Clone)]
pub struct Params {
  /// None: the setup's own default folder.
  pub dir: Option<PathBuf>,
  pub shortcuts: bool,
}

pub type Emit<'a> = &'a dyn Fn(Value);

fn phase(emit: Emit, name: &str) {
  emit(json!({ "ev": "phase", "phase": name }));
}

fn log(emit: Emit, key: &str, arg: impl Into<String>) {
  emit(json!({ "ev": "log", "key": key, "arg": arg.into() }));
}

fn done(emit: Emit, v: Value) {
  let mut v = v;
  v["ev"] = json!("done");
  emit(v);
}

/// The ending of a run of the setup as the screens get it. `confirmed` is whether the registry shows the new Orb after an exit 0.
pub fn done_for(outcome: &Outcome, confirmed: Option<registry::Installed>, can_retry_classic: bool) -> Value {
  match outcome {
    Outcome::Installed => match confirmed {
      Some(i) => json!({ "kind": "ok", "can_open": true, "version": i.version }),
      None => json!({ "kind": "failed", "code": 0, "classic": can_retry_classic, "unconfirmed": true }),
    },
    Outcome::Refused { reason, version } => json!({ "kind": "refused", "reason": reason, "version": version }),
    Outcome::Failed { code } => json!({ "kind": "failed", "code": code, "classic": can_retry_classic }),
  }
}

fn stage_error_word(e: StageError) -> &'static str {
  match e {
    StageError::Io => "io",
    StageError::Path => "path",
    StageError::Hash => "hash",
    StageError::Signature => "signature",
  }
}

/// The setup inside the binary, with its signature required: a real installer without one is refused, not run on its hash alone.
fn embedded_source() -> Result<Source<'static>, StageError> {
  let sig = embedded::SETUP_SIG.ok_or(StageError::Signature)?;
  Ok(Source { bytes: embedded::SETUP, sha256: embedded::SETUP_SHA256, sig: Some(sig), pubkey_b64: embedded::UPDATER_PUBKEY })
}

/// The folders where a running Orb would be in the way: the one about to be written, the one already installed and Orb 3.8.0's.
fn watched_dirs(target: &Path, electron: Option<&registry::Electron>) -> Vec<PathBuf> {
  let mut dirs = vec![target.to_path_buf()];
  dirs.extend(registry::installed_orb().map(|i| i.dir));
  dirs.extend(electron.map(|e| e.dir.clone()));
  dirs
}

fn norm(p: &Path) -> String {
  p.to_string_lossy().to_ascii_lowercase().trim_end_matches('\\').to_string()
}

/// Where the setup will put Orb: the folder the user chose, else the one of an Orb already installed (the setup reuses it),
/// else its own default.
pub fn expected_dir(chosen: Option<&Path>, installed_before: Option<&Path>) -> PathBuf {
  chosen.or(installed_before).map(Path::to_path_buf).unwrap_or_else(registry::default_install_dir)
}

/// What the registry says is installed only counts when it is this version and, if the place is known, that very place.
pub fn confirm_install(installed: Option<registry::Installed>, expected: Option<&Path>, version: &str) -> Option<registry::Installed> {
  installed.filter(|i| i.version == version && expected.is_none_or(|e| norm(e) == norm(&i.dir)))
}

/// Checks and starts the setup in silent mode and reports every step. Ends with exactly one `done` event. Returns the program to
/// open when (and only when) the installation was confirmed.
pub fn run_real(token: &RealToken, p: &Params, emit: Emit) -> Option<PathBuf> {
  phase(emit, "preparando");
  log(emit, "verifying", "");
  let staged = match embedded_source().and_then(|s| setup::stage(&s, &std::env::temp_dir())) {
    Ok(s) => s,
    Err(e) => {
      done(emit, json!({ "kind": "verify", "what": stage_error_word(e) }));
      return None;
    }
  };
  log(emit, "sha_ok", "");
  log(emit, "sig_ok", "");

  let electron = registry::electron();
  if let Some(e) = &electron {
    log(emit, "found_electron", e.version.clone());
  }
  let before = registry::installed_orb().map(|i| i.dir);
  let expected = expected_dir(p.dir.as_deref(), before.as_deref());
  if let Some(open) = procs::blocking(&procs::running_orb(), &watched_dirs(&expected, electron.as_ref())) {
    log(emit, "orb_open", open.to_string_lossy());
    let is_electron = electron.as_ref().is_some_and(|e| open.parent().is_some_and(|d| norm(d) == norm(&e.dir)));
    let version = if is_electron { electron.map(|e| e.version) } else { None };
    done(emit, json!({ "kind": "open", "version": version }));
    return None;
  }

  phase(emit, "instalando");
  let cmdline = nsis::silent_cmdline(p.dir.as_deref(), p.shortcuts);
  log(emit, "running", cmdline.clone());
  let started = SystemTime::now();
  let status = staged.run(token, &cmdline);
  phase(emit, "terminando");
  let code = match status {
    Ok(s) => s.code(),
    Err(_) => {
      log(emit, "start_failed", "");
      done(emit, json!({ "kind": "failed", "code": null, "classic": true }));
      return None;
    }
  };
  log(emit, "exit", code.map(|c| c.to_string()).unwrap_or_default());
  let fail = nsis::data_dir().and_then(|d| nsis::read_fail_file(&d, started));
  if let Some((reason, _)) = &fail {
    log(emit, "reason", serde_json::to_value(reason).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default());
  }
  let outcome = nsis::classify(code, fail);
  let confirmed = if outcome == Outcome::Installed { confirm_install(registry::installed_orb(), Some(&expected), embedded::VERSION) } else { None };
  if outcome == Outcome::Installed {
    log(emit, if confirmed.is_some() { "registry_ok" } else { "registry_missing" }, confirmed.as_ref().map(|i| i.dir.to_string_lossy().into_owned()).unwrap_or_default());
  }
  drop(staged);
  log(emit, "cleaned", "");
  let exe = confirmed.as_ref().map(|i| i.exe.clone());
  done(emit, done_for(&outcome, confirmed, true));
  exe
}

#[derive(Debug, PartialEq, Eq)]
pub enum ClassicError {
  /// The setup inside did not pass its checks.
  Stage(StageError),
  /// It passed, but Windows could not start it.
  Start,
}

/// The same setup, checked in the same way, started WITHOUT /S so it shows its own windows. Used when the user asks for the
/// classic installer and when WebView2 is missing or fails. Returns its exit code.
pub fn run_classic(token: &RealToken, emit: Option<Emit>) -> Result<Option<i32>, ClassicError> {
  let staged = embedded_source().and_then(|s| setup::stage(&s, &std::env::temp_dir())).map_err(ClassicError::Stage)?;
  if let Some(e) = emit {
    log(e, "classic", "");
  }
  staged.run(token, "").map(|s| s.code()).map_err(|_| ClassicError::Start)
}

/// After the classic installer: the same reading as after the silent one, from its exit code and the registry (it chose its own
/// folder, so only the version is compared). Also the program to open, if the installation is confirmed.
pub fn done_after_classic(code: Option<i32>) -> (Value, Option<PathBuf>) {
  let outcome = nsis::classify(code, None);
  let confirmed = if outcome == Outcome::Installed { confirm_install(registry::installed_orb(), None, embedded::VERSION) } else { None };
  let exe = confirmed.as_ref().map(|i| i.exe.clone());
  (done_for(&outcome, confirmed, true), exe)
}

/// Opens an installed Orb for the user (this program is not elevated, so neither is it). Only a file named Orb.exe.
pub fn launch(exe: &Path) -> bool {
  exe.file_name().is_some_and(|n| n == "Orb.exe") && exe.is_file() && exe.parent().is_some_and(|dir| std::process::Command::new(exe).current_dir(dir).spawn().is_ok())
}

/// Without WebView2 (or when it fails to start): the classic installer, then end with its exit code. If it cannot be checked or
/// started, the user is told why instead of the program vanishing.
pub fn classic_and_exit(token: &RealToken) -> ! {
  match run_classic(token, None) {
    Ok(code) => std::process::exit(code.unwrap_or(1)),
    Err(ClassicError::Stage(e)) => {
      message(
        &format!("No se pudo comprobar el instalador que va dentro de este programa ({}), así que no se ha ejecutado. Descarga Orb otra vez desde su web oficial.", stage_error_word(e)),
        &format!("The installer inside this program could not be checked ({}), so it was not run. Download Orb again from its official site.", stage_error_word(e)),
      );
      std::process::exit(1)
    }
    Err(ClassicError::Start) => {
      message("Windows no pudo arrancar el instalador de Orb. Prueba a abrir este programa otra vez o descarga Orb de nuevo.", "Windows could not start Orb's installer. Try opening this program again or download Orb again.");
      std::process::exit(1)
    }
  }
}

fn spanish() -> bool {
  use windows::Win32::Globalization::GetUserDefaultUILanguage;
  // SAFETY: a plain call that takes nothing and returns a language id.
  let id = unsafe { GetUserDefaultUILanguage() };
  id & 0x3ff == 0x0a
}

/// A message box in the language of Windows, for the moments when there is no window of ours to say something.
pub fn message(text_es: &str, text_en: &str) {
  use windows::core::PCWSTR;
  use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
  let text = setup::wide(std::ffi::OsStr::new(if spanish() { text_es } else { text_en }));
  let title = setup::wide(std::ffi::OsStr::new("Orb"));
  // SAFETY: both strings are NUL-terminated and live through the call; no owner window.
  unsafe { MessageBoxW(None, PCWSTR(text.as_ptr()), PCWSTR(title.as_ptr()), MB_OK | MB_ICONERROR) };
}

/// Test mode: the same events, with short pauses and a chosen ending. Nothing is checked, started or written.
pub fn run_test(o: &TestOptions, emit: Emit) {
  let pause = |ms: u64| std::thread::sleep(Duration::from_millis(ms));
  let third = o.pause_ms / 3;
  phase(emit, "preparando");
  log(emit, "verifying", "");
  pause(third);
  log(emit, "sha_ok", "");
  log(emit, "sig_ok", "");
  pause(third);
  let electron = o.electron.clone().filter(|e| e != "no");
  if let Some(v) = &electron {
    log(emit, "found_electron", v.clone());
  }
  match o.forced.clone().unwrap_or(Forced::Ok) {
    Forced::Open => {
      log(emit, "orb_open", r"C:\Users\Dani\AppData\Local\Orb\Orb.exe");
      return done(emit, json!({ "kind": "open", "version": electron }));
    }
    _ => {}
  }
  phase(emit, "instalando");
  log(emit, "running", "/S");
  pause(o.pause_ms);
  phase(emit, "terminando");
  pause(third);
  match o.forced.clone().unwrap_or(Forced::Ok) {
    Forced::Ok => {
      log(emit, "exit", "0");
      log(emit, "registry_ok", r"C:\Users\Dani\AppData\Local\Orb");
      done(emit, json!({ "kind": "ok", "can_open": o.can_open, "version": embedded::VERSION }));
    }
    Forced::Refused(word) => {
      let reason = Refusal::from_word(&word).unwrap_or(Refusal::Desinstalador);
      log(emit, "exit", "2");
      log(emit, "reason", word);
      done(emit, json!({ "kind": "refused", "reason": reason, "version": electron.unwrap_or_else(|| "3.8.0".into()) }));
    }
    Forced::Error => {
      log(emit, "exit", "1603");
      done(emit, json!({ "kind": "failed", "code": 1603, "classic": true }));
    }
    Forced::Open => unreachable!("returned above"),
  }
}

/// Free bytes on the drive of `dir` (or of the nearest folder that exists) and the drive's letter.
pub fn free_space(dir: &Path) -> Option<(u64, String)> {
  use windows::core::PCWSTR;
  use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
  let mut probe = Some(dir);
  while let Some(p) = probe {
    if p.is_dir() {
      break;
    }
    probe = p.parent();
  }
  let probe = probe?;
  let drive = probe.to_string_lossy().chars().next().filter(|c| c.is_ascii_alphabetic())?.to_ascii_uppercase();
  let wide = setup::wide(probe.as_os_str());
  let mut free = 0u64;
  // SAFETY: `wide` is NUL-terminated and lives through the call; the only out parameter is a valid u64.
  unsafe { GetDiskFreeSpaceExW(PCWSTR(wide.as_ptr()), Some(&mut free), None, None).ok()? };
  Some((free, format!("{drive}:")))
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::Mutex;

  fn collect(o: &TestOptions) -> Vec<Value> {
    let events = Mutex::new(Vec::new());
    run_test(o, &|v| events.lock().unwrap().push(v));
    events.into_inner().unwrap()
  }

  fn opts(f: Forced) -> TestOptions {
    TestOptions { forced: Some(f), pause_ms: 3, can_open: true, ..Default::default() }
  }

  fn last_kind(ev: &[Value]) -> String {
    let d = ev.last().unwrap();
    assert_eq!(d["ev"], "done");
    d["kind"].as_str().unwrap().to_string()
  }

  #[test]
  fn every_forced_ending_is_shown_and_there_is_exactly_one() {
    for (f, kind) in [(Forced::Ok, "ok"), (Forced::Open, "open"), (Forced::Error, "failed"), (Forced::Refused("elevado".into()), "refused")] {
      let ev = collect(&opts(f));
      assert_eq!(last_kind(&ev), kind);
      assert_eq!(ev.iter().filter(|e| e["ev"] == "done").count(), 1);
    }
  }

  #[test]
  fn the_test_run_goes_through_the_real_phases_in_order() {
    let ev = collect(&opts(Forced::Ok));
    let phases: Vec<&str> = ev.iter().filter(|e| e["ev"] == "phase").map(|e| e["phase"].as_str().unwrap()).collect();
    assert_eq!(phases, ["preparando", "instalando", "terminando"]);
    // the open-Orb ending stops before the setup would be started
    let ev = collect(&opts(Forced::Open));
    assert!(!ev.iter().any(|e| e["phase"] == "instalando"));
  }

  #[test]
  fn an_unknown_refusal_word_falls_back_and_the_reason_reaches_the_screen() {
    let ev = collect(&opts(Forced::Refused("nonsense".into())));
    assert_eq!(ev.last().unwrap()["reason"], "desinstalador");
    let ev = collect(&opts(Forced::Refused("otro".into())));
    assert_eq!(ev.last().unwrap()["reason"], "otro");
  }

  #[test]
  fn an_installation_counts_only_in_the_place_that_was_asked_for() {
    let inst = |dir: &str| registry::Installed { dir: dir.into(), exe: format!(r"{dir}\Orb.exe").into(), version: "3.8.8".into() };
    // the chosen folder wins over the registry's, which wins over the default
    assert_eq!(expected_dir(Some(Path::new(r"D:\Orb")), Some(Path::new(r"E:\Old"))), PathBuf::from(r"D:\Orb"));
    assert_eq!(expected_dir(None, Some(Path::new(r"E:\Old"))), PathBuf::from(r"E:\Old"));
    assert_eq!(expected_dir(None, None), registry::default_install_dir());
    assert!(confirm_install(Some(inst(r"D:\Orb")), Some(Path::new(r"d:\orb\")), "3.8.8").is_some());
    assert!(confirm_install(Some(inst(r"E:\Other")), Some(Path::new(r"D:\Orb")), "3.8.8").is_none(), "another folder");
    assert!(confirm_install(Some(inst(r"D:\Orb")), Some(Path::new(r"D:\Orb")), "3.8.7").is_none(), "another version");
    assert!(confirm_install(None, None, "3.8.8").is_none());
    assert!(confirm_install(Some(inst(r"E:\Whatever")), None, "3.8.8").is_some(), "the classic installer picks its own folder");
  }

  #[test]
  fn only_a_file_named_orb_exe_is_ever_launched() {
    assert!(!launch(Path::new(r"C:\Windows\System32\notepad.exe")));
    assert!(!launch(Path::new(r"C:\does\not\exist\Orb.exe")));
  }

  #[test]
  fn endings_of_the_setup_map_to_screens() {
    let inst = registry::Installed { dir: r"C:\Orb".into(), exe: r"C:\Orb\Orb.exe".into(), version: "3.8.8".into() };
    assert_eq!(done_for(&Outcome::Installed, Some(inst), true)["kind"], "ok");
    // exit 0 but nothing in the registry: not shown as installed
    let unconfirmed = done_for(&Outcome::Installed, None, true);
    assert_eq!(unconfirmed["kind"], "failed");
    assert_eq!(unconfirmed["unconfirmed"], true);
    let r = done_for(&Outcome::Refused { reason: Refusal::Elevado, version: "3.8.0".into() }, None, true);
    assert_eq!((r["kind"].as_str(), r["reason"].as_str(), r["version"].as_str()), (Some("refused"), Some("elevado"), Some("3.8.0")));
    let f = done_for(&Outcome::Failed { code: Some(5) }, None, true);
    assert_eq!((f["kind"].as_str(), f["code"].as_i64(), f["classic"].as_bool()), (Some("failed"), Some(5), Some(true)));
  }
}

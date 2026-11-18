//! Real or test mode. The test mode never reaches the code that starts a setup: `setup::Staged::run` asks for a `RealToken`,
//! and the only way to get one is `Mode::decide` returning `Mode::Real`, which needs a setup inside the binary and no test flag.
use std::ffi::OsString;

/// Proof that this run is a real installation. Its field is private: only `Mode::decide` builds one.
pub struct RealToken(());

impl RealToken {
  /// For the tests that run a harmless stand-in program (feature `fake-setup`); never compiled into the installer.
  #[cfg(feature = "fake-setup")]
  pub fn for_tests() -> Self {
    RealToken(())
  }
}

/// How a test run ends (`--prueba=ok|rechazo[:motivo]|abierto|error`).
#[derive(Debug, Clone, PartialEq)]
pub enum Forced {
  Ok,
  Refused(String),
  Open,
  Error,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct TestOptions {
  pub forced: Option<Forced>,
  /// A debugging port for the browser engine, only ever accepted here.
  pub port: Option<u16>,
  pub lang: Option<String>,
  /// The Orb 3.8.0 the test pretends to find (`--electron=3.8.0`, or `no`).
  pub electron: Option<String>,
  pub pause_ms: u64,
  pub can_open: bool,
  pub hidden: bool,
}

pub enum Mode {
  Real(RealToken),
  Test(TestOptions),
}

impl Mode {
  /// `args` without the program name; `env_flag` is ORB_INSTALADOR_PRUEBA. A build with no setup inside is always a test; one
  /// with a setup inside is a test only when `--prueba` is given as an argument (an inherited variable never turns it into one).
  pub fn decide(args: &[OsString], env_flag: bool, has_setup: bool) -> Mode {
    let args: Vec<String> = args.iter().map(|a| a.to_string_lossy().into_owned()).collect();
    let wants_test = (env_flag && !has_setup) || args.iter().any(|a| a == "--prueba" || a.starts_with("--prueba="));
    if has_setup && !wants_test {
      return Mode::Real(RealToken(()));
    }
    Mode::Test(parse_test(&args))
  }

  pub fn is_real(&self) -> bool {
    matches!(self, Mode::Real(_))
  }
}

fn parse_test(args: &[String]) -> TestOptions {
  let mut o = TestOptions { pause_ms: 900, can_open: true, ..Default::default() };
  let mut it = args.iter().peekable();
  while let Some(a) = it.next() {
    let value = |name: &str| a.strip_prefix(&format!("{name}=")).map(str::to_string);
    if a == "--prueba" {
      o.forced.get_or_insert(Forced::Ok);
    } else if let Some(v) = value("--prueba") {
      o.forced = Some(match v.as_str() {
        "rechazo" => Forced::Refused("desinstalador".into()),
        "abierto" => Forced::Open,
        "error" => Forced::Error,
        v if v.starts_with("rechazo:") => Forced::Refused(v["rechazo:".len()..].to_string()),
        _ => Forced::Ok,
      });
    } else if a == "--puerto" {
      o.port = it.next().and_then(|p| p.parse().ok());
    } else if let Some(v) = value("--puerto") {
      o.port = v.parse().ok();
    } else if let Some(v) = value("--lang") {
      o.lang = Some(v);
    } else if let Some(v) = value("--electron") {
      o.electron = Some(v);
    } else if let Some(v) = value("--pausa") {
      o.pause_ms = v.parse().unwrap_or(900);
    } else if let Some(v) = value("--abrir") {
      o.can_open = v != "no";
    } else if a == "--oculta" {
      o.hidden = true;
    }
  }
  o.forced.get_or_insert(Forced::Ok);
  o
}

#[cfg(test)]
mod tests {
  use super::*;

  fn args(a: &[&str]) -> Vec<OsString> {
    a.iter().map(OsString::from).collect()
  }

  #[test]
  fn a_build_without_setup_is_always_a_test() {
    assert!(!Mode::decide(&args(&[]), false, false).is_real());
    assert!(!Mode::decide(&args(&["--oculta"]), false, false).is_real());
  }

  #[test]
  fn a_real_build_is_real_unless_a_test_flag_is_given() {
    assert!(Mode::decide(&args(&[]), false, true).is_real());
    assert!(Mode::decide(&args(&["--puerto", "9333"]), false, true).is_real());
    assert!(!Mode::decide(&args(&["--prueba"]), false, true).is_real());
    assert!(!Mode::decide(&args(&["--prueba=error"]), false, true).is_real());
    assert!(Mode::decide(&args(&[]), true, true).is_real(), "an inherited variable does not make a real installer a test");
  }

  #[test]
  fn forced_endings_and_options_are_read() {
    let Mode::Test(o) = Mode::decide(&args(&["--prueba=rechazo:elevado", "--puerto", "9400", "--lang=en", "--electron=no", "--pausa=50", "--abrir=no"]), false, false) else { panic!() };
    assert_eq!(o.forced, Some(Forced::Refused("elevado".into())));
    assert_eq!(o.port, Some(9400));
    assert_eq!(o.lang.as_deref(), Some("en"));
    assert_eq!(o.electron.as_deref(), Some("no"));
    assert_eq!(o.pause_ms, 50);
    assert!(!o.can_open);
    let Mode::Test(o) = Mode::decide(&args(&["--prueba"]), false, false) else { panic!() };
    assert_eq!(o.forced, Some(Forced::Ok));
  }
}

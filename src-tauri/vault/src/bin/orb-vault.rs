// The tests' vault (npm test; src/core/master.mjs starts it when no app runs the engine): the same code as Orb.exe's,
// for one engine process. orb-vault --channel <pipe or folder> --grants <pipe or socket> [--test]
// --test: the tests' cheap scrypt costs and the caller's clock (a test moves time forward); never in Orb.exe.
// It ends when its engine closes the channel, or when none comes within a minute.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

fn main() {
  let args: Vec<String> = std::env::args().collect();
  let arg = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).cloned();
  let test = args.iter().any(|a| a == "--test");
  let (Some(channel), grants) = (arg("--channel"), arg("--grants")) else {
    eprintln!("orb-vault --channel <name> [--grants <name>] [--test]");
    std::process::exit(2);
  };
  let grants = orb_vault::start_grants(grants).unwrap_or_else(|e| {
    eprintln!("orb-vault: grants: {e}");
    std::process::exit(1);
  });
  let ch = orb_vault::EngineChannel::named(&channel).unwrap_or_else(|e| {
    eprintln!("orb-vault: {e}");
    std::process::exit(1);
  });
  let served = Arc::new(AtomicBool::new(false));
  let s = served.clone();
  std::thread::spawn(move || {
    std::thread::sleep(std::time::Duration::from_secs(60));
    if !s.load(Ordering::SeqCst) {
      std::process::exit(3);
    }
  });
  let server = orb_vault::Server { costs: orb_vault::Costs { test }, caller_clock: test, grants };
  served.store(true, Ordering::SeqCst);
  let _ = ch.serve(&server, None);
}

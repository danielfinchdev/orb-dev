//! A harmless stand-in for the NSIS setup, only for the tests (feature `fake-setup`). It installs nothing: it writes the
//! command line it received into the file given by `--marker` and exits with the code given by `--exit`.
fn main() {
  let args: Vec<String> = std::env::args().skip(1).collect();
  let value = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
  if let Some(marker) = value("--marker") {
    let _ = std::fs::write(marker, args.join("\n"));
  }
  std::process::exit(value("--exit").and_then(|c| c.parse().ok()).unwrap_or(0));
}

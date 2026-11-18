// Puts into the binary: Orb's version, the updater's PUBLIC key and, when ORB_SETUP names a file, the NSIS setup that
// `tauri build` made (plus its minisign signature from ORB_SETUP_SIG, if any) and the setup's SHA-256. Without ORB_SETUP
// the binary is a test build with no setup inside: it can only show the screens (see mode.rs). A setup always comes with its
// signature.
use sha2::{Digest, Sha256};
use std::{env, fs, path::PathBuf};

fn hex(bytes: &[u8]) -> String {
  bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn main() {
  let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
  let out = PathBuf::from(env::var("OUT_DIR").unwrap());
  let package_json = manifest.join("..").join("..").join("package.json");
  let conf_json = manifest.join("..").join("tauri.conf.json");
  for f in [&package_json, &conf_json] {
    println!("cargo:rerun-if-changed={}", f.display());
  }
  println!("cargo:rerun-if-changed=manifest.xml");
  println!("cargo:rerun-if-env-changed=ORB_SETUP");
  println!("cargo:rerun-if-env-changed=ORB_SETUP_SIG");
  println!("cargo:rerun-if-env-changed=ORB_VERSION");

  let version = env::var("ORB_VERSION").unwrap_or_else(|_| {
    let pkg: serde_json::Value = serde_json::from_slice(&fs::read(&package_json).expect("package.json")).expect("package.json is JSON");
    pkg["version"].as_str().expect("package.json version").to_string()
  });
  // The updater's public key (not a secret): the same one Orb's own updates are checked against.
  let conf: serde_json::Value = serde_json::from_slice(&fs::read(&conf_json).expect("tauri.conf.json")).expect("tauri.conf.json is JSON");
  let pubkey = conf["plugins"]["updater"]["pubkey"].as_str().expect("plugins.updater.pubkey").to_string();

  let mut code = String::new();
  code += &format!("pub const VERSION: &str = {version:?};\n");
  code += &format!("pub const UPDATER_PUBKEY: &str = {pubkey:?};\n");

  match env::var("ORB_SETUP").ok().filter(|s| !s.is_empty()) {
    Some(path) => {
      println!("cargo:rerun-if-changed={path}");
      let bytes = fs::read(&path).unwrap_or_else(|e| panic!("ORB_SETUP {path}: {e}"));
      let sha = hex(&Sha256::digest(&bytes));
      fs::write(out.join("setup.bin"), &bytes).unwrap();
      code += "pub const HAS_SETUP: bool = true;\n";
      code += &format!("pub static SETUP: &[u8] = include_bytes!({:?});\n", out.join("setup.bin").to_string_lossy());
      code += &format!("pub const SETUP_SHA256: &str = {sha:?};\n");
      match env::var("ORB_SETUP_SIG").ok().filter(|s| !s.is_empty()) {
        Some(sig_path) => {
          println!("cargo:rerun-if-changed={sig_path}");
          let sig = fs::read_to_string(&sig_path).unwrap_or_else(|e| panic!("ORB_SETUP_SIG {sig_path}: {e}"));
          // A signature that does not match the setup stops the build: better here than on someone's PC.
          verify_at_build(&bytes, &sig, &pubkey);
          code += &format!("pub const SETUP_SIG: Option<&str> = Some({:?});\n", sig.trim());
        }
        // A real installer is always signed: the hash alone comes from the same file and proves nothing about who made it.
        None => panic!("ORB_SETUP needs ORB_SETUP_SIG (the .sig made with the updater key)"),
      }
    }
    None => {
      code += "pub const HAS_SETUP: bool = false;\npub static SETUP: &[u8] = &[];\npub const SETUP_SHA256: &str = \"\";\npub const SETUP_SIG: Option<&str> = None;\n";
    }
  }
  fs::write(out.join("embedded.rs"), code).unwrap();

  // asInvoker (never asks for administrator rights: the installation is per user), DPI aware, no installer heuristics.
  if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") && env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
    println!("cargo:rustc-link-arg-bins=/MANIFEST:EMBED");
    // DLLs are only looked for in System32 (never next to the program, which may sit in Downloads).
    println!("cargo:rustc-link-arg-bins=/DEPENDENTLOADFLAG:0x800");
    println!("cargo:rustc-link-arg-bins=/MANIFESTINPUT:{}", manifest.join("manifest.xml").display());
  }
}

fn verify_at_build(bytes: &[u8], sig_file: &str, pubkey_b64: &str) {
  use base64::{engine::general_purpose::STANDARD, Engine};
  let text = |b64: &str| String::from_utf8(STANDARD.decode(b64.trim()).expect("base64")).expect("utf8");
  let key = minisign_verify::PublicKey::decode(&text(pubkey_b64)).expect("updater public key");
  let sig_text = if sig_file.trim_start().starts_with("untrusted comment:") { sig_file.to_string() } else { text(sig_file) };
  let sig = minisign_verify::Signature::decode(&sig_text).expect("ORB_SETUP_SIG is not a minisign signature");
  key.verify(bytes, &sig, true).expect("ORB_SETUP_SIG is not the updater key's signature of ORB_SETUP");
}

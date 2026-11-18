#![cfg_attr(windows, windows_subsystem = "windows")]
//! Orb's installer face (see lib.rs). Without WebView2 nothing is drawn: the same checked setup is started in its own
//! (classic) mode and this program ends with the setup's exit code.
mod window;

use orb_instalador::mode::Mode;
use orb_instalador::{embedded, run, webview2};

/// From here on, DLLs are only loaded from System32: a program that sits in Downloads must not pick up a library planted
/// beside it. (The linker flag /DEPENDENTLOADFLAG covers the ones loaded at start-up.)
fn restrict_dll_search() {
  use windows::Win32::System::LibraryLoader::{SetDefaultDllDirectories, LOAD_LIBRARY_SEARCH_SYSTEM32};
  // SAFETY: a plain call that only changes this process's DLL search order.
  let _ = unsafe { SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32) };
}

fn main() {
  restrict_dll_search();
  let args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
  let flag = std::env::var("ORB_INSTALADOR_PRUEBA").is_ok_and(|v| v == "1");
  let mode = Mode::decide(&args, flag, embedded::HAS_SETUP);
  if let Mode::Real(token) = &mode {
    if !webview2::installed() {
      run::classic_and_exit(token);
    }
  }
  window::run(mode)
}

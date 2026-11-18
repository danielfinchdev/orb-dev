//! Orb's installer face. The window only shows screens; what installs, uninstalls Orb 3.8.0 and makes the shortcuts is
//! the NSIS setup that `tauri build` generates, which travels inside this program and is checked before it runs.
pub mod embedded;
pub mod guard;
pub mod mode;
pub mod nsis;
pub mod procs;
pub mod registry;
pub mod run;
pub mod setup;
pub mod webview2;

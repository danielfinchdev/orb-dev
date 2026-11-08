// What the engine asks the app to do (src/engine/host.mjs): open a link or a folder with the system, or start a program
// that must outlive Orb (a terminal, an editor, a project's action). Every request is checked again here
// (protocol::check_host, the same rules as the engine's).
use crate::protocol::{check_host, HostRequest};
use serde_json::{json, Value};
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

pub async fn handle(app: &AppHandle, method: &str, params: &Value) -> Result<Value, String> {
  match check_host(method, params, |p: &Path| p.is_dir())? {
    HostRequest::OpenUrl(url) => app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())?,
    HostRequest::OpenPath(path) => app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())?,
    HostRequest::Spawn { cmd, args, cwd } => spawn_detached(&cmd, &args, &cwd)?,
  }
  Ok(json!(true))
}

/// A program on its own: a console program gets its own window, and it is outside the engine's Job Object (Rust starts
/// it, not the engine). If Orb itself runs inside a job that forbids leaving it, it starts inside that one.
fn spawn_detached(cmd: &str, args: &[String], cwd: &Path) -> Result<(), String> {
  let start = |flags: u32| {
    let mut c = std::process::Command::new(cmd);
    c.args(args).current_dir(cwd).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
      use std::os::windows::process::CommandExt;
      c.creation_flags(flags);
    }
    #[cfg(not(windows))]
    let _ = flags;
    c.spawn().map(drop)
  };
  const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
  const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
  const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
  start(CREATE_NEW_CONSOLE | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB)
    .or_else(|_| start(CREATE_NEW_CONSOLE | CREATE_NEW_PROCESS_GROUP))
    .map_err(|e| e.to_string())
}

// What the engine asks the app to do (src/engine/host.mjs): open a link or a folder with the system; open a terminal, an
// editor or a project's action (programs that must outlive Orb: started here, outside the engine's Job Object, the
// program picked here: tools.rs); and seal or open the approval secret with DPAPI (secrets.rs). Every request is checked
// again here (protocol::check_host, the same rules as the engine's).
use crate::protocol::{check_host, HostRequest};
use crate::tools::{self, Finder, Plan, Program};
use serde_json::{json, Value};
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

pub async fn handle(app: &AppHandle, method: &str, params: &Value) -> Result<Value, String> {
  let engine = crate::engine::get(app);
  let t = |key: &str, vars: &[(&str, String)]| engine.t(key, vars);
  Ok(match check_host(method, params, |p: &Path| p.is_dir())? {
    HostRequest::OpenUrl(url) => {
      app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())?;
      json!(true)
    }
    HostRequest::OpenPath(path) => {
      app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())?;
      json!(true)
    }
    HostRequest::OpenTerminal { dir, choice } => {
      let found = tools::find_terminals(&finder());
      let (name, plan) = tools::terminal_plan(&choice, &dir, &found).map_err(|n| t("sys.terminal.notInstalled", &[("name", n.into())]))?;
      let failed = |e: String| t("sys.terminal.openFailed", &[("name", name.into()), ("error", e)]);
      match plan {
        Plan::Url { url, fallback } => {
          if let Err(e) = app.opener().open_url(url, None::<&str>) {
            spawn_detached(&fallback.ok_or_else(|| failed(e.to_string()))?).map_err(failed)?;
          }
        }
        Plan::Run(p) => spawn_detached(&p).map_err(failed)?,
      }
      json!(name)
    }
    HostRequest::OpenEditor { which, dir } => {
      let name = if which == "vscode" { "VS Code" } else { "Cursor" };
      let exe = tools::find_editor(&finder(), &which).ok_or_else(|| t("sys.terminal.notInstalled", &[("name", name.into())]))?;
      let dir_text = dir.to_string_lossy().to_string();
      spawn_detached(&Program { cmd: exe, args: vec![dir_text], cwd: dir }).map_err(|e| t("sys.terminal.openFailed", &[("name", name.into()), ("error", e)]))?;
      json!(true)
    }
    HostRequest::RunAction { command, dir, choice } => {
      let p = tools::action_plan(&command, &dir, &tools::find_terminals(&finder()), &choice);
      spawn_detached(&p).map_err(|e| t("sys.terminal.openFailed", &[("name", "PowerShell".into()), ("error", e)]))?;
      json!(true)
    }
    HostRequest::Seal(text) => {
      use base64::Engine as _;
      json!({ "data": base64::engine::general_purpose::STANDARD.encode(crate::secrets::seal(&text)?) })
    }
    HostRequest::Unseal(blob) => json!({ "text": crate::secrets::unseal(&blob, &engine.local_state())? }),
  })
}

/// This PC's places and PATH, as they are now.
fn finder() -> Finder<'static> {
  Finder { env: &|k| std::env::var(k).ok(), exists: &|p| p.is_file() }
}

/// A program on its own: a console program gets its own window, and it is outside the engine's Job Object (Rust starts
/// it, not the engine). If Orb itself runs inside a job that forbids leaving it, it starts inside that one. Always an
/// absolute path (tools.rs), so nothing is looked for in the folder it starts in.
fn spawn_detached(p: &Program) -> Result<(), String> {
  if !p.cmd.is_absolute() {
    return Err("programa no válido".into());
  }
  let start = |flags: u32| {
    let mut c = std::process::Command::new(&p.cmd);
    c.args(&p.args).current_dir(&p.cwd).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
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

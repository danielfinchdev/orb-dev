// What the engine asks the app to do (src/engine/host/host.mjs): open a link or a folder with the system; open a terminal, an
// editor or a project's action (programs that must outlive Orb: started here, outside the engine's Job Object, the
// program picked here: tools.rs). Every request is checked
// again here (protocol::check_host, the same rules as the engine's). And the agents' browser and its little window
// (host.browser.*, host.pip.*: browser.rs, pip.rs, checked by browser_rules.rs).
use crate::protocol::{check_host, HostRequest};
use crate::tools::{self, Finder, Plan, Program};
use serde_json::{json, Value};
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

/// An error for the engine; `code` when it must tell kinds apart.
pub struct HostError {
  pub message: String,
  pub code: Option<&'static str>,
}
impl From<String> for HostError {
  fn from(message: String) -> Self {
    Self { message, code: None }
  }
}

pub async fn handle(app: &AppHandle, method: &str, params: &Value) -> Result<Value, HostError> {
  if let Some(req) = crate::browser_rules::check_browser(method, params) {
    return Ok(crate::browser::handle(app, req?).await?);
  }
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
    HostRequest::Screenshot(path) => crate::screenshot::capture(path).await?,
    HostRequest::TrashFolder { path, token, forever } => {
      let home = engine.home().ok_or_else(|| "sin carpeta de trabajo".to_string())?;
      crate::uninstall::trash_marked(home, path.to_string_lossy().to_string(), token, forever).await?
    }
    HostRequest::UninstallCheck => json!({ "ready": crate::uninstall::installer_path().is_some() }),
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
    HostRequest::OpenEditor { which, dir, file, line } => {
      let name = match which.as_str() {
        "vscode" => "VS Code",
        "windsurf" => "Windsurf",
        "zed" => "Zed",
        "jetbrains" => "JetBrains",
        _ => "Cursor",
      };
      let exe = tools::find_editor(&finder(), &which).ok_or_else(|| t("sys.terminal.notInstalled", &[("name", name.into())]))?;
      // The editors are always .exe (tools.rs › find_editor), so no shell rereads the name. The file must exist and, once
      // links are resolved, stay inside the folder; the editor gets that resolved path (without the long-path prefix), so
      // what is opened is what was checked.
      let resolved = match &file {
        Some(f) => match (f.canonicalize(), dir.canonicalize()) {
          (Ok(c), Ok(d)) if f.is_file() && c.starts_with(&d) => Some(tools::plain_path(&c)),
          _ => return Err("archivo no válido".to_string().into()),
        },
        None => None,
      };
      let args = tools::editor_args(&which, &dir, resolved.as_deref(), line);
      // Checks the .exe that is started: a valid embedded signature from the editor's maker. It does not cover what the
      // editor loads later from its own folder (resources, DLLs, JVM options), which in a per-user install any program of
      // the user can write. The file stays open without write access (`verified`) until it has started, and the path that
      // is started is the one the open file really has.
      use crate::signature::{expected_signer, verify_editor, Expected, Failure};
      let canonical = std::fs::canonicalize(&exe).map(|c| tools::plain_path(&c));
      let shown = canonical.as_ref().unwrap_or(&exe).to_string_lossy().into_owned();
      let verified = match &canonical {
        Ok(c) => verify_editor(c, &which),
        Err(_) => Err(Failure::Unreadable),
      }
      .map_err(|f| {
        let expected = match expected_signer(&which) {
          Expected::Named(names) => names.first().copied().unwrap_or("").to_string(),
          Expected::AnyTrusted => String::new(),
        };
        let (name, path) = (name.to_string(), shown.clone());
        match f {
          Failure::Unsigned => t("sys.editor.unsigned", &[("name", name), ("path", path)]),
          Failure::WrongSigner(found) => t("sys.editor.wrongSigner", &[("name", name), ("found", found), ("expected", expected), ("path", path)]),
          Failure::Unreadable => t("sys.editor.unreadable", &[("name", name), ("path", path)]),
        }
      })?;
      spawn_detached(&Program { cmd: verified.path.clone(), args, cwd: dir }).map_err(|e| t("sys.terminal.openFailed", &[("name", name.into()), ("error", e)]))?;
      json!(true)
    }
    HostRequest::RunAction { command, dir, choice } => {
      let p = tools::action_plan(&command, &dir, &tools::find_terminals(&finder()), &choice);
      spawn_detached(&p).map_err(|e| t("sys.terminal.openFailed", &[("name", "PowerShell".into()), ("error", e)]))?;
      json!(true)
    }
  })
}

/// This PC's places and PATH, as they are now. Windows' own folder from Windows itself, not from the environment.
fn finder() -> Finder<'static> {
  Finder {
    env: &|k| match k {
      "SystemRoot" | "windir" => windows_dir().or_else(|| std::env::var(k).ok()),
      _ => std::env::var(k).ok(),
    },
    exists: &|p| p.is_file(),
  }
}

#[cfg(windows)]
fn windows_dir() -> Option<String> {
  use windows::Win32::System::SystemInformation::GetSystemWindowsDirectoryW;
  let mut buf = [0u16; 260];
  // SAFETY: a buffer of MAX_PATH wide characters; the call writes at most that many.
  let n = unsafe { GetSystemWindowsDirectoryW(Some(&mut buf)) } as usize;
  (n > 0 && n < buf.len()).then(|| String::from_utf16_lossy(&buf[..n]))
}
#[cfg(not(windows))]
fn windows_dir() -> Option<String> {
  None
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

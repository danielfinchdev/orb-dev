// The programs the engine may ask for by kind (host.openTerminal, host.openEditor, host.runAction): the app picks them
// itself, from the places they install to on this PC, always as absolute paths (a bare name would also be looked for in
// the folder it starts in, where a project could plant one). The same choices as src/engine/host/terminal.mjs and
// editors.mjs (Ctrl+J, God mode's editors, a project's actions); Ajustes → Interfaz can force a terminal.
use std::path::{Path, PathBuf};

/// Where a program would be: one of its usual places, or a folder of the PATH (absolute folders only).
pub struct Finder<'a> {
  pub env: &'a dyn Fn(&str) -> Option<String>,
  pub exists: &'a dyn Fn(&Path) -> bool,
}

impl Finder<'_> {
  fn var(&self, k: &str) -> Option<PathBuf> {
    (self.env)(k).filter(|v| !v.is_empty()).map(PathBuf::from)
  }
  fn first(&self, candidates: Vec<Option<PathBuf>>) -> Option<PathBuf> {
    candidates.into_iter().flatten().find(|p| p.is_absolute() && (self.exists)(p))
  }
  fn in_path(&self, file: &str) -> Option<PathBuf> {
    let path = (self.env)("PATH").unwrap_or_default();
    path.split(';').map(PathBuf::from).filter(|d| d.is_absolute()).map(|d| d.join(file)).find(|p| (self.exists)(p))
  }
  fn system32(&self) -> PathBuf {
    self.var("SystemRoot").or_else(|| self.var("windir")).filter(|p| p.is_absolute()).unwrap_or_else(|| PathBuf::from("C:\\Windows")).join("System32")
  }
}

#[derive(Debug, PartialEq, Default)]
pub struct Terminals {
  pub warp: Option<PathBuf>,
  pub wt: Option<PathBuf>,
  pub powershell: PathBuf,
  pub cmd: PathBuf,
}

pub fn find_terminals(f: &Finder) -> Terminals {
  let local = f.var("LOCALAPPDATA");
  let programs = f.var("ProgramFiles").unwrap_or_else(|| PathBuf::from("C:\\Program Files"));
  let system = f.system32();
  Terminals {
    warp: f
      .first(vec![local.as_ref().map(|l| l.join("Programs").join("Warp").join("warp.exe")), Some(programs.join("Warp").join("warp.exe"))])
      .or_else(|| f.in_path("warp.exe")),
    wt: f.first(vec![local.as_ref().map(|l| l.join("Microsoft").join("WindowsApps").join("wt.exe"))]).or_else(|| f.in_path("wt.exe")),
    // Windows' own, from System32 first: a folder of the user's PATH (WindowsApps, npm…) is writable by any program, and
    // ComSpec is the user's to change. The PATH only when Windows' PowerShell is not there (removed by an admin).
    powershell: f
      .first(vec![Some(system.join("WindowsPowerShell").join("v1.0").join("powershell.exe"))])
      .or_else(|| f.in_path("powershell.exe"))
      .unwrap_or_else(|| system.join("WindowsPowerShell").join("v1.0").join("powershell.exe")),
    cmd: system.join("cmd.exe"),
  }
}

pub fn find_editor(f: &Finder, which: &str) -> Option<PathBuf> {
  let local = f.var("LOCALAPPDATA");
  let programs = f.var("ProgramFiles").unwrap_or_else(|| PathBuf::from("C:\\Program Files"));
  let programs86 = f.var("ProgramFiles(x86)").unwrap_or_else(|| PathBuf::from("C:\\Program Files (x86)"));
  match which {
    "cursor" => f.first(vec![local.map(|l| l.join("Programs").join("cursor").join("Cursor.exe")), Some(programs.join("Cursor").join("Cursor.exe"))]),
    "vscode" => f.first(vec![
      local.map(|l| l.join("Programs").join("Microsoft VS Code").join("Code.exe")),
      Some(programs.join("Microsoft VS Code").join("Code.exe")),
      Some(programs86.join("Microsoft VS Code").join("Code.exe")),
    ]),
    _ => None,
  }
}

/// A program and its arguments as a list (never a shell line), started in `cwd`.
#[derive(Debug, PartialEq)]
pub struct Program {
  pub cmd: PathBuf,
  pub args: Vec<String>,
  pub cwd: PathBuf,
}

#[derive(Debug, PartialEq)]
pub enum Plan {
  /// Warp's own link to open a tab in the folder; if it cannot be opened, Warp itself in the folder.
  Url { url: String, fallback: Option<Program> },
  Run(Program),
}

/// The terminal's name (as the engine's terminal.mjs says it) and how to open it. Err: the name of the terminal chosen
/// that this PC does not have.
pub fn terminal_plan(choice: &str, dir: &Path, found: &Terminals) -> Result<(&'static str, Plan), &'static str> {
  let d = dir.to_string_lossy().to_string();
  let pick = match choice {
    "auto" | "" => {
      if found.warp.is_some() {
        "warp"
      } else if found.wt.is_some() {
        "wt"
      } else {
        "powershell"
      }
    }
    c => c,
  };
  let run = |cmd: &Path, args: Vec<String>| Plan::Run(Program { cmd: cmd.to_path_buf(), args, cwd: dir.to_path_buf() });
  Ok(match pick {
    "warp" => {
      let warp = found.warp.as_ref().ok_or("Warp")?;
      ("Warp", Plan::Url { url: format!("warp://action/new_tab?path={}", encode_component(&d)), fallback: Some(Program { cmd: warp.clone(), args: vec![], cwd: dir.to_path_buf() }) })
    }
    // wt reads «;» as a separator between its own commands: escaped, a folder such as «a;b» still works.
    "wt" => ("Windows Terminal", run(found.wt.as_ref().ok_or("Windows Terminal")?, vec!["-d".into(), d.replace(';', "\\;")])),
    "cmd" => ("CMD", run(&found.cmd, vec![])),
    _ => ("PowerShell", run(&found.powershell, vec!["-NoExit".into(), "-NoLogo".into()])),
  })
}

/// A project's action in a terminal window that stays open with its output: Windows Terminal (its «;» escaped) or
/// PowerShell; CMD when chosen in Ajustes.
pub fn action_plan(command: &str, dir: &Path, found: &Terminals, choice: &str) -> Program {
  let d = dir.to_string_lossy().to_string();
  let (cmd, args) = if choice == "cmd" {
    (found.cmd.clone(), vec!["/k".to_string(), command.to_string()])
  } else if let (Some(wt), false) = (&found.wt, choice == "powershell") {
    let ps = found.powershell.to_string_lossy().to_string();
    (wt.clone(), vec!["-d".into(), d.replace(';', "\\;"), ps, "-NoExit".into(), "-NoLogo".into(), "-Command".into(), command.replace(';', "\\;")])
  } else {
    (found.powershell.clone(), vec!["-NoExit".into(), "-NoLogo".into(), "-Command".into(), command.to_string()])
  };
  Program { cmd, args, cwd: dir.to_path_buf() }
}

/// encodeURIComponent.
fn encode_component(s: &str) -> String {
  let mut out = String::new();
  for b in s.bytes() {
    if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
      out.push(b as char);
    } else {
      out.push_str(&format!("%{b:02X}"));
    }
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::collections::{HashMap, HashSet};

  fn finder<'a>(env: &'a HashMap<&str, &str>, files: &'a HashSet<PathBuf>) -> (impl Fn(&str) -> Option<String> + 'a, impl Fn(&Path) -> bool + 'a) {
    (move |k: &str| env.get(k).map(|v| v.to_string()), move |p: &Path| files.contains(p))
  }

  #[test]
  fn terminals_and_editors_are_absolute_and_never_from_a_relative_path() {
    let env = HashMap::from([
      ("LOCALAPPDATA", "C:\\Users\\a\\AppData\\Local"),
      ("SystemRoot", "C:\\Windows"),
      ("PATH", ".;;relativa;C:\\herramientas"),
      ("ComSpec", "C:\\Users\\a\\cmd.exe"),
    ]);
    // A powershell.exe and a wt.exe in «.» or a relative folder of the PATH are never picked.
    let files: HashSet<PathBuf> = ["powershell.exe", ".\\powershell.exe", "relativa\\wt.exe", "C:\\herramientas\\warp.exe", "C:\\Users\\a\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"]
      .iter()
      .map(PathBuf::from)
      .collect();
    let (e, x) = finder(&env, &files);
    let f = Finder { env: &e, exists: &x };
    let t = find_terminals(&f);
    assert_eq!(t.warp, Some(PathBuf::from("C:\\herramientas\\warp.exe")));
    assert_eq!(t.wt, None);
    assert_eq!(t.powershell, PathBuf::from("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"));
    assert_eq!(t.cmd, PathBuf::from("C:\\Windows\\System32\\cmd.exe"), "ComSpec is ignored");
    // Windows' PowerShell wins over one in a folder of the PATH.
    let both: HashSet<PathBuf> = ["C:\\herramientas\\powershell.exe", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"].iter().map(PathBuf::from).collect();
    let (e2, x2) = finder(&env, &both);
    assert_eq!(find_terminals(&Finder { env: &e2, exists: &x2 }).powershell, PathBuf::from("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"));
    // Only when it is not there, the PATH's (absolute folders only).
    let only_path: HashSet<PathBuf> = ["C:\\herramientas\\powershell.exe"].iter().map(PathBuf::from).collect();
    let (e3, x3) = finder(&env, &only_path);
    assert_eq!(find_terminals(&Finder { env: &e3, exists: &x3 }).powershell, PathBuf::from("C:\\herramientas\\powershell.exe"));
    assert_eq!(find_editor(&f, "vscode"), Some(PathBuf::from("C:\\Users\\a\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe")));
    assert_eq!(find_editor(&f, "cursor"), None);
    assert_eq!(find_editor(&f, "notepad"), None);
  }

  #[test]
  fn plans_match_the_engine() {
    let dir = Path::new("C:\\p\\a;b");
    let all = Terminals { warp: Some("C:\\W\\warp.exe".into()), wt: Some("C:\\A\\wt.exe".into()), powershell: "C:\\PS\\powershell.exe".into(), cmd: "C:\\S\\cmd.exe".into() };
    let none = Terminals { powershell: "C:\\PS\\powershell.exe".into(), cmd: "C:\\S\\cmd.exe".into(), ..Default::default() };
    let (name, plan) = terminal_plan("auto", dir, &all).unwrap();
    assert_eq!(name, "Warp");
    assert_eq!(plan, Plan::Url { url: "warp://action/new_tab?path=C%3A%5Cp%5Ca%3Bb".into(), fallback: Some(Program { cmd: "C:\\W\\warp.exe".into(), args: vec![], cwd: dir.into() }) });
    assert_eq!(terminal_plan("wt", dir, &all).unwrap(), ("Windows Terminal", Plan::Run(Program { cmd: "C:\\A\\wt.exe".into(), args: vec!["-d".into(), "C:\\p\\a\\;b".into()], cwd: dir.into() })));
    assert_eq!(terminal_plan("cmd", dir, &all).unwrap().0, "CMD");
    assert_eq!(terminal_plan("auto", dir, &none).unwrap(), ("PowerShell", Plan::Run(Program { cmd: "C:\\PS\\powershell.exe".into(), args: vec!["-NoExit".into(), "-NoLogo".into()], cwd: dir.into() })));
    assert_eq!(terminal_plan("warp", dir, &none).unwrap_err(), "Warp");
    assert_eq!(terminal_plan("wt", dir, &none).unwrap_err(), "Windows Terminal");
    assert_eq!(action_plan("npm run dev", dir, &all, "cmd"), Program { cmd: "C:\\S\\cmd.exe".into(), args: vec!["/k".into(), "npm run dev".into()], cwd: dir.into() });
    assert_eq!(
      action_plan("a; b", dir, &all, "auto").args,
      vec!["-d", "C:\\p\\a\\;b", "C:\\PS\\powershell.exe", "-NoExit", "-NoLogo", "-Command", "a\\; b"].iter().map(|s| s.to_string()).collect::<Vec<_>>()
    );
    assert_eq!(action_plan("x", dir, &all, "powershell").cmd, PathBuf::from("C:\\PS\\powershell.exe"));
    assert_eq!(action_plan("x", dir, &none, "auto").args, vec!["-NoExit", "-NoLogo", "-Command", "x"]);
  }
}

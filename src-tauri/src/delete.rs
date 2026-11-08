// «Eliminar proyecto» (3.8.1), the same steps as Orb 3.8.0 took. The engine checks the master
// password's token, that nothing of the project works and what may go (projects.deleteCheck: from then on nothing of it
// starts, and it returns a one-off ticket); the folder is checked here again by its real path and moved to the Recycle
// Bin (never deleted for good on the way: a folder the Recycle Bin cannot take stays); then the engine takes the project
// out with that ticket (projects.delete, trashed). When the Recycle Bin cannot take it:
//   - some program is using the folder → { ok: false, locked: true, path }: the window offers only «Reintentar»;
//   - otherwise → { ok: false, noTrash: true, path }: «Reintentar» or «Borrar para siempre» (the engine deletes it).
// step: None (start; unlock: the token) | "retry" | "forever" (only after a noTrash for that same project) | "cancel"
// (the project works again). A delete under way is kept here, by name, with its ticket and folder.
use crate::engine::Engine;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Clone)]
struct Pending {
  ticket: String,
  path: PathBuf,
  no_trash: bool,
}

#[derive(Default)]
pub struct Deletes(Mutex<HashMap<String, Pending>>);

impl Deletes {
  fn get(&self, name: &str) -> Option<Pending> {
    self.0.lock().unwrap().get(name).cloned()
  }
  fn set(&self, name: &str, p: Pending) {
    self.0.lock().unwrap().insert(name.to_string(), p);
  }
  fn take(&self, name: &str) -> Option<Pending> {
    self.0.lock().unwrap().remove(name)
  }
}

const NO_PREFIX: &str = r"\\?\";
fn plain(p: &Path) -> String {
  let s = p.to_string_lossy();
  s.strip_prefix(NO_PREFIX).unwrap_or(&s).to_lowercase()
}

/// The workspace's categories (src/core/layout.mjs › CATEGORIES): only a project folder inside one of them can go.
const CATEGORIES: [&str; 6] = ["windows", "linux", "ios", "android", "web", "multi"];
/// Names inside a category that are never a project (src/core/home.mjs › isReservedInCategory): hidden folders, the
/// Recycle Bin, node_modules and Orb 3.7's adb folder in android.
fn reserved_in_category(category: &str, name: &str) -> bool {
  name.starts_with('.') || name == "node_modules" || name == "$recycle.bin" || (category == "android" && name == "adb-tools")
}

/// The folder the engine named, checked again here as src/core/project-close.mjs › deletableFolder: a real folder of this
/// PC (not a link or a junction), exactly two levels inside the workspace (<category>\<name>), by its real path, in one
/// of the workspace's own category folders (never core, its data or its secrets) and not a reserved name. → that real
/// path.
pub fn checked_folder(home: &Path, folder: &str) -> Option<PathBuf> {
  let p = Path::new(folder);
  if !p.is_absolute() || folder.starts_with(r"\\") || folder.starts_with("//") {
    return None;
  }
  let meta = std::fs::symlink_metadata(p).ok()?;
  if meta.file_type().is_symlink() || !meta.is_dir() {
    return None;
  }
  let real = std::fs::canonicalize(p).ok()?;
  let root = std::fs::canonicalize(home).ok()?;
  let (real_s, root_s) = (plain(&real), plain(&root));
  let rest = real_s.strip_prefix(&format!("{}\\", root_s.trim_end_matches('\\')))?;
  let parts: Vec<&str> = rest.split('\\').collect();
  if parts.len() != 2 || parts.iter().any(|x| x.is_empty() || *x == "." || *x == "..") || plain(p) != real_s {
    return None;
  }
  let (category, name) = (parts[0], parts[1]);
  if !CATEGORIES.contains(&category) || reserved_in_category(category, name) {
    return None;
  }
  // The category itself is the workspace's own folder (not a link to somewhere else).
  let cat_real = std::fs::canonicalize(root.join(category)).ok()?;
  if plain(&cat_real) != format!("{}\\{}", root_s.trim_end_matches('\\'), category) {
    return None;
  }
  Some(PathBuf::from(real.to_string_lossy().strip_prefix(NO_PREFIX).unwrap_or(&real.to_string_lossy()).to_string()))
}

const PROBE: &str = ".orb-comprobando-";

/// What the in-use probe found.
#[derive(Debug, PartialEq)]
pub enum InUse {
  Free,
  Busy,
  /// Renamed for the probe and Windows would not let the name come back (an antivirus or the indexer took it just then):
  /// the folder is at this path now. Tried again in the background and at the next step (put_back).
  Stuck(PathBuf),
}

/// A probe left behind by an earlier step (`<folder>.orb-comprobando-xxxxxx` and no `<folder>`): its name comes back.
/// → false when it is still there.
pub fn put_back(dir: &Path) -> bool {
  if dir.exists() {
    return true;
  }
  let (Some(parent), Some(name)) = (dir.parent(), dir.file_name()) else { return true };
  let prefix = format!("{}{PROBE}", name.to_string_lossy());
  let Ok(entries) = std::fs::read_dir(parent) else { return true };
  for e in entries.flatten() {
    let n = e.file_name().to_string_lossy().to_string();
    if n.starts_with(&prefix) && n.len() == prefix.len() + 6 && e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
      return std::fs::rename(e.path(), dir).is_ok();
    }
  }
  true
}

/// Some program is using the folder (its working folder, an open file): Windows does not let it be renamed. Tried with a
/// rename beside it and back, as src/core/project-close.mjs › folderInUse. The folder never stays under the probe's
/// name without saying where it is.
pub fn folder_in_use(dir: &Path) -> InUse {
  if !put_back(dir) {
    return InUse::Busy;
  }
  if !dir.is_dir() {
    return InUse::Free;
  }
  let probe = PathBuf::from(format!("{}{PROBE}{:06x}", dir.to_string_lossy(), std::process::id() ^ (std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0) & 0xffffff)));
  if std::fs::rename(dir, &probe).is_err() {
    return InUse::Busy;
  }
  for _ in 0..50 {
    if std::fs::rename(&probe, dir).is_ok() {
      return InUse::Free;
    }
    std::thread::sleep(Duration::from_millis(100));
  }
  // Still kept trying for a while on its own.
  let (from, to) = (probe.clone(), dir.to_path_buf());
  let _ = std::thread::Builder::new().name("orb-devolver-nombre".into()).spawn(move || {
    for _ in 0..120 {
      if std::fs::rename(&from, &to).is_ok() || !from.exists() {
        return;
      }
      std::thread::sleep(Duration::from_millis(500));
    }
  });
  InUse::Stuck(probe)
}

/// The window's answer for a folder that is not free (Busy: «Reintentar»; Stuck: the error says where the folder is).
fn not_free(engine: &Arc<Engine>, deletes: &Deletes, name: &str, d: Pending, real: &Path, found: InUse) -> Result<Value, String> {
  deletes.set(name, Pending { no_trash: false, ..d });
  match found {
    InUse::Stuck(at) => Err(engine.t("sys.main.folderProbeStuck", &[("path", at.to_string_lossy().to_string())])),
    _ => Ok(json!({ "ok": false, "locked": true, "path": real })),
  }
}

pub async fn delete_project(engine: Arc<Engine>, deletes: &Deletes, name: String, unlock: Option<String>, step: Option<String>) -> Result<Value, String> {
  let bad = || engine.t("sys.main.badAction", &[]);
  if name.is_empty() || name.chars().count() > 200 {
    return Err(bad());
  }
  let home = engine.home().ok_or_else(|| engine.t("sys.main.badPath", &[]))?;
  let abort = |ticket: String| {
    let e = engine.clone();
    let name = name.clone();
    async move {
      let _ = e.call("projects.deleteAbort", json!({ "name": name, "ticket": ticket }), Duration::from_secs(30)).await;
    }
  };
  match step.as_deref() {
    Some("cancel") => {
      if let Some(d) = deletes.take(&name) {
        abort(d.ticket).await;
      }
      return Ok(json!({ "ok": false, "cancelled": true }));
    }
    Some(s @ ("retry" | "forever")) => {
      let d = deletes.get(&name).ok_or_else(bad)?;
      if s == "forever" && !d.no_trash {
        return Err(bad());
      }
      if s == "retry" {
        return trash_step(&engine, deletes, &home, &name, d).await;
      }
      put_back(&d.path);
      let real = checked_folder(&home, &d.path.to_string_lossy()).ok_or_else(bad)?;
      let found = folder_in_use(&real);
      if found != InUse::Free {
        return not_free(&engine, deletes, &name, d, &real, found);
      }
      deletes.take(&name); // one try: a delete that stops half-way says what is left, and the project works again
      let out = engine.call("projects.delete", json!({ "name": name, "ticket": d.ticket }), Duration::from_secs(600)).await?;
      return Ok(merge(json!({ "ok": true }), out));
    }
    Some(_) => return Err(bad()),
    None => {}
  }
  if let Some(d) = deletes.take(&name) {
    abort(d.ticket).await;
  }
  let check = engine.call("projects.deleteCheck", json!({ "name": name, "unlock": unlock.unwrap_or_default() }), Duration::from_secs(30)).await?;
  let ticket = check.get("ticket").and_then(Value::as_str).unwrap_or_default().to_string();
  let path = check.get("path").and_then(Value::as_str).unwrap_or_default().to_string();
  let next = Pending { ticket: ticket.clone(), path: PathBuf::from(&path), no_trash: false };
  deletes.set(&name, next.clone());
  match trash_step(&engine, deletes, &home, &name, next).await {
    Ok(v) => Ok(v),
    Err(e) => {
      // Not even checked here (the folder is not one Orb may delete): the project works again.
      if deletes.get(&name).map(|d| d.ticket == ticket).unwrap_or(false) {
        deletes.take(&name);
        abort(ticket).await;
      }
      Err(e)
    }
  }
}

async fn trash_step(engine: &Arc<Engine>, deletes: &Deletes, home: &Path, name: &str, d: Pending) -> Result<Value, String> {
  put_back(&d.path);
  let real = checked_folder(home, &d.path.to_string_lossy()).ok_or_else(|| engine.t("sys.main.badAction", &[]))?;
  let target = real.clone();
  // A thread of its own for COM (STA): a pooled blocking thread may have been left in another apartment.
  let (tx, rx) = tokio::sync::oneshot::channel();
  std::thread::Builder::new().name("orb-papelera".into()).spawn(move || { let _ = tx.send(trash(&target)); }).map_err(|e| e.to_string())?;
  let trashed = rx.await.unwrap_or_else(|_| Err("papelera: el hilo terminó".into()));
  if trashed.is_err() || real.exists() {
    let found = folder_in_use(&real);
    if found != InUse::Free {
      return not_free(engine, deletes, name, d, &real, found);
    }
    deletes.set(name, Pending { no_trash: true, ..d });
    return Ok(json!({ "ok": false, "noTrash": true, "path": real }));
  }
  deletes.take(name);
  let out = engine.call("projects.delete", json!({ "name": name, "ticket": d.ticket, "trashed": true }), Duration::from_secs(60)).await?;
  Ok(merge(json!({ "ok": true }), out))
}

fn merge(mut a: Value, b: Value) -> Value {
  if let (Some(m), Value::Object(extra)) = (a.as_object_mut(), b) {
    m.extend(extra);
  }
  a
}

/// To the Recycle Bin only: what the Recycle Bin cannot take (too big, a drive without one) is never deleted for good on
/// the way (the shell would, silently): the operation is stopped before it (PreDeleteItem without
/// TSF_DELETE_RECYCLE_IF_POSSIBLE), as Electron's shell.trashItem does.
#[cfg(windows)]
pub fn trash(path: &Path) -> Result<(), String> {
  use windows::core::{implement, Ref, HRESULT, HSTRING, PCWSTR};
  use windows::Win32::Foundation::E_ABORT;
  use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED};
  use windows::Win32::UI::Shell::*;

  #[implement(IFileOperationProgressSink)]
  struct RecycleOnly;
  #[allow(non_snake_case)]
  impl IFileOperationProgressSink_Impl for RecycleOnly_Impl {
    fn StartOperations(&self) -> windows::core::Result<()> {
      Ok(())
    }
    fn FinishOperations(&self, _: HRESULT) -> windows::core::Result<()> {
      Ok(())
    }
    fn PreRenameItem(&self, _: u32, _: Ref<IShellItem>, _: &PCWSTR) -> windows::core::Result<()> {
      Ok(())
    }
    fn PostRenameItem(&self, _: u32, _: Ref<IShellItem>, _: &PCWSTR, _: HRESULT, _: Ref<IShellItem>) -> windows::core::Result<()> {
      Ok(())
    }
    fn PreMoveItem(&self, _: u32, _: Ref<IShellItem>, _: Ref<IShellItem>, _: &PCWSTR) -> windows::core::Result<()> {
      Ok(())
    }
    fn PostMoveItem(&self, _: u32, _: Ref<IShellItem>, _: Ref<IShellItem>, _: &PCWSTR, _: HRESULT, _: Ref<IShellItem>) -> windows::core::Result<()> {
      Ok(())
    }
    fn PreCopyItem(&self, _: u32, _: Ref<IShellItem>, _: Ref<IShellItem>, _: &PCWSTR) -> windows::core::Result<()> {
      Ok(())
    }
    fn PostCopyItem(&self, _: u32, _: Ref<IShellItem>, _: Ref<IShellItem>, _: &PCWSTR, _: HRESULT, _: Ref<IShellItem>) -> windows::core::Result<()> {
      Ok(())
    }
    fn PreDeleteItem(&self, flags: u32, _: Ref<IShellItem>) -> windows::core::Result<()> {
      if flags & (TSF_DELETE_RECYCLE_IF_POSSIBLE.0 as u32) == 0 {
        Err(E_ABORT.into())
      } else {
        Ok(())
      }
    }
    fn PostDeleteItem(&self, _: u32, _: Ref<IShellItem>, _: HRESULT, _: Ref<IShellItem>) -> windows::core::Result<()> {
      Ok(())
    }
    fn PreNewItem(&self, _: u32, _: Ref<IShellItem>, _: &PCWSTR) -> windows::core::Result<()> {
      Ok(())
    }
    fn PostNewItem(&self, _: u32, _: Ref<IShellItem>, _: &PCWSTR, _: &PCWSTR, _: u32, _: HRESULT, _: Ref<IShellItem>) -> windows::core::Result<()> {
      Ok(())
    }
    fn UpdateProgress(&self, _: u32, _: u32) -> windows::core::Result<()> {
      Ok(())
    }
    fn ResetTimer(&self) -> windows::core::Result<()> {
      Ok(())
    }
    fn PauseTimer(&self) -> windows::core::Result<()> {
      Ok(())
    }
    fn ResumeTimer(&self) -> windows::core::Result<()> {
      Ok(())
    }
  }

  // SAFETY: COM on this thread (one of its own: trash_step) for the length of the operation; every interface is released before
  // CoUninitialize.
  unsafe {
    let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    let result = (|| -> windows::core::Result<bool> {
      let op: IFileOperation = CoCreateInstance(&FileOperation, None, CLSCTX_ALL)?;
      op.SetOperationFlags(FOF_NO_UI | FOF_ALLOWUNDO | FOFX_RECYCLEONDELETE | FOFX_EARLYFAILURE)?;
      let item: IShellItem = SHCreateItemFromParsingName(&HSTRING::from(path.as_os_str()), None)?;
      let sink: IFileOperationProgressSink = RecycleOnly.into();
      op.DeleteItem(&item, &sink)?;
      op.PerformOperations()?;
      Ok(op.GetAnyOperationsAborted()?.as_bool())
    })();
    if init.is_ok() {
      CoUninitialize();
    }
    match result {
      Ok(false) => Ok(()),
      Ok(true) => Err("la Papelera no lo admite".into()),
      Err(e) => Err(e.to_string()),
    }
  }
}

#[cfg(not(windows))]
pub fn trash(_: &Path) -> Result<(), String> {
  Err("solo en Windows".into())
}

#[cfg(all(test, windows))]
mod tests {
  use super::*;

  #[test]
  fn only_folders_two_levels_inside_the_workspace_and_in_use_is_seen() {
    let home = std::env::temp_dir().join(format!("orb-borrar-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    let project = home.join("web").join("demo");
    std::fs::create_dir_all(&project).unwrap();
    std::fs::write(project.join("a.txt"), "x").unwrap();
    let real = checked_folder(&home, &project.to_string_lossy()).expect("la carpeta del proyecto");
    assert_eq!(plain(&real), plain(&std::fs::canonicalize(&project).unwrap()));
    assert!(checked_folder(&home, &home.join("web").to_string_lossy()).is_none(), "la categoría");
    assert!(checked_folder(&home, &home.to_string_lossy()).is_none(), "el espacio");
    assert!(checked_folder(&home, &project.join("..").join("demo").to_string_lossy()).is_none(), "con ..");
    assert!(checked_folder(&home, "relativa\\demo").is_none());
    assert!(checked_folder(&home, r"\\servidor\recurso\web\demo").is_none());
    assert!(checked_folder(&home, &project.join("a.txt").to_string_lossy()).is_none(), "un archivo");
    // As deletableFolder: only inside a category, never core (its data, its secrets) nor a reserved name.
    for (cat, name) in [("core", "datos"), ("core", "secretos"), ("otra", "demo"), ("web", ".git"), ("web", "node_modules"), ("android", "adb-tools")] {
      let f = home.join(cat).join(name);
      std::fs::create_dir_all(&f).unwrap();
      assert!(checked_folder(&home, &f.to_string_lossy()).is_none(), "{cat}\\{name}");
    }
    // A junction inside the workspace to a folder outside it is never followed.
    let outside = std::env::temp_dir().join(format!("orb-borrar-fuera-{}", std::process::id()));
    std::fs::create_dir_all(&outside).unwrap();
    let link = home.join("web").join("enlace");
    let made = std::process::Command::new(r"C:\Windows\System32\cmd.exe").args(["/c", "mklink", "/J"]).arg(&link).arg(&outside).output().map(|o| o.status.success()).unwrap_or(false);
    if made {
      assert!(checked_folder(&home, &link.to_string_lossy()).is_none(), "una unión");
    }
    // A file held open: the folder cannot be renamed, so it is in use (and nothing moved).
    assert_eq!(folder_in_use(&project), InUse::Free);
    // A probe left behind by an earlier step gets its name back first.
    let left = home.join("web").join(format!("demo{PROBE}abc123"));
    std::fs::rename(&project, &left).unwrap();
    assert_eq!(folder_in_use(&project), InUse::Free);
    assert!(project.is_dir() && !left.exists(), "devuelta a su nombre");
    use std::os::windows::fs::OpenOptionsExt;
    let held = std::fs::OpenOptions::new().read(true).share_mode(1).open(project.join("a.txt")).unwrap(); // as an editor holds it
    let in_use = folder_in_use(&project);
    drop(held);
    assert!(project.exists());
    assert_eq!(in_use, InUse::Busy, "un archivo abierto");
    if made {
      let _ = std::fs::remove_dir(&link);
    }
    let _ = std::fs::remove_dir_all(&outside);
    let _ = std::fs::remove_dir_all(&home);
  }
}

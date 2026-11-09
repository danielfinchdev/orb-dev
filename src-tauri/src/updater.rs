// New versions (D9), as Orb 3.8.0 did: Orb looks at the latest release when it opens (after 15 s)
// and every 4 hours; the user decides with «Descargar e instalar» (downloaded in the background, with its progress), and
// «Reiniciar e instalar» (or closing Orb) runs the installer. Before a new version touches the data the engine makes a
// backup (backup.now, kind preupdate), started once when the download ends; a failure is only logged.
// 3.8.2 (the 3.8.1 → 3.8.2 update of 2026-11-09 «did nothing»): that backup never holds the update back. «Reiniciar e
// instalar» shows its progress on the card (state 'installing') and waits for it at most INSTALL_WAIT, once (it used to
// wait for the one under way for 3 minutes and then start a second wait of 3 more, the card unchanged); then the
// installer runs, or the card says it could not and offers to download it again.
//   - tauri-plugin-updater: latest.json of the GitHub release (plugins.updater.endpoints), the installer signed with
//     Orb's updater key (minisign, plugins.updater.pubkey) and checked before it runs, the version it was signed for
//     too (requireSignedVersion: no older signed installer passed off as newer).
//   - Not installed (Orb.exe without the installer's uninstall.exe next to it, e.g. a build run from its folder): it only
//     says there is a new version and «Descargar» opens the release page.
//   - ORB_NO_UPDATE=1 turns it off; ORB_FAKE_UPDATE=<version> shows that version without the network (tests, captures;
//     nothing is downloaded). In the e2e build only, ORB_UPDATE_URL=http://127.0.0.1:<port>/ reads <that>/latest.json
//     (a local feed to try an update before publishing it; that build also allows its plain http).
// The window gets the state as the 'app:update' event and asks through app_update* (src/ui/lib/tauri-bridge.js).
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::{Update, UpdaterExt};

pub const RELEASES_URL: &str = "https://github.com/danielfinchdev/orb-dev/releases/latest";
const FIRST: Duration = Duration::from_secs(15);
const EVERY: Duration = Duration::from_secs(4 * 60 * 60);
/// The longest a pre-update backup may take in the background (it usually takes a few seconds).
const BACKUP_WAIT: Duration = Duration::from_secs(10 * 60);
/// «Reiniciar e instalar» waits at most this long for that backup, with its progress on the card; then it installs
/// without it (logged: the daily copy is there).
const INSTALL_WAIT: Duration = Duration::from_secs(45);
/// Closing Orb waits at most this long for it (review D10 B14: no invisible Orb for minutes; reopened meanwhile,
/// «nothing happens»), and then installs as well.
const EXIT_WAIT: Duration = Duration::from_secs(20);

#[derive(Clone, Serialize, Debug, PartialEq)]
pub struct State {
  /// off · idle · checking · none · available · downloading · downloaded · installing · error
  pub state: &'static str,
  /// While installing: 'backup' (percent: the backup's) or 'installer' (being started).
  pub step: Option<&'static str>,
  pub current: String,
  pub version: Option<String>,
  pub percent: u32,
  pub error: Option<String>,
  pub portable: bool,
  pub url: &'static str,
}

pub struct Updates {
  state: Mutex<State>,
  fake: Option<String>,
  enabled: bool,
  /// The release found by the last check, and its installer once downloaded.
  found: Mutex<Option<Update>>,
  bytes: Mutex<Option<Vec<u8>>>,
  /// The pre-update backup: one at a time and once per version (review D9 M6); everyone waits on this one.
  backup: tokio::sync::watch::Sender<Backup>,
  installing: std::sync::atomic::AtomicBool,
}

#[derive(Clone, Debug, PartialEq)]
enum Backup {
  None,
  Running(String),
  Done(String),
  Failed(String),
}

/// "2.3.10" > "2.3.9"; anything that is not x.y.z counts as older (the same rule as updater.mjs › newer).
pub fn newer(a: &str, b: &str) -> bool {
  let p = |v: &str| -> [u64; 3] {
    let mut out = [0; 3];
    for (i, n) in v.trim_start_matches('v').split(['.', '-']).take(3).enumerate() {
      out[i] = n.parse().unwrap_or(0);
    }
    out
  };
  p(a) > p(b)
}

/// A local feed (only this PC, only plain http on 127.0.0.1 with a port), as updater.mjs accepted ORB_UPDATE_URL.
pub fn local_feed(url: &str) -> Option<String> {
  let rest = url.strip_prefix("http://127.0.0.1:")?;
  let port = rest.strip_suffix('/').unwrap_or(rest);
  (!port.is_empty() && port.len() <= 5 && port.bytes().all(|b| b.is_ascii_digit())).then(|| format!("http://127.0.0.1:{port}/latest.json"))
}

fn short(e: impl ToString) -> String {
  e.to_string().lines().next().unwrap_or("").chars().take(300).collect()
}

fn feed() -> Option<String> {
  if cfg!(feature = "e2e") {
    std::env::var("ORB_UPDATE_URL").ok().and_then(|u| local_feed(&u))
  } else {
    None
  }
}

pub fn init(app: &AppHandle) {
  let current = app.package_info().version.to_string();
  let fake = std::env::var("ORB_FAKE_UPDATE").ok().filter(|v| !v.is_empty());
  // Installed by the installer: its uninstall.exe next to Orb.exe.
  let installed = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join("uninstall.exe").exists())).unwrap_or(false);
  let local = feed().is_some();
  let portable = fake.is_none() && !installed && !local;
  // Only a release build updates (from the code there is nothing to replace).
  let enabled = fake.is_some() || ((!cfg!(debug_assertions) || local) && std::env::var("ORB_NO_UPDATE").as_deref() != Ok("1"));
  let state = State { state: if enabled { "idle" } else { "off" }, step: None, current, version: None, percent: 0, error: None, portable, url: RELEASES_URL };
  app.manage(Updates { state: Mutex::new(state), fake, enabled, found: Mutex::new(None), bytes: Mutex::new(None), backup: tokio::sync::watch::Sender::new(Backup::None), installing: Default::default() });
}

fn set(app: &AppHandle, patch: impl FnOnce(&mut State)) -> State {
  let u = app.state::<Updates>();
  let state = {
    let mut s = u.state.lock().unwrap();
    patch(&mut s);
    s.clone()
  };
  let _ = app.emit_to("main", "engine:event", json!({ "event": "app:update", "payload": state }));
  state
}

pub fn get(app: &AppHandle) -> State {
  app.state::<Updates>().state.lock().unwrap().clone()
}

/// The first check after FIRST, then every EVERY (a simulated version only shows when asked).
pub fn start(app: &AppHandle) {
  let u = app.state::<Updates>();
  if !u.enabled || u.fake.is_some() {
    return;
  }
  let app = app.clone();
  tauri::async_runtime::spawn(async move {
    tokio::time::sleep(FIRST).await;
    loop {
      check(&app).await;
      tokio::time::sleep(EVERY).await;
    }
  });
}

pub async fn check(app: &AppHandle) -> State {
  let (enabled, fake, busy) = {
    let u = app.state::<Updates>();
    let s = u.state.lock().unwrap();
    (u.enabled, u.fake.clone(), matches!(s.state, "checking" | "downloading" | "downloaded" | "installing"))
  };
  if !enabled || busy {
    return get(app);
  }
  if let Some(fake) = fake {
    let current = get(app).current;
    return set(app, |s| {
      if newer(&fake, &current) {
        s.state = "available";
        s.version = Some(fake);
      } else {
        s.state = "none";
      }
    });
  }
  set(app, |s| {
    s.state = "checking";
    s.error = None;
  });
  let found = async {
    let mut b = app.updater_builder();
    if let Some(url) = feed() {
      b = b.endpoints(vec![url.parse().map_err(short)?]).map_err(short)?;
    }
    // Installing ends Orb at once (the installer replaces it): the engine first, as when Orb closes.
    let handle = app.clone();
    b = b.on_before_exit(move || crate::engine::get(&handle).shutdown(Duration::from_secs(5)));
    b.build().map_err(short)?.check().await.map_err(short)
  }
  .await;
  match found {
    Ok(Some(update)) => {
      let version = update.version.clone();
      *app.state::<Updates>().found.lock().unwrap() = Some(update);
      set(app, |s| {
        s.state = "available";
        s.version = Some(version);
      })
    }
    Ok(None) => set(app, |s| {
      s.state = "none";
      s.version = None;
    }),
    Err(e) => set(app, |s| {
      s.state = "error";
      s.error = Some(e);
    }),
  }
}

pub async fn download(app: &AppHandle) -> State {
  let st = get(app);
  let u = app.state::<Updates>();
  if st.state != "available" || st.portable || u.fake.is_some() {
    return st;
  }
  let Some(update) = u.found.lock().unwrap().clone() else { return st };
  // Only from Orb's own releases (review D9 B1): the signature already guarantees what is installed; this keeps the
  // download itself on GitHub over https (a local test feed: its own address).
  if feed().is_none() && !official_download(update.download_url.as_str()) {
    return set(app, |s| {
      s.state = "error";
      s.error = Some("download url".into());
    });
  }
  set(app, |s| {
    s.state = "downloading";
    s.percent = 0;
    s.error = None;
  });
  let mut got = 0u64;
  let mut said = 0u32;
  let progress = app.clone();
  // Checked against Orb's updater key (and the version it was signed for) before it is kept.
  let result = update
    .download(
      move |chunk, total| {
        got += chunk as u64;
        let percent = total.filter(|t| *t > 0).map(|t| (got * 100 / t).min(100) as u32).unwrap_or(0);
        if percent != said {
          said = percent;
          set(&progress, |s| s.percent = percent);
        }
      },
      || {},
    )
    .await;
  match result {
    Ok(bytes) => {
      *u.bytes.lock().unwrap() = Some(bytes);
      let st = set(app, |s| {
        s.state = "downloaded";
        s.percent = 100;
      });
      // The backup as soon as it is downloaded (closing Orb installs it too).
      start_backup(app, &update.version);
      st
    }
    // A failed download goes back to «Descargar e instalar» with the reason, to try again.
    Err(e) => set(app, |s| {
      s.state = "available";
      s.error = Some(short(e));
    }),
  }
}

/// Starts the backup before installing `version` unless it was already started for it (under way, made or failed: a
/// failed one is not tried again, the update never waits twice).
fn start_backup(app: &AppHandle, version: &str) {
  let u = app.state::<Updates>();
  let started = u.backup.send_if_modified(|b| match b {
    Backup::Running(v) | Backup::Done(v) | Backup::Failed(v) if v == version => false,
    _ => {
      *b = Backup::Running(version.to_string());
      true
    }
  });
  if !started {
    return;
  }
  let app = app.clone();
  let version = version.to_string();
  tauri::async_runtime::spawn(async move {
    let engine = crate::engine::get(&app);
    let began = std::time::Instant::now();
    let done = match engine.call("backup.now", json!({ "kind": "preupdate" }), BACKUP_WAIT).await {
      Ok(_) => {
        engine.log_line(&format!("actualizar: copia de seguridad hecha antes de la {version} ({} s)", began.elapsed().as_secs()));
        Backup::Done(version)
      }
      Err(e) => {
        engine.log_line(&format!("actualizar: no se pudo hacer la copia antes de actualizar ({} s): {}", began.elapsed().as_secs(), short(e)));
        Backup::Failed(version)
      }
    };
    app.state::<Updates>().backup.send_replace(done);
  });
}

/// The backup of `version` (started if it was not), waited for at most `max`. → whether it is made.
async fn backup(app: &AppHandle, version: &str, max: Duration) -> bool {
  start_backup(app, version);
  let mut rx = app.state::<Updates>().backup.subscribe();
  let ended = tokio::time::timeout(max, async {
    rx.wait_for(|b| !matches!(b, Backup::Running(v) if v == version)).await.map(|b| *b == Backup::Done(version.to_string())).unwrap_or(false)
  })
  .await;
  match ended {
    Ok(done) => done,
    Err(_) => {
      crate::engine::get(app).log_line(&format!("actualizar: la copia antes de actualizar sigue sin terminar tras {} s: se instala sin ella (queda la copia diaria)", max.as_secs()));
      false
    }
  }
}

/// The engine's progress of a backup (event 'backup:progress'): the pre-update one, on the card while installing.
pub fn backup_progress(app: &AppHandle, payload: &Value) {
  if payload.get("kind").and_then(Value::as_str) != Some("preupdate") || app.try_state::<Updates>().is_none() {
    return;
  }
  let Some(percent) = payload.get("percent").and_then(Value::as_u64) else { return };
  let percent = percent.min(100) as u32;
  let st = get(app);
  if st.state == "installing" && st.step == Some("backup") && st.percent != percent {
    set(app, |s| s.percent = percent);
  }
}

/// «Reiniciar e instalar»: with tasks running, Windows' question first; then the backup, and the installer (passive:
/// only its progress bar), which ends Orb and opens the new version. Not installed: the release page instead.
pub async fn install(app: &AppHandle) -> Result<bool, String> {
  let st = get(app);
  if st.portable {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(RELEASES_URL, None::<&str>).map_err(|e| e.to_string())?;
    return Ok(false);
  }
  if st.state != "downloaded" {
    return Ok(false);
  }
  let engine = crate::engine::get(app);
  let running = engine.call("app.state", json!({}), Duration::from_secs(5)).await.ok().and_then(|v| v.pointer("/counts/running").and_then(Value::as_u64)).unwrap_or(0);
  if running > 0 {
    let message = engine.t(if running == 1 { "sys.dialog.updateOne" } else { "sys.dialog.updateMany" }, &[("n", running.to_string())]);
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app
      .dialog()
      .message(message)
      .title(engine.t("sys.dialog.runningTitle", &[]))
      .kind(MessageDialogKind::Warning)
      .buttons(MessageDialogButtons::OkCancelCustom(engine.t("sys.dialog.updateAnyway", &[]), engine.t("sys.dialog.cancel", &[])));
    if let Some(w) = app.get_webview_window("main") {
      dialog = dialog.parent(&w);
    }
    dialog.show(move |ok| {
      let _ = tx.send(ok);
    });
    if !rx.await.unwrap_or(false) {
      return Ok(false);
    }
  }
  // From here the card says what is happening: the backup with its progress, then the installer being started.
  set(app, |s| {
    s.state = "installing";
    s.step = Some("backup");
    s.percent = 0;
    s.error = None;
  });
  if let Some(v) = st.version.as_deref() {
    backup(app, v, INSTALL_WAIT).await;
  }
  set(app, |s| {
    s.step = Some("installer");
    s.percent = 100;
  });
  engine.log_line(&format!("actualizar: se abre el instalador de la {}", st.version.as_deref().unwrap_or("?")));
  // The plugin writes the installer, stops the engine (on_before_exit), starts the installer and ends Orb: off the async
  // workers, it blocks.
  let handle = app.clone();
  let why = match tauri::async_runtime::spawn_blocking(move || run_installer(&handle, true)).await {
    Ok(Ok(())) => String::new(),
    Ok(Err(e)) => e,
    Err(e) => short(e),
  };
  // Still here: the installer could not be started (deleted, held by the antivirus). Orb keeps working and offers to
  // download it again (or the release page).
  engine.log_line(&format!("actualizar: no se pudo abrir el instalador descargado: {why}"));
  if engine.quitting() {
    // The engine had already been stopped for the installer: it starts again.
    tauri::async_runtime::spawn(engine.clone().resume());
  }
  set(app, |s| {
    s.state = "available";
    s.step = None;
    s.percent = 0;
    s.error = Some("install".into());
  });
  Ok(false)
}

/// Runs the downloaded installer, which ends Orb (std::process::exit inside the plugin, after the engine has stopped).
/// Returns only if it could not be started, with why.
fn run_installer(app: &AppHandle, restart: bool) -> Result<(), String> {
  let u = app.state::<Updates>();
  if u.installing.swap(true, std::sync::atomic::Ordering::SeqCst) {
    return Err("already installing".into());
  }
  let update = u.found.lock().unwrap().clone();
  let bytes = u.bytes.lock().unwrap().take();
  let result = match (update, bytes) {
    (Some(update), Some(bytes)) => {
      let r = update.restart_after_install(restart).install(&bytes).map_err(short);
      *u.bytes.lock().unwrap() = Some(bytes);
      r
    }
    (None, _) => Err("no release found".into()),
    (_, None) => Err("no installer downloaded".into()),
  };
  u.installing.store(false, std::sync::atomic::Ordering::SeqCst);
  result
}

/// Orb is closing with a new version downloaded and not installed («Más tarde»): before the engine stops, the backup of
/// that version is finished (the one under way since the download is waited for, at most EXIT_WAIT).
pub fn before_exit(app: &AppHandle) {
  if app.try_state::<Updates>().is_none() || !install_on_exit() {
    return;
  }
  let st = get(app);
  if let (true, Some(v)) = (st.state == "downloaded", st.version) {
    tauri::async_runtime::block_on(backup(app, &v, EXIT_WAIT));
  }
}

/// After the engine stopped: it installs now, without opening Orb again (as Electron's autoInstallOnAppQuit), with its
/// backup made or, after EXIT_WAIT, without it (logged).
pub fn on_exit(app: &AppHandle) {
  if app.try_state::<Updates>().is_none() || !install_on_exit() {
    return;
  }
  let st = get(app);
  if st.state == "downloaded" && st.version.is_some() {
    if let Err(e) = run_installer(app, false) {
      crate::engine::get(app).log_line(&format!("actualizar: no se pudo abrir el instalador al cerrar: {e}"));
    }
  }
}

/// Never from a test's local feed (its installer is not a real one), unless the test built a real one for it
/// (ORB_E2E_INSTALL_ON_EXIT=1, e2e build only).
fn install_on_exit() -> bool {
  feed().is_none() || (cfg!(feature = "e2e") && std::env::var("ORB_E2E_INSTALL_ON_EXIT").as_deref() == Ok("1"))
}

/// An installer address of Orb's releases on GitHub (https, that repository's release downloads).
pub fn official_download(url: &str) -> bool {
  url.starts_with("https://github.com/danielfinchdev/orb-dev/releases/download/") && !url.contains("..") && !url.contains('@')
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn downloads_only_from_orbs_releases() {
    assert!(official_download("https://github.com/danielfinchdev/orb-dev/releases/download/v3.8.1/Orb_3.8.1_x64-setup.exe"));
    for bad in ["http://github.com/danielfinchdev/orb-dev/releases/download/v3.8.1/x.exe", "https://github.com.evil/danielfinchdev/orb-dev/releases/download/x", "https://github.com/otro/orb-dev/releases/download/v1/x.exe", "https://github.com/danielfinchdev/orb-dev/releases/download/../../x", "https://evil.example/Orb.exe"] {
      assert!(!official_download(bad), "{bad}");
    }
  }

  #[test]
  fn versions_compare_as_numbers() {
    assert!(newer("3.8.1", "3.8.0"));
    assert!(newer("3.10.0", "3.9.9"));
    assert!(newer("v4.0.0", "3.99.99"));
    assert!(!newer("3.8.0", "3.8.0"));
    assert!(!newer("3.8.0", "3.8.1"));
    assert!(!newer("rubbish", "0.0.1"));
  }

  #[test]
  fn a_local_feed_only_on_this_pc_with_a_port() {
    assert_eq!(local_feed("http://127.0.0.1:8123/").as_deref(), Some("http://127.0.0.1:8123/latest.json"));
    assert_eq!(local_feed("http://127.0.0.1:8123").as_deref(), Some("http://127.0.0.1:8123/latest.json"));
    for bad in ["http://127.0.0.1/", "https://127.0.0.1:8123/", "http://localhost:8123/", "http://127.0.0.1:8123/x", "http://127.0.0.1:8123@evil.example/", "http://127.0.0.1:123456/"] {
      assert_eq!(local_feed(bad), None, "{bad}");
    }
  }
}

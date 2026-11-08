// New versions (D9), as Electron's src/main/updater.mjs did: Orb looks at the latest release when it opens (after 15 s)
// and every 4 hours; the user decides with «Descargar e instalar» (downloaded in the background, with its progress), and
// «Reiniciar e instalar» (or closing Orb) runs the installer. Before a new version touches the data the engine makes a
// backup (backup.now, kind preupdate, at most 3 minutes, a failure only logged).
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
const BACKUP_WAIT: Duration = Duration::from_secs(3 * 60);

#[derive(Clone, Serialize, Debug, PartialEq)]
pub struct State {
  pub state: &'static str,
  pub current: String,
  pub version: Option<String>,
  pub percent: u32,
  pub error: Option<String>,
  pub portable: bool,
  pub linux: Option<String>,
  pub url: &'static str,
}

pub struct Updates {
  state: Mutex<State>,
  fake: Option<String>,
  enabled: bool,
  /// The release found by the last check, and its installer once downloaded.
  found: Mutex<Option<Update>>,
  bytes: Mutex<Option<Vec<u8>>>,
  backed_up: Mutex<Option<String>>,
  installing: std::sync::atomic::AtomicBool,
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
  let state = State { state: if enabled { "idle" } else { "off" }, current, version: None, percent: 0, error: None, portable, linux: None, url: RELEASES_URL };
  app.manage(Updates { state: Mutex::new(state), fake, enabled, found: Mutex::new(None), bytes: Mutex::new(None), backed_up: Mutex::new(None), installing: Default::default() });
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
    (u.enabled, u.fake.clone(), matches!(s.state, "checking" | "downloading" | "downloaded"))
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
      let handle = app.clone();
      let version = update.version.clone();
      tauri::async_runtime::spawn(async move { backup(&handle, &version).await });
      st
    }
    // A failed download goes back to «Descargar e instalar» with the reason, to try again.
    Err(e) => set(app, |s| {
      s.state = "available";
      s.error = Some(short(e));
    }),
  }
}

async fn backup(app: &AppHandle, version: &str) {
  let u = app.state::<Updates>();
  if u.backed_up.lock().unwrap().as_deref() == Some(version) {
    return;
  }
  let engine = crate::engine::get(app);
  match engine.call("backup.now", json!({ "kind": "preupdate" }), BACKUP_WAIT).await {
    Ok(_) => {
      *u.backed_up.lock().unwrap() = Some(version.to_string());
      engine.log_line(&format!("actualizar: copia de seguridad hecha antes de la {version}"));
    }
    Err(e) => engine.log_line(&format!("actualizar: no se pudo hacer la copia antes de actualizar: {}", short(e))),
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
  if let Some(v) = st.version.as_deref() {
    backup(app, v).await;
  }
  run_installer(app, true);
  // Still here: the installer could not be started (deleted, held by the antivirus). Orb keeps working and offers to
  // download it again.
  engine.log_line("actualizar: no se pudo abrir el instalador descargado");
  set(app, |s| {
    s.state = "available";
    s.percent = 0;
    s.error = Some("install".into());
  });
  Ok(false)
}

/// Runs the downloaded installer, which ends Orb (std::process::exit inside the plugin, after the engine has stopped).
/// Returns only if it could not be started.
fn run_installer(app: &AppHandle, restart: bool) {
  let u = app.state::<Updates>();
  if u.installing.swap(true, std::sync::atomic::Ordering::SeqCst) {
    return;
  }
  let update = u.found.lock().unwrap().clone();
  let bytes = u.bytes.lock().unwrap().take();
  if let (Some(update), Some(bytes)) = (update, bytes) {
    let update = update.restart_after_install(restart);
    if let Err(e) = update.install(&bytes) {
      crate::engine::get(app).log_line(&format!("actualizar: {}", short(e)));
    }
    *u.bytes.lock().unwrap() = Some(bytes);
  }
  u.installing.store(false, std::sync::atomic::Ordering::SeqCst);
}

/// Orb is closing with a new version downloaded and not installed («Más tarde»): it installs now, without opening Orb
/// again (as Electron's autoInstallOnAppQuit).
pub fn on_exit(app: &AppHandle) {
  // Never from a test's local feed (its installer is not a real one).
  if app.try_state::<Updates>().is_some() && feed().is_none() && get(app).state == "downloaded" {
    run_installer(app, false);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

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

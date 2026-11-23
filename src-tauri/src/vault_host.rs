// The vault (the master password, Orb's secrets and this PC's secret: the orb-vault crate, src-tauri/vault) runs inside
// Orb.exe, not in the engine: each engine process gets its own channel, a named pipe made before it starts (ORB_VAULT_PIPE) that only
// its process id may open (src/domain/security/master.mjs connects to it). The connectors' launchers trade their one-time grants on
// the vault's other pipe. When the engine ends, everything it opened (the data key included) is wiped.
use orb_vault::{Costs, EngineChannel, Server};
use std::sync::{Arc, OnceLock};

static SERVER: OnceLock<Option<Arc<Server>>> = OnceLock::new();

fn server() -> Option<Arc<Server>> {
  SERVER
    .get_or_init(|| orb_vault::start_grants(None).ok().map(|grants| Arc::new(Server { costs: Costs { test: false }, caller_clock: false, grants, sealer: Arc::new(orb_vault::machine::Dpapi), hello: real_hello() })))
    .clone()
}

/// A channel for the next engine. → its name (for the engine's environment) and what serves it once the engine runs.
pub fn channel() -> Result<(String, impl FnOnce(u32) + Send + 'static), String> {
  let server = server().ok_or("la bóveda no ha podido abrir su canal de claves")?;
  let ch = EngineChannel::new().map_err(|e| format!("bóveda: {e}"))?;
  let name = ch.name().to_string();
  Ok((name, move |pid: u32| {
    std::thread::Builder::new()
      .name("orb-vault".into())
      .spawn(move || {
        let _ = ch.serve(&server, Some(pid));
      })
      .map(drop)
      .unwrap_or_default();
  }))
}

/// Windows Hello where there is a Windows; no Hello anywhere else.
fn real_hello() -> Arc<dyn orb_vault::hello::Hello> {
  #[cfg(windows)]
  return Arc::new(orb_vault::windows_hello::WindowsHello);
  #[cfg(not(windows))]
  Arc::new(orb_vault::hello::Absent)
}

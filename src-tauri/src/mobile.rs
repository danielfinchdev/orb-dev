// Orb for Android: the same interface as the desktop (src/ui, built with `vite build --mode android`), which talks to the
// linked PC over HTTP with end-to-end encryption (src/ui/lib/web-bridge.js). Nothing of the desktop runs here: no engine,
// no windows of its own. What the phone adds lives in Kotlin (gen/android/app/src/main/java/dev/orb/app): the plugin
// «orb-native» (the Keystore, «Compartir con Orb», back, QR, dictation and notifications), reached from the page through
// src/ui/lib/app-bridge.js. Its commands are allowed only to the app's own window (capabilities/mobile.json).
use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

/// The Kotlin plugin, in the app's own Android module (no separate crate): `dev.orb.app.OrbNativePlugin`.
fn orb_native<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("orb-native")
    .setup(|_app, api| {
      api.register_android_plugin("dev.orb.app", "OrbNativePlugin")?;
      Ok(())
    })
    .build()
}

#[tauri::mobile_entry_point]
pub fn run() {
  tauri::Builder::default()
    .plugin(orb_native())
    .run(tauri::generate_context!())
    .expect("Orb no pudo arrancar");
}

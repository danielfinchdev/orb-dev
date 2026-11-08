// Orb for Android: the same interface as the desktop (src/ui, built with `vite build --mode android`), which talks to the
// linked PC over HTTP with end-to-end encryption (src/ui/lib/web-bridge.js). Nothing of the desktop runs here: no engine,
// no windows of its own. What the phone adds lives in Kotlin (gen/android/app/src/main/java/dev/orb/app): the plugin
// «orb-native» (the Keystore, «Compartir con Orb», back, QR, dictation and notifications), reached from the page through
// src/ui/lib/app-bridge.js. Its commands are allowed only to the app's own window (capabilities/mobile.json).
// The WebView only ever shows Orb's own page (review Android A2): any other address is refused there (Wry would load it
// in place of Orb, with Tauri's IPC); links out go to the phone's browser (OrbNativePlugin › open_url).
#[cfg(mobile)]
use tauri::plugin::{Builder, TauriPlugin};
#[cfg(mobile)]
use tauri::Runtime;

#[cfg(mobile)]
/// The Kotlin plugin, in the app's own Android module (no separate crate): `dev.orb.app.OrbNativePlugin`.
fn orb_native<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("orb-native")
    .setup(|_app, api| {
      api.register_android_plugin("dev.orb.app", "OrbNativePlugin")?;
      Ok(())
    })
    .on_navigation(|_webview, url| own_page(url))
    .build()
}

/// Orb's page in the app: http(s)://tauri.localhost, any path (its routes and assets).
pub fn own_page(url: &tauri::Url) -> bool {
  matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost") && url.port().is_none()
}

#[cfg(test)]
mod tests {
  #[test]
  fn only_orbs_own_page_loads_in_the_app() {
    for ok in ["http://tauri.localhost/", "http://tauri.localhost/assets/x.js", "https://tauri.localhost/#/chats"] {
      assert!(super::own_page(&ok.parse().unwrap()), "{ok}");
    }
    for no in ["https://github.com/danielfinchdev/orb-dev/releases", "http://tauri.localhost:8080/", "http://evil.tauri.localhost/", "file:///sdcard/x.html", "intent://x", "javascript:alert(1)"] {
      assert!(!super::own_page(&no.parse().unwrap()), "{no}");
    }
  }
}

#[cfg(mobile)]
#[tauri::mobile_entry_point]
pub fn run() {
  tauri::Builder::default()
    .plugin(orb_native())
    .run(tauri::generate_context!())
    .expect("Orb no pudo arrancar");
}

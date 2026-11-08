fn main() {
  // A test build (DevTools port, hidden window) must never be shipped: said loudly, and it goes to its own target folder
  // (npm run tauri:build:e2e → src-tauri/target-e2e).
  if std::env::var_os("CARGO_FEATURE_E2E").is_some() {
    println!("cargo:warning=build de PRUEBAS (feature e2e): no publicar este Orb.exe");
  }
  // The app's own commands, allowed per window by the capabilities (capabilities/main.json): only Orb's window may call
  // them; the little window of the agents' browser only pip_action (capabilities/pip.json); the agents' pages are not Tauri
  // windows at all (browser.rs).
  tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
    "engine_call",
    "app_info",
    "app_retry_start",
    "app_delete_project",
    "app_setup",
    "app_switch_home",
    "app_zoom",
    "app_zoom_step",
    "window_act",
    "window_drag",
    "app_pick_folder",
    "app_pick_program",
    "app_pick_files",
    "app_pick_images",
    "app_feedback_images",
    "app_feedback_capture",
    "app_open_path",
    "app_open_external",
    "app_show_browser",
    "pip_action",
  ])))
  .expect("tauri build script");
}

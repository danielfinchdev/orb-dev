fn main() {
  // The app's own commands, allowed per window by the capabilities (capabilities/main.json): only Orb's window may call
  // them; the agents' browser windows (a later step) get no capability and so no IPC at all.
  tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
    "engine_call",
    "app_info",
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
  ])))
  .expect("tauri build script");
}

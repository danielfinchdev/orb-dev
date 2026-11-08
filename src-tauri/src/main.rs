// No console window next to Orb in a release build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  orb_lib::run();
}

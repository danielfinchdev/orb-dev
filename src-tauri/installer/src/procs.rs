//! Is an Orb running from the folder the setup is about to change? The setup, in silent mode, ends a running Orb of its own
//! folder by force (its CheckIfAppIsRunning), so the face asks first and lets the user close it.
use std::path::{Path, PathBuf};

fn norm(p: &Path) -> String {
  p.to_string_lossy().to_ascii_lowercase().trim_end_matches('\\').to_string()
}

/// The first running program that sits directly inside one of `dirs` (case-insensitive, as Windows' paths).
pub fn blocking(running: &[PathBuf], dirs: &[PathBuf]) -> Option<PathBuf> {
  let dirs: Vec<String> = dirs.iter().map(|d| norm(d)).filter(|d| !d.is_empty()).collect();
  running.iter().find(|r| r.parent().is_some_and(|p| dirs.contains(&norm(p)))).cloned()
}

/// The full paths of the Orb.exe processes this user can see. Other users' processes have no readable path and are left out.
pub fn running_orb() -> Vec<PathBuf> {
  use windows::core::PWSTR;
  use windows::Win32::Foundation::CloseHandle;
  use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
  use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
  let mut found = Vec::new();
  // SAFETY: plain Win32 calls. The snapshot handle is closed below; `entry` is a correctly sized, initialised struct that the
  // calls fill in; the path buffer's length is passed with it.
  unsafe {
    let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return found };
    let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
    let mut more = Process32FirstW(snap, &mut entry).is_ok();
    while more {
      let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
      if String::from_utf16_lossy(&entry.szExeFile[..len]).eq_ignore_ascii_case("orb.exe") {
        if let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, entry.th32ProcessID) {
          let mut buf = [0u16; 1024];
          let mut size = buf.len() as u32;
          if QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut size).is_ok() {
            found.push(PathBuf::from(String::from_utf16_lossy(&buf[..size as usize])));
          }
          let _ = CloseHandle(h);
        }
      }
      more = Process32NextW(snap, &mut entry).is_ok();
    }
    let _ = CloseHandle(snap);
  }
  found
}

#[cfg(test)]
mod tests {
  use super::*;

  fn p(s: &str) -> PathBuf {
    PathBuf::from(s)
  }

  #[test]
  fn an_orb_in_a_watched_folder_blocks() {
    let running = [p(r"C:\Users\a\AppData\Local\Orb\Orb.exe")];
    assert_eq!(blocking(&running, &[p(r"c:\users\a\appdata\local\orb")]), Some(running[0].clone()));
    assert_eq!(blocking(&running, &[p(r"C:\Users\a\AppData\Local\Orb\")]), Some(running[0].clone()));
  }

  #[test]
  fn another_folder_or_a_subfolder_does_not() {
    let running = [p(r"D:\Copia\Orb.exe"), p(r"C:\Users\a\AppData\Local\Orb\app\Orb.exe")];
    assert_eq!(blocking(&running, &[p(r"C:\Users\a\AppData\Local\Orb")]), None);
    assert_eq!(blocking(&[], &[p(r"C:\x")]), None);
    assert_eq!(blocking(&running, &[]), None);
    assert_eq!(blocking(&running, &[p("")]), None);
  }
}

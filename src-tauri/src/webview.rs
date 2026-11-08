// What WebView2 itself is told about Orb's window (Electron's session did the same): every permission a page may ask for
// (camera, microphone, location, notifications…) is denied without asking, nothing is autofilled or offered to be saved
// as a password, the window's picture for Ajustes › Contribuye (CapturePreview), and the real path of a file the user
// dropped, pasted or picked in the page (window.orb.pathForFile: the page hands the File to WebView2 with
// chrome.webview.postMessageWithAdditionalObjects and WebView2 gives Rust its path, as Electron's webUtils did). The page's
// own drag and drop keeps working (Tauri's drop handler stays off).
use tauri::{Emitter, WebviewWindow};

#[cfg(windows)]
mod win {
  use super::*;
  use webview2_com::Microsoft::Web::WebView2::Win32::*;
  use webview2_com::{CapturePreviewCompletedHandler, PermissionRequestedEventHandler, WebMessageReceivedEventHandler};
  use windows::core::{Interface, PWSTR};
  use windows::Win32::System::Com::{IStream, STATSTG, STATFLAG_NONAME, STREAM_SEEK_SET};

  fn take(p: PWSTR) -> String {
    if p.is_null() {
      return String::new();
    }
    // SAFETY: WebView2 gave a CoTaskMem string, freed once copied.
    unsafe {
      let s = p.to_string().unwrap_or_default();
      windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as _));
      s
    }
  }

  pub fn setup(window: &WebviewWindow) {
    let w = window.clone();
    let _ = window.with_webview(move |wv| unsafe {
      let Ok(core) = wv.controller().CoreWebView2() else { return };
      let mut token = 0i64;
      let _ = core.add_PermissionRequested(
        &PermissionRequestedEventHandler::create(Box::new(|_, args| {
          if let Some(args) = args {
            args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
          }
          Ok(())
        })),
        &mut token,
      );
      if let Ok(settings) = core.Settings() {
        if let Ok(s4) = settings.cast::<ICoreWebView2Settings4>() {
          let _ = s4.SetIsPasswordAutosaveEnabled(false);
          let _ = s4.SetIsGeneralAutofillEnabled(false);
        }
      }
      // 'orb-file:<id>' with the File as an additional object → 'app:file-path' { id, path | null }. Only from Orb's own
      // page. A string, because wry's own handler (Tauri's IPC, registered first) fails on any other message and WebView2
      // then stops calling the next ones; Tauri's IPC ignores it (a console.error in the page's DevTools).
      let _ = core.add_WebMessageReceived(
        &WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
          let Some(args) = args else { return Ok(()) };
          let mut src = PWSTR::null();
          args.Source(&mut src)?;
          if !take(src).starts_with("http://tauri.localhost/") {
            return Ok(());
          }
          let mut text = PWSTR::null();
          if args.TryGetWebMessageAsString(&mut text).is_err() {
            return Ok(());
          }
          let Some(id) = take(text).strip_prefix("orb-file:").and_then(|n| n.parse::<u64>().ok()) else { return Ok(()) };
          let path = file_path(&args);
          let _ = w.emit_to("main", "app:file-path", serde_json::json!({ "id": id, "path": path }));
          Ok(())
        })),
        &mut token,
      );
    });
  }

  /// The path of the first File handed with the message (a pasted picture has none).
  unsafe fn file_path(args: &ICoreWebView2WebMessageReceivedEventArgs) -> Option<String> {
    unsafe {
      let objects = args.cast::<ICoreWebView2WebMessageReceivedEventArgs2>().ok()?.AdditionalObjects().ok()?;
      let mut n = 0u32;
      objects.Count(&mut n).ok()?;
      if n == 0 {
        return None;
      }
      let file = objects.GetValueAtIndex(0).ok()?.cast::<ICoreWebView2File>().ok()?;
      let mut p = PWSTR::null();
      file.Path(&mut p).ok()?;
      Some(take(p)).filter(|s| !s.is_empty())
    }
  }

  fn read_stream(stream: &IStream) -> windows::core::Result<Vec<u8>> {
    unsafe {
      let mut stat = STATSTG::default();
      stream.Stat(&mut stat, STATFLAG_NONAME)?;
      let size = stat.cbSize as usize;
      stream.Seek(0, STREAM_SEEK_SET, None)?;
      let mut buf = vec![0u8; size];
      let mut read = 0u32;
      stream.Read(buf.as_mut_ptr() as _, size as u32, Some(&mut read)).ok()?;
      buf.truncate(read as usize);
      Ok(buf)
    }
  }

  pub async fn capture(window: &WebviewWindow) -> Result<Vec<u8>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<u8>, String>>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let send = move |r: Result<Vec<u8>, String>| {
      if let Some(t) = tx.lock().unwrap().take() {
        let _ = t.send(r);
      }
    };
    let fail = send.clone();
    window
      .with_webview(move |wv| unsafe {
        let core = match wv.controller().CoreWebView2() {
          Ok(c) => c,
          Err(e) => return send(Err(e.to_string())),
        };
        let Some(stream) = windows::Win32::UI::Shell::SHCreateMemStream(None) else { return send(Err("sin memoria".into())) };
        let s2 = stream.clone();
        let done = send.clone();
        let handler = CapturePreviewCompletedHandler::create(Box::new(move |hr| {
          done(hr.and_then(|_| read_stream(&s2)).map_err(|e| e.to_string()));
          Ok(())
        }));
        if let Err(e) = core.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, &stream, &handler) {
          send(Err(e.to_string()));
        }
      })
      .map_err(|e| {
        let m = e.to_string();
        fail(Err(m.clone()));
        m
      })?;
    match tokio::time::timeout(std::time::Duration::from_secs(10), rx).await {
      Ok(Ok(r)) => r,
      _ => Err("sin captura".into()),
    }
  }
}

#[cfg(windows)]
pub use win::{capture, setup};

#[cfg(not(windows))]
pub fn setup(_: &WebviewWindow) {}
#[cfg(not(windows))]
pub async fn capture(_: &WebviewWindow) -> Result<Vec<u8>, String> {
  Err("solo en Windows".into())
}

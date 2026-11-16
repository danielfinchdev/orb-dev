// A picture of the whole desktop (every monitor) for the linked phone, taken natively: antivirus engines block the
// PowerShell/System.Drawing way (AMSI flags such a script as malicious), and a script was never needed for this.
// GDI copies the screen, WIC encodes it to JPEG in memory, and the file is created only when everything worked.
#[cfg(windows)]
use serde_json::json;
use serde_json::Value;
use std::path::PathBuf;

/// The JPEG is never bigger than this: the phone's sealed download has the same ceiling.
const MAX_BYTES: usize = 10 * 1024 * 1024;

pub async fn capture(path: PathBuf) -> Result<Value, String> {
  tauri::async_runtime::spawn_blocking(move || capture_blocking(&path)).await.map_err(|e| e.to_string())?
}

#[cfg(not(windows))]
fn capture_blocking(_path: &std::path::Path) -> Result<Value, String> {
  Err("la captura de pantalla solo funciona en Windows".into())
}

#[cfg(windows)]
fn capture_blocking(path: &std::path::Path) -> Result<Value, String> {
  use std::io::Write;
  // COM is per thread and the blocking pool's threads are shared, so the initialisation is paired with an uninit.
  struct Com(bool);
  impl Drop for Com {
    fn drop(&mut self) {
      if self.0 {
        unsafe { windows::Win32::System::Com::CoUninitialize() }
      }
    }
  }
  let com = unsafe { windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_MULTITHREADED) };
  let _guard = Com(com.is_ok());
  // Real pixels on scaled displays: a thread that is not DPI-aware would read virtualised (smaller) screen metrics.
  // The previous context is put back when the capture ends, since pool threads are shared.
  struct Dpi(windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT);
  impl Drop for Dpi {
    fn drop(&mut self) {
      if !self.0 .0.is_null() {
        unsafe { windows::Win32::UI::HiDpi::SetThreadDpiAwarenessContext(self.0) };
      }
    }
  }
  let _dpi = Dpi(unsafe {
    windows::Win32::UI::HiDpi::SetThreadDpiAwarenessContext(windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)
  });
  let (w, h, bgr) = grab()?;
  let jpeg = encode(w, h, &bgr)?;
  if jpeg.len() > MAX_BYTES {
    return Err("la captura es demasiado grande".into());
  }
  // create_new: an existing file is never overwritten.
  let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|e| e.to_string())?;
  if let Err(e) = file.write_all(&jpeg).and_then(|_| file.flush()) {
    drop(file);
    let _ = std::fs::remove_file(path);
    return Err(e.to_string());
  }
  Ok(json!({ "bytes": jpeg.len(), "width": w, "height": h }))
}

/// The virtual screen as top-down 24-bit BGR rows padded to 4 bytes, plus its size.
#[cfg(windows)]
fn grab() -> Result<(u32, u32, Vec<u8>), String> {
  use windows::Win32::Graphics::Gdi::*;
  use windows::Win32::UI::WindowsAndMessaging::*;
  // Releases every GDI handle on any exit path.
  struct Gdi {
    screen: HDC,
    mem: HDC,
    bmp: HBITMAP,
    old: HGDIOBJ,
  }
  impl Drop for Gdi {
    fn drop(&mut self) {
      unsafe {
        if !self.mem.is_invalid() {
          if !self.old.is_invalid() {
            SelectObject(self.mem, self.old);
          }
          let _ = DeleteDC(self.mem);
        }
        if !self.bmp.is_invalid() {
          let _ = DeleteObject(self.bmp.into());
        }
        if !self.screen.is_invalid() {
          ReleaseDC(None, self.screen);
        }
      }
    }
  }
  unsafe {
    let (x, y) = (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN));
    let (w, h) = (GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN));
    if w <= 0 || h <= 0 || w > 32768 || h > 32768 {
      return Err("tamaño de pantalla no válido".into());
    }
    let mut g = Gdi { screen: GetDC(None), mem: HDC::default(), bmp: HBITMAP::default(), old: HGDIOBJ::default() };
    if g.screen.is_invalid() {
      return Err("no se pudo abrir la pantalla".into());
    }
    g.mem = CreateCompatibleDC(Some(g.screen));
    g.bmp = CreateCompatibleBitmap(g.screen, w, h);
    if g.mem.is_invalid() || g.bmp.is_invalid() {
      return Err("no se pudo preparar la captura".into());
    }
    g.old = SelectObject(g.mem, g.bmp.into());
    BitBlt(g.mem, 0, 0, w, h, Some(g.screen), x, y, SRCCOPY | CAPTUREBLT).map_err(|e| e.to_string())?;
    let mut info = BITMAPINFO::default();
    info.bmiHeader = BITMAPINFOHEADER {
      biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
      biWidth: w,
      biHeight: -h, // negative: top-down rows
      biPlanes: 1,
      biBitCount: 32,
      biCompression: BI_RGB.0,
      ..Default::default()
    };
    let mut bgra = vec![0u8; w as usize * h as usize * 4];
    // GetDIBits needs the bitmap out of the DC.
    SelectObject(g.mem, g.old);
    g.old = HGDIOBJ::default();
    let lines = GetDIBits(g.mem, g.bmp, 0, h as u32, Some(bgra.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
    if lines != h {
      return Err("no se pudo leer la captura".into());
    }
    // The JPEG encoder takes 24 bits: drop the unused alpha byte.
    let stride = (w as usize * 3 + 3) & !3;
    let mut bgr = vec![0u8; stride * h as usize];
    for row in 0..h as usize {
      let src = &bgra[row * w as usize * 4..][..w as usize * 4];
      let dst = &mut bgr[row * stride..][..w as usize * 3];
      for (s, d) in src.chunks_exact(4).zip(dst.chunks_exact_mut(3)) {
        d.copy_from_slice(&s[..3]);
      }
    }
    Ok((w as u32, h as u32, bgr))
  }
}

#[cfg(windows)]
fn encode(w: u32, h: u32, bgr: &[u8]) -> Result<Vec<u8>, String> {
  use windows::core::{w as wide, PWSTR};
  use windows::Win32::Graphics::Imaging::*;
  use windows::Win32::System::Com::StructuredStorage::{IPropertyBag2, PROPBAG2};
  use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER, STREAM_SEEK_CUR};
  use windows::Win32::System::Variant::{VARIANT, VT_R4};
  let e = |e: windows::core::Error| e.to_string();
  // The output buffer is one byte over the cap: running out of room there means the picture is too big, not a failure.
  // STG_E_MEDIUMFULL / ERROR_DISK_FULL as HRESULT.
  let full = |err: windows::core::Error| {
    if matches!(err.code().0 as u32, 0x8003_0070 | 0x8007_0070) {
      "la captura es demasiado grande".to_string()
    } else {
      err.to_string()
    }
  };
  unsafe {
    let factory: IWICImagingFactory = CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER).map_err(e)?;
    // One byte over the cap so that "too big" is told apart from the encoder failing.
    let mut out = vec![0u8; MAX_BYTES + 1];
    let stream = factory.CreateStream().map_err(e)?;
    stream.InitializeFromMemory(&mut out).map_err(e)?;
    let encoder = factory.CreateEncoder(&GUID_ContainerFormatJpeg, std::ptr::null()).map_err(e)?;
    encoder.Initialize(&stream, WICBitmapEncoderNoCache).map_err(e)?;
    let mut frame = None;
    let mut bag: Option<IPropertyBag2> = None;
    encoder.CreateNewFrame(&mut frame, &mut bag).map_err(e)?;
    let frame = frame.ok_or("sin marco")?;
    let bag = bag.ok_or("sin propiedades")?;
    let mut name = PROPBAG2 { pstrName: PWSTR(wide!("ImageQuality").as_ptr() as *mut u16), ..Default::default() };
    let mut quality = VARIANT::default();
    {
      let v = &mut quality.Anonymous.Anonymous;
      v.vt = VT_R4;
      v.Anonymous.fltVal = 0.8;
    }
    bag.Write(1, &mut name, &quality).map_err(e)?;
    frame.Initialize(&bag).map_err(e)?;
    frame.SetSize(w, h).map_err(e)?;
    let mut format = GUID_WICPixelFormat24bppBGR;
    frame.SetPixelFormat(&mut format).map_err(e)?;
    if format != GUID_WICPixelFormat24bppBGR {
      return Err("formato de píxel no admitido".into());
    }
    let stride = (w as usize * 3 + 3) & !3;
    frame.WritePixels(h, stride as u32, bgr).map_err(full)?;
    frame.Commit().map_err(full)?;
    encoder.Commit().map_err(full)?;
    let mut pos = 0u64;
    stream.Seek(0, STREAM_SEEK_CUR, Some(&mut pos)).map_err(e)?;
    let len = pos as usize;
    out.truncate(len);
    Ok(out)
  }
}

#[cfg(all(test, windows))]
mod tests {
  use super::*;

  // Takes the real screen once: run by hand with `cargo test -- --ignored`. The picture is only inspected for its
  // header and size, then deleted.
  #[test]
  #[ignore]
  fn captures_the_virtual_screen_as_jpeg() {
    use windows::Win32::UI::WindowsAndMessaging::*;
    let dir = std::env::temp_dir().join(format!("orb-shot-test-{}", std::process::id())).join("capturas-movil");
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("1-0123abcd.jpg");
    let started = std::time::Instant::now();
    let r = capture_blocking(&file);
    let ms = started.elapsed().as_millis();
    let head = std::fs::read(&file).map(|b| b[..2].to_vec());
    let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    let r = r.unwrap();
    // The expected size is read per-monitor aware too, as the capture does.
    unsafe { windows::Win32::UI::HiDpi::SetThreadDpiAwarenessContext(windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let (sw, sh) = unsafe { (GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN)) };
    eprintln!("screenshot: {r} in {ms} ms");
    assert_eq!(head.unwrap(), vec![0xFF, 0xD8]);
    assert_eq!(r["width"], sw);
    assert_eq!(r["height"], sh);
    assert!(r["bytes"].as_u64().unwrap() > 1000);
  }
}

// The channels to the vault:
//   the engine's   one connection, only for the engine: on Windows a named pipe with a random name, one instance (made
//                  with FILE_FLAG_FIRST_PIPE_INSTANCE, so nobody can have made it first), this Windows user only, no remote
//                  clients, and (Orb.exe) only the engine's process id; the engine opens it as a plain file and talks to
//                  it synchronously (src/domain/security/master.mjs). Elsewhere (the tests on Linux) two FIFOs in a private folder.
//   the grants'    connectors' launchers trade a grant for their keys (grants.rs): a pipe (a Unix socket elsewhere) with
//                  as many instances as needed, this Windows user only.
use crate::grants::Grants;
use crate::server::{self, Server};
use std::io::{BufRead, Read};
use std::sync::Arc;

fn random_name(prefix: &str) -> String {
  let hex: String = crate::crypto::random(12).as_slice().iter().map(|b| format!("{b:02x}")).collect();
  format!("{prefix}{hex}")
}

fn now_ms() -> u64 {
  std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[cfg(windows)]
mod win {
  use std::fs::File;
  use std::os::windows::io::{AsRawHandle, FromRawHandle};
  use windows::core::{HSTRING, PWSTR};
  use windows::Win32::Foundation::{CloseHandle, LocalFree, ERROR_PIPE_CONNECTED, HANDLE, HLOCAL};
  use windows::Win32::Security::Authorization::{ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1};
  use windows::Win32::Security::{GetTokenInformation, TokenUser, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER};
  use windows::Win32::Storage::FileSystem::{FILE_FLAGS_AND_ATTRIBUTES, FILE_FLAG_FIRST_PIPE_INSTANCE, PIPE_ACCESS_DUPLEX};
  use windows::Win32::System::Pipes::{ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, GetNamedPipeClientProcessId, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT};
  use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

  fn io(e: windows::core::Error) -> std::io::Error {
    std::io::Error::other(e.message())
  }

  /// This Windows user's SID as text (S-1-5-21-…).
  fn user_sid() -> std::io::Result<String> {
    // SAFETY: plain Win32 calls with buffers of the size Windows asks for; every handle and allocation is freed.
    unsafe {
      let mut token = HANDLE::default();
      OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).map_err(io)?;
      let mut len = 0u32;
      let _ = GetTokenInformation(token, TokenUser, None, 0, &mut len);
      let mut buf = vec![0u8; len as usize];
      let r = GetTokenInformation(token, TokenUser, Some(buf.as_mut_ptr() as *mut _), len, &mut len);
      let _ = CloseHandle(token);
      r.map_err(io)?;
      let user = &*(buf.as_ptr() as *const TOKEN_USER);
      let mut text = PWSTR::null();
      ConvertSidToStringSidW(user.User.Sid, &mut text).map_err(io)?;
      let out = text.to_string().map_err(|e| std::io::Error::other(e.to_string()));
      let _ = LocalFree(Some(HLOCAL(text.0 as *mut _)));
      out
    }
  }

  /// One instance of a pipe this user only may open. first: the name must be new (nobody made it before us).
  pub fn create(name: &str, first: bool, unlimited: bool) -> std::io::Result<File> {
    let sddl = HSTRING::from(format!("D:P(A;;GA;;;{})", user_sid()?));
    // SAFETY: the descriptor lives until CreateNamedPipeW returns, then it is freed; the handle becomes a File (closed
    // when dropped).
    unsafe {
      let mut sd = PSECURITY_DESCRIPTOR::default();
      ConvertStringSecurityDescriptorToSecurityDescriptorW(&sddl, SDDL_REVISION_1, &mut sd, None).map_err(io)?;
      let sa = SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: sd.0, bInheritHandle: false.into() };
      let mut mode = PIPE_ACCESS_DUPLEX;
      if first {
        mode |= FILE_FLAG_FIRST_PIPE_INSTANCE;
      }
      let h = CreateNamedPipeW(
        &HSTRING::from(name),
        FILE_FLAGS_AND_ATTRIBUTES(mode.0),
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
        if unlimited { PIPE_UNLIMITED_INSTANCES } else { 1 },
        64 * 1024,
        64 * 1024,
        0,
        Some(&sa),
      );
      let _ = LocalFree(Some(HLOCAL(sd.0)));
      if h.is_invalid() {
        return Err(std::io::Error::last_os_error());
      }
      Ok(File::from_raw_handle(h.0 as _))
    }
  }

  /// Waits for its client. → the client's process id.
  pub fn accept(pipe: &File) -> std::io::Result<u32> {
    let h = HANDLE(pipe.as_raw_handle() as _);
    // SAFETY: a pipe handle of ours.
    unsafe {
      if let Err(e) = ConnectNamedPipe(h, None) {
        if e.code() != ERROR_PIPE_CONNECTED.to_hresult() {
          return Err(io(e));
        }
      }
      let mut pid = 0u32;
      GetNamedPipeClientProcessId(h, &mut pid).map_err(io)?;
      Ok(pid)
    }
  }
  /// Drops the client connected now, so the pipe can wait for the next one.
  pub fn disconnect(pipe: &File) {
    // SAFETY: a pipe handle of ours.
    unsafe {
      let _ = DisconnectNamedPipe(HANDLE(pipe.as_raw_handle() as _));
    }
  }
}

/// A reader whose buffer is wiped as it is consumed and when it goes (review final B3): the lines carry passwords and
/// secrets, and std's BufReader keeps its buffer as it is.
pub struct Wiping<R: Read> {
  inner: R,
  buf: Box<[u8]>,
  pos: usize,
  filled: usize,
}
impl<R: Read> Wiping<R> {
  pub fn new(inner: R) -> Self {
    Wiping { inner, buf: vec![0u8; 8192].into_boxed_slice(), pos: 0, filled: 0 }
  }
}
impl<R: Read> Read for Wiping<R> {
  fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
    let n = {
      let have = self.fill_buf()?;
      let n = have.len().min(out.len());
      out[..n].copy_from_slice(&have[..n]);
      n
    };
    self.consume(n);
    Ok(n)
  }
}
impl<R: Read> BufRead for Wiping<R> {
  fn fill_buf(&mut self) -> std::io::Result<&[u8]> {
    if self.pos >= self.filled {
      zeroize::Zeroize::zeroize(&mut self.buf[..self.filled]);
      self.pos = 0;
      self.filled = 0;
      self.filled = self.inner.read(&mut self.buf)?;
    }
    Ok(&self.buf[self.pos..self.filled])
  }
  fn consume(&mut self, n: usize) {
    let end = (self.pos + n).min(self.filled);
    zeroize::Zeroize::zeroize(&mut self.buf[self.pos..end]);
    self.pos = end;
  }
}
impl<R: Read> Drop for Wiping<R> {
  fn drop(&mut self) {
    zeroize::Zeroize::zeroize(&mut self.buf[..]);
  }
}

/// The engine's channel, made before the engine starts (its name goes in the engine's environment).
pub struct EngineChannel {
  name: String,
  #[cfg(windows)]
  pipe: std::fs::File,
  #[cfg(unix)]
  dir: std::path::PathBuf,
}

impl EngineChannel {
  #[cfg(windows)]
  pub fn new() -> std::io::Result<Self> {
    Self::named(&random_name(r"\\.\pipe\orb-boveda-"))
  }
  #[cfg(windows)]
  pub fn named(name: &str) -> std::io::Result<Self> {
    Ok(Self { name: name.to_string(), pipe: win::create(name, true, false)? })
  }
  /// The tests on Linux: the folder (made by the caller, private) gets two FIFOs, req and res.
  #[cfg(unix)]
  pub fn named(dir: &str) -> std::io::Result<Self> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let dir = std::path::PathBuf::from(dir);
    std::fs::create_dir_all(&dir)?;
    for f in ["req", "res"] {
      let p = CString::new(dir.join(f).as_os_str().as_bytes()).map_err(std::io::Error::other)?;
      // SAFETY: a valid C string.
      if unsafe { libc::mkfifo(p.as_ptr(), 0o600) } != 0 {
        return Err(std::io::Error::last_os_error());
      }
    }
    Ok(Self { name: dir.display().to_string(), dir })
  }
  pub fn name(&self) -> &str {
    &self.name
  }

  /// Serves its one client until it closes. pid: the only process allowed (Orb.exe: the engine's); another is refused.
  #[cfg(windows)]
  pub fn serve(self, server: &Server, pid: Option<u32>) -> std::io::Result<()> {
    // Another process of this user that connects first is dropped and the pipe waits for the engine (review final B4: it
    // could otherwise keep the engine from ever getting its vault).
    loop {
      let client = win::accept(&self.pipe)?;
      if pid.is_none_or(|p| p == client) {
        break;
      }
      win::disconnect(&self.pipe);
    }
    let mut input = Wiping::new(self.pipe.try_clone()?);
    let mut output = self.pipe;
    server::serve(server, &mut input, &mut output)
  }
  #[cfg(unix)]
  pub fn serve(self, server: &Server, _pid: Option<u32>) -> std::io::Result<()> {
    let mut input = Wiping::new(std::fs::File::open(self.dir.join("req"))?);
    let mut output = std::fs::OpenOptions::new().write(true).open(self.dir.join("res"))?;
    let r = server::serve(server, &mut input, &mut output);
    let _ = std::fs::remove_dir_all(&self.dir);
    r
  }
}

/// The grants' pipe, served on threads of its own for as long as the process lives. → the grants (and their name).
pub fn start_grants(name: Option<String>) -> std::io::Result<Arc<Grants>> {
  #[cfg(windows)]
  {
    let name = name.unwrap_or_else(|| random_name(r"\\.\pipe\orb-claves-"));
    let first = win::create(&name, true, true)?;
    let grants = Arc::new(Grants::new(name.clone()));
    let g = grants.clone();
    std::thread::Builder::new().name("orb-vault-grants".into()).spawn(move || {
      let mut next = Some(first);
      loop {
        let pipe = match next.take() {
          Some(p) => p,
          None => match win::create(&name, false, true) {
            Ok(p) => p,
            Err(_) => {
              std::thread::sleep(std::time::Duration::from_millis(500));
              continue;
            }
          },
        };
        if win::accept(&pipe).is_err() {
          continue;
        }
        let g = g.clone();
        std::thread::spawn(move || {
          if let Ok(read) = pipe.try_clone() {
            let mut pipe = pipe;
            let _ = g.trade(&mut Wiping::new(read), &mut pipe, now_ms());
          }
        });
      }
    })?;
    Ok(grants)
  }
  #[cfg(unix)]
  {
    let name = name.unwrap_or_else(|| std::env::temp_dir().join(random_name("orb-claves-")).with_extension("sock").display().to_string());
    let listener = std::os::unix::net::UnixListener::bind(&name)?;
    let grants = Arc::new(Grants::new(name));
    let g = grants.clone();
    std::thread::spawn(move || {
      for conn in listener.incoming().flatten() {
        let g = g.clone();
        std::thread::spawn(move || {
          if let Ok(read) = conn.try_clone() {
            let mut conn = conn;
            let _ = g.trade(&mut Wiping::new(read), &mut conn, now_ms());
          }
        });
      }
    });
    Ok(grants)
  }
}

#[cfg(test)]
mod wiping_tests {
  use super::*;

  #[test]
  fn what_was_read_does_not_stay_in_the_buffer() {
    let mut w = Wiping::new(std::io::Cursor::new(b"{\"password\":\"secreta\"}\n{\"op\":\"x\"}\n".to_vec()));
    let mut line = vec![];
    w.read_until(b'\n', &mut line).unwrap();
    assert_eq!(line, b"{\"password\":\"secreta\"}\n");
    assert!(!w.buf.windows(7).any(|x| x == b"secreta"), "the first line is wiped once consumed");
    line.clear();
    w.read_until(b'\n', &mut line).unwrap();
    assert!(w.buf.iter().all(|b| *b == 0));
  }
}

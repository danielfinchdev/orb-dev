// Memory for a secret: whole pages of their own, kept out of the page file (VirtualLock on Windows, mlock elsewhere: a
// best effort, the process's quota may refuse it) and overwritten before they are given back (volatile writes, so the
// compiler cannot drop them). The data key, this PC's secret, every key made from a password and every opened vault
// live in one of these, for as short as they are needed.
use std::alloc::{alloc_zeroed, dealloc, Layout};
use zeroize::Zeroize;

const PAGE: usize = 4096;

pub struct Locked {
  ptr: *mut u8,
  cap: usize,
  len: usize,
}

// SAFETY: the buffer is owned (no aliasing) and only reached through &self / &mut self.
unsafe impl Send for Locked {}
unsafe impl Sync for Locked {}

impl Locked {
  /// A buffer for at most `cap` bytes, empty.
  pub fn with_capacity(cap: usize) -> Self {
    let size = cap.max(1).div_ceil(PAGE) * PAGE;
    let layout = Layout::from_size_align(size, PAGE).expect("layout");
    // SAFETY: a non-zero size and a valid alignment.
    let ptr = unsafe { alloc_zeroed(layout) };
    if ptr.is_null() {
      std::alloc::handle_alloc_error(layout);
    }
    lock(ptr, size);
    Self { ptr, cap: size, len: 0 }
  }
  pub fn from_slice(bytes: &[u8]) -> Self {
    let mut out = Self::with_capacity(bytes.len());
    out.extend(bytes);
    out
  }
  /// `n` zero bytes, to be written in place (a key derived into it).
  pub fn zeroed(n: usize) -> Self {
    let mut out = Self::with_capacity(n);
    out.len = n;
    out
  }
  pub fn len(&self) -> usize {
    self.len
  }
  pub fn is_empty(&self) -> bool {
    self.len == 0
  }
  /// Appends; a buffer never grows (that would leave a copy behind): more than its capacity is a bug.
  pub fn extend(&mut self, bytes: &[u8]) {
    assert!(self.len + bytes.len() <= self.cap, "locked buffer full");
    // SAFETY: in bounds (checked above); the source never overlaps our own pages.
    unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), self.ptr.add(self.len), bytes.len()) };
    self.len += bytes.len();
  }
  pub fn as_slice(&self) -> &[u8] {
    // SAFETY: ptr is valid for cap >= len bytes.
    unsafe { std::slice::from_raw_parts(self.ptr, self.len) }
  }
  pub fn as_mut_slice(&mut self) -> &mut [u8] {
    // SAFETY: as above, uniquely borrowed.
    unsafe { std::slice::from_raw_parts_mut(self.ptr, self.len) }
  }
  pub fn as_str(&self) -> Option<&str> {
    std::str::from_utf8(self.as_slice()).ok()
  }
}

impl Clone for Locked {
  fn clone(&self) -> Self {
    Self::from_slice(self.as_slice())
  }
}

impl Drop for Locked {
  fn drop(&mut self) {
    // SAFETY: the whole allocation, valid and ours.
    let all = unsafe { std::slice::from_raw_parts_mut(self.ptr, self.cap) };
    all.zeroize();
    unlock(self.ptr, self.cap);
    // SAFETY: allocated in with_capacity with this very layout.
    unsafe { dealloc(self.ptr, Layout::from_size_align_unchecked(self.cap, PAGE)) };
  }
}

impl std::fmt::Debug for Locked {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "Locked({} bytes)", self.len) // never the bytes
  }
}

#[cfg(windows)]
fn lock(ptr: *mut u8, size: usize) {
  use windows::Win32::System::Memory::VirtualLock;
  // SAFETY: committed memory of this process. A refusal (the working set's quota) only loses the page-file protection.
  let _ = unsafe { VirtualLock(ptr as *const _, size) };
}
#[cfg(windows)]
fn unlock(ptr: *mut u8, size: usize) {
  use windows::Win32::System::Memory::VirtualUnlock;
  // SAFETY: as above; unlocking pages that were never locked only fails.
  let _ = unsafe { VirtualUnlock(ptr as *const _, size) };
}
#[cfg(unix)]
fn lock(ptr: *mut u8, size: usize) {
  // SAFETY: memory of this process; a refusal (RLIMIT_MEMLOCK) only loses the swap protection.
  unsafe { libc::mlock(ptr as *const _, size) };
}
#[cfg(unix)]
fn unlock(ptr: *mut u8, size: usize) {
  // SAFETY: as above.
  unsafe { libc::munlock(ptr as *const _, size) };
}
#[cfg(not(any(windows, unix)))]
fn lock(_: *mut u8, _: usize) {}
#[cfg(not(any(windows, unix)))]
fn unlock(_: *mut u8, _: usize) {}

/// Every string inside a JSON value overwritten (a vault opened to read one entry, a request that carried a password).
pub fn wipe_value(v: &mut serde_json::Value) {
  use serde_json::Value;
  match v {
    Value::String(s) => s.zeroize(),
    Value::Array(a) => a.iter_mut().for_each(wipe_value),
    Value::Object(m) => m.values_mut().for_each(wipe_value),
    _ => {}
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn holds_and_grows_never() {
    let mut b = Locked::with_capacity(10);
    b.extend(b"abc");
    assert_eq!(b.as_slice(), b"abc");
    assert_eq!(format!("{b:?}"), "Locked(3 bytes)");
    let c = b.clone();
    drop(b);
    assert_eq!(c.as_str(), Some("abc"));
    assert_eq!(Locked::zeroed(32).as_slice(), &[0u8; 32]);
  }
}

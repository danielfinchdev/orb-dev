// The vault's crypto, byte for byte what Orb 3.8 / 3.8.1 wrote from Node (src/domain/security/master.mjs before this crate, and
// src/shared/mobile-crypto.mjs for the phones' side), so every file already on disk opens the same:
//   seal        base64(nonce(24) ‖ XChaCha20-Poly1305(key, nonce, aad, plain))
//   keyId       base64(HMAC-SHA256(dek, "orb-key-id")[..16])
//   check       base64(HMAC-SHA256(kek, "orb-master-check-v1"))
//   machine key HKDF-SHA256(ikm = this PC's secret, salt "orb-master", info "machine-v1")
//   scrypt      of the password's UTF-8 (NFC, done by the caller), 32 bytes
//   verifier    X25519 public of HKDF-SHA256(scrypt(password), salt "orb-verificador", info "orb pake v1")
//   PAKE-lite   mobile-crypto.mjs › pakeTranscript / pakeKey / pakeMac
use crate::locked::Locked;
use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE_NO_PAD};
use base64::Engine as _;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use x25519_dalek::{PublicKey, StaticSecret};

type HmacSha256 = Hmac<Sha256>;

pub fn b64(bytes: &[u8]) -> String {
  STANDARD.encode(bytes)
}
/// Node's Buffer.from(text, 'base64'): padding optional, url-safe letters accepted.
pub fn unb64(text: &str) -> Option<Vec<u8>> {
  let s: String = text.trim_end_matches('=').chars().map(|c| match c { '-' => '+', '_' => '/', c => c }).collect();
  STANDARD_NO_PAD.decode(s).ok()
}
pub fn b64url(bytes: &[u8]) -> String {
  URL_SAFE_NO_PAD.encode(bytes)
}

pub fn random(n: usize) -> Locked {
  let mut out = Locked::zeroed(n);
  chacha20poly1305::aead::rand_core::RngCore::fill_bytes(&mut chacha20poly1305::aead::OsRng, out.as_mut_slice());
  out
}

pub fn seal(key: &[u8], plain: &[u8], aad: &str) -> String {
  let cipher = XChaCha20Poly1305::new_from_slice(key).expect("32-byte key");
  let nonce = random(24);
  let sealed = cipher.encrypt(XNonce::from_slice(nonce.as_slice()), Payload { msg: plain, aad: aad.as_bytes() }).expect("seal");
  let mut raw = Vec::with_capacity(24 + sealed.len());
  raw.extend_from_slice(nonce.as_slice());
  raw.extend_from_slice(&sealed);
  b64(&raw)
}

/// The plain bytes in locked memory, or None (another key, another additional data, changed or not a box).
pub fn unseal(key: &[u8], sealed: &str, aad: &str) -> Option<Locked> {
  let raw = unb64(sealed)?;
  if raw.len() < 24 + 16 || key.len() != 32 {
    return None;
  }
  let cipher = XChaCha20Poly1305::new_from_slice(key).ok()?;
  let mut plain = cipher.decrypt(XNonce::from_slice(&raw[..24]), Payload { msg: &raw[24..], aad: aad.as_bytes() }).ok()?;
  let out = Locked::from_slice(&plain);
  zeroize::Zeroize::zeroize(&mut plain);
  Some(out)
}

fn hmac(key: &[u8], data: &[u8]) -> [u8; 32] {
  let mut m = <HmacSha256 as Mac>::new_from_slice(key).expect("any key length");
  m.update(data);
  m.finalize().into_bytes().into()
}

pub fn key_id(dek: &[u8]) -> String {
  b64(&hmac(dek, b"orb-key-id")[..16])
}
pub fn check_of(kek: &[u8]) -> [u8; 32] {
  hmac(kek, b"orb-master-check-v1")
}
/// The key that signs approvals, made from this PC's secret (src/platform/keys.mjs › approvalKeyOf).
pub fn approval_key(secret: &[u8]) -> Locked {
  let mut k = hmac(secret, b"orb-approval-v2");
  let out = Locked::from_slice(&k);
  zeroize::Zeroize::zeroize(&mut k);
  out
}
/// The key that wraps this PC's backups and its recovery wrap (src/platform/keys.mjs › backupKeyOf).
pub fn backup_key(secret: &[u8]) -> Locked {
  let mut out = Locked::zeroed(32);
  Hkdf::<Sha256>::new(Some(b"orb-backup"), secret).expand(b"machine-v1", out.as_mut_slice()).expect("32 bytes");
  out
}
/// Lower-case hex, kept in locked memory (the sealed text of this PC's secret is its hex).
pub fn hex_of(bytes: &[u8]) -> Locked {
  const D: &[u8; 16] = b"0123456789abcdef";
  let mut out = Locked::with_capacity(bytes.len() * 2);
  for b in bytes {
    out.extend(&[D[(b >> 4) as usize], D[(b & 15) as usize]]);
  }
  out
}
/// The bytes of lower-case hex text; None when it is not that.
pub fn unhex(text: &[u8]) -> Option<Locked> {
  if text.len() % 2 != 0 {
    return None;
  }
  let v = |c: u8| match c {
    b'0'..=b'9' => Some(c - b'0'),
    b'a'..=b'f' => Some(c - b'a' + 10),
    _ => None,
  };
  let mut out = Locked::with_capacity(text.len() / 2);
  for pair in text.chunks(2) {
    out.extend(&[(v(pair[0])? << 4) | v(pair[1])?]);
  }
  Some(out)
}

pub fn machine_key(secret: &[u8]) -> Locked {
  let mut out = Locked::zeroed(32);
  Hkdf::<Sha256>::new(Some(b"orb-master"), secret).expand(b"machine-v1", out.as_mut_slice()).expect("32 bytes");
  out
}

pub fn same(a: &[u8], b: &[u8]) -> bool {
  a.len() == b.len() && bool::from(a.ct_eq(b))
}

/// scrypt, 32 bytes. n is N (a power of two, checked by the caller).
pub fn scrypt(password: &[u8], salt: &[u8], n: u64, r: u32, p: u32) -> Option<Locked> {
  let log_n = u8::try_from(n.trailing_zeros()).ok()?;
  let params = scrypt::Params::new(log_n, r, p, 32).ok()?;
  let mut out = Locked::zeroed(32);
  scrypt::scrypt(password, salt, &params, out.as_mut_slice()).ok()?;
  Some(out)
}

/// The phones' verifier of a password from scrypt's output: its X25519 public half (the private one is never kept).
pub fn verifier_pub(seed: &[u8]) -> [u8; 32] {
  let mut private = Locked::zeroed(32);
  Hkdf::<Sha256>::new(Some(b"orb-verificador"), seed).expand(b"orb pake v1", private.as_mut_slice()).expect("32 bytes");
  let bytes: [u8; 32] = private.as_slice().try_into().expect("32");
  let secret = StaticSecret::from(bytes);
  PublicKey::from(&secret).to_bytes()
}

fn field(out: &mut Vec<u8>, bytes: &[u8]) {
  out.push((bytes.len() >> 8) as u8);
  out.push((bytes.len() & 255) as u8);
  out.extend_from_slice(bytes);
}

pub struct Pake<'a> {
  pub via: &'a str,
  pub dev_pub: &'a [u8],
  pub pc_pub: &'a [u8],
  pub sid: &'a str,
  pub n: u64,
  pub r: u64,
  pub p: u64,
  pub salt: &'a str,
  /// The QR's code (or the short code's stretched secret).
  pub secret: &'a str,
}

/// K of one linking exchange: HKDF(code ‖ ECDH(phone, PC) ‖ ECDH(password key, PC)), salted with the exchange's hash.
pub fn pake_key(x: &Pake, pc_priv: &[u8], verifier: &[u8]) -> Option<Locked> {
  let mut t = Vec::new();
  field(&mut t, b"orb-pake-v1");
  field(&mut t, x.via.as_bytes());
  field(&mut t, x.dev_pub);
  field(&mut t, x.pc_pub);
  field(&mut t, x.sid.as_bytes());
  field(&mut t, format!("{}/{}/{}", x.n, x.r, x.p).as_bytes());
  field(&mut t, x.salt.as_bytes());
  let transcript = Sha256::digest(&t);
  let pc: [u8; 32] = pc_priv.try_into().ok()?;
  let pc = StaticSecret::from(pc);
  let dev: [u8; 32] = x.dev_pub.try_into().ok()?;
  let ver: [u8; 32] = verifier.try_into().ok()?;
  let dh_device = pc.diffie_hellman(&PublicKey::from(dev));
  let dh_password = pc.diffie_hellman(&PublicKey::from(ver));
  let mut ikm = Locked::with_capacity(6 + x.secret.len() + 64);
  let mut part = Vec::new();
  field(&mut part, x.secret.as_bytes());
  ikm.extend(&part);
  zeroize::Zeroize::zeroize(&mut part);
  for dh in [dh_device.as_bytes(), dh_password.as_bytes()] {
    ikm.extend(&[0, 32]);
    ikm.extend(dh);
  }
  let mut k = Locked::zeroed(32);
  Hkdf::<Sha256>::new(Some(&transcript), ikm.as_slice()).expand(b"orb pake clave v1", k.as_mut_slice()).ok()?;
  Some(k)
}
pub fn pake_mac(k: &[u8], label: &str) -> [u8; 32] {
  hmac(k, label.as_bytes())
}

pub fn sha256_b64(bytes: &[u8]) -> String {
  b64(&Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn round_trip_and_tamper() {
    let key = random(32);
    let boxed = seal(key.as_slice(), b"hola", "aad");
    assert_eq!(unseal(key.as_slice(), &boxed, "aad").unwrap().as_slice(), b"hola");
    assert!(unseal(key.as_slice(), &boxed, "otra").is_none());
    let mut raw = unb64(&boxed).unwrap();
    raw[30] ^= 1;
    assert!(unseal(key.as_slice(), &b64(&raw), "aad").is_none());
  }
  // Vectors made with Node (crypto.hkdfSync, crypto.createHmac, crypto.scrypt) as src/domain/security/master.mjs did.
  #[test]
  fn same_as_node() {
    let k = [7u8; 32];
    assert_eq!(key_id(&k), "1cINczgcCagHuGxzica+Lg==");
    assert_eq!(b64(machine_key(&k).as_slice()), "FVv9uQKJ0AJ8sspG+3RtC7PgqjuXhBPc/sCxBicuRHM=");
    assert_eq!(b64(scrypt("contraseña".as_bytes(), &[1u8; 16], 1024, 8, 1).unwrap().as_slice()), "yngerL1t1lTtzUteGF1+Va0EHzkmIoQZ3VazzglkAcM=");
  }
}

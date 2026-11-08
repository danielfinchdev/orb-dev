// The phone's end-to-end encryption with the PC, the same as src/core/mobile-crypto.mjs (the session key, seal and open
// of a JSON message). Android's notification buttons («Aprobar», «Rechazar», «Responder») answer the PC with it while the
// app is closed: Notes.kt › NoteReceiver (through PcCall.kt) reads this phone's keys from the Keystore and calls the JNI
// functions at the end.
// The page itself keeps using mobile-crypto.mjs; the test vectors below come from it (test/android-tauri.test.mjs checks
// them from the JS side too).
#![cfg_attr(not(any(test, target_os = "android")), allow(dead_code))]

use base64::engine::general_purpose::{STANDARD_NO_PAD, URL_SAFE_NO_PAD};
use base64::Engine as _;
use chacha20poly1305::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};

/// mobile-crypto.mjs › b64.enc: base64url without padding.
pub fn b64_enc(bytes: &[u8]) -> String {
  URL_SAFE_NO_PAD.encode(bytes)
}

/// mobile-crypto.mjs › b64.dec: base64url or standard, padding optional.
pub fn b64_dec(text: &str) -> Option<Vec<u8>> {
  let s: String = text.trim_end_matches('=').chars().map(|c| match c { '-' => '+', '_' => '/', c => c }).collect();
  STANDARD_NO_PAD.decode(s).ok()
}

fn key32(bytes: &[u8]) -> Option<[u8; 32]> {
  bytes.try_into().ok()
}

/// mobile-crypto.mjs › sessionKey: HKDF-SHA256 of the X25519 shared secret, salt «orb-movil», info «orb movil sesion v1».
pub fn session_key(private: &[u8], peer_public: &[u8]) -> Option<[u8; 32]> {
  let shared = StaticSecret::from(key32(private)?).diffie_hellman(&PublicKey::from(key32(peer_public)?));
  let mut out = [0u8; 32];
  Hkdf::<Sha256>::new(Some(b"orb-movil"), shared.as_bytes()).expand(b"orb movil sesion v1", &mut out).ok()?;
  Some(out)
}

/// mobile-crypto.mjs › seal: XChaCha20-Poly1305 with a random 24-byte nonce → (n, c) in base64url.
pub fn seal(key: &[u8; 32], plain: &[u8], aad: &str) -> Option<(String, String)> {
  let cipher = XChaCha20Poly1305::new(key.into());
  let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
  let c = cipher.encrypt(&nonce, Payload { msg: plain, aad: aad.as_bytes() }).ok()?;
  Some((b64_enc(&nonce), b64_enc(&c)))
}

/// mobile-crypto.mjs › open: None if it was changed, sealed with another key or for another purpose (aad).
pub fn open(key: &[u8; 32], n: &str, c: &str, aad: &str) -> Option<Vec<u8>> {
  let nonce = b64_dec(n)?;
  if nonce.len() != 24 {
    return None;
  }
  let cipher = XChaCha20Poly1305::new(key.into());
  cipher.decrypt(XNonce::from_slice(&nonce), Payload { msg: &b64_dec(c)?, aad: aad.as_bytes() }).ok()
}

/// The key of this phone's link (orb.movil: its private key and the PC's public key, both base64url).
fn link_key(private_b64: &str, pc_b64: &str) -> Option<[u8; 32]> {
  session_key(&b64_dec(private_b64)?, &b64_dec(pc_b64)?)
}

/// What Kotlin calls: a JSON message sealed for the PC → `{"n":…,"c":…}`, or None.
pub fn seal_json(private_b64: &str, pc_b64: &str, aad: &str, json: &str) -> Option<String> {
  let (n, c) = seal(&link_key(private_b64, pc_b64)?, json.as_bytes(), aad)?;
  Some(serde_json::json!({ "n": n, "c": c }).to_string())
}

/// What Kotlin calls: the PC's sealed answer opened → its JSON text, or None.
pub fn open_json(private_b64: &str, pc_b64: &str, aad: &str, n: &str, c: &str) -> Option<String> {
  String::from_utf8(open(&link_key(private_b64, pc_b64)?, n, c, aad)?).ok()
}

/// JNI for dev.orb.app.PhoneCrypto (Kotlin): `external fun seal(priv, pc, aad, json): String?` and
/// `external fun open(priv, pc, aad, n, c): String?`.
#[cfg(target_os = "android")]
mod jni_api {
  use jni::objects::{JClass, JString};
  use jni::sys::jstring;
  use jni::JNIEnv;

  fn text(env: &mut JNIEnv, s: &JString) -> Option<String> {
    env.get_string(s).ok().map(Into::into)
  }

  fn out(env: &mut JNIEnv, value: Option<String>) -> jstring {
    match value.and_then(|v| env.new_string(v).ok()) {
      Some(s) => s.into_raw(),
      None => std::ptr::null_mut(),
    }
  }

  #[no_mangle]
  pub extern "system" fn Java_dev_orb_app_PhoneCrypto_seal<'l>(mut env: JNIEnv<'l>, _class: JClass<'l>, private: JString<'l>, pc: JString<'l>, aad: JString<'l>, json: JString<'l>) -> jstring {
    let r = (|| super::seal_json(&text(&mut env, &private)?, &text(&mut env, &pc)?, &text(&mut env, &aad)?, &text(&mut env, &json)?))();
    out(&mut env, r)
  }

  #[no_mangle]
  pub extern "system" fn Java_dev_orb_app_PhoneCrypto_open<'l>(mut env: JNIEnv<'l>, _class: JClass<'l>, private: JString<'l>, pc: JString<'l>, aad: JString<'l>, n: JString<'l>, c: JString<'l>) -> jstring {
    let r = (|| super::open_json(&text(&mut env, &private)?, &text(&mut env, &pc)?, &text(&mut env, &aad)?, &text(&mut env, &n)?, &text(&mut env, &c)?))();
    out(&mut env, r)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  // Made with src/core/mobile-crypto.mjs (test/android-tauri.test.mjs checks the same values from the JS side).
  const PHONE_PRIV: &str = "oKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKA";
  const PC_PRIV: &str = "sbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbGxsbE";
  const PHONE_PUB: &str = "8LT9i-SANJKTq2HwUF67W6_M34pBJ94iHm7z2yDgPSk";
  const PC_PUB: &str = "0zN-TU7lA6Zpdv6x-t9b0hupb8KxVxs-mA2Hz0l5dRA";
  const SESSION_KEY: &str = "Zx5tmSaWhH4KNvK6KrkPoQWuCqobB4iYgpOBcEqKOj8";
  const JS_BOX_AAD: &str = "orb:respuesta:dev1";
  const JS_BOX_N: &str = "FhyiNVNimq7MoNTi0EEWSK0LjTCYf_BH";
  const JS_BOX_C: &str = "FqR9Dc7iS_6HnCLHs9o5ejv53-KM-9CzpEef9EihpneI6cY3ZWdGFLF5HBJY8Rh8-GDcIBu8HaJS";
  const JS_BOX_PLAIN: &str = r#"{"r":"abc","ok":true,"result":{"n":"ñ"}}"#;

  #[test]
  fn session_key_matches_mobile_crypto() {
    let phone_pub = PublicKey::from(&StaticSecret::from(key32(&b64_dec(PHONE_PRIV).unwrap()).unwrap()));
    let pc_pub = PublicKey::from(&StaticSecret::from(key32(&b64_dec(PC_PRIV).unwrap()).unwrap()));
    assert_eq!(b64_enc(phone_pub.as_bytes()), PHONE_PUB);
    assert_eq!(b64_enc(pc_pub.as_bytes()), PC_PUB);
    let k = link_key(PHONE_PRIV, PC_PUB).unwrap();
    assert_eq!(b64_enc(&k), SESSION_KEY);
    // Both sides derive the same key.
    assert_eq!(link_key(PC_PRIV, PHONE_PUB).unwrap(), k);
  }

  #[test]
  fn opens_what_mobile_crypto_sealed_and_back() {
    let k = link_key(PHONE_PRIV, PC_PUB).unwrap();
    let plain = open(&k, JS_BOX_N, JS_BOX_C, JS_BOX_AAD).expect("opens the JS box");
    assert_eq!(String::from_utf8(plain).unwrap(), JS_BOX_PLAIN);
    // The wrong purpose or a changed byte: refused.
    assert!(open(&k, JS_BOX_N, JS_BOX_C, "orb:respuesta:otro").is_none());
    let mut c = b64_dec(JS_BOX_C).unwrap();
    c[0] ^= 1;
    assert!(open(&k, JS_BOX_N, &b64_enc(&c), JS_BOX_AAD).is_none());
    // Sealed here, opened here with the PC's side of the key (what the engine does with mobile-crypto.mjs).
    let sealed = seal_json(PHONE_PRIV, PC_PUB, "orb:peticion:abc", r#"{"t":1,"m":"call"}"#).unwrap();
    let v: serde_json::Value = serde_json::from_str(&sealed).unwrap();
    let back = open_json(PC_PRIV, PHONE_PUB, "orb:peticion:abc", v["n"].as_str().unwrap(), v["c"].as_str().unwrap()).unwrap();
    assert_eq!(back, r#"{"t":1,"m":"call"}"#);
    assert_eq!(b64_dec(v["n"].as_str().unwrap()).unwrap().len(), 24);
  }

  #[test]
  fn base64_like_the_page() {
    assert_eq!(b64_dec("-_8").unwrap(), vec![0xfb, 0xff]);
    assert_eq!(b64_dec("+/8=").unwrap(), vec![0xfb, 0xff]);
    assert!(b64_dec("no válido").is_none());
    assert!(session_key(&[1; 31], &[2; 32]).is_none());
  }
}

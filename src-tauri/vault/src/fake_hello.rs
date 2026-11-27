// The tests' Windows Hello (orb-vault --test --fake-hello=<mode> only; never Orb.exe: server.rs and bin/orb-vault.rs decide). It
// signs with a fixed RSA-2048 key made for this file; the key is worth nothing, it protects nothing. The mode says how the
// "user" behaves: ok, cancel, fail, changed (the key was reset), wrong-message (signs another message than the one asked),
// bad-alg (the key it makes is not RSA-2048 PKCS#1/SHA-256), no-hello (Hello is not there).
use crate::crypto::unb64;
use crate::hello::{Hello, HelloError, HelloKey, ALG};
use rsa::pkcs1::{DecodeRsaPrivateKey, EncodeRsaPublicKey};
use rsa::pkcs1v15::SigningKey;
use rsa::sha2::Sha256;
use rsa::signature::{SignatureEncoding, Signer};
use rsa::RsaPrivateKey;
use std::sync::Mutex;

const TEST_KEY: &str = "MIIEogIBAAKCAQEAsOv3wAzCgMAY1gJtvWSnJYV55KdDUuuNnFUjNk0qZdNM0Ow8vNJcfXYHgOYCGC9p3FfLikkF1cj+qlcVXPEoutQ+274R8EHhtPKX0D/MI7ImoGqQZ12ddjTbDI9WK1hq+Z2BLKwmQw5tUfsvQHKPO2pkMrh3L9Oxw8j6xe2mrNDYLajVaRsGhllx5JugoknecDhAyK1mbmG51YQxRHq+Cj32Pl4vDGGWxh1vF2mD7U4c5HBttnPNzkk6InmyercjF3l/VDJeNIAyA3uOos7EG4aVtCh4q360Lq0L5msjjjtGtj2p4eupGv2zUVu1EWdk4pAQua5tn/WWVnaQ2L4SkwIDAQABAoIBADvWs6b7KdYOIthPXfqOzpG8QWv6vqSPEwhrK0u0ccCa5QJMxIZAyBOPFh6crNytPKrP7wHIjPav0qKebZVP46y9GL2N3ddbERH4cyx2R39TRAlBwbGUUium2Oe4mzZx40yl3wjS+OX5PTRbNrIfjR5Vb6pQBc/hU+CaW2cSaCtOruRgCnqIhsfSGXEG/763gfUS60fncmt2Cx+QBEqdAhh5RiWrOq0660aBEhX/myVf+TFgkoqOYTh30v8XNkzbyS3NSSL8P7M8ziNpp0jBgwc9ot/WQiDF2DXs92GCC8gHQz+SIa3YDwZTCmBf794RUsBvVOckzi9F2gONl3OD2kECgYEA7PFlNxm08JLhnR6CTF80aV+q99oi93oBTnQ/ZycMzpFQwh4HQK9A55r8Uknct57nKXVFPxYn31+OfNnmiarl3WlDBFmUH0x1mO9KxLD6Mqcgvxavbn3BBw3lMlrmtsStI+tOrnTo6ZorsRoyRkfUc4SAVWhaeYqP8CD3uU5FqYMCgYEAvya/q5XKjHz8bLm2jSI5LsrgezsOtuVPpKsrqPwJhLG7oJAHGVJSgHJuI5TetwtbiKJzLlAWk5mEz4s2ID3PrY8YBpsc+pw5+uXzLWDynyqdHJAzg4yPcegDovU47KLmQ8puuaRJz9o70IOu8F6dTfjMA8Whx6QrCJ19PI+JdbECgYAKlRFvL4+8OuMmsEkjfhEKL8KkBTMQmHtcdKasRbs1spnHwa2TPwCIF4zzY+cesFMkr98i3St0t4DWpKi+N0rC48Ohexq5dyG9bdqKBFl4T6yPvESji6xGU2GMKTEqsogFFapS8lfArykKZOAf8W9UpXNR3TJFQWICWIaX2R4VXwKBgBuq8idV4SGAndDm+KNpBrndJ6zumWyjuGlvVTx6bq5EQ5I0BrMFlWd+KK8Bx1LbU/5s9RsJAJuQpwabcdQs3jiS87lRDlq/7iyAyDgTRkr/kgomXS53U/P6zzvxHrIxyf6Z+HjqbLynK+08gj/MkhxNHMqW+pm5C3mNwijX5d+hAoGAM1/DhpU0t9tYbNivV8v/fAuP+yYHpVENOpr0G89bNSsEe988Bk8aoUWFqWk+f5Yr71xMwTs6GBzG1K58Rt+OZ0xtALYD+M2IAWCXLfQj3+0Ngk7iUWXQZtG5LwL0ZDC9UuAnarvdhrmLAzH7hf0F2mg79SN+NH9Uy6giVFfctnU=";

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Mode {
  Ok,
  Cancel,
  Fail,
  Changed,
  WrongMessage,
  BadAlg,
  NoHello,
}
impl Mode {
  pub fn parse(s: &str) -> Option<Mode> {
    Some(match s {
      "" | "ok" => Mode::Ok,
      "cancel" => Mode::Cancel,
      "fail" => Mode::Fail,
      "changed" => Mode::Changed,
      "wrong-message" => Mode::WrongMessage,
      "bad-alg" => Mode::BadAlg,
      "no-hello" => Mode::NoHello,
      _ => return None,
    })
  }
}

pub struct Fake {
  pub mode: Mutex<Mode>,
  key: RsaPrivateKey,
  /// The accounts that have a key (create adds, delete removes), and what was signed (a test looks at it).
  pub accounts: Mutex<Vec<String>>,
  pub signed: Mutex<Vec<Vec<u8>>>,
}
impl Fake {
  pub fn new(mode: Mode) -> Self {
    Self::with_key(mode, RsaPrivateKey::from_pkcs1_der(&unb64(TEST_KEY).unwrap_or_default()).expect("the fake Hello's key"))
  }
  /// Another key (a test of a size Orb refuses).
  pub fn with_key(mode: Mode, key: RsaPrivateKey) -> Self {
    Fake { mode: Mutex::new(mode), key, accounts: Mutex::new(Vec::new()), signed: Mutex::new(Vec::new()) }
  }
  pub fn set_mode(&self, mode: Mode) {
    *self.mode.lock().unwrap() = mode;
  }
  pub fn sign_raw(&self, message: &[u8]) -> Vec<u8> {
    SigningKey::<Sha256>::new(self.key.clone()).sign(message).to_vec()
  }
  fn mode(&self) -> Mode {
    *self.mode.lock().unwrap()
  }
}
impl Hello for Fake {
  fn available(&self) -> bool {
    self.mode() != Mode::NoHello
  }
  fn create(&self, account: &str) -> Result<HelloKey, HelloError> {
    match self.mode() {
      Mode::NoHello => return Err(HelloError::Unavailable),
      Mode::Cancel => return Err(HelloError::Cancelled),
      Mode::Fail => return Err(HelloError::Failed),
      _ => {}
    }
    let mut accounts = self.accounts.lock().unwrap();
    accounts.retain(|a| a != account);
    accounts.push(account.to_string());
    let public = self.key.to_public_key().to_pkcs1_der().map_err(|_| HelloError::Failed)?.as_bytes().to_vec();
    Ok(HelloKey { public, alg: if self.mode() == Mode::BadAlg { "rsa2048-pss-sha256".into() } else { ALG.into() }, tpm: false })
  }
  fn sign(&self, account: &str, message: &[u8]) -> Result<Vec<u8>, HelloError> {
    match self.mode() {
      Mode::NoHello => return Err(HelloError::Unavailable),
      Mode::Cancel => return Err(HelloError::Cancelled),
      Mode::Fail => return Err(HelloError::Failed),
      Mode::Changed => return Err(HelloError::Changed),
      _ => {}
    }
    if !self.accounts.lock().unwrap().iter().any(|a| a == account) {
      return Err(HelloError::Changed);
    }
    self.signed.lock().unwrap().push(message.to_vec());
    let mut m = message.to_vec();
    if self.mode() == Mode::WrongMessage {
      m.push(1);
    }
    Ok(self.sign_raw(&m))
  }
  fn delete(&self, account: &str) {
    self.accounts.lock().unwrap().retain(|a| a != account);
  }
}

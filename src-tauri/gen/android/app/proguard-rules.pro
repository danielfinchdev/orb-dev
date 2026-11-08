# Orb's own rules (the Tauri and Wry ones come with their libraries and proguard-wry.pro).
# The Rust functions of src-tauri/src/phone_crypto.rs are found by these exact names (JNI).
-keep class dev.orb.app.PhoneCrypto {
  native <methods>;
}

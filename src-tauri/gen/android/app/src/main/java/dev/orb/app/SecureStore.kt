package dev.orb.app

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * A small key store: values encrypted with an AES key that lives in the Android Keystore and never leaves the phone (this
 * phone's keys for the linked PC, «orb.movil»).
 *
 * Exactly what Orb 3.8.0 (Capacitor, OrbNativePlugin.java) used: the Keystore alias «orb.store», the SharedPreferences
 * file «orb.secure» and the format "<ivLen>:" + base64(iv ‖ ciphertext) with AES-256-GCM (128-bit tag). Installed over
 * 3.8.0 the app keeps its UID and signature, so the Keystore key and the file are still there and the phone stays linked.
 */
object SecureStore {
  private const val KEY_ALIAS = "orb.store"
  private const val PREFS = "orb.secure"

  private fun prefs(context: Context): SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  @Synchronized
  private fun key(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore")
    ks.load(null)
    if (ks.containsAlias(KEY_ALIAS)) return (ks.getEntry(KEY_ALIAS, null) as KeyStore.SecretKeyEntry).secretKey
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return gen.generateKey()
  }

  fun set(context: Context, k: String, value: String) {
    val c = Cipher.getInstance("AES/GCM/NoPadding")
    c.init(Cipher.ENCRYPT_MODE, key())
    val iv = c.iv
    val box = c.doFinal(value.toByteArray(StandardCharsets.UTF_8))
    prefs(context).edit().putString(k, iv.size.toString() + ":" + Base64.encodeToString(iv + box, Base64.NO_WRAP)).apply()
  }

  /** The value, or null: none, or unreadable (the Keystore key is gone: it is removed, the phone links again). */
  fun get(context: Context, k: String): String? {
    val stored = prefs(context).getString(k, null) ?: return null
    return try {
      val sep = stored.indexOf(':')
      val ivLen = stored.substring(0, sep).toInt()
      val all = Base64.decode(stored.substring(sep + 1), Base64.NO_WRAP)
      val c = Cipher.getInstance("AES/GCM/NoPadding")
      c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, all, 0, ivLen))
      String(c.doFinal(all, ivLen, all.size - ivLen), StandardCharsets.UTF_8)
    } catch (e: Exception) {
      prefs(context).edit().remove(k).apply()
      null
    }
  }

  fun remove(context: Context, k: String) {
    prefs(context).edit().remove(k).apply()
  }
}

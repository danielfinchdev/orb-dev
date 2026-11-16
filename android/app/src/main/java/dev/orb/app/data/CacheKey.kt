package dev.orb.app.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** What the database passphrase's storage answered. */
sealed class CacheKeyState {
    /** The 32-byte passphrase. */
    class Ready(val passphrase: ByteArray) : CacheKeyState()

    /** No passphrase was ever stored: a database file found next to this cannot be opened. */
    data object Missing : CacheKeyState()

    /** One is stored but cannot be opened any more (the Keystore key is gone or another one, a restore): start over. */
    data object Lost : CacheKeyState()

    /** The Keystore could not be used right now: nothing is deleted, the cache is simply unavailable for now. */
    data object Busy : CacheKeyState()
}

/** Where the database passphrase lives. Injectable so the database factory can be tested without a Keystore. */
interface CacheKeyProvider {
    fun load(): CacheKeyState

    /** Makes and stores a new random passphrase, replacing any old one. */
    fun create(): ByteArray

    /** Forgets the passphrase and its Keystore key. */
    fun clear()
}

/**
 * Seals a passphrase with an AES-256-GCM key. Pure JVM so it is tested without a phone; the Keystore only supplies the key.
 * Format: "v1:" + hex(iv ‖ ciphertext ‖ tag).
 */
class PassphraseVault(private val key: () -> SecretKey, private val random: SecureRandom = SecureRandom()) {
    fun seal(passphrase: ByteArray): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val box = c.doFinal(passphrase)
        return PREFIX + hex(c.iv + box)
    }

    /** The passphrase, or null if [stored] is not ours or does not open with the key (wrong key, damaged). */
    fun open(stored: String): ByteArray? {
        if (!stored.startsWith(PREFIX)) return null
        val raw = unhex(stored.removePrefix(PREFIX)) ?: return null
        if (raw.size <= IV_LEN + 16) return null
        return try {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw, 0, IV_LEN))
            c.doFinal(raw, IV_LEN, raw.size - IV_LEN)
        } catch (e: GeneralSecurityException) {
            null
        }
    }

    fun newPassphrase(): ByteArray = ByteArray(32).also { random.nextBytes(it) }

    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
    private fun unhex(s: String): ByteArray? =
        if (s.length % 2 != 0) null else runCatching { ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() } }.getOrNull()

    private companion object {
        const val PREFIX = "v1:"
        const val IV_LEN = 12
    }
}

/**
 * The passphrase wrapped by its own Keystore key «orb.cache», in its own prefs file «orb.cache». Deliberately apart from
 * [dev.orb.app.SecureStore] (alias «orb.store», prefs «orb.secure»), which keeps the link keys: wiping or losing one
 * must never touch the other.
 */
class KeystoreCacheKey(context: Context) : CacheKeyProvider {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val vault = PassphraseVault(::keystoreKey)

    @Synchronized
    private fun keystoreKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    @Synchronized
    override fun load(): CacheKeyState {
        val stored = prefs.getString(PREF_KEY, null) ?: return CacheKeyState.Missing
        return try {
            // A Keystore with no «orb.cache» key (wiped, restored on another phone) makes a new one, which cannot open the old value.
            vault.open(stored)?.let { CacheKeyState.Ready(it) } ?: CacheKeyState.Lost
        } catch (e: Exception) {
            CacheKeyState.Busy
        }
    }

    @Synchronized
    override fun create(): ByteArray {
        val pass = vault.newPassphrase()
        prefs.edit().putString(PREF_KEY, vault.seal(pass)).commit()
        return pass
    }

    @Synchronized
    override fun clear() {
        prefs.edit().clear().commit()
        runCatching { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(ALIAS) }
    }

    private companion object {
        const val ALIAS = "orb.cache"
        const val PREFS = "orb.cache"
        const val PREF_KEY = "db"
    }
}

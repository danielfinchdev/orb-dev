package dev.orb.app.lock

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.annotation.RequiresApi
import dev.orb.app.ui.theme.KeyValueStore
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** A cipher ready to be handed to the system prompt, or the reason there is none. */
sealed interface LockCipher {
    data class Ready(val cipher: Cipher) : LockCipher

    /** The key can no longer be used (a new fingerprint, or the screen lock was removed) or is gone. */
    data object Invalidated : LockCipher
}

/**
 * The key that makes the lock real: an AES-GCM key of the Keystore that needs the person's fingerprint, face or PIN for
 * every use. A random challenge is sealed with it when the lock is turned on, and the gate opens only when the
 * authenticated cipher opens that challenge again. It guards the app's door, not the data: the link keys stay in
 * `orb.store`, because reconnecting and notices need them without anybody present.
 * It is behind an interface so the lock can be tested without a Keystore.
 */
interface LockCrypto {
    /** Replaces any older key by a new one and returns its ENCRYPT cipher, to be authenticated by the prompt. */
    fun prepareEnable(): LockCipher

    /** Stores the challenge sealed by the authenticated [cipher]. */
    fun seal(cipher: Cipher): Boolean

    /** The DECRYPT cipher over the stored challenge. */
    fun prepareUnlock(): LockCipher

    /** True only when the authenticated [cipher] opens the stored challenge. */
    fun open(cipher: Cipher): Boolean

    /** Forgets the key and the challenge. */
    fun clear()
}

/** Android 11 or later: `setUserAuthenticationParameters` (timeout 0, strong biometrics or the device credential) exists from there. */
@RequiresApi(Build.VERSION_CODES.R)
class KeystoreLockCrypto(private val store: KeyValueStore, private val log: (String) -> Unit = {}) : LockCrypto {
    private fun keyStore() = KeyStore.getInstance(PROVIDER).apply { load(null) }

    private fun spec(strongBox: Boolean) = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setUserAuthenticationRequired(true)
        // Timeout 0: every use needs a fresh authentication bound to the CryptoObject, not a recent unlock of the phone.
        .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
        .setInvalidatedByBiometricEnrollment(true)
        .setIsStrongBoxBacked(strongBox)
        .build()

    private fun generate(strongBox: Boolean) {
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
        generator.init(spec(strongBox))
        generator.generateKey()
    }

    private fun createKey() {
        val t0 = System.nanoTime()
        var strongBox = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
        try {
            generate(strongBox)
        } catch (e: Exception) {
            // A phone that says it has StrongBox but cannot make the key there: the normal hardware key still protects it.
            if (!strongBox) throw e
            strongBox = false
            generate(false)
        }
        log("lock key created, strongbox=$strongBox, ${(System.nanoTime() - t0) / 1_000_000} ms")
    }

    private fun key(): SecretKey? = keyStore().getKey(ALIAS, null) as? SecretKey

    override fun prepareEnable(): LockCipher = try {
        clear()
        createKey()
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        LockCipher.Ready(cipher)
    } catch (e: Exception) {
        // Any failure to make or use the new key means the lock cannot be turned on safely.
        LockCipher.Invalidated
    }

    override fun seal(cipher: Cipher): Boolean = try {
        val challenge = ByteArray(CHALLENGE_BYTES).also { SecureRandom().nextBytes(it) }
        val sealed = cipher.doFinal(challenge)
        store.edit {
            putString(IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            putString(SEALED, Base64.encodeToString(sealed, Base64.NO_WRAP))
        }
        true
    } catch (e: GeneralSecurityException) {
        false
    }

    override fun prepareUnlock(): LockCipher {
        val iv = store.getString(IV)?.let { Base64.decode(it, Base64.NO_WRAP) } ?: return LockCipher.Invalidated
        return try {
            val key = key() ?: return LockCipher.Invalidated
            val cipher = Cipher.getInstance(TRANSFORM)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
            LockCipher.Ready(cipher)
        } catch (e: KeyPermanentlyInvalidatedException) {
            LockCipher.Invalidated
        } catch (e: GeneralSecurityException) {
            LockCipher.Invalidated
        }
    }

    override fun open(cipher: Cipher): Boolean = try {
        val sealed = store.getString(SEALED)?.let { Base64.decode(it, Base64.NO_WRAP) }
        // GCM checks its tag: a wrong key or a changed challenge throws, so a result at all means the door may open.
        sealed != null && cipher.doFinal(sealed).size == CHALLENGE_BYTES
    } catch (e: GeneralSecurityException) {
        false
    }

    override fun clear() {
        try { keyStore().deleteEntry(ALIAS) } catch (e: GeneralSecurityException) { /* nothing to delete */ }
        store.edit { putString(IV, null); putString(SEALED, null) }
    }

    private companion object {
        const val PROVIDER = "AndroidKeyStore"
        const val ALIAS = "orb.lock"
        const val TRANSFORM = "AES/GCM/NoPadding"
        const val TAG_BITS = 128
        const val CHALLENGE_BYTES = 32
        const val IV = "lock.iv"
        const val SEALED = "lock.challenge"
    }
}

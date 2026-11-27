package dev.orb.app.approve

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import androidx.annotation.RequiresApi
import dev.orb.app.ui.theme.KeyValueStore
import java.security.GeneralSecurityException
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

/** A signature ready to be handed to the system prompt, or the reason there is none. */
sealed interface ApproveSigner {
    class Ready(val signature: Signature) : ApproveSigner

    /** The key can no longer be used (a new fingerprint was added): the PC has to register this phone again. */
    data object Invalidated : ApproveSigner

    /** There is no key: nothing was registered, or it was lost. */
    data object Missing : ApproveSigner

    /** The key could not be used this time for another reason: trying again is the whole advice, the key is not touched. */
    data object Failed : ApproveSigner
}

/**
 * The key that approves the PC's sensitive actions: an ECDSA P-256 key of the Keystore that only a strong biometric (class 3)
 * can use, with no PIN as an alternative. It is made only when the PC registers this phone ([createKey]), never on its own and
 * never again after it was invalidated. Behind an interface so the approval can be tested without a Keystore.
 */
interface ApproveCrypto {
    fun hasKey(): Boolean

    /**
     * Makes a new key beside the one in use, which stays as it is until [commit]. False when the phone cannot make it (no strong
     * biometric, or Android older than 11).
     */
    fun createPending(): Boolean

    /** The PC accepted the registration: the pending key replaces the old one. */
    fun commit()

    /** The registration did not happen: the pending key goes, the old one stays. */
    fun discardPending()

    /** The key's public half, SEC1 uncompressed (65 bytes), or null without that key. */
    fun publicKey(pending: Boolean = false): ByteArray?

    /** The signature to authenticate with (the prompt unlocks it for one signing). */
    fun prepareSign(pending: Boolean = false): ApproveSigner

    /** After the prompt: signs [message] with the unlocked [signature] (DER, what the vault verifies). Null when it fails. */
    fun sign(signature: Signature, message: ByteArray): ByteArray?

    /** Forgets the key. */
    fun clear()
}

/** Android 10 or older: there is no key that only a strong biometric opens, so there is nothing to approve with. */
object NoApproveCrypto : ApproveCrypto {
    override fun hasKey() = false
    override fun createPending() = false
    override fun commit() {}
    override fun discardPending() {}
    override fun publicKey(pending: Boolean): ByteArray? = null
    override fun prepareSign(pending: Boolean): ApproveSigner = ApproveSigner.Missing
    override fun sign(signature: Signature, message: ByteArray): ByteArray? = null
    override fun clear() {}
}

/** Android 11 or later: `setUserAuthenticationParameters` (timeout 0, strong biometrics only) exists from there. */
@RequiresApi(Build.VERSION_CODES.R)
class KeystoreApproveCrypto(private val store: KeyValueStore, private val log: (String) -> Unit = {}) : ApproveCrypto {
    private fun keyStore() = KeyStore.getInstance(PROVIDER).apply { load(null) }

    /** Two aliases take turns: the one in use, and the one a new registration is made under until the PC accepts it. */
    private fun active() = if (store.getString(ACTIVE) == ALIAS_B) ALIAS_B else ALIAS_A
    private fun pendingAlias() = if (active() == ALIAS_A) ALIAS_B else ALIAS_A

    private fun spec(alias: String, strongBox: Boolean) = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256)
        .setUserAuthenticationRequired(true)
        // Timeout 0 and strong biometrics alone: every signature needs a fresh fingerprint or face bound to the CryptoObject, never the PIN.
        .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        .setInvalidatedByBiometricEnrollment(true)
        .setIsStrongBoxBacked(strongBox)
        .build()

    private fun generate(alias: String, strongBox: Boolean) {
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, PROVIDER)
        generator.initialize(spec(alias, strongBox))
        generator.generateKeyPair()
    }

    private fun delete(alias: String) {
        try { keyStore().deleteEntry(alias) } catch (e: GeneralSecurityException) { /* nothing to delete */ }
    }

    override fun hasKey(): Boolean = try { keyStore().containsAlias(active()) } catch (e: GeneralSecurityException) { false }

    override fun createPending(): Boolean {
        val alias = pendingAlias()
        delete(alias)
        return try {
            try {
                generate(alias, strongBox = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
            } catch (e: Exception) {
                // A phone that says it has StrongBox but cannot make the key there: the normal hardware key still protects it.
                generate(alias, strongBox = false)
            }
            true
        } catch (e: Exception) {
            // No strong biometric enrolled, or the Keystore refuses: no key, and the registration says so.
            log("approve key not created: ${e.javaClass.simpleName}")
            false
        }
    }

    override fun commit() {
        val old = active()
        store.edit { putString(ACTIVE, pendingAlias()) }
        delete(old)
    }

    override fun discardPending() = delete(pendingAlias())

    private fun alias(pending: Boolean) = if (pending) pendingAlias() else active()

    override fun publicKey(pending: Boolean): ByteArray? = try {
        (keyStore().getCertificate(alias(pending))?.publicKey as? ECPublicKey)?.let { Sec1.of(it) }
    } catch (e: GeneralSecurityException) {
        null
    }

    override fun prepareSign(pending: Boolean): ApproveSigner = try {
        val key = keyStore().getKey(alias(pending), null) as? PrivateKey ?: return ApproveSigner.Missing
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(key)
        ApproveSigner.Ready(signature)
    } catch (e: KeyPermanentlyInvalidatedException) {
        ApproveSigner.Invalidated
    } catch (e: GeneralSecurityException) {
        // Only a key that Android says is permanently invalidated is one; anything else may pass on the next try.
        ApproveSigner.Failed
    }

    override fun sign(signature: Signature, message: ByteArray): ByteArray? = try {
        signature.update(message)
        signature.sign()
    } catch (e: GeneralSecurityException) {
        null
    }

    override fun clear() {
        delete(ALIAS_A)
        delete(ALIAS_B)
        store.edit { putString(ACTIVE, null) }
    }

    companion object {
        private const val PROVIDER = "AndroidKeyStore"
        private const val ALIAS_A = "orb.approve"
        private const val ALIAS_B = "orb.approve.b"
        private const val ACTIVE = "approve.alias"

    }
}

/** A P-256 public key as the vault takes it: SEC1 uncompressed, 0x04 ‖ X ‖ Y, each 32 bytes. */
object Sec1 {
    fun of(key: ECPublicKey): ByteArray {
        fun fixed(v: java.math.BigInteger): ByteArray {
            val raw = v.toByteArray().let { if (it.size > 1 && it[0] == 0.toByte()) it.copyOfRange(1, it.size) else it }
            return ByteArray(32 - raw.size) + raw
        }
        return byteArrayOf(4) + fixed(key.w.affineX) + fixed(key.w.affineY)
    }
}

package dev.orb.app.approve

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import androidx.annotation.RequiresApi
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
}

/**
 * The key that approves the PC's sensitive actions: an ECDSA P-256 key of the Keystore that only a strong biometric (class 3)
 * can use, with no PIN as an alternative. It is made only when the PC registers this phone ([createKey]), never on its own and
 * never again after it was invalidated. Behind an interface so the approval can be tested without a Keystore.
 */
interface ApproveCrypto {
    fun hasKey(): Boolean

    /** Replaces any older key by a new one. False when the phone cannot make it (no strong biometric, or Android older than 11). */
    fun createKey(): Boolean

    /** The key's public half, SEC1 uncompressed (65 bytes), or null without a key. */
    fun publicKey(): ByteArray?

    /** The signature to authenticate with (the prompt unlocks it for one signing). */
    fun prepareSign(): ApproveSigner

    /** After the prompt: signs [message] with the unlocked [signature] (DER, what the vault verifies). Null when it fails. */
    fun sign(signature: Signature, message: ByteArray): ByteArray?

    /** Forgets the key. */
    fun clear()
}

/** Android 10 or older: there is no key that only a strong biometric opens, so there is nothing to approve with. */
object NoApproveCrypto : ApproveCrypto {
    override fun hasKey() = false
    override fun createKey() = false
    override fun publicKey(): ByteArray? = null
    override fun prepareSign(): ApproveSigner = ApproveSigner.Missing
    override fun sign(signature: Signature, message: ByteArray): ByteArray? = null
    override fun clear() {}
}

/** Android 11 or later: `setUserAuthenticationParameters` (timeout 0, strong biometrics only) exists from there. */
@RequiresApi(Build.VERSION_CODES.R)
class KeystoreApproveCrypto(private val log: (String) -> Unit = {}) : ApproveCrypto {
    private fun keyStore() = KeyStore.getInstance(PROVIDER).apply { load(null) }

    private fun spec(strongBox: Boolean) = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256)
        .setUserAuthenticationRequired(true)
        // Timeout 0 and strong biometrics alone: every signature needs a fresh fingerprint or face bound to the CryptoObject, never the PIN.
        .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        .setInvalidatedByBiometricEnrollment(true)
        .setIsStrongBoxBacked(strongBox)
        .build()

    private fun generate(strongBox: Boolean) {
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, PROVIDER)
        generator.initialize(spec(strongBox))
        generator.generateKeyPair()
    }

    override fun hasKey(): Boolean = try { keyStore().containsAlias(ALIAS) } catch (e: GeneralSecurityException) { false }

    override fun createKey(): Boolean {
        clear()
        return try {
            try {
                generate(strongBox = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
            } catch (e: Exception) {
                // A phone that says it has StrongBox but cannot make the key there: the normal hardware key still protects it.
                generate(strongBox = false)
            }
            true
        } catch (e: Exception) {
            // No strong biometric enrolled, or the Keystore refuses: no key, and the registration says so.
            log("approve key not created: ${e.javaClass.simpleName}")
            false
        }
    }

    override fun publicKey(): ByteArray? = try {
        (keyStore().getCertificate(ALIAS)?.publicKey as? ECPublicKey)?.let { Sec1.of(it) }
    } catch (e: GeneralSecurityException) {
        null
    }

    override fun prepareSign(): ApproveSigner = try {
        val key = keyStore().getKey(ALIAS, null) as? PrivateKey ?: return ApproveSigner.Missing
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(key)
        ApproveSigner.Ready(signature)
    } catch (e: KeyPermanentlyInvalidatedException) {
        ApproveSigner.Invalidated
    } catch (e: GeneralSecurityException) {
        ApproveSigner.Invalidated
    }

    override fun sign(signature: Signature, message: ByteArray): ByteArray? = try {
        signature.update(message)
        signature.sign()
    } catch (e: GeneralSecurityException) {
        null
    }

    override fun clear() {
        try { keyStore().deleteEntry(ALIAS) } catch (e: GeneralSecurityException) { /* nothing to delete */ }
    }

    companion object {
        private const val PROVIDER = "AndroidKeyStore"
        private const val ALIAS = "orb.approve"

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

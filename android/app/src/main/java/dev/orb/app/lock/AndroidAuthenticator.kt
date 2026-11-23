package dev.orb.app.lock

import android.app.Activity
import android.app.KeyguardManager
import android.os.Build
import androidx.activity.result.contract.ActivityResultContracts
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * The system's own authentication for one activity: the biometric prompt (fingerprint or face, with the phone's PIN as
 * its alternative) and, where the prompt cannot offer the PIN, the system's credential screen. Create it in `onCreate`:
 * the credential screen's result launcher must be registered before the activity starts.
 */
class AndroidAuthenticator(private val activity: FragmentActivity) : Authenticator {
    private val keyguard = activity.getSystemService(KeyguardManager::class.java)
    private val credentialScreen = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val done = credentialDone
        credentialDone = null
        done?.invoke(if (result.resultCode == Activity.RESULT_OK) AuthResult.Success else AuthResult.Cancelled)
    }

    /**
     * Strong biometrics or the phone's PIN. On Android 9 and 10 the prompt does not accept that pair (the PIN can only
     * come with weak biometrics there); below 9 the library supplies the PIN through the credential screen itself.
     */
    private val authenticators: Int
        get() = if (Build.VERSION.SDK_INT in Build.VERSION_CODES.P..Build.VERSION_CODES.Q) BIOMETRIC_WEAK or DEVICE_CREDENTIAL else BIOMETRIC_STRONG or DEVICE_CREDENTIAL

    /**
     * Below Android 9 the library's prompt is an AppCompat dialog fragment, which this app's theme cannot host: it can
     * throw on show. There the system's own credential screen is used, which also accepts the fingerprint.
     */
    private val promptSupported: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P

    private fun promptReady() = promptSupported && BiometricManager.from(activity).canAuthenticate(authenticators) == BiometricManager.BIOMETRIC_SUCCESS

    private fun pinSet() = keyguard?.isDeviceSecure == true

    override fun capability() = if (promptReady() || pinSet()) AuthCapability.Ready else AuthCapability.NothingSet

    override fun authenticate(request: AuthRequest, onResult: (AuthResult) -> Unit) {
        when {
            // A key-bound request has no credential-screen fallback: only the prompt can unlock a cipher.
            request.cipher != null -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) prompt(request, onResult) else onResult(AuthResult.Failed)
            !request.credentialOnly && promptReady() -> prompt(request, onResult)
            pinSet() -> credential(request, onResult)
            else -> onResult(AuthResult.NothingSet)
        }
    }

    private fun prompt(request: AuthRequest, onResult: (AuthResult) -> Unit) {
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                val cipher = result.cryptoObject?.cipher
                onResult(
                    when {
                        request.cipher == null -> AuthResult.Success
                        cipher != null -> AuthResult.Crypto(cipher)
                        else -> AuthResult.Failed
                    },
                )
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                onResult(
                    when (errorCode) {
                        BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_NEGATIVE_BUTTON, BiometricPrompt.ERROR_CANCELED -> AuthResult.Cancelled
                        BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> AuthResult.Blocked
                        BiometricPrompt.ERROR_NO_BIOMETRICS, BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL, BiometricPrompt.ERROR_HW_NOT_PRESENT -> AuthResult.NothingSet
                        BiometricPrompt.ERROR_UNABLE_TO_PROCESS, BiometricPrompt.ERROR_TIMEOUT -> AuthResult.NotRecognized
                        else -> AuthResult.Failed
                    },
                )
            }
        }
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(request.title)
            .setSubtitle(request.subtitle)
            .setAllowedAuthenticators(if (request.cipher != null && request.credentialOnly) DEVICE_CREDENTIAL else authenticators)
            .setConfirmationRequired(false)
            .build()
        try {
            val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback)
            if (request.cipher != null) prompt.authenticate(info, BiometricPrompt.CryptoObject(request.cipher)) else prompt.authenticate(info)
        } catch (e: RuntimeException) {
            // The prompt could not be shown (a theme or fragment state problem): the credential screen still can,
            // unless the request needs the key, which only the prompt can unlock.
            if (request.cipher == null && pinSet()) credential(request, onResult) else onResult(AuthResult.Failed)
        }
    }

    private fun credential(request: AuthRequest, onResult: (AuthResult) -> Unit) {
        val intent = keyguard?.createConfirmDeviceCredentialIntent(request.title, request.subtitle)
        if (intent == null) return onResult(AuthResult.NothingSet)
        credentialDone = onResult
        try {
            credentialScreen.launch(intent)
        } catch (e: RuntimeException) {
            credentialDone = null
            onResult(AuthResult.Failed)
        }
    }

    private companion object {
        /**
         * The credential screen can outlive the activity that opened it (a rotation or low memory recreates it); the
         * callback is kept here so the new activity's launcher still delivers the result to the lock.
         */
        @Volatile
        var credentialDone: ((AuthResult) -> Unit)? = null
    }
}

package dev.orb.app.lock

import dev.orb.app.ui.theme.MemoryStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** A software stand-in for the Keystore key: same AES-GCM, no authentication, and it can be invalidated. */
class SoftLockCrypto : LockCrypto {
    var key: SecretKey? = null
    var invalidated = false
    var cleared = 0
    private var iv: ByteArray? = null
    private var sealed: ByteArray? = null

    private fun newKey() = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    override fun prepareEnable(): LockCipher {
        key = newKey(); invalidated = false; iv = null; sealed = null
        return LockCipher.Ready(Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key) })
    }

    override fun seal(cipher: Cipher): Boolean {
        iv = cipher.iv
        sealed = cipher.doFinal(ByteArray(32).also { SecureRandom().nextBytes(it) })
        return true
    }

    override fun prepareUnlock(): LockCipher {
        val k = key
        val v = iv
        if (invalidated || k == null || v == null) return LockCipher.Invalidated
        return LockCipher.Ready(Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(128, v)) })
    }

    override fun open(cipher: Cipher) = try { sealed != null && cipher.doFinal(sealed).size == 32 } catch (e: java.security.GeneralSecurityException) { false }

    override fun clear() { cleared++; key = null; iv = null; sealed = null }

    /** A decrypting cipher with a key that never sealed anything: what a forged answer would carry. */
    fun strangerCipher(): Cipher {
        // Not inside `apply`: there `iv` would be the cipher's own, still empty.
        val sealedIv = iv!!
        return Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, newKey(), GCMParameterSpec(128, sealedIv)) }
    }
}

class KeyedLockTest {
    private val store = MemoryStore()
    private val prefs = LockPrefs(store)
    private val crypto = SoftLockCrypto()
    private val logs = mutableListOf<String>()
    private val lock = AppLock(prefs, AppLockGate(prefs, { 0L }), crypto, logs::add)
    private val auth = FakeAuthenticator().also { lock.authenticator = it }

    private fun turnOn() {
        var result: AuthResult? = null
        lock.enable { result = it }
        auth.answer(AuthResult.Crypto(auth.requests.last().cipher!!))
        assertEquals(AuthResult.Success, result)
        // A cold start: the door is shut again.
        lock.gate.onBackground(); lock.gate.lockForTest()
    }

    private fun AppLockGate.lockForTest() { prefs.setDelay(LockDelay.Immediate); onForeground() }

    @Test fun enablingSealsAChallengeAndTurnsTheLockOn() {
        turnOn()
        assertTrue(prefs.settings.value.enabled)
        assertNotNull(auth.requests.last().cipher)
        assertTrue(logs.any { it.startsWith("lock enabled") })
    }

    @Test fun theDoorOpensOnlyWhenTheCipherOpensTheChallenge() {
        turnOn()
        assertFalse(lock.gate.isOpen())
        lock.unlock()
        auth.answer(AuthResult.Crypto(auth.requests.last().cipher!!))
        assertTrue(lock.gate.isOpen())
        assertTrue(logs.any { it.startsWith("lock opened") })
    }

    @Test fun aCipherThatDoesNotOpenTheChallengeKeepsTheDoorShut() {
        turnOn()
        lock.unlock()
        auth.answer(AuthResult.Crypto(crypto.strangerCipher()))
        assertFalse(lock.gate.isOpen())
        assertEquals(LockNotice.Failed, lock.notice.value)
        assertTrue(prefs.settings.value.enabled)
    }

    @Test fun anAnswerWithoutTheKeyIsNotEnough() {
        turnOn()
        lock.unlock()
        auth.answer(AuthResult.Success)
        assertFalse(lock.gate.isOpen())
    }

    @Test fun aCancelledEnableLeavesTheLockOffAndNoKey() {
        var result: AuthResult? = null
        lock.enable { result = it }
        auth.answer(AuthResult.Cancelled)
        assertEquals(AuthResult.Cancelled, result)
        assertFalse(prefs.settings.value.enabled)
        assertEquals(null, crypto.key)
    }

    @Test fun anInvalidatedKeyWithNoScreenLockTurnsTheLockOffAndSaysSo() {
        turnOn()
        crypto.invalidated = true
        auth.capability = AuthCapability.NothingSet
        lock.unlock()
        assertFalse(prefs.settings.value.enabled)
        assertTrue(prefs.settings.value.autoOff)
        assertTrue(lock.gate.isOpen())
        assertEquals(null, crypto.key)
    }

    @Test fun anInvalidatedKeyWithAScreenLockAsksForThePinAndMakesANewKey() {
        turnOn()
        val old = crypto.key
        crypto.invalidated = true
        lock.unlock()
        assertTrue(auth.requests.last().credentialOnly)
        auth.answer(AuthResult.Crypto(auth.requests.last().cipher!!))
        assertTrue(lock.gate.isOpen())
        assertTrue(prefs.settings.value.enabled)
        assertFalse(crypto.key === old)
        // And the new key is the one that opens the door next time.
        lock.gate.onBackground(); lock.gate.onForeground()
        lock.unlock()
        auth.answer(AuthResult.Crypto(auth.requests.last().cipher!!))
        assertTrue(lock.gate.isOpen())
    }

    @Test fun aLockMadeBeforeTheKeyExistedIsRenewedWithThePin() {
        prefs.setEnabled(true)
        val old = AppLock(prefs, AppLockGate(prefs, { 0L }), crypto)
        val a = FakeAuthenticator().also { old.authenticator = it }
        old.unlock()
        assertTrue(a.requests.last().credentialOnly)
        a.answer(AuthResult.Crypto(a.requests.last().cipher!!))
        assertTrue(old.gate.isOpen())
    }

    @Test fun turningTheLockOffForgetsTheKey() {
        turnOn()
        lock.disable()
        assertEquals(null, crypto.key)
        assertFalse(prefs.settings.value.enabled)
    }

    @Test fun belowAndroid11TheLockAsksTheSystemOnly() {
        val plain = AppLock(prefs, AppLockGate(prefs, { 0L }))
        val a = FakeAuthenticator().also { plain.authenticator = it }
        plain.enable { }
        assertEquals(null, a.requests.last().cipher)
        a.answer(AuthResult.Success)
        assertTrue(prefs.settings.value.enabled)
        plain.gate.onBackground(); prefs.setDelay(LockDelay.Immediate); plain.gate.onForeground()
        plain.unlock()
        assertEquals(null, a.requests.last().cipher)
        a.answer(AuthResult.Success)
        assertTrue(plain.gate.isOpen())
    }

    @Test fun theNoteAboutTheAutomaticSwitchOffFollowsTheLanguage() {
        assertTrue(dev.orb.app.ui.thisphone.ThisPhoneTexts.lockAutoOff("en").startsWith("The lock"))
        assertTrue(dev.orb.app.ui.thisphone.ThisPhoneTexts.lockAutoOff("es").startsWith("El bloqueo"))
    }
}

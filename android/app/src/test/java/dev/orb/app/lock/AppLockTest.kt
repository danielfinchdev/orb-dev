package dev.orb.app.lock

import dev.orb.app.ui.theme.MemoryStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FakeAuthenticator(var capability: AuthCapability = AuthCapability.Ready) : Authenticator {
    val requests = mutableListOf<AuthRequest>()
    private var pending: ((AuthResult) -> Unit)? = null
    override fun capability() = capability
    override fun authenticate(request: AuthRequest, onResult: (AuthResult) -> Unit) {
        requests += request
        pending = onResult
    }
    fun answer(r: AuthResult) { pending!!.also { pending = null }.invoke(r) }
}

class AppLockTest {
    private var clock = 1_000L
    private val store = MemoryStore()
    private val prefs = LockPrefs(store)
    private fun gate() = AppLockGate(prefs, { clock })

    @Test fun offByDefaultSoTheAppIsAlwaysOpen() {
        val g = gate()
        assertTrue(g.isOpen())
        g.onBackground(); clock += 3_600_000; g.onForeground()
        assertTrue(g.isOpen())
    }

    @Test fun aColdStartWithTheLockOnIsLocked() {
        prefs.setEnabled(true)
        val g = gate()
        assertFalse(g.isOpen())
        assertTrue(g.locked.value)
    }

    @Test fun theSettingsSurviveARestart() {
        prefs.setEnabled(true); prefs.setDelay(LockDelay.FiveMinutes)
        val again = LockPrefs(store).settings.value
        assertTrue(again.enabled)
        assertEquals(LockDelay.FiveMinutes, again.delay)
    }

    @Test fun locksOnlyAfterTheChosenTimeInTheBackground() {
        prefs.setEnabled(true)
        val g = gate().also { it.unlock() }
        g.onBackground(); clock += 59_999; g.onForeground()
        assertTrue(g.isOpen())
        g.onBackground(); clock += 60_000; g.onForeground()
        assertFalse(g.isOpen())
    }

    @Test fun theDelayOptionsApply() {
        prefs.setEnabled(true)
        val g = gate().also { it.unlock() }
        prefs.setDelay(LockDelay.Immediate)
        g.onBackground(); g.onForeground()
        assertFalse(g.isOpen())
        g.unlock()
        prefs.setDelay(LockDelay.FiveMinutes)
        g.onBackground(); clock += 299_000; g.onForeground()
        assertTrue(g.isOpen())
        g.onBackground(); clock += 300_000; g.onForeground()
        assertFalse(g.isOpen())
    }

    @Test fun returningFromTheSystemCredentialScreenDoesNotLockAgain() {
        prefs.setEnabled(true); prefs.setDelay(LockDelay.Immediate)
        val g = gate()
        g.onBackground() // the credential screen covers the app
        g.unlock() // its result arrives before the app is shown again
        g.onForeground()
        assertTrue(g.isOpen())
    }

    @Test fun aLockedAppStaysLockedUntilTheSystemSaysYes() {
        prefs.setEnabled(true)
        val lock = AppLock(prefs, gate())
        val auth = FakeAuthenticator().also { lock.authenticator = it }
        lock.unlock()
        assertEquals(1, auth.requests.size)
        auth.answer(AuthResult.Cancelled)
        assertFalse(lock.gate.isOpen())
        lock.unlock()
        auth.answer(AuthResult.Failed)
        assertFalse(lock.gate.isOpen())
        assertEquals(LockNotice.Failed, lock.notice.value)
        lock.unlock()
        auth.answer(AuthResult.Success)
        assertTrue(lock.gate.isOpen())
    }

    @Test fun tooManyTriesOnlyBlocksTheSensorAndKeepsTheSetting() {
        prefs.setEnabled(true)
        val lock = AppLock(prefs, gate())
        val auth = FakeAuthenticator().also { lock.authenticator = it }
        lock.unlock()
        auth.answer(AuthResult.Blocked)
        assertEquals(LockNotice.Blocked, lock.notice.value)
        assertFalse(lock.gate.isOpen())
        assertTrue(lock.settings.value.enabled)
    }

    @Test fun thePinButtonAsksForTheCredentialOnly() {
        prefs.setEnabled(true)
        val lock = AppLock(prefs, gate())
        val auth = FakeAuthenticator().also { lock.authenticator = it }
        lock.unlock(pin = true)
        assertTrue(auth.requests.single().credentialOnly)
    }

    @Test fun aSecondTapWhileAskingDoesNotOpenASecondPrompt() {
        prefs.setEnabled(true)
        val lock = AppLock(prefs, gate())
        val auth = FakeAuthenticator().also { lock.authenticator = it }
        lock.unlock(); lock.unlock()
        assertEquals(1, auth.requests.size)
    }

    @Test fun withoutAnActivityNothingOpens() {
        prefs.setEnabled(true)
        val lock = AppLock(prefs, gate())
        lock.unlock()
        assertFalse(lock.gate.isOpen())
    }

    @Test fun turningTheLockOnNeedsASuccessfulAuthenticationNow() {
        val lock = AppLock(prefs, gate())
        val auth = FakeAuthenticator().also { lock.authenticator = it }
        var result: AuthResult? = null
        lock.enable { result = it }
        assertFalse(prefs.settings.value.enabled)
        auth.answer(AuthResult.Cancelled)
        assertEquals(AuthResult.Cancelled, result)
        assertFalse(prefs.settings.value.enabled)
        lock.enable { result = it }
        auth.answer(AuthResult.Success)
        assertTrue(prefs.settings.value.enabled)
        assertTrue(lock.gate.isOpen())
    }

    @Test fun withNothingToAuthenticateWithTheLockCannotBeTurnedOn() {
        val lock = AppLock(prefs, gate())
        lock.authenticator = FakeAuthenticator(AuthCapability.NothingSet)
        var result: AuthResult? = null
        lock.enable { result = it }
        assertEquals(AuthResult.NothingSet, result)
        assertFalse(prefs.settings.value.enabled)
    }

    @Test fun ifThePhoneLosesItsScreenLockTheAppLockIsDroppedInsteadOfStuck() {
        prefs.setEnabled(true)
        val lock = AppLock(prefs, gate())
        lock.authenticator = FakeAuthenticator(AuthCapability.NothingSet)
        lock.unlock()
        assertTrue(lock.gate.isOpen())
        assertFalse(prefs.settings.value.enabled)
    }

    @Test fun turningTheLockOffOpensAndForgets() {
        prefs.setEnabled(true)
        val lock = AppLock(prefs, gate())
        lock.disable()
        assertTrue(lock.gate.isOpen())
        assertFalse(LockPrefs(store).settings.value.enabled)
        assertNull(lock.notice.value)
    }
}

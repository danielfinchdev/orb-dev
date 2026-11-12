package dev.orb.app.ui.lock

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.lock.AppLock
import dev.orb.app.lock.AppLockGate
import dev.orb.app.lock.AuthResult
import dev.orb.app.lock.FakeAuthenticator
import dev.orb.app.lock.LockNotice
import dev.orb.app.lock.LockPrefs
import dev.orb.app.lock.LockTexts
import dev.orb.app.ui.theme.MemoryStore
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.ThemeChoice
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LockScreenTest {
    @get:Rule val rule = createComposeRule()

    private fun lock(): Pair<AppLock, FakeAuthenticator> {
        val prefs = LockPrefs(MemoryStore()).also { it.setEnabled(true) }
        val lock = AppLock(prefs, AppLockGate(prefs) { 0L })
        return lock to FakeAuthenticator().also { lock.authenticator = it }
    }

    @Test fun showsOnlyTheLockAndAsksTheSystemRightAway() {
        val (lock, auth) = lock()
        rule.setContent { OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { LockScreen(lock) } }
        rule.waitForIdle()
        rule.onNodeWithText(LockTexts.LOCKED_TITLE).assertIsDisplayed()
        rule.onNodeWithText(LockTexts.USE_PIN).assertIsDisplayed()
        assertEquals(1, auth.requests.size)
        assertFalse(auth.requests.single().credentialOnly)
        assertFalse(lock.gate.isOpen())
    }

    @Test fun thePinButtonAsksForThePhonesPin() {
        val (lock, auth) = lock()
        rule.setContent { OrbTheme(ThemeChoice.Orbita, dark = true, dynamic = false) { LockScreen(lock) } }
        rule.waitForIdle()
        auth.answer(AuthResult.Cancelled)
        rule.waitForIdle()
        rule.onNodeWithText(LockTexts.USE_PIN).performClick()
        rule.waitForIdle()
        assertTrue(auth.requests.last().credentialOnly)
    }

    @Test fun unlockingOpensTheGate() {
        val (lock, auth) = lock()
        rule.setContent { OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { LockScreen(lock) } }
        rule.waitForIdle()
        auth.answer(AuthResult.Success)
        assertTrue(lock.gate.isOpen())
    }

    @Test fun aBlockedSensorIsExplainedAndNothingIsLost() {
        val (lock, auth) = lock()
        rule.setContent { OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { LockScreen(lock) } }
        rule.waitForIdle()
        auth.answer(AuthResult.Blocked)
        rule.waitForIdle()
        rule.onNodeWithText(LockTexts.BLOCKED).assertIsDisplayed()
        rule.onNodeWithText(LockTexts.UNLOCK).assertIsDisplayed()
        assertTrue(lock.settings.value.enabled)
    }

    @Test fun theButtonsWaitWhileTheSystemIsAsking() {
        rule.setContent { OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { LockContent(null as LockNotice?, busy = true, onUnlock = {}, onPin = {}) } }
        rule.onNodeWithText(LockTexts.UNLOCK).assertIsNotEnabled()
    }
}

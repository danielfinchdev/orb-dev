package dev.orb.app.ui.lock

import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
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
import dev.orb.app.ui.theme.OrbPaletteChoice
import org.junit.Assert.assertEquals
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { LockScreen(lock) } }
        rule.waitForIdle()
        rule.onNodeWithText(LockTexts.LOCKED_TITLE).assertIsDisplayed()
        rule.onNodeWithText(LockTexts.USE_PIN).assertIsDisplayed()
        assertEquals(1, auth.requests.size)
        assertFalse(auth.requests.single().credentialOnly)
        assertFalse(lock.gate.isOpen())
    }

    @Test fun thePinButtonAsksForThePhonesPin() {
        val (lock, auth) = lock()
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = true) { LockScreen(lock) } }
        rule.waitForIdle()
        auth.answer(AuthResult.Cancelled)
        rule.waitForIdle()
        rule.onNodeWithText(LockTexts.USE_PIN).performClick()
        rule.waitForIdle()
        assertTrue(auth.requests.last().credentialOnly)
    }

    @Test fun unlockingOpensTheGate() {
        val (lock, auth) = lock()
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { LockScreen(lock) } }
        rule.waitForIdle()
        auth.answer(AuthResult.Success)
        assertTrue(lock.gate.isOpen())
    }

    @Test fun aBlockedSensorIsExplainedAndNothingIsLost() {
        val (lock, auth) = lock()
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { LockScreen(lock) } }
        rule.waitForIdle()
        auth.answer(AuthResult.Blocked)
        rule.waitForIdle()
        rule.onNodeWithText(LockTexts.BLOCKED).assertIsDisplayed()
        rule.onNodeWithText(LockTexts.UNLOCK_AGAIN).assertIsDisplayed()
        rule.onNodeWithText(LockTexts.USE_PIN).assertIsDisplayed()
        assertTrue(lock.settings.value.enabled)
    }

    @Test fun nothingIsComposedWhileLockedAndAPendingDestinationWaitsForTheUnlock() {
        val (lock, auth) = lock()
        val pending = MutableStateFlow<String?>("chat:5")
        var opened: String? = null
        var composed = 0
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                LockGate(lock) {
                    composed++
                    val target by pending.collectAsState()
                    LaunchedEffect(target) { target?.let { opened = it; pending.value = null } }
                    Text("contenido")
                }
            }
        }
        rule.waitForIdle()
        rule.onNodeWithText("contenido").assertDoesNotExist()
        assertEquals(0, composed)
        assertEquals("chat:5", pending.value)
        auth.answer(AuthResult.Success)
        rule.waitForIdle()
        rule.onNodeWithText("contenido").assertIsDisplayed()
        assertEquals("chat:5", opened)
        assertNull(pending.value)
    }

    @Test fun lockingAgainHidesTheContentAgain() {
        val (lock, auth) = lock()
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { LockGate(lock) { Text("contenido") } } }
        rule.waitForIdle()
        auth.answer(AuthResult.Success)
        rule.waitForIdle()
        rule.onNodeWithText("contenido").assertIsDisplayed()
        lock.prefs.setDelay(dev.orb.app.lock.LockDelay.Immediate)
        lock.gate.onBackground(); lock.gate.onForeground()
        rule.waitForIdle()
        rule.onNodeWithText("contenido").assertDoesNotExist()
        rule.onNodeWithText(LockTexts.LOCKED_TITLE).assertIsDisplayed()
    }

    private fun content(notice: LockNotice?, onUnlock: () -> Unit = {}, onPin: () -> Unit = {}) =
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { LockContent(notice, busy = false, onUnlock = onUnlock, onPin = onPin) } }

    @Test fun theLockedPageHasTheMarkTheSentenceAndTheOneTrueWayToChangeIt() {
        content(null)
        rule.onNodeWithText("Desbloquea para ver tus chats").assertIsDisplayed()
        rule.onNodeWithText("Huella, cara o PIN del móvil").assertIsDisplayed()
        rule.onNodeWithContentDescription("Orbe").assertIsDisplayed()
        rule.onNodeWithText(LockTexts.UNLOCK).assertIsDisplayed()
        rule.onNodeWithText(LockTexts.USE_PIN).assertIsDisplayed()
        rule.onNodeWithText("Opcional · Menú › Este móvil › Bloqueo de la app").assertIsDisplayed()
        rule.onNodeWithText("Nunca pide la contraseña maestra.").assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText("Más", substring = true).fetchSemanticsNodes().size)
    }

    @Test fun aFailedAttemptShowsABannerAndOffersToTryAgainStillWithThePin() {
        var unlocks = 0
        var pins = 0
        content(LockNotice.Failed, onUnlock = { unlocks++ }, onPin = { pins++ })
        rule.onNodeWithText(LockTexts.FAILED).assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText(LockTexts.UNLOCK).fetchSemanticsNodes().size)
        rule.onNodeWithText("Probar otra vez").performClick()
        rule.onNodeWithText(LockTexts.USE_PIN).performClick()
        assertEquals(1, unlocks)
        assertEquals(1, pins)
    }

    @Test fun aFingerNotReadHasTheMockupsOneLine() {
        content(LockNotice.NotRecognized)
        rule.onNodeWithText("No se reconoció. Prueba otra vez.").assertIsDisplayed()
        rule.onNodeWithText("Probar otra vez").assertIsDisplayed()
    }

    @Test fun theAttemptsLimitKeepsItsOwnWords() {
        content(LockNotice.Blocked)
        rule.onNodeWithText(LockTexts.BLOCKED).assertIsDisplayed()
        rule.onNodeWithText("Probar otra vez").assertIsDisplayed()
    }

    @Test fun theButtonsWaitWhileTheSystemIsAsking() {
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { LockContent(null as LockNotice?, busy = true, onUnlock = {}, onPin = {}) } }
        rule.onNodeWithText(LockTexts.UNLOCK).assertIsNotEnabled()
    }
}

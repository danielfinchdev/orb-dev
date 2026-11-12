package dev.orb.app.ui.thisphone

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.PcVersions
import dev.orb.app.lock.AuthCapability
import dev.orb.app.lock.AuthResult
import dev.orb.app.lock.LockDelay
import dev.orb.app.lock.LockSettings
import dev.orb.app.notify.NotifySettings
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.ThemeChoice
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.TimeZone

class FakeThisPhoneBackend : ThisPhoneBackend {
    override val pcName = MutableStateFlow<String?>("DanLaptop")
    override val connection = MutableStateFlow<ConnectionState>(ConnectionState.Online("b", "DanLaptop", PcVersions(4, 2, "3.8.4")))
    override val settings = MutableStateFlow(NotifySettings())
    override val notificationsEnabled = MutableStateFlow(true)
    var requested = 0
    var unlinked = 0
    override fun setKeepConnected(on: Boolean) { settings.value = settings.value.copy(keepConnected = on) }
    override fun setLockScreenPublic(on: Boolean) { settings.value = settings.value.copy(lockScreenPublic = on) }
    override fun requestNotifications() { requested++ }
    override val lock = MutableStateFlow(LockSettings())
    var capability = AuthCapability.Ready
    var enableAnswer: AuthResult = AuthResult.Success
    override fun lockCapability() = capability
    override fun enableLock(onDone: (AuthResult) -> Unit) { if (enableAnswer == AuthResult.Success) lock.value = lock.value.copy(enabled = true); onDone(enableAnswer) }
    override fun disableLock() { lock.value = lock.value.copy(enabled = false) }
    override fun setLockDelay(delay: LockDelay) { lock.value = lock.value.copy(delay = delay) }
    override suspend fun unlink() { unlinked++ }
}

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ThisPhoneTest {
    @get:Rule val rule = createComposeRule()
    private val backend = FakeThisPhoneBackend()
    private var back = 0
    private var appearance = 0
    private var left = 0

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    private fun show(dark: Boolean = false) {
        val vm = ThisPhoneViewModel(backend)
        rule.setContent {
            OrbTheme(ThemeChoice.Orbita, dark = dark, dynamic = false) {
                ThisPhoneScreen(vm, onBack = { back++ }, onAppearance = { appearance++ }, onUnlinked = { left++ })
            }
        }
        rule.waitForIdle()
    }

    @Test fun showsTheLinkAndTheDefaults() {
        show()
        rule.onNodeWithText("DanLaptop").assertIsDisplayed()
        rule.onNodeWithText("Conectado ahora").assertIsDisplayed()
        rule.onNodeWithText("Mantener conectado").assertIsDisplayed()
        rule.onNodeWithText("Permitidos").assertIsDisplayed()
        assertTrue(backend.settings.value.keepConnected)
        assertFalse(backend.settings.value.lockScreenPublic)
    }

    @Test fun paintsInTheDarkToo() {
        show(dark = true)
        rule.onNodeWithText("Mantener conectado").assertIsDisplayed()
    }

    @Test fun theSwitchesChangeTheSettings() {
        show()
        rule.onNodeWithText("Mantener conectado").performClick()
        assertFalse(backend.settings.value.keepConnected)
        rule.onNodeWithText("Mostrar el texto en la pantalla de bloqueo").performScrollTo().performClick()
        assertTrue(backend.settings.value.lockScreenPublic)
    }

    @Test fun disabledNoticesOfferThePermission() {
        backend.notificationsEnabled.value = false
        show()
        rule.onNodeWithText("Desactivados en Android").assertIsDisplayed()
        rule.onNodeWithText("Permitir").performClick()
        assertEquals(1, backend.requested)
    }


    @Test fun theLockIsOffByDefaultAndTurnsOnAfterTheSystemAgrees() {
        show()
        rule.onNodeWithText("Bloqueo con huella").performScrollTo().assertIsEnabled()
        assertFalse(backend.lock.value.enabled)
        rule.onNodeWithText("Bloqueo con huella").performClick()
        rule.waitForIdle()
        assertTrue(backend.lock.value.enabled)
        rule.onNodeWithText("1 min").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("5 min").performScrollTo().performClick()
        assertEquals(LockDelay.FiveMinutes, backend.lock.value.delay)
    }

    @Test fun aRefusedAuthenticationLeavesTheLockOff() {
        backend.enableAnswer = AuthResult.Failed
        show()
        rule.onNodeWithText("Bloqueo con huella").performScrollTo().performClick()
        rule.waitForIdle()
        assertFalse(backend.lock.value.enabled)
        rule.onNodeWithText(ThisPhoneTexts.LOCK_FAILED).performScrollTo().assertIsDisplayed()
    }

    @Test fun withoutAPinOrFingerprintTheSwitchIsDisabledAndExplained() {
        backend.capability = AuthCapability.NothingSet
        show()
        rule.onNodeWithText("Bloqueo con huella").performScrollTo().assertIsNotEnabled()
        rule.onNodeWithText(ThisPhoneTexts.FINGERPRINT_UNAVAILABLE).performScrollTo().assertIsDisplayed()
    }

    @Test fun anActiveLockCanAlwaysBeTurnedOff() {
        backend.lock.value = LockSettings(enabled = true)
        backend.capability = AuthCapability.NothingSet
        show()
        rule.onNodeWithText("Bloqueo con huella").performScrollTo().assertIsEnabled().performClick()
        assertFalse(backend.lock.value.enabled)
    }

    @Test fun appearanceAndBackAreHandedBack() {
        show()
        rule.onNodeWithText("Apariencia").performScrollTo().performClick()
        assertEquals(1, appearance)
        rule.onNodeWithContentDescription("Volver").performClick()
        assertEquals(1, back)
    }

    @Test fun unlinkAsksFirstThenLeaves() {
        show()
        rule.onNodeWithText("Desenlazar este móvil").performScrollTo().performClick()
        assertEquals(0, backend.unlinked)
        rule.onNodeWithText("Desenlazar").performClick()
        rule.waitForIdle()
        assertEquals(1, backend.unlinked)
        assertEquals(1, left)
    }

    @Test fun cancellingTheConfirmationKeepsTheLink() {
        show()
        rule.onNodeWithText("Desenlazar este móvil").performScrollTo().performClick()
        rule.onNodeWithText("Cancelar").performClick()
        assertEquals(0, backend.unlinked)
    }

    @Test fun linkTextsSayWhenThePcWasSeen() {
        val utc = TimeZone.getTimeZone("UTC")
        assertEquals("Sin conexión", ThisPhoneTexts.link(ConnectionState.Offline(null, null), utc))
        assertTrue(ThisPhoneTexts.link(ConnectionState.Offline(null, 1_700_000_000_000), utc).startsWith("Sin conexión · última vez 14 nov"))
        assertEquals("Conectando…", ThisPhoneTexts.link(ConnectionState.Connecting))
    }
}

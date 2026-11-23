package dev.orb.app.ui.thisphone

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isSelected
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
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
import dev.orb.app.notify.LockScreenNotice
import dev.orb.app.notify.NoteChannel
import dev.orb.app.notify.NoticeStatus
import dev.orb.app.notify.NotifySettings
import dev.orb.app.ui.theme.DarkMode
import dev.orb.app.ui.theme.MemoryStore
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.ThemePrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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
    override val connection = MutableStateFlow<ConnectionState>(ConnectionState.Online("http://100.101.102.103:4310", "DanLaptop", PcVersions(4, 2, "3.8.8")))
    override val settings = MutableStateFlow(NotifySettings())
    override val noticeStatus = MutableStateFlow(NoticeStatus.On)
    var camera = CameraState.Allowed
    var battery = false
    var refreshed = 0
    var cameraSettingsOpened = 0
    var batterySettingsOpened = 0
    var fingerprintValue: String? = "8f3a-c21d-77e0"
    var requested = 0
    var noticeSettingsOpened = 0
    val channels = ArrayList<NoteChannel>()
    var unlinked = 0

    /** What the call through the link does: the test advances its clock there, and may make it fail. */
    var probes = 0
    var probeTook: () -> Unit = {}
    var probeResult: Result<Unit> = Result.success(Unit)

    override fun fingerprint() = fingerprintValue
    override fun setKeepConnected(on: Boolean) { settings.value = settings.value.copy(keepConnected = on) }
    override fun setLockScreen(mode: LockScreenNotice) { settings.value = settings.value.copy(lockScreen = mode) }
    override fun requestNotifications() { requested++ }
    override fun openNoticeSettings() { noticeSettingsOpened++ }
    override fun openChannelSettings(channel: NoteChannel) { channels += channel }
    override fun refreshPermissions() { refreshed++ }
    override fun cameraState() = camera
    override fun openCameraSettings() { cameraSettingsOpened++ }
    override fun batteryRestricted() = battery
    override fun openBatterySettings() { batterySettingsOpened++ }
    override suspend fun probe(): Result<Unit> { probes++; probeTook(); return probeResult }
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
    private val theme = ThemePrefs(MemoryStore())
    private var clock = 0L
    private var back = 0
    private var linkTests = 0
    private var left = 0
    private lateinit var vm: ThisPhoneViewModel

    @Before fun setUp() {
        Dispatchers.setMain(Dispatchers.Unconfined)
        backend.probeTook = { clock += 38 }
    }

    @After fun tearDown() = Dispatchers.resetMain()

    private fun show(dark: Boolean = false) {
        vm = ThisPhoneViewModel(backend, now = { clock })
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = dark) {
                ThisPhoneScreen(vm, theme, onBack = { back++ }, onLinkTest = { linkTests++ }, onUnlinked = { left++ })
            }
        }
        rule.waitForIdle()
    }

    private fun lockSwitch() = rule.onNode(isToggleable() and hasContentDescription("Bloqueo de la app"))

    // ------------------------------------------------------------------------------------------------ Enlace

    @Test fun theLinkCardShowsThePcTheFingerprintInThreeGroupsAndTheRoute() {
        show()
        rule.onNodeWithText("DanLaptop").assertIsDisplayed()
        rule.onNodeWithText("8f3a-c21d-77e0").assertIsDisplayed()
        rule.onNodeWithText("Tailscale · 38 ms").assertIsDisplayed()
        // the line under the title of the bar
        rule.onNodeWithText("DanLaptop · conectado").assertIsDisplayed()
    }

    @Test fun theFingerprintIsTheOneOfTheSavedPublicKey() {
        val pub = ByteArray(32) { it.toByte() }
        val groups = dev.orb.app.link.crypto.LinkCrypto.fingerprint(pub)
        assertTrue(Regex("[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}").matches(groups))
        backend.fingerprintValue = groups
        show()
        rule.onNodeWithText(groups).assertIsDisplayed()
    }

    @Test fun theLatencyIsMeasuredOnceWhenTheScreenOpensAndAgainOnlyOnRequest() {
        show()
        assertEquals(1, backend.probes)
        rule.waitForIdle()
        assertEquals(1, backend.probes)
        vm.measure()
        assertEquals(2, backend.probes)
    }

    @Test fun aHomeNetworkAddressIsTheLocalNetwork() {
        backend.connection.value = ConnectionState.Online("http://192.168.1.20:4310", "DanLaptop", PcVersions(4, 2, "3.8.8"))
        show()
        rule.onNodeWithText("Red local · 38 ms").assertIsDisplayed()
    }

    @Test fun aCallThatFailsLeavesJustTheRoute() {
        backend.probeResult = Result.failure(IllegalStateException("x"))
        show()
        rule.onNodeWithText("Tailscale").assertIsDisplayed()
    }

    @Test fun withoutAConnectionTheCardSaysThereIsNoRouteAndWhenItLastWorked() {
        backend.connection.value = ConnectionState.Offline(null, 1_700_000_000_000)
        show()
        rule.onNodeWithText("Sin conexión").assertIsDisplayed()
        rule.onNodeWithText("Sin ruta · última a las ", substring = true).assertIsDisplayed()
        rule.onNodeWithText("DanLaptop · sin conexión").assertIsDisplayed()
        // there is nothing to time
        assertEquals(0, backend.probes)
    }

    @Test fun routeTextsAreToldAtTheRightHour() {
        val utc = TimeZone.getTimeZone("UTC")
        val off = ThisPhoneState(connection = ConnectionState.Offline(null, 1_700_000_000_000))
        assertEquals("Sin ruta · última a las 22:13", ThisPhoneTexts.route(off, utc))
        assertEquals("Sin ruta", ThisPhoneTexts.route(ThisPhoneState(connection = ConnectionState.Offline(null, null)), utc))
        val on = ThisPhoneState(connection = ConnectionState.Online("http://x", "PC", PcVersions(1, 1, "1")), route = RouteKind.Tailscale, latencyMs = 38)
        assertEquals("Tailscale · 38 ms", ThisPhoneTexts.route(on, utc))
        assertEquals("Tailscale", ThisPhoneTexts.route(on.copy(latencyMs = null), utc))
    }

    // ------------------------------------------------------------------------------------------------ Avisos

    @Test fun theNoticesSwitchReflectsTheSystemPermissionAndOpensItsSettingsToTurnItOff() {
        show()
        rule.onNodeWithText("Avisos de mensajes y tareas").assertIsOn()
        rule.onNodeWithText("Avisos desactivados en Android").assertDoesNotExist()
        rule.onNodeWithText("Avisos de mensajes y tareas").performClick()
        assertEquals(1, backend.noticeSettingsOpened)
        assertEquals(0, backend.requested)
    }

    @Test fun withTheNoticesOffTheSwitchIsOffAskingForThePermissionAndAllowKeepsWorking() {
        backend.noticeStatus.value = NoticeStatus(allowed = false, canAsk = true)
        show()
        rule.onNodeWithText("Avisos de mensajes y tareas").assertIsOff()
        rule.onNodeWithText("Avisos desactivados en Android").assertIsDisplayed()
        rule.onNodeWithText("Avisos de mensajes y tareas").performClick()
        assertEquals(1, backend.requested)
        rule.onNodeWithText("Permitir").performClick()
        assertEquals(2, backend.requested)
        assertEquals(0, backend.noticeSettingsOpened)
    }

    @Test fun keepConnectedIsASwitch() {
        show()
        rule.onNodeWithText("Mantener conectado").assertIsOn().performClick()
        assertFalse(backend.settings.value.keepConnected)
        rule.onNodeWithText("Mantener conectado").assertIsOff()
    }

    @Test fun theLockScreenHasThreeChoicesAndKeepsTheOneChosen() {
        show()
        // «Solo Orb» is what the phone had by default
        rule.onNodeWithText("Solo «Orb»").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("En la pantalla de bloqueo").performScrollTo().performClick()
        rule.waitForIdle()
        for (t in listOf("Nombre del chat y texto", "Nada")) rule.onNodeWithText(t).assertIsDisplayed()
        assertEquals(2, rule.onAllNodesWithText("Solo «Orb»").fetchSemanticsNodes().size)
        rule.onNodeWithText("Nada").performClick()
        rule.waitForIdle()
        assertEquals(LockScreenNotice.Hidden, backend.settings.value.lockScreen)
        // the sheet closed and the row says what was chosen
        rule.onNodeWithText("Nombre del chat y texto").assertDoesNotExist()
        rule.onNodeWithText("Nada").assertIsDisplayed()

        rule.onNodeWithText("En la pantalla de bloqueo").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Nombre del chat y texto").performClick()
        rule.waitForIdle()
        assertEquals(LockScreenNotice.Full, backend.settings.value.lockScreen)
    }

    @Test fun theChosenLockScreenOptionIsAnnouncedAsSelected() {
        backend.settings.value = backend.settings.value.copy(lockScreen = LockScreenNotice.Full)
        show()
        rule.onNodeWithText("En la pantalla de bloqueo").performScrollTo().performClick()
        rule.waitForIdle()
        // the row's subtitle and the sheet's own item say the same thing; the item is the one that is selectable
        rule.onNode(hasText("Nombre del chat y texto") and isSelected()).assertExists()
    }

    @Test fun withTheAppLockOnTheLockScreenRowSaysNoticesCarryNoText() {
        backend.lock.value = LockSettings(enabled = true)
        show()
        rule.onNodeWithText("Con el bloqueo de la app, los avisos no llevan el texto.").performScrollTo().assertIsDisplayed()
    }

    @Test fun eachChannelOpensItsOwnSystemSettings() {
        show()
        rule.onNodeWithText("Sonido de cada canal").performScrollTo().performClick()
        rule.waitForIdle()
        for (t in listOf("Mensajes", "Aprobaciones", "Estado")) rule.onNodeWithText(t).assertIsDisplayed()
        rule.onNodeWithText("Aprobaciones").performClick()
        rule.waitForIdle()
        assertEquals(listOf(NoteChannel.Approvals), backend.channels)
        rule.onNodeWithText("Aprobaciones").assertDoesNotExist()
        rule.onNodeWithText("Sonido de cada canal").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Mensajes").performClick()
        rule.onNodeWithText("Sonido de cada canal").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Estado").performClick()
        assertEquals(listOf(NoteChannel.Approvals, NoteChannel.Messages, NoteChannel.Status), backend.channels)
    }

    // ------------------------------------------------------------------------------------------------ Apariencia

    @Test fun appearanceIsACardOfThePageNotASheet() {
        show()
        for (t in listOf("Apariencia", "Modo", "Paleta", "Según el sistema", "Claro", "Oscuro")) rule.onNodeWithText(t).performScrollTo().assertIsDisplayed()
        for (p in OrbPaletteChoice.entries) rule.onNodeWithContentDescription("Paleta ${p.label}").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("Según el sistema").assertIsSelected()
        rule.onNodeWithContentDescription("Paleta Grafito").assertIsSelected()
    }

    @Test fun theModeAndThePaletteAreSaved() {
        show()
        rule.onNodeWithText("Oscuro").performScrollTo().performClick()
        assertEquals(DarkMode.Dark, theme.settings.value.dark)
        rule.onNodeWithText("Claro").performClick()
        assertEquals(DarkMode.Light, theme.settings.value.dark)
        rule.onNodeWithContentDescription("Paleta Océano").performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals(OrbPaletteChoice.Oceano, theme.settings.value.palette)
        rule.onNodeWithContentDescription("Paleta Océano").assertIsSelected()
    }

    // ------------------------------------------------------------------------------------------------ Seguridad

    @Test fun theLockIsOffByDefaultAndTheSheetOffersTheFourChoices() {
        show()
        rule.onNodeWithText("Bloqueo de la app").performScrollTo().assertIsDisplayed()
        lockSwitch().assertIsOff()
        rule.onNodeWithText("Sin bloqueo").assertIsDisplayed()
        rule.onNodeWithText("Bloqueo de la app").performClick()
        rule.waitForIdle()
        for (t in listOf("Al salir", "Huella tras 5 min fuera", "Huella tras 15 min fuera")) rule.onNodeWithText(t).assertIsDisplayed()
        // the one-minute choice is gone
        rule.onNodeWithText("1 min", substring = true).assertDoesNotExist()
    }

    @Test fun choosingFifteenMinutesTurnsTheLockOnAfterTheSystemAgrees() {
        show()
        rule.onNodeWithText("Bloqueo de la app").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Huella tras 15 min fuera").performClick()
        rule.waitForIdle()
        assertTrue(backend.lock.value.enabled)
        assertEquals(LockDelay.FifteenMinutes, backend.lock.value.delay)
        lockSwitch().assertIsOn()
        rule.onNodeWithText("Huella tras 15 min fuera").assertIsDisplayed()
    }

    @Test fun onExitIsTheImmediateDelayAndNoLockTurnsItOff() {
        backend.lock.value = LockSettings(enabled = true, delay = LockDelay.FiveMinutes)
        show()
        rule.onNodeWithText("Bloqueo de la app").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Al salir").performClick()
        rule.waitForIdle()
        assertEquals(LockDelay.Immediate, backend.lock.value.delay)
        assertTrue(backend.lock.value.enabled)
        rule.onNodeWithText("Bloqueo de la app").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Sin bloqueo").performClick()
        rule.waitForIdle()
        assertFalse(backend.lock.value.enabled)
    }

    @Test fun theSwitchTurnsTheLockOnAndOff() {
        show()
        lockSwitch().performScrollTo().performClick()
        rule.waitForIdle()
        assertTrue(backend.lock.value.enabled)
        lockSwitch().performClick()
        assertFalse(backend.lock.value.enabled)
    }

    @Test fun aRefusedAuthenticationLeavesTheLockOff() {
        backend.enableAnswer = AuthResult.Failed
        show()
        lockSwitch().performScrollTo().performClick()
        rule.waitForIdle()
        assertFalse(backend.lock.value.enabled)
        rule.onNodeWithText(ThisPhoneTexts.LOCK_FAILED).performScrollTo().assertIsDisplayed()
    }

    @Test fun withoutAPinOrFingerprintTheLockCannotBeTurnedOnAndSaysWhy() {
        backend.capability = AuthCapability.NothingSet
        show()
        lockSwitch().performScrollTo().assertIsNotEnabled()
        rule.onNodeWithText(ThisPhoneTexts.FINGERPRINT_UNAVAILABLE).performScrollTo().assertIsDisplayed()
    }

    @Test fun anActiveLockCanAlwaysBeTurnedOff() {
        backend.lock.value = LockSettings(enabled = true)
        backend.capability = AuthCapability.NothingSet
        show()
        lockSwitch().performScrollTo().performClick()
        assertFalse(backend.lock.value.enabled)
    }

    @Test fun saysWhenTheLockTurnedItselfOff() {
        backend.lock.value = LockSettings(enabled = false, autoOff = true)
        show()
        rule.onNodeWithText(ThisPhoneTexts.lockAutoOff()).performScrollTo().assertIsDisplayed()
    }

    // ------------------------------------------------------------------------------------------------ Desvincular y más opciones

    @Test fun unlinkAsksFirstSayingAllThatIsLostThenLeaves() {
        show()
        rule.onNodeWithText("Desvincular este móvil").performScrollTo().performClick()
        assertEquals(0, backend.unlinked)
        rule.onNodeWithText("¿Desvincular este móvil?").assertIsDisplayed()
        // the whole truth: the link, the saved copy and the unsent messages
        rule.onNodeWithText("Se olvida el enlace con DanLaptop", substring = true).assertIsDisplayed()
        rule.onNodeWithText("la copia guardada en el móvil", substring = true).assertIsDisplayed()
        rule.onNodeWithText("los mensajes sin enviar", substring = true).assertIsDisplayed()
        rule.onNodeWithText("Desvincular").performClick()
        rule.waitForIdle()
        assertEquals(1, backend.unlinked)
        assertEquals(1, left)
    }

    @Test fun cancellingTheConfirmationKeepsTheLink() {
        show()
        rule.onNodeWithText("Desvincular este móvil").performScrollTo().performClick()
        rule.onNodeWithText("Cancelar").performClick()
        assertEquals(0, backend.unlinked)
        rule.onNodeWithText("¿Desvincular este móvil?").assertDoesNotExist()
    }

    @Test fun moreOptionsKeepTheConnectionTest() {
        show()
        rule.onNodeWithText("Más opciones").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("Prueba de conexión").performScrollTo().performClick()
        assertEquals(1, linkTests)
    }

    @Test fun backIsHandedBack() {
        show()
        rule.onNodeWithContentDescription("Volver").performClick()
        assertEquals(1, back)
    }

    @Test fun paintsInTheDarkToo() {
        show(dark = true)
        rule.onNodeWithText("Mantener conectado").performScrollTo().assertIsDisplayed()
    }

    @Test fun aLinkWithoutAKeyShowsADashNotAnInventedFingerprint() {
        backend.fingerprintValue = null
        show()
        assertNull(vm.state.value.fingerprint)
        rule.onNodeWithText("—").assertIsDisplayed()
    }

    @Test fun linkTextsSayWhenThePcWasSeen() {
        val utc = TimeZone.getTimeZone("UTC")
        assertEquals("Sin conexión", ThisPhoneTexts.link(ConnectionState.Offline(null, null), utc))
        assertTrue(ThisPhoneTexts.link(ConnectionState.Offline(null, 1_700_000_000_000), utc).startsWith("Sin conexión · última vez 14 nov"))
        assertEquals("Conectando…", ThisPhoneTexts.link(ConnectionState.Connecting))
    }
}

package dev.orb.app.ui.thisphone

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.lifecycle.Lifecycle
import dev.orb.app.notify.NoteChannel
import dev.orb.app.notify.NoticeStatus
import dev.orb.app.ui.theme.MemoryStore
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.ThemePrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** What «Este móvil» says about the permissions the person can change in Android, and that it reads them again on return. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ThisPhonePermissionsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()
    private val backend = FakeThisPhoneBackend()
    private val theme = ThemePrefs(MemoryStore())

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)

    @After fun tearDown() = Dispatchers.resetMain()

    private fun show() {
        val vm = ThisPhoneViewModel(backend)
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                ThisPhoneScreen(vm, theme, onBack = {}, onLinkTest = {}, onUnlinked = {})
            }
        }
        rule.waitForIdle()
    }

    private fun text(t: String) = rule.onNodeWithText(t).performScrollTo()

    // ------------------------------------------------------------------------------------------------ Avisos

    @Test fun withoutThePermissionAndAndroidWillNotAskTheButtonLeadsToTheSettings() {
        backend.noticeStatus.value = NoticeStatus(allowed = false, canAsk = false)
        show()
        rule.onNodeWithText("Avisos de mensajes y tareas").assertIsOff()
        text("Avisos desactivados en Android").assertIsDisplayed()
        text("Actívalos en los ajustes de Android para recibir los chats y las aprobaciones.").assertIsDisplayed()
        rule.onNodeWithText("Permitir").assertDoesNotExist()
        text("Abrir ajustes").performClick()
        assertEquals(1, backend.requested)
    }

    @Test fun aChannelTurnedOffMakesTheSwitchOffAndSaysWhichOne() {
        backend.noticeStatus.value = NoticeStatus(allowed = true, canAsk = false, offChannels = listOf(NoteChannel.Messages))
        show()
        // permission given but «Mensajes» off: the switch must not look on
        rule.onNodeWithText("Avisos de mensajes y tareas").assertIsOff()
        text("Un aviso está apagado en Android").assertIsDisplayed()
        text("«Mensajes» está apagado en Android: esos avisos no llegan.").assertIsDisplayed()
        text("Abrir ajustes").performClick()
        assertEquals(listOf(NoteChannel.Messages), backend.channels)
        assertEquals(0, backend.requested)
    }

    @Test fun twoChannelsOffOpenTheListOfAllOfThem() {
        backend.noticeStatus.value = NoticeStatus(allowed = true, canAsk = false, offChannels = listOf(NoteChannel.Messages, NoteChannel.Approvals))
        show()
        text("«Mensajes» y «Aprobaciones» están apagados en Android: esos avisos no llegan.").assertIsDisplayed()
        rule.onNodeWithText("Avisos de mensajes y tareas").performClick()
        assertEquals(1, backend.noticeSettingsOpened)
        assertTrue(backend.channels.isEmpty())
    }

    @Test fun withEverythingAllowedNothingWarnsAndTheSwitchIsOn() {
        show()
        rule.onNodeWithText("Avisos de mensajes y tareas").assertIsOn()
        rule.onNodeWithText("Un aviso está apagado en Android").assertDoesNotExist()
    }

    // ------------------------------------------------------------------------------------------------ Cámara

    @Test fun theCameraRowSaysAllowedAndOpensTheSettings() {
        show()
        text("Permitida. Orb solo la usa para leer el QR de tu PC.").assertIsDisplayed()
        // the camera's button is the first «Ajustes»; the battery's the second
        rule.onAllNodesWithText("Ajustes")[0].performScrollTo().performClick()
        assertEquals(1, backend.cameraSettingsOpened)
        assertEquals(0, backend.batterySettingsOpened)
    }

    @Test fun aRefusedCameraSaysSoAndNamesTheWaysThatStillWork() {
        backend.camera = CameraState.NotAllowed
        show()
        text(ThisPhoneTexts.CAMERA_OFF).assertIsDisplayed()
    }

    @Test fun aPhoneWithoutCameraSaysSoAndOffersNoButton() {
        backend.camera = CameraState.None
        show()
        text(ThisPhoneTexts.CAMERA_NONE).assertIsDisplayed()
        // only the battery's «Ajustes» is left
        assertEquals(1, rule.onAllNodesWithText("Ajustes").fetchSemanticsNodes().size)
    }

    @Test fun theStateIsReadAgainWhenTheScreenComesBackFromTheSettings() {
        backend.camera = CameraState.NotAllowed
        backend.battery = true
        show()
        text(ThisPhoneTexts.CAMERA_OFF).assertIsDisplayed()
        text(ThisPhoneTexts.BATTERY_RESTRICTED).assertIsDisplayed()
        val before = backend.refreshed
        val scenario = rule.activityRule.scenario
        scenario.moveToState(Lifecycle.State.CREATED)
        // the person changes both in Android's settings
        backend.camera = CameraState.Allowed
        backend.battery = false
        scenario.moveToState(Lifecycle.State.RESUMED)
        rule.waitForIdle()
        assertTrue(backend.refreshed > before)
        text(ThisPhoneTexts.CAMERA_ON).assertIsDisplayed()
        text(ThisPhoneTexts.BATTERY_FREE).assertIsDisplayed()
    }

    // ------------------------------------------------------------------------------------------------ Batería

    @Test fun theBatteryRowSaysLimitedInPlainWordsAndOpensAndroidsPage() {
        backend.battery = true
        show()
        text("Ahorro de batería").assertIsDisplayed()
        text(ThisPhoneTexts.BATTERY_RESTRICTED).assertIsDisplayed()
        rule.onAllNodesWithText("Ajustes").onLast().performScrollTo().performClick()
        assertEquals(1, backend.batterySettingsOpened)
    }

    @Test fun theBatteryRowSaysUnrestrictedWhenAndroidLeavesOrbAlone() {
        show()
        text(ThisPhoneTexts.BATTERY_FREE).assertIsDisplayed()
    }

    @Test fun theKeepConnectedNoteLinksToTheSameBatteryPage() {
        show()
        text("Revisar el ahorro de batería").performClick()
        assertEquals(1, backend.batterySettingsOpened)
    }
}

package dev.orb.app.ui.welcome

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.link.net.LinkSession
import dev.orb.app.link.net.PairOk
import dev.orb.app.link.net.ResolvedLink
import dev.orb.app.link.payload.LinkPayload
import dev.orb.app.ui.Linker
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class WelcomeScreenTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private class Pc : Linker {
        override suspend fun resolve(payload: LinkPayload) =
            Result.success(ResolvedLink(payload.urls, payload.code, "pc", ByteArray(32), "8f3a-c21d-77e0", "DanLaptop", payload.via))

        override suspend fun link(link: ResolvedLink, password: String, deviceName: String) =
            Result.success(PairOk(LinkSession("id", ByteArray(32), ByteArray(32), listOf("http://192.168.1.20:3131")), null, 0))
    }

    private class Notices(var requests: Int = 0) : NoticeGate {
        override fun shouldAsk() = true
        override val enabled = false
        override fun request() { requests++ }
    }

    private fun show(vm: WelcomeViewModel, clipboard: String? = null, onDone: () -> Unit = {}) {
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, false) {
                WelcomeScreen(vm, onDone = onDone, onOpenThisPhone = {}, readClipboard = { clipboard })
            }
        }
        rule.waitForIdle()
    }

    private fun vm(notices: NoticeGate? = null) = WelcomeViewModel(Pc(), "Test", {}, Dispatchers.Unconfined, notices)

    @Test fun welcomeShowsTheMarkTheInstructionAndTheTwoWays() {
        show(vm())
        rule.onNodeWithText("Enlaza el móvil con tu Orb").assertIsDisplayed()
        rule.onNodeWithText("Escanear el código QR").assertIsDisplayed()
        rule.onNodeWithText("Sin cámara: código corto").assertIsDisplayed()
    }

    @Test fun scanOpensTheShortCodeSheetUntilTheScannerExists() {
        show(vm())
        rule.onNodeWithText("Escanear el código QR").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Pegar").assertIsDisplayed()
        rule.onNodeWithText("Continuar").assertExists()
    }

    @Test fun pasteButtonReadsTheClipboardIntoTheLinkField() {
        val vm = vm()
        show(vm, clipboard = "orb://enlazar?demo")
        rule.onNodeWithText("Sin cámara: código corto").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Pegar").performClick()
        rule.waitForIdle()
        assertEquals("orb://enlazar?demo", vm.state.value.link)
    }

    @Test fun notNowAsksNothingAndShowsTheBottomMessage() {
        val notices = Notices()
        val vm = vm(notices)
        vm.setCode("ABCDEF"); vm.setAddress("http://192.168.1.20:3131"); vm.resolve(); vm.setPassword("x"); vm.confirm()
        show(vm)
        rule.onNodeWithText("¿Avisos de Orb?").assertIsDisplayed()
        rule.onNodeWithText("Ahora no").performClick()
        rule.waitForIdle()
        assertEquals(0, notices.requests)
        rule.onNodeWithText("Podrás activar los avisos en Este móvil").assertIsDisplayed()
        rule.onNodeWithText("Ir a Chats").assertIsDisplayed()
    }

    @Test fun activateAsksAndroidAndGoToChatsLeaves() {
        val notices = Notices()
        val vm = vm(notices)
        vm.setCode("ABCDEF"); vm.setAddress("http://192.168.1.20:3131"); vm.resolve(); vm.setPassword("x"); vm.confirm()
        var left = 0
        show(vm, onDone = { left++ })
        rule.onNodeWithText("Activar").performClick()
        rule.waitForIdle()
        assertEquals(1, notices.requests)
        assertEquals(0, left)
        rule.onNodeWithText("Ir a Chats").performClick()
        assertEquals(1, left)
    }
}

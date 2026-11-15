package dev.orb.app.ui.chats

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.ThemeChoice
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class OrbeChatScreenTest {
    @get:Rule val rule = createComposeRule()

    private val thread = listOf(
        raw(1, "usuario", "El carrito no guarda los productos cuando recargo."),
        raw(2, "orb", "Solo vive en **memoria** y se pierde al recargar."),
    )

    private fun screen(b: FakeOrbeChatBackend, theme: ThemeChoice = ThemeChoice.Orbita): OrbeChatViewModel {
        val vm = OrbeChatViewModel(b, 7, dispatcher = Dispatchers.Unconfined)
        rule.setContent {
            OrbTheme(theme, dark = false, dynamic = false) { OrbeChatScreen(vm, onBack = {}) }
        }
        rule.waitForIdle()
        return vm
    }

    @Test fun paintsTheThreadAndTheHeader() {
        screen(FakeOrbeChatBackend(thread))
        rule.onNodeWithText("Carrito que no guarda").assertIsDisplayed()
        rule.onNodeWithText("tienda-online · Orbe").assertIsDisplayed()
        rule.onNodeWithText("El carrito no guarda los productos cuando recargo.").assertIsDisplayed()
        rule.onNodeWithText("Mensaje para Orbe").assertIsDisplayed()
    }

    @Test fun showsThinkingThenTheLiveTextThenTheFinalLine() {
        val b = FakeOrbeChatBackend(thread)
        screen(b)
        b.events.tryEmit(stateEvent(7, busy = true, partial = ""))
        rule.waitForIdle()
        rule.onNodeWithText("Pensando…").assertIsDisplayed()
        b.events.tryEmit(stateEvent(7, busy = true, partial = "Voy a revisar el almacén"))
        rule.waitForIdle()
        rule.onNodeWithText("Voy a revisar el almacén").assertIsDisplayed()
        b.events.tryEmit(stateEvent(7, busy = false, answer = raw(5, "orb", "Listo, ya guarda.")))
        rule.waitForIdle()
        rule.onNodeWithText("Listo, ya guarda.").assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText("Pensando…").fetchSemanticsNodes().size)
    }

    @Test fun tapAnOptionAndAnswerCallsAnswer() {
        val b = FakeOrbeChatBackend(thread + raw(3, "orb", "¿Dónde guardo el carrito?", questionMeta()))
        screen(b)
        rule.onNodeWithText("IndexedDB").performClick()
        rule.onNodeWithText("Responder").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("answer 3 IndexedDB - false"))
        // The card closes into the answer.
        rule.onNodeWithText("Respondida: IndexedDB").assertIsDisplayed()
    }

    @Test fun answerIsDisabledWithoutAChoice() {
        val b = FakeOrbeChatBackend(thread + raw(3, "orb", "¿Dónde guardo el carrito?", questionMeta()))
        screen(b)
        rule.onNodeWithText("Responder").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.none { it.startsWith("answer") })
    }

    @Test fun reportHasAnAcceptButton() {
        val b = FakeOrbeChatBackend(thread + raw(8, "orb", "Informe listo", """{"kind":"report","tasks":[42],"accepted":false}"""))
        screen(b)
        rule.onNodeWithText("Aceptar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.contains("accept 8"))
        rule.onNodeWithText("Aceptado · tareas #42").assertIsDisplayed()
    }

    @Test fun sendBecomesStopWhileTheTurnRuns() {
        val b = FakeOrbeChatBackend(thread)
        val vm = screen(b)
        // Idle with nothing typed: there is no stop.
        assertEquals(0, rule.onAllNodesWithContentDescription("Parar").fetchSemanticsNodes().size)
        b.events.tryEmit(stateEvent(7, busy = true))
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Parar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.contains("stop"))
        // Typing turns it back into Enviar, which queues the message behind the turn.
        rule.onNode(hasSetTextAction()).performTextInput("Otra cosa")
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Enviar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.contains("send Otra cosa"))
        rule.onNodeWithText("Otra cosa").assertIsDisplayed()
        assertTrue(vm.state.value.items.last() is ChatItem.Waiting)
    }

    @Test fun offlineSaysSoAndStillAcceptsText() {
        val b = FakeOrbeChatBackend(thread)
        screen(b)
        b.goOffline()
        rule.waitForIdle()
        rule.onNodeWithText("Sin conexión con el PC").assertIsDisplayed()
        rule.onNode(hasSetTextAction()).performTextInput("Hazlo")
        rule.onNodeWithContentDescription("Enviar").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("En espera, sale al volver la conexión").assertIsDisplayed()
    }

    @Test fun permissionModeMenuAsksThePcToChange() {
        val b = FakeOrbeChatBackend(thread)
        screen(b)
        rule.onNodeWithText("Preguntar").performClick()
        rule.onNodeWithText("Auto").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.contains("mode auto"))
    }

    @Test fun deletedChatShowsA28() {
        val b = FakeOrbeChatBackend(thread)
        b.loadResult = refused("Esa conversación ya no existe.").map { 0 }
        screen(b)
        rule.onNodeWithText("Este chat se borró en el PC").assertIsDisplayed()
        rule.onNodeWithText("Volver a Chats").assertIsDisplayed()
    }

    @Test fun a28OffersToAskThePcToRestoreAndCallsIt() {
        val b = FakeOrbeChatBackend(thread)
        b.loadResult = refused("Ese chat está en la papelera. Restáuralo para seguir.").map { 0 }
        screen(b)
        rule.onNodeWithText("Pedir al PC que lo restaure").assertIsDisplayed()
        b.loadResult = Result.success(0)
        rule.onNodeWithText("Pedir al PC que lo restaure").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.contains("restore"))
    }

    @Test fun a28HidesTheRestoreButtonWhenThePcCannot() {
        val b = FakeOrbeChatBackend(thread).apply { restoreAvailable = false }
        b.loadResult = refused("Esa conversación ya no existe.").map { 0 }
        screen(b)
        assertEquals(0, rule.onAllNodesWithText("Pedir al PC que lo restaure").fetchSemanticsNodes().size)
    }

    @Test fun cristalPaintsTheSameChat() {
        screen(FakeOrbeChatBackend(thread), ThemeChoice.Cristal)
        rule.onNodeWithText("Mensaje para Orbe").assertIsDisplayed()
    }
}

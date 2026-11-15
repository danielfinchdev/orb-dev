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
import dev.orb.app.data.json
import dev.orb.app.link.net.LinkEvent
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
class DirectChatScreenTest {
    @get:Rule val rule = createComposeRule()

    private val thread = listOf(
        sitem(1, "user", "text", jstr("Pon un límite de 3 intentos al cobro y pasa los tests.")),
        sitem(2, "tool", "tool", """{"id":"t1","name":"Bash","input":{"command":"npm test"}}"""),
        sitem(3, "tool", "tool_result", """{"id":"t1","output":"32 pasaron"}"""),
        sitem(4, "assistant", "text", jstr("Listo y en verde. Tengo que **migrar** la base de datos.")),
        sitem(5, "system", "approval", approvalBody()),
    )

    private fun screen(b: FakeDirectChatBackend): DirectChatViewModel {
        val vm = DirectChatViewModel(b, "s1", dispatcher = Dispatchers.Unconfined)
        rule.setContent {
            OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { DirectChatScreen(vm, onBack = {}, onOpenChat = {}) }
        }
        rule.waitForIdle()
        return vm
    }
    @Test fun paintsTheHeaderAndTheItems() {
        screen(FakeDirectChatBackend(thread.take(4)))
        rule.onNodeWithText("Límite de reintentos").assertIsDisplayed()
        rule.onNodeWithText("api-pagos en el PC · Editar archivos").assertIsDisplayed()
        rule.onNodeWithText("Pon un límite de 3 intentos al cobro y pasa los tests.").assertIsDisplayed()
        rule.onNodeWithText("Ejecutó en el PC npm test").assertIsDisplayed()
        rule.onNodeWithText("Mensaje para Codex").assertIsDisplayed()
    }

    @Test fun theRequestCardShowsWhatTheAgentWantsAndTheThreeButtons() {
        // The list follows the end, where the card is; the older lines are not needed here.
        screen(FakeDirectChatBackend(listOf(thread[0], thread[4])))
        rule.onNodeWithText("Codex quiere ejecutar un comando").assertIsDisplayed()
        rule.onNodeWithText("Cambia la base de datos de desarrollo.").assertIsDisplayed()
        rule.onNodeWithText("Denegar").assertIsDisplayed()
        rule.onNodeWithText("Permitir").assertIsDisplayed()
        rule.onNodeWithText("Permitir siempre aquí").assertIsDisplayed()
    }
    @Test fun tappingPermitirAsksThePcAndClosesTheCard() {
        val b = FakeDirectChatBackend(thread)
        screen(b)
        rule.onNodeWithText("Permitir").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("decide s1 r1 allow"))
        rule.onNodeWithText("Permitido").assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText("Permitir siempre aquí").fetchSemanticsNodes().size)
    }

    @Test fun denyAndAlwaysUseTheirOwnButtons() {
        val b = FakeDirectChatBackend(thread)
        screen(b)
        rule.onNodeWithText("Permitir siempre aquí").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("decide s1 r1 always"))
        rule.onNodeWithText("Permitido siempre").assertIsDisplayed()
    }

    @Test fun anActivityLineOpensToItsOutput() {
        screen(FakeDirectChatBackend(thread.take(4)))
        assertEquals(0, rule.onAllNodesWithText("32 pasaron").fetchSemanticsNodes().size)
        rule.onNodeWithText("Ejecutó en el PC npm test").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("32 pasaron").assertIsDisplayed()
    }

    @Test fun theQueueTrayFoldsAndUnfolds() {
        val b = FakeDirectChatBackend(thread.take(4))
        val vm = screen(b)
        b.infoOnPc = sessionInfo(status = "running")
        b.events.tryEmit(queueEvent("Documenta el cambio", "Sube la versión"))
        rule.waitForIdle()
        rule.onNodeWithText("En cola (2)").assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText("Documenta el cambio").fetchSemanticsNodes().size)
        rule.onNodeWithText("En cola (2)").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Documenta el cambio").assertIsDisplayed()
        rule.onNodeWithText("Sube la versión").assertIsDisplayed()
        b.queueOnPc = vm.state.value.queue
        rule.onAllNodesWithContentDescription("Quitar")[0].performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("edit 1 - true -"))
    }

    @Test fun whileWorkingTheComposerOffersStopThenCorrectOrQueue() {
        val b = FakeDirectChatBackend(thread.take(4))
        b.infoOnPc = sessionInfo(status = "running")
        screen(b)
        // Nothing typed: the button stops the turn on the PC.
        rule.onNodeWithContentDescription("Parar").assertIsDisplayed()
        rule.onNode(hasSetTextAction()).performTextInput("Mejor 5 intentos")
        rule.waitForIdle()
        rule.onNodeWithText("Corregir").assertIsDisplayed()
        rule.onNodeWithText("Encolar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("send queue Mejor 5 intentos"))
    }

    @Test fun whenIdleThereAreNoSendChoices() {
        val b = FakeDirectChatBackend(thread.take(4))
        screen(b)
        rule.onNode(hasSetTextAction()).performTextInput("Sigue")
        rule.waitForIdle()
        assertEquals(0, rule.onAllNodesWithText("Corregir").fetchSemanticsNodes().size)
        rule.onNodeWithContentDescription("Enviar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("send - Sigue"))
    }

    @Test fun theStreamedTextShowsAndTheDeletedChatSaysSo() {
        val b = FakeDirectChatBackend(thread.take(4))
        b.infoOnPc = sessionInfo(status = "running")
        screen(b)
        b.events.tryEmit(deltaEvent("Voy a migrar"))
        rule.waitForIdle()
        rule.onNodeWithText("Voy a migrar").assertIsDisplayed()
        b.events.tryEmit(LinkEvent("session:removed", json("""{"id":"s1"}""")))
        rule.waitForIdle()
        rule.onNodeWithText("Este chat se borró en el PC").assertIsDisplayed()
    }
}

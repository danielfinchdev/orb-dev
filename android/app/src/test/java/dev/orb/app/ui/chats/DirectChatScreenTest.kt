package dev.orb.app.ui.chats

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.layout.positionInRoot
import org.junit.Assert.assertFalse
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
import dev.orb.app.ui.theme.OrbPaletteChoice
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
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) { DirectChatScreen(vm, onBack = {}, onOpenChat = {}) }
        }
        rule.waitForIdle()
        return vm
    }
    @Test fun paintsTheHeaderAndTheItems() {
        screen(FakeDirectChatBackend(thread.take(4)))
        rule.onNodeWithText("Límite de reintentos").assertIsDisplayed()
        rule.onNodeWithText("Codex · api-pagos · Editar archivos").assertIsDisplayed()
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
        rule.onNodeWithText("Siempre").assertIsDisplayed()
        // «Siempre» is one tap from the main button: the card says how far it reaches, and a screen reader hears it too
        rule.onNodeWithText("«Siempre» lo permite aquí, en este chat; no vale para otros.").assertIsDisplayed()
        rule.onNodeWithContentDescription("Permitir siempre aquí").assertIsDisplayed()
    }

    @Test fun theButtonsAreInTheOrderOfTheMockup() {
        screen(FakeDirectChatBackend(listOf(thread[0], thread[4])))
        val xs = listOf("Denegar", "Siempre", "Permitir").map { rule.onNodeWithText(it).fetchSemanticsNode().positionInRoot.x }
        assertEquals(xs.sorted(), xs)
    }
    @Test fun tappingPermitirAsksThePcAndClosesTheCard() {
        val b = FakeDirectChatBackend(thread)
        screen(b)
        rule.onNodeWithText("Permitir").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("decide s1 r1 allow"))
        rule.onNodeWithText("Permitido").assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText("Siempre").fetchSemanticsNodes().size)
    }

    @Test fun denyAndAlwaysUseTheirOwnButtons() {
        val b = FakeDirectChatBackend(thread)
        screen(b)
        rule.onNodeWithText("Siempre").performClick()
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

    @Test fun theQueueIsACardInTheThreadWithEditRemoveAndMoves() {
        val b = FakeDirectChatBackend(thread.take(4))
        val vm = screen(b)
        b.infoOnPc = sessionInfo(status = "running")
        b.events.tryEmit(queueEvent("Documenta el cambio", "Sube la versión"))
        rule.waitForIdle()
        rule.onNodeWithText("En cola · 2").assertIsDisplayed()
        rule.onNodeWithText("Documenta el cambio").assertIsDisplayed()
        rule.onNodeWithText("Sube la versión").assertIsDisplayed()
        b.queueOnPc = vm.state.value.queue
        // «Subir» and «Bajar» live under the «⋯» of each message
        rule.onAllNodesWithContentDescription("Más opciones del mensaje en cola")[1].performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Subir").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("edit 2 - false up"))
        rule.onAllNodesWithContentDescription("Quitar de la cola")[0].performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("edit 1 - true -"))
    }

    @Test fun editingAQueuedMessageHappensInTheBoxAndSavesOrCancels() {
        val b = FakeDirectChatBackend(thread.take(4))
        val vm = screen(b)
        b.infoOnPc = sessionInfo(status = "running")
        b.events.tryEmit(queueEvent("Documenta el cambio", "Sube la versión"))
        rule.waitForIdle()
        b.queueOnPc = vm.state.value.queue
        rule.onAllNodesWithContentDescription("Editar")[0].performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Editando un mensaje de la cola").assertIsDisplayed()
        rule.onNodeWithText("Editando este mensaje de la cola").assertIsDisplayed()
        rule.onNode(hasSetTextAction()).assertTextContains("Documenta el cambio")
        rule.onNode(hasSetTextAction()).performTextReplacement("Documenta y sube")
        rule.onNodeWithText("Guardar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("edit 1 Documenta y sube false -"))
        assertEquals(0, rule.onAllNodesWithText("Editando un mensaje de la cola").fetchSemanticsNodes().size)
        rule.onAllNodesWithContentDescription("Editar")[0].performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Cancelar").performClick()
        rule.waitForIdle()
        assertEquals(0, rule.onAllNodesWithText("Editando un mensaje de la cola").fetchSemanticsNodes().size)
        assertEquals(1, b.calls.count { it.startsWith("edit") })
    }

    @Test fun theContextBarShowsThePercentAndForks() {
        val b = FakeDirectChatBackend(thread.take(4))
        screen(b)
        rule.onNodeWithText("Contexto 58 %").assertIsDisplayed()
        rule.onNodeWithText("Bifurcar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("fork"))
    }

    @Test fun whileWorkingTheContextBarOffersCompactingButNotYet() {
        val b = FakeDirectChatBackend(thread.take(4))
        b.infoOnPc = sessionInfo(status = "running", agent = "claude")
        screen(b)
        rule.onNodeWithText("Compactar").assertIsDisplayed().assertIsNotEnabled()
    }

    @Test fun theSheetHasEverythingAndMoreOptionsHoldsTheRest() {
        val b = FakeDirectChatBackend(thread.take(4))
        screen(b)
        rule.onNodeWithContentDescription("Más acciones del chat").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Chat con Codex").assertIsDisplayed()
        for (t in listOf("Bifurcar desde aquí", "Compactar contexto", "Reanudar sesión", "Dar por terminado", "Parar")) rule.onNodeWithText(t).assertIsDisplayed()
        rule.onNodeWithText("58 %").assertIsDisplayed()
        rule.onNodeWithText("Acceso total, Usar mi móvil, secretos y terminal integrado: solo en el PC.").assertIsDisplayed()
        // nothing to resume and nothing running: those two are drawn but off, and say why
        rule.onNodeWithText("Reanudar sesión").assertIsNotEnabled()
        rule.onNodeWithText("Parar").assertIsNotEnabled()
        assertEquals(0, rule.onAllNodesWithText("Renombrar").fetchSemanticsNodes().size)
        rule.onNodeWithText("Más opciones").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Renombrar").assertExists()
        rule.onNodeWithText("GPT-5.5").assertExists()
        rule.onNodeWithText("Archivar").performScrollTo().performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("archive"))
    }

    @Test fun compactingAsksFirst() {
        val b = FakeDirectChatBackend(thread.take(4))
        screen(b)
        rule.onNodeWithContentDescription("Más acciones del chat").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Compactar contexto").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("¿Compactar el contexto?").assertIsDisplayed()
        assertFalse(b.calls.contains("compact"))
        rule.onNodeWithText("Compactar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("compact"))
    }

    @Test fun aStoppedSessionHasItsCardWithResume() {
        val b = FakeDirectChatBackend(thread.take(4))
        b.infoOnPc = sessionInfo(status = "interrupted")
        screen(b)
        rule.onNodeWithText("Sesión parada").assertIsDisplayed()
        rule.onNodeWithContentDescription("Escribe para reanudar…").assertExists()
        rule.onNodeWithText("Bifurcar desde aquí").assertIsDisplayed()
        rule.onNodeWithText("Reanudar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("resume"))
    }

    @Test fun aMessageFromThePcHasTwoTicksAndTheOneJustSentOne() {
        val b = FakeDirectChatBackend(thread.take(4))
        val vm = screen(b)
        rule.onAllNodesWithContentDescription("Guardado en el PC", substring = true)[0].assertExists()
        vm.send("Hazlo"); rule.waitForIdle()
        b.loadError = dev.orb.app.link.net.LinkException(dev.orb.app.link.net.LinkError.Timeout)
        b.outbox.value = emptyList(); rule.waitForIdle()
        rule.onNodeWithContentDescription("Enviado", substring = true).assertExists()
    }

    @Test fun withoutALinkTheBandCountsDownAndTheThreadStaysReadable() {
        val b = FakeDirectChatBackend(thread.take(4))
        b.goOffline()
        screen(b)
        rule.onNodeWithText("Sin conexión con tu PC", substring = true).assertIsDisplayed()
        rule.onNodeWithText("Pon un límite de 3 intentos al cobro y pasa los tests.").assertIsDisplayed()
    }

    @Test fun theBoxShowsThePermissionAndADisabledMicrophone() {
        screen(FakeDirectChatBackend(thread.take(4)))
        rule.onNodeWithContentDescription("Permisos del agente: Editar archivos").assertIsDisplayed()
        rule.onNodeWithContentDescription("Dictar por voz, aún no disponible").assertIsNotEnabled()
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

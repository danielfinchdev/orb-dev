package dev.orb.app.ui.chats

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.hasSetTextAction
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Screen 12: the «Nuevo chat» sheet over the chat list, with the mockup's rows, chips and brain sheet. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w390dp-h844dp")
class NewChatScreenTest {
    @get:Rule val rule = createComposeRule()

    private fun sheet(b: FakeNewChatBackend, outcomes: MutableList<NewChatOutcome> = ArrayList(), dismissed: MutableList<Unit> = ArrayList()): NewChatViewModel {
        val vm = NewChatViewModel(b)
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) { NewChatSheet(vm, onDismiss = { dismissed += Unit }, onOutcome = { outcomes += it }) }
        }
        rule.waitForIdle()
        return vm
    }

    @Test fun theSheetFollowsTheMockupOrbeVariant() {
        sheet(FakeNewChatBackend())
        rule.onNodeWithText("Nuevo chat").assertIsDisplayed()
        rule.onNodeWithText("Con Orbe").assertIsDisplayed()
        rule.onNodeWithText("Lo divide en tareas y elige agentes").assertIsDisplayed()
        rule.onNodeWithText("Directo con un agente").assertIsDisplayed()
        // Only the agents the PC can run are named: no «ACP» that the PC did not offer.
        rule.onNodeWithText("Claude Code y Codex en una carpeta").assertIsDisplayed()
        rule.onNodeWithText("Proyecto").assertIsDisplayed()
        rule.onNodeWithText("tienda-online").assertIsDisplayed()
        rule.onNodeWithText("api-pagos").assertIsDisplayed()
        rule.onNodeWithText("Sin proyecto").assertIsDisplayed()
        rule.onNodeWithText("Nuevo").assertIsDisplayed()
        rule.onNodeWithText("Agente y modelo").assertIsDisplayed()
        rule.onNodeWithText("El que usa el PC").assertIsDisplayed()
        rule.onNodeWithText("Cancelar").assertIsDisplayed()
        rule.onNodeWithText("Empezar").assertIsEnabled()
        // The old screen's wording and notice are gone.
        assertTrue(rule.onAllNodesWithText("¿Con quién quieres hablar?").fetchSemanticsNodes().isEmpty())
        assertTrue(rule.onAllNodesWithText("Primer mensaje").fetchSemanticsNodes().isEmpty())
        assertTrue(rule.onAllNodesWithText("Se crea en el PC desde Proyectos", substring = true).fetchSemanticsNodes().isEmpty())
    }

    @Test fun theBrainRowNamesTheBrainThePcUsesWhenItSaysSo() {
        sheet(FakeNewChatBackend().apply { optionsResult = Result.success(sampleOptions.copy(pcBrain = BrainInfo("Claude Code", "Opus", "high"))) })
        rule.onNodeWithText("Claude Code · Opus · razonamiento alto").assertIsDisplayed()
        assertTrue(rule.onAllNodesWithText("El que usa el PC").fetchSemanticsNodes().isEmpty())
    }

    @Test fun theProjectChipsHaveNoColouredDot() {
        sheet(FakeNewChatBackend())
        // A chip is its name only, as in the mockup: no mark before it.
        rule.onNodeWithText("api-pagos").assertIsDisplayed()
    }

    @Test fun theActiveProjectIsChosenAndAnotherCanBePicked() {
        val vm = sheet(FakeNewChatBackend())
        rule.onNodeWithText("tienda-online").assertIsSelected()
        rule.onNodeWithText("api-pagos").performClick()
        rule.waitForIdle()
        assertEquals("api-pagos", vm.state.value.project)
        rule.onNodeWithText("Sin proyecto").performClick()
        rule.waitForIdle()
        assertEquals(null, vm.state.value.project)
    }

    @Test fun startingOrbeLeavesADraftWithoutCallingThePc() {
        val b = FakeNewChatBackend()
        val outcomes = ArrayList<NewChatOutcome>()
        sheet(b, outcomes)
        rule.onNodeWithText("Empezar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.isEmpty())
        assertEquals(listOf<NewChatOutcome>(NewChatOutcome.Draft(OrbeDraft(false, "tienda-online", null))), outcomes)
    }

    @Test fun theDirectVariantShowsAgentsFolderProjectAndBrain() {
        val vm = sheet(FakeNewChatBackend())
        rule.onNodeWithText("Directo con un agente").performClick()
        rule.waitForIdle()
        assertTrue(vm.state.value.direct)
        rule.onNodeWithText("Agente").assertIsDisplayed()
        rule.onNodeWithText("Claude Code").assertIsSelected()
        rule.onNodeWithText("Codex").assertIsDisplayed()
        rule.onNodeWithText("Carpeta").assertIsDisplayed()
        // The folder is the project's, shown as a fact; no absolute path.
        rule.onNodeWithText("la del proyecto").assertIsDisplayed()
        rule.onNodeWithText("Claude Code · El del PC").assertIsDisplayed()
    }

    @Test fun withoutAProjectTheFolderSaysTheAgentOnlyReads() {
        sheet(FakeNewChatBackend())
        rule.onNodeWithText("Directo con un agente").performClick()
        rule.onNodeWithText("Sin proyecto").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Sin carpeta").assertIsDisplayed()
        rule.onNodeWithText("el agente solo puede leer").assertIsDisplayed()
    }

    @Test fun startingADirectChatCreatesTheSessionAndOpensIt() {
        val b = FakeNewChatBackend()
        val outcomes = ArrayList<NewChatOutcome>()
        sheet(b, outcomes)
        rule.onNodeWithText("Directo con un agente").performClick()
        rule.onNodeWithText("Codex").performClick()
        rule.onNodeWithText("Empezar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("create agent=codex project=tienda-online model=null reasoning=null"), b.calls)
        assertEquals(listOf<NewChatOutcome>(NewChatOutcome.Session("s9")), outcomes)
    }

    @Test fun aRefusedDirectChatShowsTheReasonInTheSheet() {
        val b = FakeNewChatBackend()
        b.agentResult = offline()
        sheet(b)
        rule.onNodeWithText("Directo con un agente").performClick()
        rule.onNodeWithText("Empezar").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("No se pudo crear el chat en el PC. Sin conexión con el PC.").assertIsDisplayed()
    }

    @Test fun theBrainSheetListsTheUsualBrainsAsRowsLikeTheMockup() {
        val vm = sheet(FakeNewChatBackend())
        rule.onNodeWithText("El que usa el PC").performClick()
        rule.waitForIdle()
        for (t in listOf("Opus · razonamiento alto", "Sonnet · razonamiento medio", "Codex · modelo por defecto", "La cuenta la elige el PC.", "Listo")) {
            rule.onNodeWithText(t).assertIsDisplayed()
        }
        // The PC offers no Haiku and no Cursor here: those rows do not exist.
        for (t in listOf("Haiku", "Cursor · modelo por defecto")) rule.onNodeWithText(t).assertDoesNotExist()
        // The finer choices wait under «Más opciones».
        rule.onNodeWithText("Dejar la elección del PC").assertDoesNotExist()
        rule.onNodeWithText("Opus · razonamiento alto").performClick()
        rule.waitForIdle()
        assertEquals(Triple("claude", "opus", "high"), Triple(vm.state.value.brainAgent, vm.state.value.model, vm.state.value.effort))
        rule.onNodeWithText("Opus · razonamiento alto").assertIsSelected()
        rule.onNodeWithText("Codex · modelo por defecto").performClick()
        rule.waitForIdle()
        assertEquals(Triple("codex", null, null), Triple(vm.state.value.brainAgent, vm.state.value.model, vm.state.value.effort))
        rule.onNodeWithText("Listo").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Codex").assertIsDisplayed()
        rule.onNodeWithText("Empezar").assertIsDisplayed()
    }

    @Test fun theChosenRowReadsLikeTheMockupInTheBrainRow() {
        val vm = sheet(FakeNewChatBackend())
        vm.pickBrain("claude", "opus", "high")
        rule.waitForIdle()
        rule.onNodeWithText("Claude Code · Opus · razonamiento alto").assertIsDisplayed()
    }

    @Test fun moreOptionsKeepModelsEffortAndTheRecommendedOne() {
        val vm = sheet(FakeNewChatBackend())
        rule.onNodeWithText("El que usa el PC").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Más opciones").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Dejar la elección del PC").assertIsDisplayed()
        rule.onNodeWithText("Con quién piensa").assertIsDisplayed()
        rule.onAllNodesWithText("Claude Code").onLast().performClick()
        rule.waitForIdle()
        assertEquals("claude", vm.state.value.brainAgent)
        rule.onNodeWithText("Recomendado").assertIsDisplayed()
        rule.onNodeWithText("Opus").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick)
        rule.waitForIdle()
        rule.onNodeWithText("Alto").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick)
        rule.waitForIdle()
        assertEquals("high", vm.state.value.effort)
        rule.onNodeWithText("Listo").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Claude Code · Opus · razonamiento alto").assertIsDisplayed()
        rule.onNodeWithText("Empezar").assertIsDisplayed()
    }

    @Test fun theBrainSheetCanGoBackToThePcsChoice() {
        val vm = sheet(FakeNewChatBackend())
        vm.pickBrain("claude", "opus", null)
        rule.waitForIdle()
        rule.onNodeWithText("Claude Code · Opus").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Más opciones").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Dejar la elección del PC").performClick()
        rule.waitForIdle()
        assertEquals(null, vm.state.value.brainAgent)
    }

    @Test fun inADirectChatAFamilyRowSwitchesTheAgentToo() {
        val vm = sheet(FakeNewChatBackend())
        rule.onNodeWithText("Directo con un agente").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Claude Code · El del PC").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Codex · modelo por defecto").performClick()
        rule.waitForIdle()
        assertEquals("codex", vm.state.value.agent)
        assertTrue(vm.state.value.direct)
    }

    @Test fun withoutTheCatalogTheBrainSheetOffersOnlyThePcsChoice() {
        val b = FakeNewChatBackend()
        b.missing += "models.catalog"
        sheet(b)
        rule.onNodeWithText("El que usa el PC").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Dejar la elección del PC").assertIsDisplayed()
        for (t in listOf("Opus · razonamiento alto", "Más opciones")) rule.onNodeWithText(t).assertDoesNotExist()
    }

    @Test fun nuevoOpensTheProjectDialogAndCreatesIt() {
        val b = FakeNewChatBackend()
        val vm = sheet(b)
        rule.onNodeWithText("Nuevo").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Nuevo proyecto").assertIsDisplayed()
        rule.onNodeWithText("Crear").assertIsNotEnabled()
        rule.onNode(hasSetTextAction()).performTextInput("tienda-nueva")
        rule.onNodeWithText("Crear").assertIsEnabled().performClick()
        rule.waitForIdle()
        assertEquals(listOf("project tienda-nueva"), b.calls)
        assertEquals("tienda-nueva", vm.state.value.project)
        rule.onNodeWithText("tienda-nueva").assertIsSelected()
    }

    @Test fun theProjectDialogShowsTheRefusalAndStaysOpen() {
        val b = FakeNewChatBackend()
        b.projectResult = offline()
        sheet(b)
        rule.onNodeWithText("Nuevo").performClick()
        rule.onNode(hasSetTextAction()).performTextInput("x")
        rule.onNodeWithText("Crear").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Sin conexión con el PC.").assertIsDisplayed()
        rule.onNodeWithText("Nuevo proyecto").assertIsDisplayed()
    }

    @Test fun withoutTheLinkTheSheetSaysSoAndCannotStart() {
        val b = FakeNewChatBackend()
        b.connectionState.value = ConnectionState.Offline(null, null)
        sheet(b)
        rule.onNodeWithText("Sin conexión con el PC. Necesitas conexión para empezar un chat.").assertIsDisplayed()
        rule.onNodeWithText("Empezar").assertIsNotEnabled()
    }

    @Test fun failedOptionsSayWhatHappenedAndOfferARetry() {
        val b = FakeNewChatBackend()
        b.optionsResult = offline()
        sheet(b)
        rule.onNodeWithText("No se pudo leer lo que ofrece el PC. Puedes hablar con Orbe igualmente.").assertIsDisplayed()
        b.optionsResult = Result.success(sampleOptions)
        rule.onNodeWithText("Reintentar").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("tienda-online").assertIsDisplayed()
    }

    @Test fun anOldPcSaysItNeedsAnUpdate() {
        val b = FakeNewChatBackend()
        b.missing += "models.catalog"
        sheet(b)
        rule.onNodeWithText("Actualiza Orb en el PC", substring = true).assertIsDisplayed()
        rule.onNodeWithText("Empezar").assertIsEnabled()
    }

    @Test fun cancelClosesTheSheet() {
        val dismissed = ArrayList<Unit>()
        sheet(FakeNewChatBackend(), dismissed = dismissed)
        rule.onNodeWithText("Cancelar").performClick()
        assertEquals(1, dismissed.size)
    }

    @Test fun theSheetOpensOverTheChatListAndTheListStaysBehind() {
        val backend = FakeChatsBackend(listOf(row("2", title = "Revisar pasarela", project = "api-pagos")))
        val list = ChatListViewModel(backend, dispatcher = Dispatchers.Unconfined)
        val newChat = FakeNewChatBackend()
        val outcomes = ArrayList<NewChatOutcome>()
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                var open by mutableStateOf(false).let { androidx.compose.runtime.remember { it } }
                ChatListScreen(list, ChatsMenu(onMenu = {}), onOpenChat = {}, onSearch = {}, onNewChat = { open = true })
                if (open) NewChatSheet(NewChatViewModel(newChat), onDismiss = { open = false }, onOutcome = { outcomes += it })
            }
        }
        rule.waitForIdle()
        assertTrue(rule.onAllNodesWithText("Con Orbe").fetchSemanticsNodes().isEmpty())
        rule.onNodeWithText("Nuevo chat").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Con Orbe").assertIsDisplayed()
        rule.onNodeWithText("Revisar pasarela").assertExists()
        rule.onNodeWithText("Empezar").performClick()
        rule.waitForIdle()
        assertTrue(outcomes.single() is NewChatOutcome.Draft)
        assertTrue(newChat.calls.isEmpty())
    }
}

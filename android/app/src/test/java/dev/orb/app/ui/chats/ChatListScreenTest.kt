package dev.orb.app.ui.chats

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeRight
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.onFirst
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The chat list as Orb UI 2.0 draws it: header, chips, folding groups, «Completados», the menu and the swipes. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w390dp-h844dp")
class ChatListScreenTest {
    @get:Rule val rule = createComposeRule()

    private val rows = listOf(
        row("1", title = "Carrito que no guarda", project = "tienda-online", agent = "claude", state = ChatState.Working),
        row("2", title = "Revisar pasarela", project = "api-pagos", unread = 2),
        row("3", title = "Orb 3.8.4 seguimiento", pinned = true),
    )

    private fun list(b: FakeChatsBackend, menu: ChatsMenu = ChatsMenu(onMenu = {})) {
        val vm = ChatListViewModel(b, dispatcher = Dispatchers.Unconfined)
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                ChatListScreen(vm, menu, onOpenChat = {}, onSearch = {}, onNewChat = {})
            }
        }
        rule.waitForIdle()
    }

    private fun texts(t: String) = rule.onAllNodesWithText(t).fetchSemanticsNodes().size

    @Test fun headerShowsTheWordmarkTheLinkLineTheBellAndTheMoreMenu() {
        list(FakeChatsBackend(rows), ChatsMenu(onMenu = {}, unreadNotices = 2, onNotices = {}))
        rule.onNodeWithText("PC · conectado").assertIsDisplayed()
        assertTrue(rule.onAllNodesWithContentDescription("Orbe").fetchSemanticsNodes().isNotEmpty())
        rule.onNodeWithContentDescription("Menú").assertExists()
        rule.onNodeWithContentDescription("Más opciones").assertExists()
        // The bell carries its number and there is no magnifier in the bar: the search is the field.
        rule.onNodeWithContentDescription(dev.orb.app.ui.notes.NotesTexts.unreadDescription(2)).assertExists()
        rule.onNodeWithText("Buscar chats y proyectos").assertIsDisplayed()
        rule.onNodeWithContentDescription("Buscar chats, mensajes y proyectos").assertDoesNotExist()
    }

    @Test fun theLinkLineFollowsTheLink() {
        val b = FakeChatsBackend(rows)
        b.connectionState.value = dev.orb.app.link.net.ConnectionState.Offline(null, null)
        list(b)
        rule.onNodeWithText("Sin conexión").assertExists()
        assertEquals("Conectando…", ChatTexts.linkLine(dev.orb.app.link.net.ConnectionState.Connecting))
    }

    @Test fun theFourFiltersWithTheirNumbersAndNoPriorityChip() {
        list(FakeChatsBackend(rows))
        for (c in listOf("Todos", "No leídos", "Trabajando", "Directos")) assertTrue(c, texts(c) >= 1)
        rule.onNodeWithText("Prioridad").assertDoesNotExist()
    }

    @Test fun theMoreMenuTurnsPriorityOnAndOffersToReorderAndShowsTheSummary() {
        list(FakeChatsBackend(rows))
        rule.onNodeWithContentDescription("Más opciones").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Ordenar por prioridad").assertExists()
        rule.onNodeWithText("Resumen del día").assertExists()
        rule.onNodeWithText(InboxTexts.current().reorder).assertDoesNotExist()
        rule.onNodeWithText("Ordenar por prioridad").performClick()
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Más opciones").performClick()
        rule.waitForIdle()
        rule.onNodeWithText(InboxTexts.current().reorder).assertExists()
        rule.onNodeWithText("Activado").assertExists()
    }

    @Test fun theSummaryFromTheMenuAsksThePcAndShowsTheCard() {
        val b = FakeChatsBackend(rows)
        b.digestResult = Result.success(
            kotlinx.serialization.json.Json.parseToJsonElement("""{"day":"2026-11-17","due":false,"empty":false,"done":{"count":2,"items":[]}}"""),
        )
        list(b)
        rule.onNodeWithContentDescription("Más opciones").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Resumen del día").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("day-digest").assertExists()
    }

    @Test fun aGroupFoldsWithItsArrowAndTheChoiceIsKept() {
        val b = FakeChatsBackend(rows)
        list(b)
        rule.onNodeWithText("Carrito que no guarda").assertExists()
        rule.onNodeWithText("tienda-online").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Carrito que no guarda").assertDoesNotExist()
        assertTrue("h:project:tienda-online" in b.collapsedStore.orEmpty())
        rule.onNodeWithText("tienda-online").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Carrito que no guarda").assertExists()
    }

    @Test fun completedChatsStartFoldedAndOpenOnTap() {
        val done = row("9", title = "Chat terminado", done = true)
        val b = FakeChatsBackend(rows + done)
        list(b)
        rule.onNodeWithText("Completados · 1").assertExists()
        rule.onNodeWithText("Chat terminado").assertDoesNotExist()
        rule.onNodeWithText("Completados · 1").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Chat terminado").assertExists()
    }

    @Test fun rowsSayWhatIsHappening() {
        val rs = listOf(
            row("a", title = "Pantalla de pagos", waitingPermission = true),
            row("b", title = "Ajustar estilos", kind = ChatKind.Agent, agent = "cursor", state = ChatState.Working),
            row("c", title = "Arreglar el login", kind = ChatKind.Agent, agent = "claude", branch = "orb/login-huella", prNumber = 12),
            row("d", title = "Ideas para el blog", lastText = "Aquí tienes cinco temas."),
        )
        list(FakeChatsBackend(rs))
        rule.onNodeWithText("Esperando tu aprobación").assertExists()
        rule.onAllNodesWithText("Trabajando").fetchSemanticsNodes().let { assertTrue(it.size >= 2) }
        rule.onNodeWithText("orb/login-huella · PR #12").assertExists()
        rule.onNodeWithText("Orbe: Aquí tienes cinco temas.").assertExists()
    }

    @Test fun swipeRightMarksReadAndSwipeLeftArchivesWithUndo() {
        val b = FakeChatsBackend(rows)
        list(b)
        rule.onNodeWithText("Revisar pasarela").performTouchInput { swipeRight() }
        rule.waitForIdle()
        assertTrue("read conversation:2" in b.calls)
        rule.onNodeWithText("Orb 3.8.4 seguimiento").performTouchInput { swipeLeft() }
        rule.waitForIdle()
        assertTrue("archive conversation:3" in b.calls)
        rule.onNodeWithText("Chat archivado").assertExists()
        rule.onNodeWithText("Deshacer").performClick()
        rule.waitForIdle()
        assertTrue("unarchive conversation:3" in b.calls)
    }

    @Test fun everySwipeAlsoIsACustomActionForScreenReaders() {
        val b = FakeChatsBackend(rows)
        list(b)
        val node = rule.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.CustomActions)).onFirst()
        val labels = node.fetchSemanticsNode().config[SemanticsActions.CustomActions].map { it.label }
        assertTrue(labels.toString(), "Archivar" in labels)
        val archive = node.fetchSemanticsNode().config[SemanticsActions.CustomActions].first { it.label == "Archivar" }
        rule.runOnIdle { archive.action() }
        rule.waitForIdle()
        assertTrue(b.calls.any { it.startsWith("archive ") })
    }

    @Test fun aSwipeWithoutThePcSpringsBackAndChangesNothing() {
        val b = FakeChatsBackend(rows)
        b.connectionState.value = dev.orb.app.link.net.ConnectionState.Offline(null, null)
        list(b)
        rule.onNodeWithText("Orb 3.8.4 seguimiento").performTouchInput { swipeLeft() }
        rule.waitForIdle()
        assertTrue(b.calls.isEmpty())
        rule.onNodeWithText("Orb 3.8.4 seguimiento").assertIsDisplayed()
    }

    @Test fun emptyStatesSpeakInTheMockupsWords() {
        list(FakeChatsBackend())
        rule.onNodeWithText("Aún no hay chats").assertExists()
        assertNotNull(rule.onNodeWithText("Nuevo chat", useUnmergedTree = true))
    }

    @Test fun anEmptyFilterOffersToShowAll() {
        list(FakeChatsBackend(rows.map { it.copy(state = ChatState.Idle) }))
        rule.onNodeWithText("Trabajando").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Ningún chat con este filtro").assertExists()
        rule.onNodeWithText("Ver todos").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Revisar pasarela").assertExists()
    }

    @Test fun aWorkingRowAndAFinishedBranchRowCarryTheirNewDetails() {
        val rs = listOf(
            row("b", title = "Ajustar estilos", kind = ChatKind.Agent, agent = "cursor", state = ChatState.Working, activity = "Editando styles.css"),
            row("c", title = "Arreglar el login", kind = ChatKind.Agent, agent = "claude", branch = "orb/login-huella", changedFiles = 3),
            row("e", title = "Otro cambio", kind = ChatKind.Agent, agent = "claude", branch = "orb/otra"),
        )
        list(FakeChatsBackend(rs))
        rule.onNodeWithText("· Editando styles.css").assertExists()
        rule.onNodeWithText("orb/login-huella · Hecha · 3 archivos").assertExists()
        // No count from the PC: no claim of being finished.
        rule.onNodeWithText("orb/otra").assertExists()
    }

    @Test fun thePinnedGroupHasNoArrowAndDoesNotFold() {
        list(FakeChatsBackend(rows))
        rule.onNodeWithText("Fijados").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Orb 3.8.4 seguimiento").assertExists()
        val node = rule.onNodeWithText("Fijados").fetchSemanticsNode()
        assertTrue(!node.config.contains(androidx.compose.ui.semantics.SemanticsProperties.StateDescription))
    }

    @Test fun theRowOfTheOpenSheetStaysMarked() {
        val vm = ChatListViewModel(FakeChatsBackend(rows), dispatcher = Dispatchers.Unconfined)
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { ChatListScreen(vm, ChatsMenu(onMenu = {}), onOpenChat = {}, onSearch = {}, onNewChat = {}) } }
        rule.waitForIdle()
        rule.onNodeWithText("Revisar pasarela").performTouchInput { longClick() }
        rule.waitForIdle()
        rule.onNodeWithText("Fijar arriba").assertExists()
    }
}

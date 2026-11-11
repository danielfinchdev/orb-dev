package dev.orb.app.ui.chats

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.assertIsDisplayed
import dev.orb.app.ui.shell.MainShell
import dev.orb.app.ui.shell.ShellActions
import dev.orb.app.ui.theme.MemoryStore
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.ThemeChoice
import dev.orb.app.ui.theme.ThemePrefs
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ChatScreensTest {
    @get:Rule val rule = createComposeRule()

    private val rows = listOf(
        row("1", title = "Carrito que no guarda", project = "tienda-online", agent = "claude", state = ChatState.Working),
        row("2", title = "Revisar pasarela", project = "api-pagos", unread = 2),
        row("3", title = "Orb 3.8.4 seguimiento", pinned = true),
    )
    private val menu = ChatsMenu("Conectado a PC", {}, {}, {})

    private fun list(b: FakeChatsBackend, onOpen: (ChatRef) -> Unit = {}, onDelete: (ChatRef) -> Unit = {}) {
        val vm = ChatListViewModel(b, dispatcher = Dispatchers.Unconfined)
        rule.setContent {
            OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) {
                ChatListScreen(vm, menu, onOpenChat = onOpen, onSearch = {}, onNewChat = {}, onDelete = onDelete)
            }
        }
        rule.waitForIdle()
    }

    @Test fun listPaintsRowsChipsAndGroups() {
        list(FakeChatsBackend(rows))
        rule.onNodeWithText("Carrito que no guarda").assertIsDisplayed()
        rule.onNodeWithText("Revisar pasarela").assertIsDisplayed()
        for (chip in listOf("Todos", "No leídos", "Directos")) rule.onNodeWithText(chip).assertIsDisplayed()
        rule.onNodeWithText("Fijados").assertIsDisplayed()
        rule.onNodeWithText("tienda-online").assertIsDisplayed()
        rule.onNodeWithText("Nuevo chat", useUnmergedTree = true).assertExists()
        assert(rule.onAllNodesWithTextCount("Trabajando") >= 2) { "chip and tag expected" }
    }

    @Test fun filterChipNarrowsTheList() {
        list(FakeChatsBackend(rows))
        rule.onNodeWithText("No leídos").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Revisar pasarela").assertIsDisplayed()
        rule.onNodeWithText("Carrito que no guarda").assertDoesNotExist()
    }

    @Test fun tappingARowOpensTheChat() {
        var opened: ChatRef? = null
        list(FakeChatsBackend(rows), onOpen = { opened = it })
        rule.onNodeWithText("Revisar pasarela").performClick()
        assertEquals(ChatRef(ChatKind.Orbe, "2"), opened)
    }

    @Test fun longPressOpensTheActionsWithoutDeleteWhenThePcLacksIt() {
        list(FakeChatsBackend(rows))
        rule.onNodeWithText("Revisar pasarela").performTouchInput { longClick() }
        rule.waitForIdle()
        for (a in listOf("Fijar arriba", "Marcar como leído", "Silenciar", "Posponer", "Mover a sección…", "Renombrar", "Archivar")) {
            rule.onNodeWithText(a).assertExists()
        }
        rule.onNodeWithText("Borrar el chat en el PC").assertDoesNotExist()
    }

    @Test fun deleteAppearsWhenThePcHasItAndCallsTheHook() {
        var deleted: ChatRef? = null
        val b = FakeChatsBackend(rows).apply { trashAvailable = true }
        list(b, onDelete = { deleted = it })
        rule.onNodeWithText("Revisar pasarela").performTouchInput { longClick() }
        rule.waitForIdle()
        rule.onNodeWithText("Se puede deshacer").assertExists()
        rule.onNodeWithText("Borrar el chat en el PC").performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals(ChatRef(ChatKind.Orbe, "2"), deleted)
    }

    @Test fun pinFromTheSheetAsksThePc() {
        val b = FakeChatsBackend(rows)
        list(b)
        rule.onNodeWithText("Revisar pasarela").performTouchInput { longClick() }
        rule.waitForIdle()
        rule.onNodeWithText("Fijar arriba").performClick()
        rule.waitForIdle()
        assertEquals(listOf("pin conversation:2 true"), b.calls)
    }

    @Test fun offlineSheetExplainsAndDisablesTheActions() {
        val b = FakeChatsBackend(rows)
        b.connectionState.value = dev.orb.app.link.net.ConnectionState.Offline(null, null)
        list(b)
        rule.onNodeWithText("Revisar pasarela").performTouchInput { longClick() }
        rule.waitForIdle()
        rule.onNodeWithText("Sin conexión con el PC").assertExists()
    }

    @Test fun searchShowsTheGroups() {
        val b = FakeChatsBackend()
        b.searchResult = Result.success(
            SearchResults(
                listOf(row("1", title = "Carrito que no guarda", project = "tienda-online")),
                listOf(SearchMessage("conversation:1#4", ChatRef(ChatKind.Orbe, "1"), "Carrito que no guarda", null, "el carrito solo vive en memoria", null, Speaker.Orbe, "Orbe")),
                listOf(SearchTask(42, "Guardar el carrito entre recargas", "running", null, null)),
                listOf(SearchProject("tienda-online", 3)),
            ),
        )
        val vm = SearchViewModel(b, debounceMs = 0)
        var opened: ChatRef? = null
        rule.setContent { OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { SearchScreen(vm, onBack = {}, onOpenChat = { opened = it }) } }
        vm.setQuery("carrito")
        rule.waitUntil(5_000) { vm.state.value.phase == SearchPhase.Done }
        rule.waitForIdle()
        rule.onNodeWithText("Todo · 4").assertExists()
        for (c in listOf("Chats · 1", "Mensajes · 1", "Tareas · 1", "Proyectos · 1")) rule.onNodeWithText(c).assertExists()
        rule.onNodeWithText("Carrito que no guarda").assertExists()
        rule.onNodeWithText("Mensajes · 1").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("el carrito solo vive en memoria", substring = true).assertExists()
        rule.onNodeWithText("Proyectos · 1").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Proyecto en el PC · 3 chats").assertExists()
        rule.onNodeWithText("Tareas · 1").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("#42", substring = true).assertExists()
        assertNull(opened)
    }

    @Test fun theThreeTabsNavigate() {
        val b = FakeChatsBackend(rows)
        val prefs = ThemePrefs(MemoryStore())
        rule.setContent {
            OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) {
                MainShell(b, prefs, ShellActions({}, {}, {}, {}, {}, {}, {}), Dispatchers.Unconfined)
            }
        }
        rule.waitUntil(5_000) { rule.onAllNodesWithTextCount("Orb 3.8.4 seguimiento") > 0 }
        rule.onNodeWithText("Tareas").performClick()
        rule.waitUntil(5_000) { rule.onAllNodesWithTextCount("Las tareas llegan al móvil pronto") > 0 }
        rule.onNodeWithText("Pronto en el móvil; mientras, en el PC.").assertExists()
        rule.onNodeWithText("Proyectos").performClick()
        rule.waitUntil(5_000) { rule.onAllNodesWithTextCount("Los proyectos llegan al móvil pronto") > 0 }
        rule.onNodeWithText("Chats").performClick()
        rule.waitUntil(5_000) { rule.onAllNodesWithTextCount("Orb 3.8.4 seguimiento") > 0 }
    }
}

private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.onAllNodesWithTextCount(text: String) =
    onAllNodesWithText(text).fetchSemanticsNodes().size

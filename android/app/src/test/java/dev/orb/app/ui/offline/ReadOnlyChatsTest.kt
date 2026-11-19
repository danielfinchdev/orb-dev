package dev.orb.app.ui.offline

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.chats.ChatListScreen
import dev.orb.app.ui.chats.ChatListViewModel
import dev.orb.app.ui.chats.ChatsMenu
import dev.orb.app.ui.chats.FakeChatsBackend
import dev.orb.app.ui.chats.row
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The saved chats list: a clean read-only page, and the normal list again when the link is back. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w390dp-h844dp")
class ReadOnlyChatsTest {
    @get:Rule val rule = createComposeRule()

    private val seen = 1_700_000_000_000L

    @Test fun readOnlyDropsEverythingThatNeedsThePcAndKeepsTheListAndTheWayBack() {
        val backend = FakeChatsBackend(listOf(row("1", title = "Revisar pasarela", project = "api-pagos", unread = 1)))
        backend.connectionState.value = ConnectionState.Offline(null, seen)
        val info = OfflineInfo(MutableStateFlow(ConnectionState.Offline(null, seen)), MutableStateFlow(seen), {}, clock = { seen + 60_000 })
        var backs = 0
        var mode by mutableStateOf<ReadOnlyMode?>(ReadOnlyMode(info) { backs++ })
        val vm = ChatListViewModel(backend, dispatcher = Dispatchers.Unconfined)
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                ChatListScreen(vm, ChatsMenu(onMenu = {}, unreadNotices = 1, onNotices = {}), onOpenChat = {}, onSearch = {}, onNewChat = {}, readOnly = mode)
            }
        }
        rule.waitForIdle()
        rule.onNodeWithContentDescription(PcOffTexts.BACK_TO_PC).assertIsDisplayed()
        rule.onNodeWithText(OfflineTexts.READ_ONLY_TITLE).assertIsDisplayed()
        rule.onNodeWithText("Revisar pasarela").assertIsDisplayed()
        // One notice only, and no retry strip: retrying lives on the screen before.
        assertEquals(1, rule.onAllNodesWithText("Sin conexión · solo lectura. ", substring = true).fetchSemanticsNodes().size)
        rule.onNodeWithText("Lo que escribas en un chat sale al volver la conexión.", substring = true).assertIsDisplayed()
        for (gone in listOf("Reintentar ahora", "Buscar chats y proyectos", "Todos", "No leídos", "Trabajando", "Directos", "Nuevo chat")) {
            assertEquals(gone, 0, rule.onAllNodesWithText(gone).fetchSemanticsNodes().size)
        }
        for (gone in listOf("Menú", dev.orb.app.ui.notes.NotesTexts.unreadDescription(1))) rule.onNodeWithContentDescription(gone).assertDoesNotExist()
        rule.onNodeWithContentDescription(PcOffTexts.BACK_TO_PC).performClick()
        assertEquals(1, backs)

        mode = null
        rule.waitForIdle()
        rule.onNodeWithText("Buscar chats y proyectos").assertIsDisplayed()
        rule.onNodeWithText("Nuevo chat").assertIsDisplayed()
        rule.onNodeWithContentDescription("Menú").assertIsDisplayed()
    }
}

package dev.orb.app.ui.shots

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import dev.orb.app.ui.chats.ChatListScreen
import dev.orb.app.ui.chats.ChatListViewModel
import dev.orb.app.ui.chats.ChatState
import dev.orb.app.ui.chats.ChatsMenu
import dev.orb.app.ui.chats.FakeChatsBackend
import dev.orb.app.ui.chats.row
import dev.orb.app.ui.settings.AppearanceSheet
import dev.orb.app.ui.theme.DarkMode
import dev.orb.app.ui.theme.MemoryStore
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.ThemePrefs
import kotlinx.coroutines.Dispatchers
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** One picture per palette and mode of the chat list, and the appearance sheet: `ORB_SHOTS=1` turns them on. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = Shots.PHONE)
class ThemeShotsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val rows = listOf(
        row("1", title = "Carrito que no guarda", project = "tienda-online", agent = "claude", state = ChatState.Working),
        row("2", title = "Revisar pasarela", project = "api-pagos", unread = 2),
        row("3", title = "Orb 3.8.4 seguimiento", pinned = true),
    )

    private fun chatList(palette: OrbPaletteChoice) {
        Shots.assumeEnabled()
        val vm = ChatListViewModel(FakeChatsBackend(rows), dispatcher = Dispatchers.Unconfined)
        var dark by mutableStateOf(false)
        rule.setContent {
            ShotFrame(palette, dark) {
                ChatListScreen(vm, ChatsMenu(onMenu = {}), onOpenChat = {}, onSearch = {}, onNewChat = {})
            }
        }
        rule.waitForIdle()
        Shots.save(rule.activity, "09-chats-${palette.key}-claro")
        dark = true
        rule.waitForIdle()
        Shots.save(rule.activity, "09-chats-${palette.key}-oscuro")
    }

    @Test fun chatsGrafito() = chatList(OrbPaletteChoice.Grafito)
    @Test fun chatsOceano() = chatList(OrbPaletteChoice.Oceano)
    @Test fun chatsBosque() = chatList(OrbPaletteChoice.Bosque)
    @Test fun chatsUva() = chatList(OrbPaletteChoice.Uva)
    @Test fun chatsRubi() = chatList(OrbPaletteChoice.Rubi)
    @Test fun chatsArena() = chatList(OrbPaletteChoice.Arena)

    @Test fun appearanceSheet() {
        Shots.assumeEnabled()
        val prefs = ThemePrefs(MemoryStore())
        var dark by mutableStateOf(false)
        rule.setContent { ShotFrame(OrbPaletteChoice.Grafito, dark) { AppearanceSheet(prefs) {} } }
        rule.waitForIdle()
        Shots.save(rule.activity, "24-apariencia-grafito-claro")
        prefs.setDark(DarkMode.Dark)
        dark = true
        rule.waitForIdle()
        Shots.save(rule.activity, "24-apariencia-grafito-oscuro")
    }
}

package dev.orb.app.ui.shots

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.PcVersions
import dev.orb.app.ui.chats.ChatKind
import dev.orb.app.ui.chats.ChatListScreen
import dev.orb.app.ui.chats.ChatListViewModel
import dev.orb.app.ui.chats.ChatRef
import dev.orb.app.ui.chats.ChatRow
import dev.orb.app.ui.chats.ChatState
import dev.orb.app.ui.chats.ChatsMenu
import dev.orb.app.ui.chats.FakeChatsBackend
import dev.orb.app.ui.chats.SearchMessage
import dev.orb.app.ui.chats.SearchPhase
import dev.orb.app.ui.chats.SearchProject
import dev.orb.app.ui.chats.SearchResults
import dev.orb.app.ui.chats.SearchScreen
import dev.orb.app.ui.chats.SearchTask
import dev.orb.app.ui.chats.SearchViewModel
import dev.orb.app.ui.chats.Speaker
import dev.orb.app.ui.chats.row
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbBottomBar
import dev.orb.app.ui.kit.OrbTab
import dev.orb.app.ui.theme.OrbPaletteChoice
import kotlinx.coroutines.Dispatchers
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/**
 * Pictures of the chat list (09) and of Search (11) with the mockups' own chats, to compare them side by side:
 * `ORB_SHOTS=1` turns them on.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = Shots.PHONE)
class ChatsShotsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private fun at(daysAgo: Long, h: Int, m: Int): String =
        LocalDate.now().minusDays(daysAgo).atTime(LocalTime.of(h, m)).atZone(ZoneId.systemDefault()).toInstant().toString()

    private fun mockupRows(): List<ChatRow> {
        val done = (1..14).map { n -> row("d$n", title = "Chat terminado $n", done = true, at = at(10L + n, 10, 0)) }
        return listOf(
            row("41", title = "Versión 2.0 de la app", pinned = true, unread = 2, lastText = "Tarea #41 espera tu OK", at = at(0, 13, 31)),
            row("s1", ChatKind.Agent, "Ajustar estilos con Cursor", "app-movil", at(0, 13, 46), state = ChatState.Working, agent = "cursor", lastText = null),
            row("p1", title = "Pantalla de pagos", project = "app-movil", unread = 1, at = at(0, 13, 20), waitingPermission = true),
            row("s2", ChatKind.Agent, "Arreglar el login con huella", "app-movil", at(0, 9, 15), agent = "claude", lastText = null, branch = "orb/login-huella"),
            row("r1", title = "Revisar pasarela", project = "api-pagos", unread = 1, at = at(0, 12, 10), lastText = "Hecho, he añadido un límite de tres."),
            row("o1", title = "Conversación antigua", project = "api-pagos", at = at(1, 11, 0), lastText = "¡Hola!"),
            row("b1", title = "Ideas para el blog", at = at(2, 11, 0), lastText = "Aquí tienes cinco temas."),
        ) + done
    }

    private val tabs = listOf(OrbTab("chats", "Chats", OrbIcons.Chat, 3), OrbTab("tasks", "Tareas", OrbIcons.Tasks, 1), OrbTab("projects", "Proyectos", OrbIcons.Folder))

    private fun backend(rows: List<ChatRow>) = FakeChatsBackend(rows).apply {
        connectionState.value = ConnectionState.Online("http://pc", "PC de Dani", PcVersions(1, 1, "3.8.8"))
    }

    /** One picture of [name] per mode; [after] runs once the screen is up (a gesture, a menu...). */
    private fun twoModes(name: String, palette: OrbPaletteChoice, suffix: String, after: () -> Unit = {}, content: @androidx.compose.runtime.Composable () -> Unit) {
        var dark by mutableStateOf(false)
        rule.setContent { ShotFrame(palette, dark, content) }
        rule.waitForIdle()
        after()
        rule.waitForIdle()
        Shots.save(rule.activity, "$name-${palette.key}-claro$suffix")
        dark = true
        rule.waitForIdle()
        Shots.save(rule.activity, "$name-${palette.key}-oscuro$suffix")
    }

    private fun chats(palette: OrbPaletteChoice, suffix: String = "", rows: List<ChatRow> = mockupRows(), archive: String? = null) {
        Shots.assumeEnabled()
        val vm = ChatListViewModel(backend(rows), dispatcher = Dispatchers.Unconfined)
        twoModes("09-chats", palette, suffix, after = {
            if (archive != null) {
                rule.runOnIdle { vm.archive(rows.first { it.id == archive }) }
            }
        }) {
            Column(Modifier.fillMaxSize()) {
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    ChatListScreen(vm, ChatsMenu(onMenu = {}, unreadNotices = 2, onNotices = {}), onOpenChat = {}, onSearch = {}, onNewChat = {})
                }
                OrbBottomBar(tabs, "chats", {})
            }
        }
    }

    @Test fun chatsGrafito() = chats(OrbPaletteChoice.Grafito)
    @Test fun chatsOceano() = chats(OrbPaletteChoice.Oceano)
    @Test fun chatsArchivado() = chats(OrbPaletteChoice.Grafito, "-archivado", archive = "o1")

    private fun results() = SearchResults(
        chats = listOf(row("r1", title = "Revisar pasarela", project = "api-pagos", at = at(0, 12, 10))),
        messages = listOf(
            SearchMessage("conversation:o1#1", ChatRef(ChatKind.Orbe, "o1"), "Conversación antigua", null, "cambia la pasarela a Stripe y", at(1, 11, 0), Speaker.Orbe, "Orbe"),
            SearchMessage("conversation:41#1", ChatRef(ChatKind.Orbe, "41"), "Versión 2.0 de la app", null, "la pasarela de pago del móvil", at(2, 11, 0), Speaker.Orbe, "Orbe"),
        ),
        tasks = listOf(SearchTask(36, "Probar la pasarela en sandbox", "done", "api-pagos", null)),
        projects = listOf(SearchProject("api-pagos", 2, 1)),
    )

    private fun search(palette: OrbPaletteChoice, suffix: String, query: String, found: SearchResults) {
        Shots.assumeEnabled()
        val b = backend(emptyList()).apply { searchResult = Result.success(found) }
        val vm = SearchViewModel(b, debounceMs = 0)
        twoModes("11-buscar", palette, suffix, after = {
            if (query.isNotEmpty()) {
                vm.setQuery(query)
                rule.waitUntil(5_000) { vm.state.value.phase == SearchPhase.Done }
            }
        }) { SearchScreen(vm, onBack = {}, onOpenChat = {}) }
    }

    @Test fun searchResultsGrafito() = search(OrbPaletteChoice.Grafito, "", "pasarela", results())
    @Test fun searchResultsOceano() = search(OrbPaletteChoice.Oceano, "", "pasarela", results())
    @Test fun searchEmpty() = search(OrbPaletteChoice.Grafito, "-vacio", "", SearchResults.Empty)
    @Test fun searchNothing() = search(OrbPaletteChoice.Grafito, "-sin-resultados", "zzq", SearchResults.Empty)
}

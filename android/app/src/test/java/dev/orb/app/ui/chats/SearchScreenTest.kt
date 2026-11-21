package dev.orb.app.ui.chats

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Search as Orb UI 2.0 draws it: a header, a field, five chips, grouped results and a way into each kind of result. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w390dp-h844dp")
class SearchScreenTest {
    @get:Rule val rule = createComposeRule()

    private val found = SearchResults(
        chats = listOf(row("1", title = "Revisar la pasarela", project = "api-pagos")),
        messages = listOf(SearchMessage("conversation:2#4", ChatRef(ChatKind.Orbe, "2"), "Conversación antigua", null, "cambia la pasarela a Stripe y", null, Speaker.Orbe, "Orbe")),
        tasks = listOf(SearchTask(36, "Probar la pasarela en sandbox", "done", "api-pagos", null)),
        projects = listOf(SearchProject("pasarela-web", 2, 1)),
    )

    private class Opened {
        var chat: ChatRef? = null
        var task: Long? = null
        var project: String? = null
    }

    private fun screen(b: FakeChatsBackend, opened: Opened = Opened(), query: String = "pasarela"): SearchViewModel {
        val vm = SearchViewModel(b, debounceMs = 0)
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                SearchScreen(vm, onBack = {}, onOpenChat = { opened.chat = it }, onOpenTask = { opened.task = it }, onOpenProject = { opened.project = it })
            }
        }
        if (query.isNotEmpty()) {
            vm.setQuery(query)
            rule.waitUntil(5_000) { vm.state.value.phase == SearchPhase.Done || vm.state.value.phase == SearchPhase.Offline }
        }
        rule.waitForIdle()
        return vm
    }

    @Test fun theHeaderNamesTheScreenAndTheEmptyStateAsksForTwoLetters() {
        screen(FakeChatsBackend(), query = "")
        rule.onNodeWithText("Chats, mensajes, tareas y proyectos").assertIsDisplayed()
        rule.onNodeWithText("Escribe al menos 2 letras").assertIsDisplayed()
        rule.onNodeWithText("Busca por contenido en chats, mensajes, tareas y proyectos.").assertIsDisplayed()
        rule.onNodeWithContentDescription("Volver").assertExists()
    }

    @Test fun nothingFoundSaysWhatWasSearched() {
        screen(FakeChatsBackend(), query = "zzq")
        rule.onNodeWithText("Sin resultados").assertIsDisplayed()
        rule.onNodeWithText("No hay nada con «zzq».").assertIsDisplayed()
    }

    @Test fun theLinesOfTaskAndProjectCarryWhatTheAppKnows() {
        val b = FakeChatsBackend().apply { searchResult = Result.success(found) }
        screen(b)
        rule.onNodeWithText("#36 Probar la pasarela en sandbox").assertExists()
        rule.onNodeWithText("Completada").assertExists()
        rule.onNodeWithText("2 chats · 1 tarea").assertExists()
        rule.onNodeWithText("En mensajes").assertExists()
        assertEquals("2 chats", ChatTexts.projectLine(2, null))
        assertEquals("1 chat · 3 tareas", ChatTexts.projectLine(1, 3))
    }

    @Test fun aTaskOpensItsDetailAndAProjectItsSheet() {
        val opened = Opened()
        val b = FakeChatsBackend().apply { searchResult = Result.success(found) }
        screen(b, opened)
        rule.onNodeWithText("#36 Probar la pasarela en sandbox").performClick()
        assertEquals(36L, opened.task)
        assertNull(opened.project)
        rule.onNodeWithText("pasarela-web").performClick()
        assertEquals("pasarela-web", opened.project)
        rule.onNodeWithText("Revisar la pasarela").performClick()
        assertEquals(ChatRef(ChatKind.Orbe, "1"), opened.chat)
        rule.onNodeWithText("Conversación antigua").performClick()
        assertEquals(ChatRef(ChatKind.Orbe, "2"), opened.chat)
    }

    @Test fun offlineSearchesTheSavedChatsAndSaysSo() {
        val b = FakeChatsBackend().apply {
            connectionState.value = dev.orb.app.link.net.ConnectionState.Offline(null, null)
            savedResult = SearchResults(listOf(row("1", title = "Revisar la pasarela", project = "api-pagos")), emptyList(), emptyList(), emptyList())
        }
        screen(b)
        rule.onNodeWithText(ChatTexts.SEARCH_OFFLINE).assertExists()
        rule.onNodeWithText("Revisar la pasarela").assertExists()
    }
}

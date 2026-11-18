package dev.orb.app.ui.tasks

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.OrbPaletteChoice
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class TasksScreenTest {
    @get:Rule val rule = createComposeRule()

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    private val rows = listOf(
        task(3, "Probar push en el emulador", status = "queued", waiting = TaskWait("deps", null, listOf(WaitDep(2, "running", false)))),
        task(2, "Borrar build y reinstalar", status = "awaiting_approval"),
        task(1, "Ajustar margen del pie", status = "done", result = "Hecho"),
    )

    private fun show(b: FakeTasksBackend, onOpen: (Long) -> Unit = {}) {
        val vm = TasksViewModel(b, reloadDebounceMs = 0, searchDebounceMs = 0)
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) { TasksScreen(vm, onOpen) }
        }
        rule.waitForIdle()
    }

    @Test fun listShowsRowsFiltersAndWhyAQueuedTaskWaits() {
        show(FakeTasksBackend(rows))
        rule.onNodeWithText("#3 Probar push en el emulador").assertIsDisplayed()
        rule.onNodeWithText("Espera a #2").assertIsDisplayed()
        rule.onNodeWithText("Espera tu OK").assertIsDisplayed()
        for (chip in listOf("Todas", "Por aprobar", "En curso", "Incidencias", "Completadas")) rule.onNodeWithText(chip).assertIsDisplayed()
        // The chip and the pill of the queued task both say «En cola».
        assertEquals(2, rule.onAllNodesWithText("En cola").fetchSemanticsNodes().size)
        rule.onNodeWithText("Nueva tarea", useUnmergedTree = true).assertExists()
    }

    @Test fun aFilterChipNarrowsTheList() {
        show(FakeTasksBackend(rows))
        rule.onNodeWithText("Completadas").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("#1 Ajustar margen del pie").assertIsDisplayed()
        rule.onNodeWithText("#3 Probar push en el emulador").assertDoesNotExist()
    }

    @Test fun pausedQueueShowsTheBannerAndResumeAsksThePc() {
        val b = FakeTasksBackend(rows, paused = true)
        show(b)
        rule.onNodeWithText("Cola en pausa", substring = true).assertIsDisplayed()
        rule.onNodeWithText("Reanudar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("paused false"), b.calls)
        rule.onNodeWithText("Reanudar").assertDoesNotExist()
    }

    @Test fun theBannerIsHiddenWhenThePcCannotPause() {
        val b = FakeTasksBackend(rows, paused = true)
        b.unavailable = setOf(ApiMethods.CONTROL_RESUME.name)
        show(b)
        rule.onNodeWithText("Reanudar").assertDoesNotExist()
    }

    @Test fun theNewTaskButtonIsHiddenWhenThePcDoesNotListIt() {
        val b = FakeTasksBackend(rows)
        b.unavailable = setOf(ApiMethods.TASKS_CREATE.name)
        show(b)
        rule.onNodeWithText("Nueva tarea").assertDoesNotExist()
    }

    @Test fun tappingARowOpensTheTask() {
        var opened = 0L
        show(FakeTasksBackend(rows), onOpen = { opened = it })
        rule.onNodeWithText("#2 Borrar build y reinstalar").performClick()
        assertEquals(2L, opened)
    }

    @Test fun newTaskFormCreatesThroughThePc() {
        val b = FakeTasksBackend(rows)
        show(b)
        rule.onNodeWithText("Nueva tarea", useUnmergedTree = true).performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Título").performTextInput("Probar")
        rule.onNodeWithText("Qué tiene que hacer").performTextInput("Arrancar la app")
        rule.onNodeWithText("Crear tarea").performClick()
        rule.waitForIdle()
        assertEquals(listOf("create api-pagos|Probar|Arrancar la app"), b.calls)
    }

    @Test fun anEmptyBoardExplainsHowToStart() {
        show(FakeTasksBackend())
        rule.onNodeWithText("No hay tareas").assertIsDisplayed()
    }

    @Test fun searchListsThePcMatches() {
        val b = FakeTasksBackend(rows)
        b.searchResult = Result.success(listOf(dev.orb.app.ui.chats.SearchTask(40, "Pasarela sandbox", "done", "api-pagos", "…token…")))
        show(b)
        rule.onNodeWithContentDescription("Buscar tareas").performClick()
        rule.onNodeWithText("Buscar en el título y el resultado").performTextInput("pasar")
        rule.waitForIdle()
        assertTrue(b.searches.contains("pasar"))
        rule.onNodeWithText("#40 Pasarela sandbox").assertIsDisplayed()
    }
}

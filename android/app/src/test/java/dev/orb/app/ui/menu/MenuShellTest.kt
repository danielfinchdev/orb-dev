package dev.orb.app.ui.menu

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.printToString
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.orb.app.ui.chats.FakeChatsBackend
import dev.orb.app.ui.chats.InboxTexts
import dev.orb.app.ui.chats.row
import dev.orb.app.ui.notes.FakeNotesBackend
import dev.orb.app.ui.notes.notice
import dev.orb.app.ui.shell.MainShell
import dev.orb.app.ui.shell.ShellActions
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.DarkMode
import dev.orb.app.ui.theme.MemoryStore
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.ThemePrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class MenuShellTest {
    @get:Rule val rule = createComposeRule()

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    private fun show(notes: FakeNotesBackend?, actions: ShellActions, backend: FakeChatsBackend = FakeChatsBackend(), theme: ThemePrefs? = null, pc: String? = null) {
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                MainShell(backend, actions, Dispatchers.Unconfined, notes = notes, pcName = pc, theme = theme)
            }
        }
        rule.waitForIdle()
    }

    private fun showWithTasks(tasks: dev.orb.app.ui.tasks.FakeTasksBackend) {
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                MainShell(FakeChatsBackend(), ShellActions({}, {}, {}), Dispatchers.Unconfined, tasks = tasks)
            }
        }
        rule.waitForIdle()
    }

    private fun boardRows() = listOf(dev.orb.app.ui.tasks.task(1, "Ajustar estilos", status = "running"), dev.orb.app.ui.tasks.task(2, "Hecha", status = "done"))

    @Test fun theMenuTakesYouToTheBoardAndOpensItsSearch() {
        showWithTasks(dev.orb.app.ui.tasks.FakeTasksBackend(boardRows()))
        rule.onNodeWithContentDescription("Menú").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Buscar tareas").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Buscar en el título y el resultado").assertIsDisplayed()
    }

    @Test fun theMenuTakesYouToTheBoardAndShowsTheFinishedTasks() {
        showWithTasks(dev.orb.app.ui.tasks.FakeTasksBackend(boardRows()))
        rule.onNodeWithContentDescription("Menú").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Ver tareas completadas").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Hecha").assertIsDisplayed()
        // the menu now offers the way back
        rule.onNodeWithContentDescription("Menú").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Ver tareas activas").performScrollTo().assertIsDisplayed()
    }

    @Test fun theMenuPausesTheQueueOnlyWhileItRunsAndThePcCanDoIt() {
        val b = dev.orb.app.ui.tasks.FakeTasksBackend(boardRows())
        showWithTasks(b)
        rule.onNodeWithContentDescription("Menú").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Pausar la cola").performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals(listOf("paused true"), b.calls)
        // paused now: the entry is gone (the board's card has «Reanudar»)
        rule.onNodeWithContentDescription("Menú").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Pausar la cola").assertDoesNotExist()
    }

    @Test fun withoutATaskBoardTheMenuHasNoBoardEntries() {
        show(null, ShellActions({}, {}, {}))
        rule.onNodeWithContentDescription("Menú").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Buscar tareas").assertDoesNotExist()
    }

    @Test fun theSheetOpensWithTheStateOfTheLinkAndTheRowsOfTheMockup() {
        val backend = FakeChatsBackend()
        show(null, ShellActions({}, {}, {}), backend, pc = "DanLaptop", theme = ThemePrefs(MemoryStore()))
        rule.onNodeWithContentDescription("Menú").performClick()
        rule.waitForIdle()
        for (t in listOf("Este móvil", "Tutoriales", "Juegos", "Modo oscuro", "Memorias y actividad", "Uso y agentes")) rule.onNodeWithText(t).performScrollTo().assertIsDisplayed()
        // What the mockup draws elsewhere is not here.
        for (t in listOf("Notificaciones", "Apariencia", "Prueba de conexión", "Desenlazar este móvil")) rule.onNodeWithText(t).assertDoesNotExist()
    }

    @Test fun memoriesAndActivityOpensItsScreen() {
        var went = ""
        show(null, ShellActions({}, {}, {}, onActivity = { went = "activity" }))
        rule.onNodeWithContentDescription("Menú").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Memorias y actividad").performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals("activity", went)
        // the sheet closed first
        rule.onNodeWithText("Modo oscuro").assertDoesNotExist()
    }

    @Test fun theDarkModeSwitchForcesDarkFromFollowingTheSystemAndThenLightAgain() {
        val prefs = ThemePrefs(MemoryStore())
        show(null, ShellActions({}, {}, {}), theme = prefs)
        rule.onNodeWithContentDescription("Menú").performClick()
        rule.waitForIdle()
        rule.onNode(isToggleable()).performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals(DarkMode.Dark, prefs.settings.value.dark)
        rule.onNode(isToggleable()).performClick()
        rule.waitForIdle()
        assertEquals(DarkMode.Light, prefs.settings.value.dark)
    }

    @Test fun withoutAThemeTheSheetHasNoDarkModeSwitch() {
        show(null, ShellActions({}, {}, {}))
        rule.onNodeWithContentDescription("Menú").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Modo oscuro").assertDoesNotExist()
    }

    @Test fun theProjectsRowGoesToTheProjectsTab() {
        show(null, ShellActions({}, {}, {}))
        rule.onNodeWithContentDescription("Menú").performClick()
        rule.waitForIdle()
        // the bottom bar has its own «Proyectos»; the sheet's is the second one
        rule.onAllNodesWithText("Proyectos")[1].performClick()
        rule.waitForIdle()
        rule.onNodeWithText(dev.orb.app.ui.chats.ChatTexts.SOON_PROJECTS).assertIsDisplayed()
        rule.onNodeWithText("Modo oscuro").assertDoesNotExist()
    }

    @Test fun theMenuButtonOpensTheSheetAndAnEntryNavigates() {
        var went = ""
        show(null, ShellActions({}, {}, {}, onSchedules = { went = "schedules" }))
        rule.onNodeWithContentDescription("Menú").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Programadas").performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals("schedules", went)
    }

    @Test fun moreOptionsOfTheMenuTurnPriorityOnAndOffersToReorder() {
        show(null, ShellActions({}, {}, {}))
        rule.onNodeWithContentDescription("Menú").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Más opciones").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("Desactivado").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText(InboxTexts.current().reorder).assertDoesNotExist()
        rule.onNodeWithText("Ordenar por prioridad").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Menú").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Activado").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText(InboxTexts.current().reorder).performScrollTo().assertIsDisplayed()
    }

    @Test
    @Config(sdk = [35], qualifiers = "w390dp-h844dp")
    fun theDaySummaryFromTheMenuAsksThePcAndShowsTheCard() {
        val b = FakeChatsBackend(listOf(row("1", title = "Carrito que no guarda")))
        b.digestResult = Result.success(
            kotlinx.serialization.json.Json.parseToJsonElement("""{"day":"2026-11-17","due":false,"empty":false,"done":{"count":2,"items":[]}}"""),
        )
        show(null, ShellActions({}, {}, {}), b)
        rule.onNodeWithContentDescription("Menú").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Resumen del día").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("day-digest").assertExists()
    }

    @Test fun theChatsBarHasNoMoreMenu() {
        show(null, ShellActions({}, {}, {}))
        rule.onNodeWithContentDescription("Más opciones").assertDoesNotExist()
    }

    @Test fun theBellCountsUnreadNoticesAndOpensTheCenter() {
        val notes = FakeNotesBackend()
        notes.feed.add(notice("a"))
        notes.feed.add(notice("b", at = 5))
        var opened = 0
        show(notes, ShellActions({}, {}, {}, onNotices = { opened++ }))
        rule.onNode(hasContentDescription("Notificaciones, 2 sin leer")).assertIsDisplayed()
        rule.onNode(hasContentDescription("Notificaciones, 2 sin leer")).performClick()
        assertEquals(1, opened)
    }

    @Test fun withoutANoticesBackendThereIsNoBell() {
        show(null, ShellActions({}, {}, {}))
        rule.onNode(hasContentDescription("Notificaciones")).assertDoesNotExist()
    }
}


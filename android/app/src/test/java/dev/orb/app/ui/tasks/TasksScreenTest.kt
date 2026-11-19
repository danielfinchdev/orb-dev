package dev.orb.app.ui.tasks

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isSelectable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.chats.ChatsMenu
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
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

/** The task board as Orb UI 2.0 draws it (screen 17): header, numbered sections, the two buttons of a row and the «⋯» menu. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w390dp-h2000dp")
class TasksScreenTest {
    @get:Rule val rule = createComposeRule()

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    private val rows = listOf(
        task(43, "Borrar build y reinstalar", status = "blocked", project = "app-movil", agent = "codex", held = TaskHeld("borra 214 archivos", null)),
        task(46, "Migrar la base", status = "awaiting_approval", project = "api-pagos"),
        task(42, "Ajustar estilos", status = "running", project = "app-movil", agent = "cursor", percent = 60),
        task(41, "Probar push en el emulador", project = "app-movil", agent = null, waiting = TaskWait("deps", null, listOf(WaitDep(43, "blocked", false)))),
        task(44, "Traducir la FAQ al inglés", project = "api-pagos", waiting = TaskWait("notice", "Límite", emptyList(), account = "Claude", until = "2026-11-19T14:00:00.000Z", percent = 94)),
        task(45, "Ajustar margen del pie", project = "app-movil", agent = null, waiting = TaskWait("folder", null, emptyList(), by = 42)),
        task(30, "Revisar login", status = "failed"),
        task(20, "Ajustar el menú", status = "done", result = "Hecho"),
        task(21, "Subir la versión", status = "done", accepted = true),
    )

    private lateinit var vm: TasksViewModel

    private fun show(b: FakeTasksBackend, menu: ChatsMenu = ChatsMenu(onMenu = {}, unreadNotices = 2, onNotices = {}), onOpen: (Long) -> Unit = {}) {
        b.detailFor(rows)
        vm = TasksViewModel(b, reloadDebounceMs = 0, searchDebounceMs = 0)
        val vm = vm
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { TasksScreen(vm, menu, onOpen) } }
        rule.waitForIdle()
    }

    private fun FakeTasksBackend.detailFor(all: List<TaskRow>) {
        for (t in all) details[t.id] = Result.success(detail(t, previewHash = "h${t.id}"))
    }

    // Header

    @Test fun headerHasTheMenuTheQueueLineTheBellWithItsNumberAndTheMoreMenu() {
        show(FakeTasksBackend(rows, paused = true))
        rule.onNodeWithContentDescription("Menú").assertExists()
        rule.onNodeWithText("Cola en pausa · 3 esperando").assertIsDisplayed()
        rule.onNodeWithContentDescription("Notificaciones, 2 sin leer").assertExists()
        // The mockup draws no «⋯» here: what it held is under «Más opciones» of the ☰ menu.
        rule.onNodeWithContentDescription("Más opciones").assertDoesNotExist()
        rule.onNodeWithContentDescription("Buscar tareas").assertDoesNotExist()
    }

    @Test fun theQueueLineSaysWhatRunsAndWaitsWhenItIsNotPaused() {
        show(FakeTasksBackend(rows, paused = false))
        rule.onNodeWithText("1 en curso · 3 esperando").assertIsDisplayed()
    }

    @Test fun theBellIsHiddenWhenThereIsNoNoticesCenter() {
        show(FakeTasksBackend(rows), ChatsMenu(onMenu = {}))
        rule.onNodeWithContentDescription("Notificaciones", substring = true).assertDoesNotExist()
    }

    // Sections

    @Test fun theBoardIsFourSectionsAndTheFinishedOnesAreNotInThem() {
        show(FakeTasksBackend(rows))
        // each name is a chip and a heading
        for (s in listOf("Por aprobar", "En curso", "En cola", "Incidencias")) rule.onAllNodesWithText(s).assertCountEquals(2)
        val headings = rule.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading)).fetchSemanticsNodes().size
        // the title of the bar plus the four sections
        assertEquals(5, headings)
        rule.onNodeWithText("Ajustar el menú").assertDoesNotExist()
    }

    @Test fun rowsTellNumberProjectAgentAndTheirState() {
        show(FakeTasksBackend(rows))
        rule.onNodeWithText("#43 · app-movil · Codex").assertIsDisplayed()
        rule.onNodeWithText("Espera tu OK: borra 214 archivos").assertIsDisplayed()
        rule.onNodeWithText("Espera tu OK").assertIsDisplayed()
        // A running task says «proyecto · agente», without its number.
        rule.onNodeWithText("app-movil · Cursor").assertIsDisplayed()
        rule.onNodeWithText("#42 · app-movil · Cursor").assertDoesNotExist()
        rule.onNodeWithText("Espera a la #43: #43 está detenida").assertIsDisplayed()
        rule.onNodeWithText("Revisar login").assertIsDisplayed()
        rule.onNodeWithText("Fallida").assertIsDisplayed()
    }

    @Test fun eachReasonForWaitingIsSaid() {
        val zone = TaskLines.clock("2026-11-19T14:00:00.000Z")
        show(FakeTasksBackend(rows))
        rule.onNodeWithText("Claude al 94 % del límite · vuelve a las $zone").assertIsDisplayed()
        rule.onNodeWithText("Otra tarea escribe en esta carpeta (#42)").assertIsDisplayed()
    }

    @Test fun aQueueWithoutAReasonIsSaidPausedWhilePaused() {
        show(FakeTasksBackend(listOf(task(7, "Algo")), paused = true))
        // the card and the row both say it
        assertEquals(2, rule.onAllNodesWithText("Cola en pausa").fetchSemanticsNodes().size)
        rule.onNodeWithText("Algo").assertIsDisplayed()
    }

    @Test fun tappingARowOpensTheTask() {
        var opened = 0L
        show(FakeTasksBackend(rows), onOpen = { opened = it })
        rule.onNodeWithText("Ajustar estilos").performClick()
        assertEquals(42L, opened)
    }

    // A task that waits for the OK

    @Test fun seeAndApproveOpensTheTaskAndNeverApproves() {
        val opened = ArrayList<Long>()
        val b = FakeTasksBackend(rows)
        show(b, onOpen = { opened += it })
        // «Aprobar» alone is not on the list: the OK is given where everything it covers is shown
        rule.onNodeWithText("Aprobar").assertDoesNotExist()
        assertEquals(1, rule.onAllNodesWithText("Ver y aprobar").fetchSemanticsNodes().size)
        rule.onNodeWithText("Ver y aprobar").performClick()
        assertEquals(listOf(46L), opened)
        assertTrue(b.calls.isEmpty())
    }

    @Test fun aTaskHeldForReviewOnlyOffersToReviewIt() {
        show(FakeTasksBackend(listOf(rows[0])))
        rule.onNodeWithText("Revisar").assertIsDisplayed()
        rule.onNodeWithText("Rechazar").assertDoesNotExist()
        rule.onNodeWithText("Ver y aprobar").assertDoesNotExist()
    }

    @Test fun rejectAsksFirstWithTheNumberAndTheTitleThenRefuses() {
        val b = FakeTasksBackend(rows)
        show(b)
        rule.onNodeWithText("Rechazar").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("¿Rechazar la #46?").assertIsDisplayed()
        rule.onNodeWithText("«Migrar la base» (#46)", substring = true).assertIsDisplayed()
        assertTrue(b.calls.isEmpty())
        rule.onNodeWithText("Rechazar y cancelar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("decide 46 false h46"), b.calls)
    }

    @Test fun cancellingTheDialogSendsNothing() {
        val b = FakeTasksBackend(rows)
        show(b)
        rule.onNodeWithText("Rechazar").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Cancelar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.isEmpty())
        rule.onNodeWithText("¿Rechazar la #46?").assertDoesNotExist()
    }

    @Test fun rejectIsHiddenWhenThePcDoesNotTakeIt() {
        val b = FakeTasksBackend(rows)
        b.unavailable = setOf(ApiMethods.TASKS_APPROVE.name)
        show(b)
        rule.onNodeWithText("Rechazar").assertDoesNotExist()
        rule.onNodeWithText("Ver y aprobar").assertIsDisplayed()
    }

    // What the ☰ menu drives

    @Test fun theChipsCountTheSectionsAndNoneIsChosenAtFirst() {
        show(FakeTasksBackend(rows))
        val chips = rule.onNodeWithContentDescription("Secciones del tablero")
        chips.assertIsDisplayed()
        for ((name, n) in listOf("En cola" to "3", "Por aprobar" to "2", "En curso" to "1", "Incidencias" to "1")) {
            rule.onNode(hasText(name) and hasText(n) and isSelectable()).assertIsDisplayed().assertIsNotSelected()
        }
        // every section is drawn
        for (s in listOf("Por aprobar", "En curso", "En cola", "Incidencias")) rule.onAllNodesWithText(s).assertCountEquals(2)
    }

    @Test fun aChipShowsItsSectionAloneAndTheSameChipShowsThemAllAgain() {
        show(FakeTasksBackend(rows))
        rule.onNode(hasText("En curso") and isSelectable()).performClick()
        rule.waitForIdle()
        rule.onNode(hasText("En curso") and isSelectable()).assertIsSelected()
        rule.onNodeWithText("Ajustar estilos").assertIsDisplayed()
        rule.onNodeWithText("Probar push en el emulador").assertDoesNotExist()
        rule.onNodeWithText("Borrar build y reinstalar").assertDoesNotExist()
        rule.onNode(hasText("En curso") and isSelectable()).performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Probar push en el emulador").assertIsDisplayed()
        rule.onNode(hasText("En curso") and isSelectable()).assertIsNotSelected()
    }

    @Test fun aChosenSectionThatIsEmptyStillSaysSoWithItsHeading() {
        show(FakeTasksBackend(rows.filter { it.status != "failed" }))
        rule.onNode(hasText("Incidencias") and isSelectable()).performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Todo al día").assertDoesNotExist()
        rule.onNodeWithText("0").assertIsDisplayed()
    }

    @Test fun aRowThatAsksForTheOkSaysWhyInWords() {
        show(FakeTasksBackend(listOf(task(46, "Migrar la base", status = "awaiting_approval", reasons = listOf("destructive", "financial")))))
        rule.onNodeWithText("Espera tu OK: elimina datos, pagos").assertIsDisplayed()
    }
    @Test fun theViewsAddTheFinishedTasks() {
        show(FakeTasksBackend(rows))
        vm.setFilter(TaskFilter.All)
        rule.waitForIdle()
        rule.onNodeWithText("Ajustar el menú").assertIsDisplayed()
        rule.onNodeWithText("Completada").assertIsDisplayed()
        rule.onNodeWithText("Aceptada").assertIsDisplayed()
        rule.onNodeWithText("Ajustar estilos").assertIsDisplayed()
        vm.setFilter(TaskFilter.Done)
        rule.waitForIdle()
        rule.onNodeWithText("Ajustar el menú").assertIsDisplayed()
        rule.onNodeWithText("Ajustar estilos").assertDoesNotExist()
    }

    @Test fun searchOpensFromTheMenuAndListsThePcMatches() {
        val b = FakeTasksBackend(rows)
        b.searchResult = Result.success(listOf(dev.orb.app.ui.chats.SearchTask(40, "Pasarela sandbox", "done", "api-pagos", "…token…")))
        show(b)
        vm.openSearch()
        rule.waitForIdle()
        rule.onNodeWithText("Buscar en el título y el resultado").assertExists()
        rule.onNodeWithContentDescription("Buscar en el título y el resultado").performTextInput("pasar")
        rule.waitForIdle()
        assertTrue(b.searches.contains("pasar"))
        rule.onNodeWithText("#40 Pasarela sandbox").assertIsDisplayed()
    }

    @Test fun newTaskFormCreatesThroughThePc() {
        val b = FakeTasksBackend(rows)
        show(b)
        vm.openNewTask()
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Título").performTextInput("Probar")
        rule.onNodeWithContentDescription("Qué tiene que hacer").performTextInput("Arrancar la app")
        rule.onNodeWithText("Crear tarea").performClick()
        rule.waitForIdle()
        assertEquals(listOf("create api-pagos|Probar|Arrancar la app"), b.calls)
    }

    // The queue

    @Test fun pausedQueueShowsTheCardAndResumeAsksThePcThenOffersToGoBack() {
        val b = FakeTasksBackend(rows, paused = true)
        show(b)
        rule.onNodeWithText("Reanudar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("paused false"), b.calls)
        rule.onNodeWithText("Cola reanudada").assertIsDisplayed()
        rule.onNodeWithText("Deshacer").performClick()
        rule.waitForIdle()
        // going back pauses it again
        assertEquals(listOf("paused false", "paused true"), b.calls)
    }

    @Test fun pausingFromTheMenuAlsoOffersToGoBack() {
        val b = FakeTasksBackend(rows)
        show(b)
        vm.setPaused(true)
        rule.waitForIdle()
        assertEquals(listOf("paused true"), b.calls)
        rule.onNodeWithText("Deshacer").assertIsDisplayed()
        rule.onNodeWithText("Deshacer").performClick()
        rule.waitForIdle()
        assertEquals(listOf("paused true", "paused false"), b.calls)
    }

    @Test fun theCardIsHiddenWhenThePcCannotPause() {
        val b = FakeTasksBackend(rows, paused = true)
        b.unavailable = setOf(ApiMethods.CONTROL_RESUME.name)
        show(b)
        rule.onNodeWithText("Reanudar").assertDoesNotExist()
    }

    // States

    @Test fun anEmptyBoardSaysSo() {
        show(FakeTasksBackend())
        rule.onNodeWithText("No hay tareas").assertIsDisplayed()
        rule.onNodeWithText("Cuando Orbe o un agente creen una, aparecerá aquí.").assertIsDisplayed()
        // The chips stay under the header and the note sits right below them, not in the middle of the screen.
        val chips = rule.onNodeWithText("En cola").fetchSemanticsNode().positionInRoot.y
        val note = rule.onNodeWithText("No hay tareas").fetchSemanticsNode().positionInRoot.y
        assertTrue(chips < note)
        assertTrue(note < 400f)
    }

    @Test fun withNothingLeftToDoTheBoardIsUpToDate() {
        show(FakeTasksBackend(listOf(task(1, status = "done"))))
        rule.onNodeWithText("Todo al día").assertIsDisplayed()
        rule.onNodeWithText("Ver todas").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Completadas").assertIsDisplayed()
    }

    @Test fun aFailedFirstReadShowsTheErrorWithRetry() {
        val b = FakeTasksBackend()
        b.listResult = Result.failure(dev.orb.app.link.net.LinkException(dev.orb.app.link.net.LinkError.Offline))
        show(b)
        rule.onNodeWithText("No se pudieron cargar las tareas desde el PC.").assertIsDisplayed()
        rule.onNodeWithText("Reintentar").assertIsDisplayed()
    }

    @Test fun withoutTheLinkTheSavedBoardIsReadWithTheStrip() {
        val b = FakeTasksBackend()
        b.connectionState.value = ConnectionState.Offline(null, null)
        b.listResult = Result.failure(dev.orb.app.link.net.LinkException(dev.orb.app.link.net.LinkError.Offline))
        b.savedFlow.value = TasksData(rows, paused = false)
        show(b)
        rule.onNodeWithText("Ajustar estilos").assertIsDisplayed()
        rule.onNodeWithText("Sin conexión con el PC", substring = true).assertIsDisplayed()
        // refusing needs the PC: the button is there but cannot be used
        rule.onNodeWithText("Rechazar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.isEmpty())
    }

    @Test fun whileTheFirstReadIsUnderWayNothingIsDrawnButTheHeader() {
        val b = FakeTasksBackend()
        b.listGate = kotlinx.coroutines.CompletableDeferred()
        show(b)
        rule.onNodeWithText("Tareas").assertIsDisplayed()
        rule.onNodeWithText("No hay tareas").assertDoesNotExist()
    }
}

package dev.orb.app.ui.menu

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.link.net.PcVersions
import dev.orb.app.ui.tasks.TaskFilter
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.OrbPaletteChoice
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

class FakeActivityBackend : ActivityBackend {
    val connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Online("http://pc", "PC", PcVersions(1, 1, "3.8.4")))
    override val connection get() = connectionState
    var unavailable: Set<String> = emptySet()
    var events: Result<List<ActivityEvent>> = Result.success(
        listOf(ActivityEvent(2, "task_created", "usuario", "Revisar", "2026-11-12T08:00:00Z", 5, "Revisar dependencias"), ActivityEvent(1, "weird_kind", "orb", "", null, null, null)),
    )
    var logs: Result<List<LogInfo>> = Result.success(listOf(LogInfo("general", 2048), LogInfo("app-movil", 100)))
    var logText: Result<String> = Result.success("### entrada uno")
    val calls = ArrayList<String>()

    val savedActivity = MutableStateFlow<SavedActivity?>(null)
    override fun saved() = savedActivity.filterNotNull()
    var eventsGate: kotlinx.coroutines.CompletableDeferred<Unit>? = null

    override fun available(m: ApiMethod) = m.name !in unavailable
    override suspend fun events(limit: Int): Result<List<ActivityEvent>> { calls += "events $limit"; eventsGate?.await(); return events }
    override suspend fun logs() = logs
    override suspend fun readLog(name: String): Result<String> { calls += "read $name"; return logText }
}

@OptIn(ExperimentalCoroutinesApi::class)
class ActivityViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)
    @After fun tearDown() = Dispatchers.resetMain()

    private fun TestScope.vm(b: FakeActivityBackend): ActivityViewModel {
        val vm = ActivityViewModel(b)
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        return vm
    }

    @Test fun parserReadsEventsAndLogs() {
        val e = ActivityParser.events(Json.parseToJsonElement("""[{"id":4,"task_id":9,"actor":"orb","kind":"note","detail":"x","at":"2026-01-01T10:00:00Z","title":"T"},{"x":1}]""")).single()
        assertEquals(9L, e.taskId)
        assertEquals("T", e.taskTitle)
        assertEquals(listOf(LogInfo("general", 12)), ActivityParser.logs(Json.parseToJsonElement("""[{"name":"general","size":12},{"size":1}]""")))
        assertEquals("Tarea creada", MenuTexts.kind("task_created"))
        assertEquals("Weird kind", MenuTexts.kind("weird_kind"))
    }

    private val old = ActivityEvent(7, "note", "orb", "viejo", null, null, null)

    @Test fun savedActivityShowsFirstAndGivesWayToThePcAnswer() = runTest(dispatcher) {
        val b = FakeActivityBackend()
        b.eventsGate = kotlinx.coroutines.CompletableDeferred()
        b.savedActivity.value = SavedActivity(listOf(old), listOf(LogInfo("viejo", 1)))
        val vm = vm(b)
        assertEquals(listOf(7L), vm.state.value.events?.map { it.id })
        b.eventsGate!!.complete(Unit)
        advanceUntilIdle()
        assertEquals(listOf(2L, 1L), vm.state.value.events?.map { it.id })
        assertEquals(listOf("general", "app-movil"), vm.state.value.logs?.map { it.name })
        // A later copy of the cache (the answer saved) must not undo the answer.
        b.savedActivity.value = SavedActivity(listOf(old), listOf(LogInfo("viejo", 1)))
        advanceUntilIdle()
        assertEquals(listOf(2L, 1L), vm.state.value.events?.map { it.id })
    }

    @Test fun whenTheNetworkFailsTheSavedCopyStaysAndIsFlagged() = runTest(dispatcher) {
        val b = FakeActivityBackend()
        b.events = Result.failure(LinkException(LinkError.Timeout))
        b.savedActivity.value = SavedActivity(listOf(old), null)
        val vm = vm(b)
        advanceUntilIdle()
        assertEquals(listOf(7L), vm.state.value.events?.map { it.id })
        assertTrue(vm.state.value.eventsFailed)
    }

    @Test fun loadsEventsAndLogsOnConnect() = runTest(dispatcher) {
        val b = FakeActivityBackend()
        val vm = vm(b)
        advanceUntilIdle()
        assertEquals(2, vm.state.value.events?.size)
        assertEquals(2, vm.state.value.logs?.size)
        assertEquals("events 100", b.calls.first())
    }

    @Test fun openingALogReadsItAndClosingGoesBack() = runTest(dispatcher) {
        val b = FakeActivityBackend()
        val vm = vm(b)
        advanceUntilIdle()
        vm.openLog(LogInfo("general", 2048))
        advanceUntilIdle()
        assertEquals("### entrada uno", vm.state.value.log?.text)
        vm.closeLog()
        runCurrent()
        assertNull(vm.state.value.log)
    }

    @Test fun aLogThePcCannotReadShowsItsError() = runTest(dispatcher) {
        val b = FakeActivityBackend()
        b.logText = Result.failure(LinkException(LinkError.Timeout))
        val vm = vm(b)
        advanceUntilIdle()
        vm.openLog(LogInfo("general", 1))
        advanceUntilIdle()
        assertNull(vm.state.value.log?.text)
        assertTrue(vm.state.value.log?.failed?.isNotEmpty() == true)
    }

    @Test fun withoutActivityTheLogsTabIsTheOneShown() = runTest(dispatcher) {
        val b = FakeActivityBackend()
        b.unavailable = setOf(ApiMethods.ACTIVITY_LIST.name)
        val vm = vm(b)
        advanceUntilIdle()
        assertEquals(ActivityTab.Logs, vm.state.value.tab)
        assertTrue(b.calls.none { it.startsWith("events") })
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class MenuScreensTest {
    @get:Rule val rule = createComposeRule()

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    private val online = ConnectionState.Online("http://100.101.102.103:4310", "DanLaptop", PcVersions(4, 2, "3.8.8"))

    private fun menu(
        connection: ConnectionState = online, pc: String? = "DanLaptop", unreadChats: Int = 3, tasksToApprove: Int = 1,
        schedules: Boolean = true, activity: Boolean = true, usage: Boolean = true, whiteboard: Boolean = true, dark: Boolean? = false,
        inbox: InboxMenu? = null, tasks: TasksMenu? = null,
    ) = MenuState(pc, connection, unreadChats, tasksToApprove, schedules, activity, usage, whiteboard, dark, inbox, tasks)

    private fun showMenu(state: MenuState, actions: MenuActions) {
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { MenuContent(state, actions, close = {}) } }
        rule.waitForIdle()
    }

    private fun showSheet(state: MenuState, actions: MenuActions = MenuActions()) {
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { MenuSheet(state, actions, onDismiss = {}) } }
        rule.waitForIdle()
    }

    @Test fun theMenuDrawsTheMockupsRowsWithTheNumbersOfTheBottomBar() {
        showMenu(menu(), MenuActions())
        for (t in listOf("Chats", "Tareas", "Proyectos", "Programadas", "Pizarra", "Memorias y actividad", "Uso y agentes", "Juegos", "Tutoriales", "Este móvil", "Modo oscuro")) {
            rule.onNodeWithText(t).performScrollTo().assertIsDisplayed()
        }
        rule.onNodeWithText("3").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("1").performScrollTo().assertIsDisplayed()
        // The three local views say so.
        assertEquals(3, rule.onAllNodesWithText("Vista del móvil").fetchSemanticsNodes().size)
    }

    @Test fun whatTheMockupDoesNotDrawLeftTheSheet() {
        showMenu(menu(), MenuActions())
        for (t in listOf("Notificaciones", "Apariencia", "Prueba de conexión", "Desenlazar este móvil", "Desvincular este móvil")) rule.onNodeWithText(t).assertDoesNotExist()
    }

    @Test fun theHeaderTellsHowTheLinkStandsWhenConnected() {
        showSheet(menu())
        rule.onNodeWithText("Conectado").assertIsDisplayed()
        // The address is Tailscale's range.
        rule.onNodeWithText("DanLaptop · Tailscale").assertIsDisplayed()
    }

    @Test fun theHeaderTellsWhyThereIsNoConnectionWhenOffline() {
        showSheet(menu(connection = ConnectionState.Offline(null, null)))
        rule.onNodeWithText("Sin conexión").assertIsDisplayed()
        rule.onNodeWithText("DanLaptop · apagado o fuera de alcance").assertIsDisplayed()
    }

    @Test fun theStatusLineNamesTheWayToThePc() {
        fun line(base: String) = menuStatusLine(menu(connection = ConnectionState.Online(base, "PC", PcVersions(1, 1, "1"))))
        assertEquals("DanLaptop · Tailscale", line("http://dan.tail1234.ts.net"))
        assertEquals("DanLaptop · Red local", line("http://192.168.1.20:4310"))
        assertEquals("DanLaptop · Internet", line("https://orb.example.com"))
        assertEquals("PC · apagado o fuera de alcance", menuStatusLine(menu(connection = ConnectionState.Offline(null, null), pc = null)))
    }

    @Test fun entriesTheLinkedPcCannotServeAreLeftOut() {
        showMenu(menu(schedules = false, activity = false, usage = false, whiteboard = false), MenuActions())
        for (t in listOf("Programadas", "Memorias y actividad", "Uso y agentes", "Pizarra")) rule.onNodeWithText(t).assertDoesNotExist()
        rule.onNodeWithText("Chats").assertIsDisplayed()
    }

    @Test fun eachEntryClosesTheMenuAndGoesToItsScreen() {
        val got = ArrayList<String>()
        var closed = 0
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                MenuContent(
                    menu(),
                    MenuActions(
                        onChats = { got += "chats" }, onTasks = { got += "tasks" }, onProjects = { got += "projects" },
                        onSchedules = { got += "schedules" }, onActivity = { got += "activity" }, onUsage = { got += "usage" }, onWhiteboard = { got += "whiteboard" },
                        onGames = { got += "games" }, onTutorials = { got += "tutorials" }, onThisPhone = { got += "thisphone" },
                    ),
                    close = { closed++ },
                )
            }
        }
        for (t in listOf("Chats", "Tareas", "Proyectos", "Programadas", "Memorias y actividad", "Uso y agentes", "Pizarra", "Juegos", "Tutoriales", "Este móvil")) {
            rule.onNodeWithText(t).performScrollTo().performClick()
        }
        rule.waitForIdle()
        assertEquals(listOf("chats", "tasks", "projects", "schedules", "activity", "usage", "whiteboard", "games", "tutorials", "thisphone"), got)
        assertEquals(10, closed)
    }

    @Test fun theDarkModeSwitchForcesTheOppositeOfWhatIsOnScreen() {
        val got = ArrayList<Boolean>()
        var closed = 0
        var dark by mutableStateOf(false)
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) { MenuContent(menu(dark = dark), MenuActions(onDark = { got += it; dark = it }), close = { closed++ }) }
        }
        rule.onNode(isToggleable()).performScrollTo().assertIsOff().performClick()
        rule.waitForIdle()
        assertEquals(listOf(true), got)
        rule.onNode(isToggleable()).assertIsOn().performClick()
        assertEquals(listOf(true, false), got)
        // the sheet stays open so the change can be seen
        assertEquals(0, closed)
    }

    @Test fun withoutAThemeThereIsNoDarkModeSwitch() {
        showMenu(menu(dark = null), MenuActions())
        rule.onNodeWithText("Modo oscuro").assertDoesNotExist()
    }

    @Test fun moreOptionsGoLastAndKeepTheOrderingAndTheSummary() {
        val got = ArrayList<String>()
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                MenuContent(
                    menu(inbox = InboxMenu(priority = true, canDigest = true)),
                    MenuActions(onPriority = { got += "priority" }, onReorder = { got += "reorder" }, onDigest = { got += "digest" }),
                    close = {},
                )
            }
        }
        for (t in listOf("Más opciones", "Ordenar por prioridad", "Activado", "Resumen del día", dev.orb.app.ui.chats.InboxTexts.current().reorder)) {
            rule.onNodeWithText(t).performScrollTo().assertIsDisplayed()
        }
        for (t in listOf("Ordenar por prioridad", dev.orb.app.ui.chats.InboxTexts.current().reorder, "Resumen del día")) rule.onNodeWithText(t).performScrollTo().performClick()
        assertEquals(listOf("priority", "reorder", "digest"), got)
    }

    @Test fun moreOptionsOfferOnlyWhatTheListCanDo() {
        showMenu(menu(inbox = InboxMenu(priority = false, canDigest = false)), MenuActions())
        rule.onNodeWithText("Desactivado").performScrollTo().assertIsDisplayed()
        for (t in listOf(dev.orb.app.ui.chats.InboxTexts.current().reorder, "Resumen del día")) rule.onNodeWithText(t).assertDoesNotExist()
    }

    private fun showTasksMenu(tasks: TasksMenu, got: ArrayList<String> = ArrayList()) {
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                MenuContent(
                    menu(tasks = tasks),
                    MenuActions(
                        onTasksSearch = { got += "search" }, onTasksNew = { got += "new" }, onTasksPause = { got += "pause" },
                        onTasksView = { got += "view ${it.name}" },
                    ),
                    close = { got += "closed" },
                )
            }
        }
        rule.waitForIdle()
    }

    @Test fun moreOptionsOfferTheBoardsSearchNewTaskPauseAndTheOtherViews() {
        val got = ArrayList<String>()
        showTasksMenu(TasksMenu(TaskFilter.Active, canCreate = true, canPause = true), got)
        for (t in listOf("Más opciones", "Buscar tareas", "Nueva tarea", "Pausar la cola", "Ver tareas completadas", "Ver todas las tareas")) {
            rule.onNodeWithText(t).performScrollTo().assertIsDisplayed()
        }
        rule.onNodeWithText("Ver tareas activas").assertDoesNotExist()
        for (t in listOf("Buscar tareas", "Nueva tarea", "Pausar la cola", "Ver tareas completadas", "Ver todas las tareas")) rule.onNodeWithText(t).performScrollTo().performClick()
        // each entry closes the menu first, then does its own thing
        assertEquals(
            listOf("closed", "search", "closed", "new", "closed", "pause", "closed", "view Done", "closed", "view All"),
            got,
        )
    }

    @Test fun theBoardsEntriesThePcCannotServeAreLeftOut() {
        showTasksMenu(TasksMenu(TaskFilter.Active, canCreate = false, canPause = false))
        rule.onNodeWithText("Buscar tareas").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("Nueva tarea").assertDoesNotExist()
        rule.onNodeWithText("Pausar la cola").assertDoesNotExist()
    }

    @Test fun fromTheFinishedViewTheMenuOffersTheOtherTwo() {
        showTasksMenu(TasksMenu(TaskFilter.Done, canCreate = true, canPause = true))
        rule.onNodeWithText("Ver tareas activas").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("Ver todas las tareas").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("Ver tareas completadas").assertDoesNotExist()
    }

    @Test fun withoutTheListThereIsNoMoreOptions() {
        showMenu(menu(), MenuActions())
        rule.onNodeWithText("Más opciones").assertDoesNotExist()
    }

    @Test fun tutorialsOffersEveryTutorialAndFaqWithoutAConnection() {
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { TutorialsScreen(onBack = {}) } }
        rule.waitForIdle()
        rule.onNodeWithText("Primeros pasos").assertIsDisplayed()
        rule.onNodeWithText("Cómo funciona").assertIsDisplayed()
        // Nothing for the PC alone, no keyboard shortcuts.
        for (t in listOf("Atajos de teclado", "Repetir el tutorial guiado")) rule.onNodeWithText(t).assertDoesNotExist()
        assertEquals(16, TutorialTexts.FAQS.size)
        assertTrue(TutorialTexts.TUTORIALS.none { it.id in setOf("agents", "usage", "expert", "games", "looks", "tabs", "copy", "accounts", "dictation", "reset", "android") })
        assertTrue((TutorialTexts.TUTORIALS.flatMap { it.lines } + TutorialTexts.FAQS.map { it.answer }).none { it.contains("Avisos") })
    }

    @Test fun aTutorialCardOpensAndFoldsAgain() {
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { TutorialsScreen(onBack = {}) } }
        val firstLine = TutorialTexts.named(TutorialTexts.TUTORIALS.first().lines.first())
        rule.onNodeWithText("•  $firstLine").assertDoesNotExist()
        rule.onNodeWithText("Primeros pasos").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("•  $firstLine").assertIsDisplayed()
        rule.onNodeWithText("Primeros pasos").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("•  $firstLine").assertDoesNotExist()
    }

    @Test fun searchIgnoresAccentsAndCaseAndSaysWhenNothingMatches() {
        assertTrue(TutorialSearch.tutorials("BITACORA").any { it.id == "logs" })
        assertEquals(TutorialTexts.TUTORIALS.size, TutorialSearch.tutorials("  ").size)
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { TutorialsScreen(onBack = {}) } }
        rule.onNode(hasSetTextAction()).performTextInput("zzzqq")
        rule.waitForIdle()
        rule.onNodeWithText("No hay resultados para «zzzqq».").assertIsDisplayed()
    }

    private fun showActivity(b: FakeActivityBackend) {
        val vm = ActivityViewModel(b)
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { ActivityScreen(vm, onBack = {}) } }
        rule.waitForIdle()
    }

    @Test fun activityShowsEventsAndLogsOpenAsText() {
        showActivity(FakeActivityBackend())
        rule.onNodeWithText("Tarea creada").assertIsDisplayed()
        rule.onNodeWithText("Bitácoras").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("general").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("### entrada uno").assertIsDisplayed()
    }
}

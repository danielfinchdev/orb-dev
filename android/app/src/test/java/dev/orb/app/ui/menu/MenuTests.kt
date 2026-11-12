package dev.orb.app.ui.menu

import androidx.compose.ui.test.assertIsDisplayed
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
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.ThemeChoice
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

    private fun showMenu(state: MenuState, actions: MenuActions) {
        rule.setContent { OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { MenuContent(state, actions, close = {}) } }
        rule.waitForIdle()
    }

    @Test fun menuKeepsAppearanceLinkTestAndUnlinkAndAddsTheNewEntries() {
        showMenu(MenuState("Conectado a PC", unreadNotices = 3), MenuActions())
        for (t in listOf("Conectado a PC", "Notificaciones", "Programadas", "Memorias y actividad", "Uso y agentes", "Pizarra", "Juegos", "Tutoriales", "Este móvil", "Apariencia", "Prueba de conexión", "Desenlazar este móvil")) {
            rule.onNodeWithText(t).performScrollTo().assertIsDisplayed()
        }
        rule.onNodeWithText("3").performScrollTo().assertIsDisplayed()
    }

    @Test fun entriesTheLinkedPcCannotServeAreLeftOut() {
        showMenu(MenuState("PC", showSchedules = false, showActivity = false, showUsage = false, showWhiteboard = false), MenuActions())
        for (t in listOf("Programadas", "Memorias y actividad", "Uso y agentes", "Pizarra")) rule.onNodeWithText(t).assertDoesNotExist()
        rule.onNodeWithText("Notificaciones").assertIsDisplayed()
    }

    @Test fun eachEntryClosesTheMenuAndGoesToItsScreen() {
        val got = ArrayList<String>()
        var closed = 0
        rule.setContent {
            OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) {
                MenuContent(
                    MenuState("PC"),
                    MenuActions(
                        onNotices = { got += "notices" }, onSchedules = { got += "schedules" }, onActivity = { got += "activity" }, onUsage = { got += "usage" }, onWhiteboard = { got += "whiteboard" }, onGames = { got += "games" }, onTutorials = { got += "tutorials" },
                        onAppearance = { got += "appearance" }, onLinkTest = { got += "linktest" }, onUnlink = { got += "unlink" },
                    ),
                    close = { closed++ },
                )
            }
        }
        for (t in listOf("Notificaciones", "Programadas", "Memorias y actividad", "Uso y agentes", "Pizarra", "Juegos", "Tutoriales", "Apariencia", "Prueba de conexión", "Desenlazar este móvil")) {
            rule.onNodeWithText(t).performScrollTo().performClick()
        }
        rule.waitForIdle()
        assertEquals(listOf("notices", "schedules", "activity", "usage", "whiteboard", "games", "tutorials", "appearance", "linktest", "unlink"), got)
        assertEquals(10, closed)
    }

    @Test fun tutorialsOffersEveryTutorialAndFaqWithoutAConnection() {
        rule.setContent { OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { TutorialsScreen(onBack = {}) } }
        rule.waitForIdle()
        rule.onNodeWithText("Primeros pasos").assertIsDisplayed()
        rule.onNodeWithText("Cómo funciona").assertIsDisplayed()
        // Nothing for the PC alone, no keyboard shortcuts.
        for (t in listOf("Atajos de teclado", "Repetir el tutorial guiado")) rule.onNodeWithText(t).assertDoesNotExist()
        assertEquals(17, TutorialTexts.FAQS.size)
        assertTrue(TutorialTexts.TUTORIALS.none { it.id in setOf("agents", "usage", "expert", "games", "looks") })
        assertTrue((TutorialTexts.TUTORIALS.flatMap { it.lines } + TutorialTexts.FAQS.map { it.answer }).none { it.contains("Avisos") })
    }

    @Test fun aTutorialCardOpensAndFoldsAgain() {
        rule.setContent { OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { TutorialsScreen(onBack = {}) } }
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
        rule.setContent { OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { TutorialsScreen(onBack = {}) } }
        rule.onNodeWithText("Buscar en los tutoriales…").performTextInput("zzzqq")
        rule.waitForIdle()
        rule.onNodeWithText("No hay resultados para «zzzqq».").assertIsDisplayed()
    }

    private fun showActivity(b: FakeActivityBackend) {
        val vm = ActivityViewModel(b)
        rule.setContent { OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { ActivityScreen(vm, onBack = {}) } }
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

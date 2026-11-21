package dev.orb.app.ui.projects

import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ProjectsViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = kotlinx.coroutines.Dispatchers.setMain(dispatcher)
    @After fun tearDown() = kotlinx.coroutines.Dispatchers.resetMain()

    private fun TestScope.vm(b: FakeProjectsBackend): ProjectsViewModel {
        val vm = ProjectsViewModel(b, reloadDebounceMs = 300)
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        return vm
    }

    private val list = listOf(
        project("app-movil", "android", active = true, open = 2),
        project("api-pagos", "web"),
        project("tienda-online", "web"),
    )
    private val done = listOf(FinishedProject("k1", "viejo", "web", "2026-10-01T10:00:00Z"))

    @Test fun parserReadsTheListApprovalsAndFinished() {
        val l = Json.parseToJsonElement("""[{"name":"a","category":"web","active":true,"open":3,"path":"C:/a"},{"x":1}]""")
        val items = ProjectsParser.list(l, mapOf("a" to 2))
        assertEquals(1, items.size)
        assertEquals(ProjectItem("a", "web", true, 3, approve = 2), items[0])
        assertEquals(0, ProjectsParser.list(l)[0].approve)
        val f = ProjectsParser.finished(Json.parseToJsonElement("""[{"key":"k","name":"n","category":null,"at":"2026-01-01"}]"""))
        assertEquals(listOf(FinishedProject("k", "n", null, "2026-01-01")), f)
    }

    @Test fun parserTakesGitOnlyFromRowsThatCameWithChanges() {
        val l = Json.parseToJsonElement(
            """[{"name":"a","branch":"dev","changes":2},{"name":"b","branch":null,"changes":0},{"name":"c"},{"name":"d","branch":"main"}]""",
        )
        assertEquals(mapOf("a" to ProjectGit("dev", 2, null, null), "b" to ProjectGit(null, 0, null, null)), ProjectsParser.git(l))
    }

    @Test fun gitLineSaysBranchAndChangesAndStaysOutWithoutData() {
        assertEquals("dev · 2 archivos sin confirmar", ProjectTexts.gitLine(ProjectGit("dev", 2, null, null)))
        assertEquals("main · al día", ProjectTexts.gitLine(ProjectGit("main", 0, null, null)))
        assertEquals("main · 1 archivo sin confirmar", ProjectTexts.gitLine(ProjectGit("main", 1, null, null)))
        assertEquals("HEAD suelto · 3 archivos sin confirmar", ProjectTexts.gitLine(ProjectGit(null, 3, null, null)))
        assertNull(ProjectTexts.gitLine(null))
        assertNull(ProjectTexts.gitLine(ProjectGit("main", null, null, null)))
    }

    @Test fun approvalsCountTheTasksWaitingForAnOkPerProject() {
        val rows = listOf(
            dev.orb.app.ui.tasks.task(1, status = "awaiting_approval", project = "App-Movil"),
            dev.orb.app.ui.tasks.task(2, status = "awaiting_approval", project = "app-movil"),
            dev.orb.app.ui.tasks.task(3, status = "running", project = "app-movil"),
            dev.orb.app.ui.tasks.task(4, status = "awaiting_approval", project = null),
        )
        assertEquals(mapOf("app-movil" to 2), ProjectsParser.approvals(rows))
    }

    @Test fun savedProjectsShowWhileThePcIsUnreachableAndTheFreshAnswerWins() = runTest(dispatcher) {
        val off = FakeProjectsBackend().also {
            it.connectionState.value = ConnectionState.Offline(null, null)
            it.savedFlow.value = ProjectsData(list, done)
        }
        val offline = vm(off)
        assertEquals(3, offline.state.value.projects.size)
        assertTrue(offline.state.value.loaded)
        assertFalse(offline.state.value.online)

        val on = FakeProjectsBackend(listOf(list[0]), done).also { it.savedFlow.value = ProjectsData(list, done) }
        val fresh = vm(on)
        assertEquals(1, fresh.state.value.projects.size)
        on.savedFlow.value = ProjectsData(list + project("otro", "web"), done)
        runCurrent()
        assertEquals(1, fresh.state.value.projects.size)
    }

    @Test fun loadsOnStartAndListsCategories() = runTest(dispatcher) {
        val b = FakeProjectsBackend(list, done)
        val vm = vm(b)
        advanceUntilIdle()
        val s = vm.state.value
        assertTrue(s.loaded)
        assertEquals(3, s.projects.size)
        assertEquals(listOf("android", "web"), s.categories)
        assertEquals(1, s.finished.size)
    }

    @Test fun theGitLineCompletesTheCardsWhenItArrivesAndNeverHoldsTheListBack() = runTest(dispatcher) {
        val b = FakeProjectsBackend(list, done)
        b.gitGate = CompletableDeferred()
        b.gitResult = Result.success(mapOf("app-movil" to ProjectGit("dev", 2, null, null), "api-pagos" to ProjectGit("main", 0, null, null)))
        val vm = vm(b)
        advanceUntilIdle()
        assertTrue(vm.state.value.loaded)
        assertEquals(3, vm.state.value.projects.size)
        assertTrue(vm.state.value.projects.all { it.git == null })
        b.gitGate!!.complete(Unit)
        advanceUntilIdle()
        val byName = vm.state.value.projects.associateBy { it.name }
        assertEquals("dev", byName["app-movil"]?.git?.branch)
        assertEquals(0, byName["api-pagos"]?.git?.changes)
        assertNull(byName["tienda-online"]?.git)
    }

    @Test fun anOlderPcIsNeverAskedForGit() = runTest(dispatcher) {
        val b = FakeProjectsBackend(list, done).also { it.gitReadable = false }
        val vm = vm(b)
        advanceUntilIdle()
        assertEquals(0, b.gitCount)
        assertTrue(vm.state.value.projects.all { it.git == null })
    }

    @Test fun aFailedGitReadLeavesTheCardsWithoutALine() = runTest(dispatcher) {
        val b = FakeProjectsBackend(list, done).also { it.gitResult = Result.failure(LinkException(LinkError.Timeout)) }
        val vm = vm(b)
        advanceUntilIdle()
        assertEquals(1, b.gitCount)
        assertEquals(3, vm.state.value.projects.size)
        assertTrue(vm.state.value.projects.all { it.git == null })
        assertFalse(vm.state.value.loadFailed)
    }

    @Test fun newProjectOffersTheMockupsCategoriesAndTheFreeOnesOfThePc() = runTest(dispatcher) {
        val b = FakeProjectsBackend(list + project("raro", "rust"), listOf(FinishedProject("k", "viejo", "godot", null)))
        val vm = vm(b)
        advanceUntilIdle()
        assertEquals(listOf("web", "android", "windows", "linux", "ios", "multi", "rust", "godot"), vm.state.value.newCategories)
        assertEquals(listOf("web", "android", "windows", "linux", "ios", "multi"), vm(FakeProjectsBackend()).state.value.newCategories)
    }

    @Test fun aCategoryFilterNarrowsTheGridAndFallsBackWhenEmpty() = runTest(dispatcher) {
        val b = FakeProjectsBackend(list, done)
        val vm = vm(b)
        advanceUntilIdle()
        vm.setFilter(ProjectFilter.Category("web"))
        advanceUntilIdle()
        assertEquals(listOf("api-pagos", "tienda-online"), vm.state.value.projects.map { it.name })
        vm.setFilter(ProjectFilter.Category("linux"))
        advanceUntilIdle()
        assertEquals(ProjectFilter.Active, vm.state.value.filter)
    }

    @Test fun finishedIsHiddenWhenThePcCannotListThem() = runTest(dispatcher) {
        val b = FakeProjectsBackend(list, done)
        b.unavailable = setOf(ApiMethods.PROJECTS_FINISHED.name)
        val vm = vm(b)
        advanceUntilIdle()
        assertFalse(vm.state.value.canSeeFinished)
        vm.setFilter(ProjectFilter.Finished)
        advanceUntilIdle()
        assertEquals(ProjectFilter.Active, vm.state.value.filter)
    }

    @Test fun activatingAsksThePcAndReloads() = runTest(dispatcher) {
        val b = FakeProjectsBackend(list)
        val vm = vm(b)
        advanceUntilIdle()
        val before = b.listCount
        vm.toggleActive(list[1])
        advanceUntilIdle()
        assertEquals(listOf("active api-pagos"), b.calls)
        assertTrue(b.listCount > before)
        vm.toggleActive(list[0])
        advanceUntilIdle()
        assertEquals("active null", b.calls.last())
    }

    @Test fun aSecondTapWhileBusyIsIgnored() = runTest(dispatcher) {
        val b = FakeProjectsBackend(list, done)
        val gate = CompletableDeferred<Unit>()
        b.gate = gate
        val vm = vm(b)
        advanceUntilIdle()
        vm.reopen(done[0])
        vm.reopen(done[0])
        vm.toggleActive(list[1])
        runCurrent()
        assertEquals(listOf("reopen k1"), b.calls)
        gate.complete(Unit)
        advanceUntilIdle()
        assertFalse(vm.state.value.busy)
    }

    @Test fun offlineActionsAreRefusedWithoutCallingThePc() = runTest(dispatcher) {
        val b = FakeProjectsBackend(list, done)
        val vm = vm(b)
        advanceUntilIdle()
        b.connectionState.value = ConnectionState.Offline(null, null)
        advanceUntilIdle()
        vm.reopen(done[0])
        advanceUntilIdle()
        assertTrue(b.calls.isEmpty())
    }

    @Test fun createSendsTrimmedValuesAndClosesTheForm() = runTest(dispatcher) {
        val b = FakeProjectsBackend(list)
        val vm = vm(b)
        advanceUntilIdle()
        vm.openNewProject()
        vm.createProject("  nuevo ", "web", " notas ")
        advanceUntilIdle()
        assertEquals(listOf("create nuevo|web|notas"), b.calls)
        assertNull(vm.state.value.newProject)
    }

    @Test fun aFailedCreateKeepsTheFormWithThePcsError() = runTest(dispatcher) {
        val b = FakeProjectsBackend(list)
        b.actionResult = Result.failure(LinkException(LinkError.Timeout))
        val vm = vm(b)
        advanceUntilIdle()
        vm.openNewProject()
        vm.createProject("nuevo", null, "")
        advanceUntilIdle()
        val n = vm.state.value.newProject!!
        assertFalse(n.saving)
        assertTrue(n.error != null)
    }

    @Test fun createIsHiddenWhenThePcCannotCreate() = runTest(dispatcher) {
        val b = FakeProjectsBackend(list)
        b.unavailable = setOf(ApiMethods.PROJECTS_CREATE.name)
        val vm = vm(b)
        advanceUntilIdle()
        vm.openNewProject()
        assertNull(vm.state.value.newProject)
        assertFalse(vm.state.value.canCreate)
    }
}

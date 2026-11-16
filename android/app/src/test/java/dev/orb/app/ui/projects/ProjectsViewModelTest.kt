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

    @Test fun parserReadsTheListIconsAndFinished() {
        val l = Json.parseToJsonElement("""[{"name":"a","category":"web","active":true,"open":3,"path":"C:/a"},{"x":1}]""")
        val icons = Json.parseToJsonElement("""{"a":"data:image/png;base64,AAAA","b":"nope"}""") as JsonObject
        val items = ProjectsParser.list(l, icons)
        assertEquals(1, items.size)
        assertEquals(ProjectItem("a", "web", true, 3, "data:image/png;base64,AAAA"), items[0])
        assertNull(ProjectsParser.list(l, null)[0].icon)
        val f = ProjectsParser.finished(Json.parseToJsonElement("""[{"key":"k","name":"n","category":null,"at":"2026-01-01"}]"""))
        assertEquals(listOf(FinishedProject("k", "n", null, "2026-01-01")), f)
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

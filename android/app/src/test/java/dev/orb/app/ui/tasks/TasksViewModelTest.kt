package dev.orb.app.ui.tasks

import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.LinkException
import dev.orb.app.ui.chats.SearchTask
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonNull
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TasksViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = kotlinx.coroutines.Dispatchers.setMain(dispatcher)
    @After fun tearDown() = kotlinx.coroutines.Dispatchers.resetMain()

    private fun TestScope.vm(b: FakeTasksBackend): TasksViewModel {
        val vm = TasksViewModel(b, reloadDebounceMs = 300, searchDebounceMs = 300)
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        return vm
    }

    private val mixed = listOf(
        task(5, status = "queued", waiting = TaskWait("paused", null, emptyList())),
        task(4, status = "queued"),
        task(3, status = "awaiting_approval"),
        task(2, status = "running"),
        task(1, status = "failed"),
        task(0, status = "blocked", held = TaskHeld("ha eliminado 3 archivos", "C:/p")),
        task(9, status = "done", result = "Listo el cambio"),
    )

    @Test fun savedBoardShowsWhileThePcIsUnreachable() = runTest(dispatcher) {
        val b = FakeTasksBackend()
        b.connectionState.value = ConnectionState.Offline(null, null)
        b.savedFlow.value = TasksData(listOf(task(1), task(2, status = "done")), paused = false)
        val vm = vm(b)
        assertEquals(2, vm.state.value.total)
        assertTrue(vm.state.value.loaded)
        assertFalse(vm.state.value.online)
    }

    @Test fun theFreshAnswerWinsOverTheSavedBoard() = runTest(dispatcher) {
        val b = FakeTasksBackend(listOf(task(7)))
        b.savedFlow.value = TasksData(listOf(task(1), task(2)), paused = false)
        val vm = vm(b)
        assertEquals(1, vm.state.value.total)
        // A later cache write that follows the answer must not bring older rows back.
        b.savedFlow.value = TasksData(listOf(task(1), task(2), task(3)), paused = false)
        runCurrent()
        assertEquals(1, vm.state.value.total)
    }

    @Test fun readsTheBoardOnceWhenOnlineAndCountsTheFilters() = runTest(dispatcher) {
        val b = FakeTasksBackend(mixed, paused = true)
        val vm = vm(b)
        val s = vm.state.value
        assertEquals(1, b.listCount)
        assertEquals(7, s.total)
        assertEquals(2, s.queued)
        assertEquals(2, s.approve) // awaiting approval + held for review
        assertEquals(1, s.running)
        assertEquals(1, s.problems) // the held one is not a problem, it needs a decision
        assertTrue(s.paused)
        assertEquals(1, s.waitingPaused)
        assertTrue(s.loaded)
    }

    @Test fun filtersNarrowTheList() = runTest(dispatcher) {
        val vm = vm(FakeTasksBackend(mixed))
        vm.setFilter(TaskFilter.Approve)
        runCurrent()
        assertEquals(setOf(3L, 0L), vm.state.value.tasks.map { it.id }.toSet())
        vm.setFilter(TaskFilter.Done)
        runCurrent()
        assertEquals(listOf(9L), vm.state.value.tasks.map { it.id })
        vm.setFilter(TaskFilter.All)
        runCurrent()
        assertEquals(7, vm.state.value.tasks.size)
    }

    @Test fun aBoardEventReadsTheListAgainOnceAfterTheDebounce() = runTest(dispatcher) {
        val b = FakeTasksBackend(mixed)
        vm(b)
        b.events.tryEmit(LinkEvent("board:changed", JsonNull))
        b.events.tryEmit(LinkEvent("board:changed", JsonNull))
        b.events.tryEmit(LinkEvent("session:delta", JsonNull))
        advanceTimeBy(250); runCurrent()
        assertEquals(1, b.listCount)
        advanceTimeBy(100); runCurrent()
        assertEquals(2, b.listCount)
    }

    @Test fun reconnectingReadsTheBoardAgain() = runTest(dispatcher) {
        val b = FakeTasksBackend(mixed)
        val vm = vm(b)
        b.connectionState.value = ConnectionState.Connecting
        runCurrent()
        assertFalse(vm.state.value.online)
        b.connectionState.value = ConnectionState.Online("http://pc", "PC", dev.orb.app.link.net.PcVersions(1, 1, "3.8.4"))
        runCurrent()
        assertEquals(2, b.listCount)
    }

    @Test fun aFailedFirstReadShowsTheErrorAndKeepsNothing() = runTest(dispatcher) {
        val b = FakeTasksBackend()
        b.listResult = Result.failure(LinkException(LinkError.Offline))
        val vm = vm(b)
        assertTrue(vm.state.value.loadFailed)
        assertFalse(vm.state.value.loaded)
    }

    @Test fun anEmptyBoardIsLoadedOnceThePcAnswered() = runTest(dispatcher) {
        val vm = vm(FakeTasksBackend())
        assertTrue(vm.state.value.loaded)
        assertEquals(0, vm.state.value.total)
    }

    @Test fun resumeShowsAtOnceAndAskedThePc() = runTest(dispatcher) {
        val b = FakeTasksBackend(mixed, paused = true)
        val vm = vm(b)
        vm.setPaused(false)
        runCurrent()
        assertEquals(listOf("paused false"), b.calls)
        assertFalse(vm.state.value.paused)
        assertFalse(vm.state.value.queueBusy)
    }

    @Test fun aRefusedPauseGoesBackWithTheReason() = runTest(dispatcher) {
        val b = FakeTasksBackend(mixed, paused = false)
        b.actionResult = Result.failure(LinkException(LinkError.Offline))
        val vm = vm(b)
        val seen = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { seen += it } }
        vm.setPaused(true)
        runCurrent()
        assertFalse(vm.state.value.paused)
        assertTrue(seen.single().startsWith(TaskTexts.ACTION_FAILED))
    }

    @Test fun aSecondTapWhileThePcAnswersIsIgnored() = runTest(dispatcher) {
        val b = FakeTasksBackend(mixed, paused = true)
        b.gate = kotlinx.coroutines.CompletableDeferred()
        val vm = vm(b)
        vm.setPaused(false)
        vm.setPaused(false)
        runCurrent()
        assertTrue(vm.state.value.queueBusy)
        b.gate!!.complete(Unit)
        advanceUntilIdle()
        assertEquals(1, b.calls.size)
    }

    @Test fun offlineActionsSayNothingChanged() = runTest(dispatcher) {
        val b = FakeTasksBackend(mixed, paused = true)
        val vm = vm(b)
        b.connectionState.value = ConnectionState.Connecting
        runCurrent()
        val seen = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { seen += it } }
        vm.setPaused(false)
        runCurrent()
        assertEquals(listOf(TaskTexts.ACTION_OFFLINE), seen)
        assertTrue(b.calls.isEmpty())
    }

    @Test fun createIsOfferedOnlyWhenThePcListsIt() = runTest(dispatcher) {
        val b = FakeTasksBackend(mixed)
        b.unavailable = setOf(ApiMethods.TASKS_CREATE.name)
        val vm = vm(b)
        assertFalse(vm.state.value.canCreate)
        vm.openNewTask()
        runCurrent()
        assertNull(vm.state.value.newTask)
    }

    @Test fun creatingATaskClosesTheFormAndReadsTheBoard() = runTest(dispatcher) {
        val b = FakeTasksBackend(mixed)
        val vm = vm(b)
        vm.openNewTask()
        runCurrent()
        assertEquals(listOf("api-pagos", "app-movil"), vm.state.value.newTask?.projects)
        vm.createTask("app-movil", "  Título ", " Descripción ")
        runCurrent()
        assertEquals(listOf("create app-movil|Título|Descripción"), b.calls)
        assertNull(vm.state.value.newTask)
        assertEquals(2, b.listCount)
    }

    @Test fun aRefusedCreationKeepsTheFormWithTheError() = runTest(dispatcher) {
        val b = FakeTasksBackend(mixed)
        b.actionResult = Result.failure(LinkException(LinkError.Offline))
        val vm = vm(b)
        vm.openNewTask()
        runCurrent()
        vm.createTask("api-pagos", "T", "D")
        runCurrent()
        val n = vm.state.value.newTask
        assertTrue(n != null && !n.saving && n.error != null)
    }

    @Test fun searchAsksThePcFromTwoLettersAndFallsBackToTheLoadedRows() = runTest(dispatcher) {
        val b = FakeTasksBackend(mixed)
        b.searchResult = Result.success(listOf(SearchTask(7, "Pasarela", "done", "api-pagos", "…sandbox…")))
        val vm = vm(b)
        vm.openSearch()
        vm.setQuery("p")
        advanceTimeBy(400); runCurrent()
        assertTrue(b.searches.isEmpty())
        vm.setQuery("pas")
        advanceTimeBy(400); runCurrent()
        assertEquals(listOf("pas"), b.searches)
        assertEquals(listOf(7L), vm.state.value.results?.map { it.id })
        b.searchResult = Result.failure(LinkException(LinkError.Offline))
        vm.setQuery("Listo")
        advanceTimeBy(400); runCurrent()
        assertEquals(listOf(9L), vm.state.value.results?.map { it.id })
        vm.closeSearch()
        runCurrent()
        assertNull(vm.state.value.results)
        assertFalse(vm.state.value.searching)
    }

    @Test fun refreshWhileReadingDoesNotReadTwice() = runTest(dispatcher) {
        val b = FakeTasksBackend(mixed)
        val vm = vm(b)
        vm.refresh()
        vm.refresh()
        runCurrent()
        assertEquals(2, b.listCount)
    }
}

package dev.orb.app.ui.schedules

import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
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
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SchedulesViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = kotlinx.coroutines.Dispatchers.setMain(dispatcher)
    @After fun tearDown() = kotlinx.coroutines.Dispatchers.resetMain()

    private fun TestScope.vm(b: FakeSchedulesBackend): SchedulesViewModel {
        val vm = SchedulesViewModel(b, reloadDebounceMs = 300)
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        return vm
    }

    @Test fun savedSchedulesShowBeforeThePcAnswersAndGiveWayToItsAnswer() = runTest(dispatcher) {
        val b = FakeSchedulesBackend(listOf(schedule(9)))
        b.listGate = kotlinx.coroutines.CompletableDeferred()
        b.savedItems.value = listOf(schedule(1))
        val vm = vm(b)
        assertTrue(vm.state.value.loaded)
        assertEquals(listOf(1L), vm.state.value.items.map { it.id })
        b.listGate!!.complete(Unit)
        advanceUntilIdle()
        assertEquals(listOf(9L), vm.state.value.items.map { it.id })
        // A later copy of the cache (the answer saved) must not undo the answer.
        b.savedItems.value = listOf(schedule(1))
        advanceUntilIdle()
        assertEquals(listOf(9L), vm.state.value.items.map { it.id })
    }

    @Test fun parserReadsThePcRows() {
        val el = Json.parseToJsonElement(
            """[{"id":3,"project":"p","title":"t","description":"d","agent":"claude","readonly":1,"every":"weekly","at_time":"09:00",
            "weekdays":[1,3],"enabled":1,"approved":0,"next_run":"2026-11-16T08:00:00.000Z","last_task":12,"same_chat":0,"when":"Cada semana"},{"x":1}]""",
        )
        val s = SchedulesParser.list(el).single()
        assertEquals(3L, s.id)
        assertTrue(s.readonly && s.enabled && !s.approved)
        assertEquals(listOf(1, 3), s.weekdays)
        assertEquals(12L, s.lastTask)
        assertEquals("Cada semana", s.whenText)
    }

    @Test fun loadsOnStart() = runTest(dispatcher) {
        val vm = vm(FakeSchedulesBackend(listOf(schedule(1), schedule(2))))
        advanceUntilIdle()
        assertTrue(vm.state.value.loaded)
        assertEquals(2, vm.state.value.items.size)
    }

    @Test fun aFailedFirstReadShowsTheErrorAndRetries() = runTest(dispatcher) {
        val b = FakeSchedulesBackend(listOf(schedule(1)))
        b.listResult = Result.failure(LinkException(LinkError.Timeout))
        val vm = vm(b)
        advanceUntilIdle()
        assertTrue(vm.state.value.loadFailed && !vm.state.value.loaded)
        b.listResult = null
        vm.refresh()
        advanceUntilIdle()
        assertTrue(vm.state.value.loaded && !vm.state.value.loadFailed)
    }

    @Test fun togglingAsksThePcAndReloads() = runTest(dispatcher) {
        val b = FakeSchedulesBackend(listOf(schedule(1)))
        val vm = vm(b)
        advanceUntilIdle()
        val before = b.listCount
        vm.setEnabled(schedule(1), false)
        advanceUntilIdle()
        assertEquals(listOf("update 1 enabled=false approve=false title=null description=null"), b.calls)
        assertTrue(b.listCount > before)
    }

    @Test fun runNowAsksThePc() = runTest(dispatcher) {
        val b = FakeSchedulesBackend(listOf(schedule(1)))
        val vm = vm(b)
        advanceUntilIdle()
        vm.run(schedule(1))
        advanceUntilIdle()
        assertEquals(listOf("run 1"), b.calls)
    }

    @Test fun nothingRunsWhileOffline() = runTest(dispatcher) {
        val b = FakeSchedulesBackend(listOf(schedule(1)))
        val vm = vm(b)
        advanceUntilIdle()
        b.connectionState.value = ConnectionState.Offline(null, null)
        advanceUntilIdle()
        val got = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { got += it } }
        vm.run(schedule(1))
        runCurrent()
        assertTrue(b.calls.isEmpty())
        assertEquals(listOf(SchedulesTexts.ACTION_OFFLINE), got)
    }

    @Test fun aPcFailureIsShownAsItComes() = runTest(dispatcher) {
        val b = FakeSchedulesBackend(listOf(schedule(1)))
        val vm = vm(b)
        advanceUntilIdle()
        b.actionResult = Result.failure(LinkException(LinkError.Timeout))
        val got = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { got += it } }
        vm.run(schedule(1))
        advanceUntilIdle()
        assertTrue(got.single().startsWith(SchedulesTexts.ACTION_FAILED))
    }

    @Test fun openNewLoadsTheAgentsAndCreateSendsTheChosenOnes() = runTest(dispatcher) {
        val b = FakeSchedulesBackend()
        val vm = vm(b)
        advanceUntilIdle()
        vm.openNew()
        advanceUntilIdle()
        assertEquals(listOf("claude", "codex"), vm.state.value.form?.agents?.map { it.id })
        vm.create(NewSchedule("app-movil", "t", "d", "daily", "08:15", emptyList(), 6, false, false, agent = "claude", model = "opus"))
        advanceUntilIdle()
        assertEquals(listOf("create app-movil|t|daily|08:15|[]|6|false|claude|opus"), b.calls)
    }

    @Test fun formStillOpensWhenTheAgentsCannotBeRead() = runTest(dispatcher) {
        val b = FakeSchedulesBackend()
        b.agentList = Result.failure(RuntimeException("x"))
        val vm = vm(b)
        advanceUntilIdle()
        vm.openNew()
        advanceUntilIdle()
        assertTrue(vm.state.value.form?.agents.orEmpty().isEmpty())
        assertEquals(listOf("app-movil", "api-pagos"), vm.state.value.form?.projects)
    }

    @Test fun createSendsTheFormAndClosesIt() = runTest(dispatcher) {
        val b = FakeSchedulesBackend()
        val vm = vm(b)
        advanceUntilIdle()
        vm.openNew()
        advanceUntilIdle()
        assertEquals(listOf("app-movil", "api-pagos"), vm.state.value.form?.projects)
        vm.create(NewSchedule("app-movil", " Tests ", " corre los tests ", "daily", "22:30", emptyList(), 6, true, false))
        advanceUntilIdle()
        assertEquals(listOf("create app-movil|Tests|daily|22:30|[]|6|true|any|null"), b.calls)
        assertNull(vm.state.value.form)
    }

    @Test fun aRefusedCreateKeepsTheFormWithTheError() = runTest(dispatcher) {
        val b = FakeSchedulesBackend()
        b.actionResult = Result.failure(LinkException(LinkError.Refused(400, "Fecha pasada")))
        val vm = vm(b)
        advanceUntilIdle()
        vm.openNew()
        advanceUntilIdle()
        vm.create(NewSchedule("app-movil", "t", "d", "once", "2020-01-01T10:00", emptyList(), 6, false, false))
        advanceUntilIdle()
        val f = vm.state.value.form
        assertNotNull(f)
        assertFalse(f!!.saving)
        assertNotNull(f.error)
    }

    @Test fun anIncompleteFormSendsNothing() = runTest(dispatcher) {
        val b = FakeSchedulesBackend()
        val vm = vm(b)
        advanceUntilIdle()
        vm.openNew()
        advanceUntilIdle()
        vm.create(NewSchedule("app-movil", " ", "d", "daily", "09:00", emptyList(), 6, false, false))
        advanceUntilIdle()
        assertTrue(b.calls.isEmpty())
    }

    @Test fun editSavesTitleAndInstructions() = runTest(dispatcher) {
        val b = FakeSchedulesBackend(listOf(schedule(4)))
        val vm = vm(b)
        advanceUntilIdle()
        vm.openEdit(schedule(4))
        vm.saveEdit("Nuevo", "Otra cosa")
        advanceUntilIdle()
        assertEquals(listOf("update 4 enabled=null approve=false title=Nuevo description=Otra cosa"), b.calls)
    }

    @Test fun approvingSendsTheApproval() = runTest(dispatcher) {
        val b = FakeSchedulesBackend(listOf(schedule(5, approved = false)))
        val vm = vm(b)
        advanceUntilIdle()
        vm.approve(schedule(5, approved = false))
        advanceUntilIdle()
        assertEquals(listOf("update 5 enabled=null approve=true title=null description=null"), b.calls)
    }

    @Test fun whatThePcLacksIsHidden() = runTest(dispatcher) {
        val b = FakeSchedulesBackend(listOf(schedule(1)))
        b.unavailable = setOf(ApiMethods.SCHEDULES_CREATE.name, ApiMethods.SCHEDULES_RUN.name)
        val vm = vm(b)
        advanceUntilIdle()
        assertFalse(vm.state.value.canCreate)
        assertFalse(vm.state.value.canRun)
        assertTrue(vm.state.value.canUpdate)
        vm.openNew()
        vm.run(schedule(1))
        advanceUntilIdle()
        assertNull(vm.state.value.form)
        assertTrue(b.calls.isEmpty())
    }
}

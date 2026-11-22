package dev.orb.app.ui.tasks

import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import kotlinx.coroutines.CompletableDeferred
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
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TaskDetailViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = kotlinx.coroutines.Dispatchers.setMain(dispatcher)
    @After fun tearDown() = kotlinx.coroutines.Dispatchers.resetMain()

    private fun TestScope.vm(b: FakeTasksBackend, id: Long = 7): TaskDetailViewModel {
        val vm = TaskDetailViewModel(b, id)
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        return vm
    }

    private fun backend(d: TaskDetail) = FakeTasksBackend().also { it.details[d.id] = Result.success(d) }

    private val queued = detail(task(7, status = "queued", waiting = TaskWait("notice", "Claude al 94 % del límite", emptyList())))

    @Test fun waitingTaskOffersLaunchReassignFollowupAndCancel() = runTest(dispatcher) {
        val vm = vm(backend(queued))
        assertEquals(
            setOf(TaskAction.LaunchAnyway, TaskAction.Reassign, TaskAction.Followup, TaskAction.Cancel),
            vm.state.value.actions,
        )
    }

    @Test fun aHalfDoneJoinOffersUndoAndRetryOnlyWhenItWroteFiles() = runTest(dispatcher) {
        val wrote = backend(detail(task(7, status = "done"), partialJoin = PartialJoin(wrote = true)))
        val vm = vm(wrote)
        assertTrue(TaskAction.UndoJoin in vm.state.value.actions && TaskAction.RetryJoin in vm.state.value.actions)
        vm.undoJoin()
        advanceUntilIdle()
        assertTrue("undoJoin 7" in wrote.calls)
        val clean = vm(backend(detail(task(7, status = "done"), partialJoin = PartialJoin(wrote = false))))
        assertFalse(TaskAction.UndoJoin in clean.state.value.actions)
        assertTrue(TaskAction.RetryJoin in clean.state.value.actions)
        assertFalse(TaskAction.RetryJoin in vm(backend(detail(task(7, status = "done")))).state.value.actions)
    }

    // An event of the PC: the decisions go off at once, not after the wait

    private fun TestScope.slowVm(b: FakeTasksBackend): TaskDetailViewModel {
        val vm = TaskDetailViewModel(b, 7, reloadDebounceMs = 300)
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        return vm
    }

    private val held7 = detail(task(7, status = "blocked", held = TaskHeld("x", null)), hasCheckpoint = true, checkpointId = "cp1")
    private fun event(name: String) = dev.orb.app.link.net.LinkEvent(name, kotlinx.serialization.json.JsonNull)

    @Test fun anEventMarksTheTaskAsBeingReadAgainBeforeTheWaitAndTheDecisionsWait() = runTest(dispatcher) {
        val b = backend(held7)
        val vm = slowVm(b)
        assertFalse(vm.state.value.reloading)
        b.events.tryEmit(event("board:changed"))
        runCurrent()
        assertTrue(vm.state.value.reloading)
        vm.accept(); vm.askUndo(); vm.undo()
        runCurrent()
        assertEquals(emptyList<String>(), b.calls)
        advanceTimeBy(301)
        runCurrent()
        assertFalse(vm.state.value.reloading)
        vm.accept()
        runCurrent()
        assertEquals(listOf("accept 7"), b.calls)
    }

    @Test fun anApprovalWaitsForTheReadAnEventAskedFor() = runTest(dispatcher) {
        val b = backend(detail(task(7, status = "awaiting_approval"), previewHash = "h1"))
        val vm = slowVm(b)
        b.events.tryEmit(event("approval:changed"))
        runCurrent()
        vm.approve(true, "h1")
        runCurrent()
        assertEquals(emptyList<String>(), b.calls)
        advanceTimeBy(301)
        runCurrent()
        vm.approve(true, "h1")
        runCurrent()
        assertEquals(listOf("decide 7 true h1"), b.calls)
    }

    @Test fun anEventThatIsNotAboutTasksDoesNotHoldTheDecisions() = runTest(dispatcher) {
        val b = backend(held7)
        val vm = slowVm(b)
        b.events.tryEmit(event("chat:new"))
        runCurrent()
        assertFalse(vm.state.value.reloading)
    }

    @Test fun aTaskWaitingForOthersCannotBeLaunchedAnyway() = runTest(dispatcher) {
        val deps = detail(task(7, status = "queued", waiting = TaskWait("deps", null, listOf(WaitDep(3, "running", false)))))
        val vm = vm(backend(deps))
        assertFalse(TaskAction.LaunchAnyway in vm.state.value.actions)
    }

    @Test fun whatThePcDoesNotListIsHidden() = runTest(dispatcher) {
        val b = backend(queued)
        b.unavailable = setOf(ApiMethods.TASKS_LAUNCH_ANYWAY.name, ApiMethods.TASKS_CANCEL.name)
        val vm = vm(b)
        assertEquals(setOf(TaskAction.Reassign, TaskAction.Followup), vm.state.value.actions)
    }

    @Test fun heldTaskOffersAcceptAndUndoAndNoRetry() = runTest(dispatcher) {
        val held = detail(task(7, status = "blocked", held = TaskHeld("ha eliminado 9 archivos", "C:/p")), hasCheckpoint = true)
        val a = vm(backend(held)).state.value.actions
        assertTrue(TaskAction.AcceptHeld in a && TaskAction.UndoHeld in a && TaskAction.SeeChanges in a)
        assertFalse(TaskAction.Retry in a)
    }

    @Test fun failedTaskCanBeRetried() = runTest(dispatcher) {
        val vm = vm(backend(detail(task(7, status = "failed"))))
        assertTrue(TaskAction.Retry in vm.state.value.actions)
        assertFalse(TaskAction.Cancel in vm.state.value.actions)
    }

    @Test fun doneTaskOffersReviewAndChangesUnlessUndone() = runTest(dispatcher) {
        val done = detail(task(7, status = "done"), hasCheckpoint = true)
        assertTrue(vm(backend(done)).state.value.actions.containsAll(listOf(TaskAction.Review, TaskAction.SeeChanges)))
        val undone = detail(task(7, status = "done", undone = true), hasCheckpoint = true)
        assertFalse(TaskAction.SeeChanges in vm(backend(undone)).state.value.actions)
    }

    @Test fun approvalNeedsTheFingerprintTheScreenShowed() = runTest(dispatcher) {
        val withHash = detail(task(7, status = "awaiting_approval"), previewHash = "abc")
        val b = backend(withHash)
        val vm = vm(b)
        vm.approve(true)
        runCurrent()
        assertEquals(listOf("decide 7 true abc"), b.calls)
        val without = detail(task(7, status = "awaiting_approval"))
        assertFalse(TaskAction.Approve in vm(backend(without)).state.value.actions)
    }

    @Test fun launchAnywaySaysWhenTheQueueStaysPaused() = runTest(dispatcher) {
        val b = backend(queued)
        b.launchResult = Result.success(true)
        val vm = vm(b)
        val seen = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { seen += it } }
        vm.launchAnyway()
        runCurrent()
        assertEquals(listOf("launch 7"), b.calls)
        assertEquals(listOf(TaskTexts.LAUNCH_PAUSED_NOTE), seen)
    }

    @Test fun aSecondTapOnAcceptWhileThePcAnswersDoesNothing() = runTest(dispatcher) {
        val held = detail(task(7, status = "blocked", held = TaskHeld("x", null)), hasCheckpoint = true)
        val b = backend(held)
        b.gate = CompletableDeferred()
        val vm = vm(b)
        vm.accept()
        vm.accept()
        vm.undo()
        runCurrent()
        assertTrue(vm.state.value.busy)
        b.gate!!.complete(Unit)
        advanceUntilIdle()
        assertEquals(listOf("accept 7"), b.calls)
        assertFalse(vm.state.value.busy)
    }

    @Test fun anActionTheTaskDoesNotAllowIsNotSent() = runTest(dispatcher) {
        val b = backend(detail(task(7, status = "done")))
        val vm = vm(b)
        vm.cancel()
        vm.retry()
        vm.accept()
        runCurrent()
        assertTrue(b.calls.isEmpty())
    }

    @Test fun aRefusalShowsThePcReasonAndKeepsTheTask() = runTest(dispatcher) {
        val b = backend(queued)
        b.actionResult = Result.failure(LinkException(LinkError.Offline))
        val vm = vm(b)
        val seen = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { seen += it } }
        vm.cancel()
        runCurrent()
        assertTrue(seen.single().startsWith(TaskTexts.ACTION_FAILED))
        assertEquals(7L, vm.state.value.detail?.id)
        assertFalse(vm.state.value.busy)
    }

    @Test fun reassignAndFollowupCarryTheirValues() = runTest(dispatcher) {
        val b = backend(queued)
        val vm = vm(b)
        vm.reassign("codex", "high")
        runCurrent()
        vm.followup("  añade tests ")
        runCurrent()
        assertEquals(listOf("reassign 7 codex high", "followup 7 añade tests"), b.calls)
    }

    @Test fun offlineActionsDoNotReachThePc() = runTest(dispatcher) {
        val b = backend(queued)
        val vm = vm(b)
        b.connectionState.value = ConnectionState.Connecting
        runCurrent()
        val seen = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { seen += it } }
        vm.cancel()
        runCurrent()
        assertTrue(b.calls.isEmpty())
        assertEquals(listOf(TaskTexts.ACTION_OFFLINE), seen)
    }

    @Test fun aFirstReadThatFailsShowsTheError() = runTest(dispatcher) {
        val vm = vm(FakeTasksBackend())
        assertEquals(null, vm.state.value.detail)
        assertFalse(vm.state.value.loading)
        assertTrue(vm.state.value.error != null)
    }

    @Test fun agentsAreAskedOnlyWhenTheReassignDialogOpens() = runTest(dispatcher) {
        val vm = vm(backend(queued))
        assertEquals(null, vm.state.value.agents)
        vm.loadAgents()
        runCurrent()
        assertEquals(listOf("claude", "codex"), vm.state.value.agents?.map { it.id })
    }

    @Test fun aFailedAgentsReadIsNotKeptSoTheNextOpenTriesAgain() = runTest(dispatcher) {
        val b = backend(queued)
        val good = b.agentList
        b.agentList = Result.failure(LinkException(LinkError.Timeout))
        val vm = vm(b)
        vm.loadAgents()
        runCurrent()
        assertEquals(null, vm.state.value.agents)
        b.agentList = good
        vm.loadAgents()
        runCurrent()
        assertEquals(listOf("claude", "codex"), vm.state.value.agents?.map { it.id })
    }
}

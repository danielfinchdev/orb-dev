package dev.orb.app.ui.projects

import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.ui.chats.row
import dev.orb.app.ui.tasks.task
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
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ProjectDetailViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = kotlinx.coroutines.Dispatchers.setMain(dispatcher)
    @After fun tearDown() = kotlinx.coroutines.Dispatchers.resetMain()

    private fun TestScope.vm(b: FakeProjectsBackend): ProjectDetailViewModel {
        val vm = ProjectDetailViewModel(b, "app-movil", reloadDebounceMs = 300)
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        return vm
    }

    private fun backend() = FakeProjectsBackend().also {
        it.detailResult = Result.success(
            ProjectDetailData(listOf(row("1", project = "app-movil")), listOf(task(7, project = "app-movil")), ProjectGit("dev", 2, 1, "git@x")),
        )
    }

    @Test fun parsesInfoBranchAndTheReviewTask() {
        val g = ProjectInfoParser.info(Json.parseToJsonElement("""{"git":true,"branch":"dev","remote":null,"branches":["dev"],"changes":2,"ahead":null,"prs":[]}"""))
        assertEquals(ProjectGit("dev", 2, null, null), g)
        assertNull(ProjectInfoParser.info(Json.parseToJsonElement("""{"git":false}""")))
        assertEquals("main", ProjectInfoParser.branch(Json.parseToJsonElement("""{"branch":"main"}"""))?.branch)
        assertEquals(12L, ProjectInfoParser.taskId(Json.parseToJsonElement("""{"id":12,"title":"x"}""")))
    }

    @Test fun theRowAndTheSheetNameEachThingTruthfully() {
        assertEquals("dev · 2", ProjectTexts.branchMeta(ProjectGit("dev", 2, 1, null)))
        assertEquals("main", ProjectTexts.branchMeta(ProjectGit("main", 0, null, null)))
        assertEquals("HEAD suelto · 1", ProjectTexts.branchMeta(ProjectGit(null, 1, null, null)))
        assertNull(ProjectTexts.branchMeta(null))
        assertEquals("1 archivo sin confirmar", ProjectTexts.uncommitted(1))
        assertEquals("3 archivos sin confirmar", ProjectTexts.uncommitted(3))
        assertEquals("Ninguna tarea con cambios sin aceptar", ProjectTexts.unaccepted(0))
        assertEquals("1 tarea con cambios sin aceptar", ProjectTexts.unaccepted(1))
        assertEquals("2 tareas con cambios sin aceptar", ProjectTexts.unaccepted(2))
        assertEquals("android · rama dev", ProjectTexts.barLine("android", ProjectGit("dev", null, null, null)))
        assertNull(ProjectTexts.barLine(null, null))
    }

    @Test fun onlyFinishedWorkNotAcceptedNorUndoneCountsAsTaskChanges() = runTest(dispatcher) {
        val b = FakeProjectsBackend()
        b.detailResult = Result.success(
            ProjectDetailData(
                emptyList(),
                listOf(
                    task(1, status = "done"), task(2, status = "done", accepted = true), task(3, status = "done", undone = true),
                    task(4, status = "running"), task(5, status = "done").copy(readonly = true), task(6, status = "done"),
                    task(7, status = "awaiting_approval"), task(8, status = "queued"), task(9, status = "failed"),
                ),
                ProjectGit("dev", 2, null, null),
            ),
        )
        val vm = vm(b)
        advanceUntilIdle()
        assertEquals(listOf(1L, 6L), vm.state.value.unaccepted.map { it.id })
        // running, waiting for the OK and queued
        assertEquals(3, vm.state.value.openTasks)
    }

    @Test fun aFinishedProjectCarriesItsKeyAndReopensThroughThePc() = runTest(dispatcher) {
        val b = backend()
        b.detailResult = Result.success(ProjectDetailData(emptyList(), emptyList(), null, "web", "k1", "2026-10-01"))
        val vm = vm(b)
        advanceUntilIdle()
        assertTrue(vm.state.value.archived)
        vm.reopen()
        advanceUntilIdle()
        assertEquals(listOf("reopen k1"), b.calls)
    }

    @Test fun anActiveProjectCannotBeReopened() = runTest(dispatcher) {
        val b = backend()
        val vm = vm(b)
        advanceUntilIdle()
        assertFalse(vm.state.value.archived)
        vm.reopen()
        advanceUntilIdle()
        assertTrue(b.calls.isEmpty())
    }

    @Test fun newTaskFixesTheProjectAndCreatesThroughThePc() = runTest(dispatcher) {
        val b = backend()
        val vm = vm(b)
        advanceUntilIdle()
        vm.openNewTask()
        runCurrent()
        assertEquals(listOf("app-movil"), vm.state.value.newTask?.projects)
        assertFalse(vm.state.value.newTask!!.loading)
        vm.createTask("app-movil", " Ajustar ", " el pie ")
        advanceUntilIdle()
        assertEquals(listOf("task app-movil|Ajustar|el pie"), b.calls)
        assertNull(vm.state.value.newTask)
    }

    @Test fun aFailedNewTaskKeepsTheDialogWithTheError() = runTest(dispatcher) {
        val b = backend()
        b.actionResult = Result.failure(LinkException(LinkError.Timeout))
        val vm = vm(b)
        advanceUntilIdle()
        vm.openNewTask()
        vm.createTask("app-movil", "t", "d")
        advanceUntilIdle()
        assertTrue(vm.state.value.newTask?.error != null)
        assertFalse(vm.state.value.newTask!!.saving)
    }

    @Test fun newTaskIsHiddenAndRefusedWhenThePcCannotCreate() = runTest(dispatcher) {
        val b = backend()
        b.unavailable = setOf(ApiMethods.TASKS_CREATE.name)
        val vm = vm(b)
        advanceUntilIdle()
        assertFalse(vm.state.value.canNewTask)
        vm.openNewTask()
        assertNull(vm.state.value.newTask)
    }

    @Test fun loadsChatsTasksAndBranch() = runTest(dispatcher) {
        val vm = vm(backend())
        advanceUntilIdle()
        val s = vm.state.value
        assertTrue(s.loaded)
        assertEquals(1, s.chats.size)
        assertEquals(7L, s.tasks[0].id)
        assertEquals("dev", s.git?.branch)
    }

    @Test fun aFailedLoadIsShownAsFailedUntilItWorks() = runTest(dispatcher) {
        val b = backend()
        b.detailResult = Result.failure(LinkException(LinkError.Offline))
        val vm = vm(b)
        advanceUntilIdle()
        assertTrue(vm.state.value.loadFailed)
        assertFalse(vm.state.value.loaded)
    }

    @Test fun reviewsAreHiddenWhenThePcDoesNotListThem() = runTest(dispatcher) {
        val b = backend()
        b.unavailable = setOf(ApiMethods.PROJECTS_REVIEW.name, ApiMethods.PROJECTS_SECURITY_REVIEW.name, ApiMethods.LOGS_READ.name)
        val vm = vm(b)
        advanceUntilIdle()
        assertFalse(vm.state.value.canReview)
        assertFalse(vm.state.value.canSecurityReview)
        assertFalse(vm.state.value.canLog)
        vm.review()
        vm.openLog()
        advanceUntilIdle()
        assertTrue(b.calls.isEmpty())
    }

    @Test fun reviewAsksThePcOnce() = runTest(dispatcher) {
        val b = backend()
        val gate = CompletableDeferred<Unit>()
        b.gate = gate
        val vm = vm(b)
        advanceUntilIdle()
        vm.review()
        vm.review()
        vm.securityReview()
        runCurrent()
        assertEquals(listOf("review app-movil"), b.calls)
        gate.complete(Unit)
        advanceUntilIdle()
        assertFalse(vm.state.value.busy)
    }

    @Test fun finishLeavesOnlyAfterThePcAgrees() = runTest(dispatcher) {
        val b = backend()
        b.actionResult = Result.failure(LinkException(LinkError.Timeout))
        val vm = vm(b)
        advanceUntilIdle()
        vm.finish()
        advanceUntilIdle()
        assertFalse(vm.state.value.finished)
        b.actionResult = Result.success(Unit)
        vm.finish()
        advanceUntilIdle()
        assertTrue(vm.state.value.finished)
        assertEquals(listOf("finish app-movil", "finish app-movil"), b.calls)
    }

    @Test fun offlineFinishDoesNotCallThePc() = runTest(dispatcher) {
        val b = backend()
        val vm = vm(b)
        advanceUntilIdle()
        b.connectionState.value = ConnectionState.Offline(null, null)
        advanceUntilIdle()
        vm.finish()
        advanceUntilIdle()
        assertTrue(b.calls.isEmpty())
    }

    @Test fun logLoadsAndClosesAndShowsErrors() = runTest(dispatcher) {
        val b = backend()
        b.logResult = Result.success("### entrada")
        val vm = vm(b)
        advanceUntilIdle()
        vm.openLog()
        advanceUntilIdle()
        assertEquals("### entrada", vm.state.value.log?.text)
        vm.closeLog()
        advanceUntilIdle()
        assertNull(vm.state.value.log)
        b.logResult = Result.failure(LinkException(LinkError.Timeout))
        vm.openLog()
        advanceUntilIdle()
        assertTrue(vm.state.value.log?.error != null)
    }
}

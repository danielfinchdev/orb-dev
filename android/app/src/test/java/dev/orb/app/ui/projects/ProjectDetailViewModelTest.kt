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

    @Test fun branchLineSummarisesChangesAndPending() {
        assertEquals("dev · 2 cambios · 1 por subir", ProjectTexts.branchValue(ProjectGit("dev", 2, 1, null)))
        assertEquals("main · 1 cambio", ProjectTexts.branchValue(ProjectGit("main", 1, 0, null)))
        assertEquals("main", ProjectTexts.branchValue(ProjectGit("main", null, null, null)))
        assertEquals("Sin git", ProjectTexts.branchValue(null))
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

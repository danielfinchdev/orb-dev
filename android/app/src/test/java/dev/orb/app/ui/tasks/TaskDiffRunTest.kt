package dev.orb.app.ui.tasks

import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
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
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class TaskDiffParsingTest {
    private fun parse(s: String) = TasksParser.diff(Json.parseToJsonElement(s))

    @Test fun readsTheReasonTheHiddenFilesAndTheRunOfTheDiff() {
        val d = parse("""{"available":true,"files":[{"path":"a","added":1,"removed":0}],"more":0,"hidden":3,"checkpointId":"cp1"}""")
        assertEquals(3, d.hidden)
        assertEquals("cp1", d.checkpointId)
        assertTrue(d.runKnown)
        assertNull(d.reason)
        val none = parse("""{"available":false,"reason":"notdone","files":[],"more":0}""")
        assertEquals("notdone", none.reason)
        assertFalse(none.runKnown)
        assertEquals(0, none.hidden)
    }

    @Test fun aPcThatSendsTheRunEmptyIsNotAPcThatDoesNotSendIt() {
        assertTrue(parse("""{"available":true,"files":[],"more":0,"checkpointId":null}""").runKnown)
        assertFalse(parse("""{"available":true,"files":[],"more":0}""").runKnown)
    }

    @Test fun aDiffIsOfTheRunOfTheTaskOnlyWhenTheyAreTheSameOrThePcSaysNothing() {
        assertTrue(TaskDiff(true, emptyList(), 0, checkpointId = "a", runKnown = true).isOfRun("a"))
        assertFalse(TaskDiff(true, emptyList(), 0, checkpointId = "a", runKnown = true).isOfRun("b"))
        assertFalse(TaskDiff(true, emptyList(), 0, checkpointId = "a", runKnown = true).isOfRun(null))
        assertFalse(TaskDiff(true, emptyList(), 0, checkpointId = null, runKnown = true).isOfRun("b"))
        assertTrue(TaskDiff(true, emptyList(), 0).isOfRun("b"))
        assertTrue(TaskDiff(false, emptyList(), 0, reason = "nophoto").isOfRun("b"))
    }

    @Test fun readsTheReviewTheScheduleAndTheReasonsOfATask() {
        val d = TasksParser.detail(
            Json.parseToJsonElement(
                """{"id":4,"title":"t","status":"done","schedule_id":9,"sensitivity":["publish","financial"],
                   "review":{"task":6,"verdict":"correcto","agent":"codex","at":"2026-11-11T10:00:00.000Z"}}""",
            ),
        )!!
        assertEquals(9L, d.row.scheduleId)
        assertEquals(listOf("publish", "financial"), d.row.reasons)
        assertEquals(TaskReview(6, "correcto", "codex", "2026-11-11T10:00:00.000Z"), d.review)
        assertNull(TasksParser.detail(Json.parseToJsonElement("""{"id":4,"title":"t","status":"done"}"""))!!.review)
    }

    @Test fun readsTheAgentsWithTheirModelAndAccount() {
        val agents = TasksParser.agents(
            Json.parseToJsonElement(
                """[{"id":"claude","label":"Claude","defaultModel":"sonnet","models":[{"id":"sonnet","label":"Sonnet 5.5"}],"accounts":[{"id":"claude","label":"Claude"}]},
                   {"id":"codex","label":"Codex","defaultModel":"","models":[],"accounts":[{"id":"codex-pro","label":"Codex Pro"}]}]""",
            ),
        )
        assertEquals(listOf(AgentChoice("claude", "Claude", "Sonnet 5.5"), AgentChoice("codex", "Codex", "Codex Pro")), agents)
    }
}

/** The changes screen offers «Aceptar» and «Deshacer» only on a diff that is of the run the task is at now. */
@OptIn(ExperimentalCoroutinesApi::class)
class TaskDiffRunTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = kotlinx.coroutines.Dispatchers.setMain(dispatcher)
    @After fun tearDown() = kotlinx.coroutines.Dispatchers.resetMain()

    private val oneFile = listOf(DiffFile("M", "a.ts", 1, 0, false, "@@ -1 +1 @@\n-a\n+b\n", false))
    private fun taskAt(run: String?) = detail(task(4, "Push", status = "done"), hasCheckpoint = true, checkpointId = run)
    private fun diff(run: String?, known: Boolean = true) = TaskDiff(true, oneFile, 0, checkpointId = run, runKnown = known)

    private fun backend(taskRun: String?, diff: TaskDiff) = FakeTasksBackend().also {
        it.details[4] = Result.success(taskAt(taskRun))
        it.diffs[4] = Result.success(diff)
    }

    private fun TestScope.vm(b: FakeTasksBackend, debounce: Long = 0): TaskDiffViewModel {
        val vm = TaskDiffViewModel(b, 4, reloadDebounceMs = debounce)
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        return vm
    }

    private fun event(name: String) = LinkEvent(name, JsonNull)

    @Test fun aDiffOfAnotherRunOffersNeitherAcceptNorUndoAndSaysItIsNotReady() = runTest(dispatcher) {
        val vm = vm(backend("run2", diff("run1")))
        val s = vm.state.value
        assertFalse(s.canAccept || s.canUndo)
        assertTrue(s.notReady)
        vm.accept()
        vm.askUndo()
        vm.undo()
        runCurrent()
    }

    @Test fun nothingIsSentFromADiffOfAnotherRun() = runTest(dispatcher) {
        val b = backend("run2", diff("run1"))
        val vm = vm(b)
        vm.accept(); vm.askUndo(); vm.undo()
        runCurrent()
        assertEquals(emptyList<String>(), b.calls)
    }

    @Test fun aDiffOfTheSameRunOffersBothAndSendsThatRun() = runTest(dispatcher) {
        val b = backend("run2", diff("run2"))
        val vm = vm(b)
        assertTrue(vm.state.value.canAccept && vm.state.value.canUndo && !vm.state.value.notReady)
        vm.accept()
        runCurrent()
        vm.askUndo()
        vm.undo()
        runCurrent()
        assertEquals(listOf<String?>("run2"), b.acceptCheckpoints)
        assertEquals(listOf<String?>("run2"), b.undoCheckpoints)
    }

    @Test fun aPcThatDoesNotNameTheRunOfTheDiffIsTreatedAsBefore() = runTest(dispatcher) {
        val s = vm(backend("run2", diff(null, known = false))).state.value
        assertTrue(s.canAccept && s.canUndo && !s.notReady)
    }

    @Test fun aPcThatNamesNoRunForTheDiffOffersNothing() = runTest(dispatcher) {
        val s = vm(backend("run2", diff(null, known = true))).state.value
        assertFalse(s.canAccept || s.canUndo)
        assertTrue(s.notReady)
    }

    @Test fun aTaskWithoutRunButADiffThatNamesOneOffersNothing() = runTest(dispatcher) {
        val s = vm(backend(null, diff("run1"))).state.value
        assertFalse(s.canAccept || s.canUndo)
    }

    @Test fun aDiffTheLastRunHasNotLeftYetOffersNothingAndShowsNoDiff() = runTest(dispatcher) {
        val s = vm(backend("run2", TaskDiff(false, emptyList(), 0, reason = "notdone"))).state.value
        assertFalse(s.canAccept || s.canUndo)
        assertTrue(s.notReady)
    }

    @Test fun theOtherReasonsForNoDiffDoNotBlockTheButtonsThatDoNotNeedOne() = runTest(dispatcher) {
        for (reason in listOf("nophoto", "nogit", "gone")) {
            val s = vm(backend("run2", TaskDiff(false, emptyList(), 0, reason = reason))).state.value
            assertFalse(reason, s.notReady)
        }
    }

    @Test fun theTaskChangingBetweenTheDiffAndTheTaskIsNotAcceptedUnseen() = runTest(dispatcher) {
        val b = backend("run1", diff("run1"))
        val vm = vm(b)
        assertTrue(vm.state.value.canAccept)
        // The PC runs the task again while its diff is being read: the diff comes back of run 1, the task of run 2.
        b.diffGate = CompletableDeferred()
        vm.refresh()
        runCurrent()
        b.details[4] = Result.success(taskAt("run2"))
        b.diffGate!!.complete(Unit)
        runCurrent()
        assertTrue(vm.state.value.notReady)
        assertFalse(vm.state.value.canAccept || vm.state.value.canUndo)
        vm.accept()
        runCurrent()
        assertEquals(emptyList<String>(), b.calls)
        // The next reading brings the diff of run 2 and the buttons come back with that run.
        b.diffs[4] = Result.success(diff("run2"))
        vm.refresh()
        runCurrent()
        assertTrue(vm.state.value.canAccept)
        vm.accept()
        runCurrent()
        assertEquals(listOf<String?>("run2"), b.acceptCheckpoints)
    }

    // An event of the PC

    @Test fun anEventTurnsTheButtonsOffAtOnceNotAfterTheWait() = runTest(dispatcher) {
        val b = backend("run1", diff("run1"))
        val vm = vm(b, debounce = 300)
        assertTrue(vm.state.value.canAccept && !vm.state.value.reloading)
        b.events.tryEmit(event("board:changed"))
        runCurrent()
        // The wait has not passed: nothing was read yet, and nothing can be decided meanwhile.
        assertEquals(listOf("diff", "get"), b.reads)
        assertFalse(vm.state.value.canAccept || vm.state.value.canUndo)
        assertTrue(vm.state.value.reloading)
        vm.accept(); vm.askUndo(); vm.undo()
        runCurrent()
        assertEquals(emptyList<String>(), b.calls)
        advanceTimeBy(301)
        runCurrent()
        assertEquals(listOf("diff", "get", "diff", "get"), b.reads)
        assertTrue(vm.state.value.canAccept && vm.state.value.canUndo && !vm.state.value.reloading)
    }

    @Test fun anEventDuringAReadKeepsTheButtonsOffUntilTheNextReadEnds() = runTest(dispatcher) {
        val b = backend("run1", diff("run1"))
        val vm = vm(b, debounce = 300)
        b.diffGate = CompletableDeferred()
        vm.refresh()
        runCurrent()
        b.events.tryEmit(event("approval:changed"))
        runCurrent()
        b.diffGate!!.complete(Unit)
        runCurrent()
        // That read began before the event: it is not the answer to it.
        assertFalse(vm.state.value.canAccept)
        b.diffGate = null
        advanceUntilIdle()
        assertTrue(vm.state.value.canAccept)
    }

    @Test fun anEventThatIsNotAboutTasksDoesNotTurnThemOff() = runTest(dispatcher) {
        val b = backend("run1", diff("run1"))
        val vm = vm(b, debounce = 300)
        b.events.tryEmit(event("chat:new"))
        runCurrent()
        assertTrue(vm.state.value.canAccept)
    }

    // The PC's refusal and «Cambios aceptados · Deshacer»

    @Test fun thePcSayingTheLastRunIsNotReadyIsShownWordForWordAndTheScreenReads() = runTest(dispatcher) {
        val b = backend("run1", diff("run1"))
        val vm = vm(b)
        val said = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { said += it } }
        val words = "los cambios de la última ejecución aún no están listos; vuelve a abrirla en un momento"
        b.actionResult = Result.failure(LinkException(LinkError.Refused(409, words)))
        vm.accept()
        runCurrent()
        assertEquals(listOf(words), said)
        assertEquals(listOf("diff", "get", "diff", "get"), b.reads)
    }

    @Test fun acceptingTellsTheScreenSoItCanOfferToGoBack() = runTest(dispatcher) {
        val b = backend("run1", diff("run1"))
        val vm = vm(b)
        var accepted = 0
        backgroundScope.launch { vm.accepted.collect { accepted++ } }
        vm.accept()
        runCurrent()
        assertEquals(1, accepted)
        // A refusal is not an acceptance.
        b.actionResult = Result.failure(LinkException(LinkError.Refused(400, "no")))
        vm.accept()
        runCurrent()
        assertEquals(1, accepted)
    }

    @Test fun anAcceptedTaskKeepsItsUndoWhileThePointOfReturnExists() = runTest(dispatcher) {
        val b = FakeTasksBackend().also {
            it.details[4] = Result.success(detail(task(4, status = "done"), hasCheckpoint = true, accepted = true, checkpointId = "run1"))
            it.diffs[4] = Result.success(diff("run1"))
        }
        val s = vm(b).state.value
        assertTrue(s.accepted && !s.canAccept && s.canUndo)
    }

    // The «⋯» menu

    @Test fun theMenuOffersWhatThePcListsForATaskThatHasAProject() = runTest(dispatcher) {
        val b = backend("run1", diff("run1"))
        val s = vm(b).state.value
        assertTrue(s.canReview && s.canSecurity && s.canBranch)
        assertEquals("api-pagos", s.project)
    }

    @Test fun reviewAndSecurityAndBranchAskThePcWithTheTasksProject() = runTest(dispatcher) {
        val b = backend("run1", diff("run1"))
        val vm = vm(b)
        val said = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { said += it } }
        vm.review(); runCurrent()
        vm.securityReview(); runCurrent()
        vm.showBranch(); runCurrent()
        assertEquals(listOf("review 4", "security api-pagos", "branch api-pagos"), b.calls)
        assertTrue(said.toString(), "Revisión solicitada" in said && "Rama del proyecto: main" in said)
        assertTrue(said.toString(), said.any { it.startsWith("Revisión de seguridad pedida") })
    }

    @Test fun theBranchOfAFolderThatIsNoRepositoryIsToldSo() = runTest(dispatcher) {
        val b = backend("run1", diff("run1"))
        b.branchResult = Result.success(null)
        val vm = vm(b)
        val said = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { said += it } }
        vm.showBranch(); runCurrent()
        assertEquals(listOf("La carpeta del proyecto no es un repositorio."), said)
    }

    @Test fun aTaskWithoutProjectOffersNeitherTheSecurityReviewNorTheBranch() = runTest(dispatcher) {
        val b = FakeTasksBackend().also {
            it.details[4] = Result.success(detail(task(4, status = "done", project = null), hasCheckpoint = true))
            it.diffs[4] = Result.success(TaskDiff(true, oneFile, 0))
        }
        val vm = vm(b)
        val s = vm.state.value
        assertFalse(s.canSecurity || s.canBranch)
        vm.securityReview(); vm.showBranch(); runCurrent()
        assertEquals(emptyList<String>(), b.calls)
    }

    @Test fun theReviewIsOnlyOfferedForAFinishedTask() = runTest(dispatcher) {
        val b = FakeTasksBackend().also {
            it.details[4] = Result.success(detail(task(4, status = "running"), hasCheckpoint = true))
            it.diffs[4] = Result.success(TaskDiff(true, oneFile, 0))
        }
        assertFalse(vm(b).state.value.canReview)
    }
}

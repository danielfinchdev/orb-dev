package dev.orb.app.ui.chats

import dev.orb.app.ui.tasks.TaskAction
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
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

/**
 * A finished task's card offers «Aceptar» and «Deshacer» only when the diff the PC has counted is of the run the task is at now:
 * a task that ran again leaves the earlier run's diff behind, and deciding on it would be deciding on work nobody has seen.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OrbeChatDiffRunTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = kotlinx.coroutines.Dispatchers.setMain(dispatcher)
    @After fun tearDown() = kotlinx.coroutines.Dispatchers.resetMain()

    private fun TestScope.vm(b: FakeOrbeChatBackend): OrbeChatViewModel {
        val vm = OrbeChatViewModel(b, 7, clock = { 5_000L }, dispatcher = dispatcher)
        runCurrent()
        return vm
    }

    private fun TestScope.said(vm: OrbeChatViewModel): ArrayList<String> {
        val out = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { out += it } }
        return out
    }

    private val two = listOf(raw(1, "usuario", "El carrito no guarda"), raw(2, "orb", "Se lo encargo a Claude"))
    private fun attention(id: Long, task: Long) = raw(id, "system", "⚠️ La #$task espera tu OK", """{"kind":"attention","task":$task}""")
    private val doneActions = setOf(TaskAction.SeeChanges, TaskAction.UndoHeld, TaskAction.AcceptHeld)

    private fun backend(stat: TaskStat?): FakeOrbeChatBackend {
        val b = FakeOrbeChatBackend(two + attention(5, 42))
        b.taskDetail = b.taskDetail.copy(status = "done", actions = doneActions, checkpointId = "run2")
        b.statOnPc = stat
        return b
    }

    private fun TestScope.actionsOf(b: FakeOrbeChatBackend): Set<TaskAction> {
        val vm = vm(b)
        vm.watchTask(42)
        runCurrent()
        return vm.state.value.taskInfo[42]!!.actions
    }

    @Test fun aDiffOfAnotherRunTakesAcceptAndUndoOffTheCard() = runTest(dispatcher) {
        val actions = actionsOf(backend(TaskStat(3, 10, 2, checkpointId = "run1", runKnown = true)))
        // «Cambios» stays: looking is always safe.
        assertTrue(TaskAction.SeeChanges in actions)
        assertFalse(TaskAction.AcceptHeld in actions)
        assertFalse(TaskAction.UndoHeld in actions)
    }

    @Test fun aDiffOfTheSameRunKeepsThem() = runTest(dispatcher) {
        val actions = actionsOf(backend(TaskStat(3, 10, 2, checkpointId = "run2", runKnown = true)))
        assertTrue(TaskAction.AcceptHeld in actions && TaskAction.UndoHeld in actions && TaskAction.SeeChanges in actions)
    }

    @Test fun aPcThatCannotSayWhichRunTheDiffIsOfTakesThemOff() = runTest(dispatcher) {
        val actions = actionsOf(backend(TaskStat(3, 10, 2, checkpointId = null, runKnown = true)))
        assertFalse(TaskAction.AcceptHeld in actions || TaskAction.UndoHeld in actions)
    }

    @Test fun aPcThatDoesNotNameTheRunIsTreatedAsBefore() = runTest(dispatcher) {
        val actions = actionsOf(backend(TaskStat(3, 10, 2)))
        assertTrue(TaskAction.AcceptHeld in actions && TaskAction.UndoHeld in actions)
    }

    @Test fun aDiffTheLastRunHasNotLeftYetTakesThemOff() = runTest(dispatcher) {
        val actions = actionsOf(backend(TaskStat(0, null, null, notReady = true)))
        assertTrue(TaskAction.SeeChanges in actions)
        assertFalse(TaskAction.AcceptHeld in actions || TaskAction.UndoHeld in actions)
    }

    @Test fun acceptingFromACardOfAnotherRunSendsNothingToThePc() = runTest(dispatcher) {
        val b = backend(TaskStat(3, 10, 2, checkpointId = "run1", runKnown = true))
        val vm = vm(b)
        val said = said(vm)
        vm.watchTask(42)
        runCurrent()
        vm.acceptTask(42)
        runCurrent()
        assertTrue(b.calls.toString(), b.calls.none { it.startsWith("taskaccept") })
        vm.askUndo(42)
        assertNull(vm.state.value.undoAsk)
        assertTrue(said.isEmpty() || said.all { it == ChatTexts.ACCEPT_UNAVAILABLE })
    }

    @Test fun theCardFollowsTheRunOnTheNextReading() = runTest(dispatcher) {
        val b = backend(TaskStat(3, 10, 2, checkpointId = "run1", runKnown = true))
        val vm = vm(b)
        vm.watchTask(42)
        runCurrent()
        assertFalse(TaskAction.AcceptHeld in vm.state.value.taskInfo[42]!!.actions)
        // The PC has now counted the diff of the run the task is at.
        b.statOnPc = TaskStat(3, 10, 2, checkpointId = "run2", runKnown = true)
        b.events.tryEmit(dev.orb.app.link.net.LinkEvent("approval:changed", Json.parseToJsonElement("{}")))
        runCurrent()
        vm.acceptTask(42)
        runCurrent()
        assertEquals(1, b.calls.count { it.startsWith("taskaccept") })
        assertEquals(listOf<String?>("run2"), b.acceptCheckpoints)
    }

    @Test fun theCountsOfADiffNotOfTheRunAreNotShownOnTheCard() = runTest(dispatcher) {
        val b = backend(TaskStat(0, null, null, notReady = true))
        val vm = vm(b)
        vm.watchTask(42)
        runCurrent()
        assertNull(vm.state.value.taskStat[42])
    }

    @Test fun aFailedCountReadTakesAcceptAndUndoOffTheCardAndKeepsOnlyChanges() = runTest(dispatcher) {
        val b = backend(null)
        b.statResult = Result.failure(dev.orb.app.link.net.LinkException(dev.orb.app.link.net.LinkError.Timeout))
        val actions = actionsOf(b)
        assertTrue(TaskAction.SeeChanges in actions)
        assertFalse(TaskAction.AcceptHeld in actions || TaskAction.UndoHeld in actions)
    }

    @Test fun theOldCountIsDroppedWhenTheRunChangedAndTheReadFails() = runTest(dispatcher) {
        val b = backend(TaskStat(3, 10, 2, checkpointId = "run2", runKnown = true))
        val vm = vm(b)
        vm.watchTask(42)
        runCurrent()
        assertEquals(3, vm.state.value.taskStat[42]?.files)
        // The task ran again (another point of return) and the count cannot be read now.
        b.taskDetail = b.taskDetail.copy(checkpointId = "run3")
        b.statResult = Result.failure(dev.orb.app.link.net.LinkException(dev.orb.app.link.net.LinkError.Timeout))
        b.events.tryEmit(dev.orb.app.link.net.LinkEvent("approval:changed", Json.parseToJsonElement("{}")))
        runCurrent()
        assertNull(vm.state.value.taskStat[42])
        vm.askUndo(42)
        assertNull(vm.state.value.undoAsk)
    }

    private fun TestScope.cardFor(reason: String?, undone: Boolean = false): Pair<Boolean, Boolean> {
        val b = backend(if (reason == null) TaskStat(0, null, null, unreadable = true) else TaskStat(0, null, null, reason = reason))
        b.taskDetail = b.taskDetail.copy(undone = undone)
        val actions = actionsOf(b)
        assertTrue(TaskAction.SeeChanges in actions)
        return (TaskAction.AcceptHeld in actions) to (TaskAction.UndoHeld in actions)
    }

    /** The card follows the same table as the changes screen: accept, undo. */
    @Test fun theCardOffersForEachReasonWhatTheChangesScreenOffers() = runTest(dispatcher) {
        assertEquals(true to false, cardFor("nophoto"))
        assertEquals(true to true, cardFor("nogit"))
        assertEquals(false to false, cardFor("notdone"))
        assertEquals(false to false, cardFor("nophotoafter"))
        assertEquals(true to false, cardFor("joinedbyhand"))
        assertEquals(false to false, cardFor("resolveonpc"))
        assertEquals(true to false, cardFor("unknownrun"))
        assertEquals(true to false, cardFor("gone"))
    }

    @Test fun aReasonThisAppDoesNotKnowOrNoValidReadTakesBothButtonsOffTheCard() = runTest(dispatcher) {
        assertEquals(false to false, cardFor(null))
        val b = backend(OrbeParser.taskStat(Json.parseToJsonElement("""{"available":false,"reason":"somethingnew","files":[],"more":0}""")))
        val actions = actionsOf(b)
        assertTrue(TaskAction.SeeChanges in actions)
        assertFalse(TaskAction.AcceptHeld in actions || TaskAction.UndoHeld in actions)
    }

    @Test fun noPhotoOnATaskAlreadyUndoneOffersNoAcceptOnTheCard() = runTest(dispatcher) {
        assertEquals(false to false, cardFor("nophoto", undone = true))
    }

    @Test fun parsesTheRunAndTheNotReadyReasonOfTheDiff() {
        val parse = { s: String -> OrbeParser.taskStat(Json.parseToJsonElement(s)) }
        val ok = parse("""{"available":true,"files":[{"path":"a","added":1,"removed":0}],"more":0,"checkpointId":"cp9"}""")!!
        assertTrue(ok.runKnown && ok.isOfRun("cp9") && !ok.isOfRun("cp8") && !ok.isOfRun(null))
        val old = parse("""{"available":true,"files":[{"path":"a","added":1,"removed":0}],"more":0}""")!!
        assertTrue(!old.runKnown && old.isOfRun("cp8"))
        val noRun = parse("""{"available":true,"files":[{"path":"a","added":1,"removed":0}],"more":0,"checkpointId":null}""")!!
        assertTrue(noRun.runKnown && !noRun.isOfRun("cp8"))
        val notDone = parse("""{"available":false,"reason":"notdone","files":[],"more":0}""")!!
        assertTrue(notDone.notReady && !notDone.isOfRun("cp8"))
        assertEquals("nophoto", parse("""{"available":false,"reason":"nophoto","files":[],"more":0}""")!!.reason)
        assertEquals("joinedbyhand", parse("""{"available":false,"reason":"joinedbyhand","files":[],"more":0}""")!!.reason)
        assertEquals("nophotoafter", parse("""{"available":false,"reason":"nophotoafter","files":[],"more":0}""")!!.reason)
        assertTrue(parse("""{"available":false,"reason":"somethingnew","files":[],"more":0}""")!!.unreadable)
    }
}

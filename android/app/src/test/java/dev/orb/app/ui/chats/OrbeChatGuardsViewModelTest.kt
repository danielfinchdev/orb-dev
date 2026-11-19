package dev.orb.app.ui.chats

import dev.orb.app.data.ONLINE
import dev.orb.app.data.json
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.ui.tasks.TaskAction
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The guards the PC's new checks need from the phone: «Aceptar» and «Deshacer» on what is true now, folders, cut text and the queue. */
@OptIn(ExperimentalCoroutinesApi::class)
class OrbeChatGuardsViewModelTest {
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
    private fun FakeOrbeChatBackend.done() { taskDetail = taskDetail.copy(status = "done", actions = doneActions, checkpointId = "cp1") }

    // ---------- «Aceptar» ----------

    @Test fun aTaskHeldMeanwhileIsNotAcceptedFromAnOldCard() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention(5, 42))
        b.done()
        val vm = vm(b)
        val said = said(vm)
        vm.watchTask(42)
        runCurrent()
        assertTrue(TaskAction.AcceptHeld in vm.state.value.taskInfo[42]!!.actions)
        // The PC ran it again and Orb held it; the phone was not told.
        b.detailsOnPc[42] = b.taskDetail.copy(held = true, heldReasons = "ha eliminado 2714 archivos", actions = setOf(TaskAction.SeeChanges))
        vm.acceptTask(42)
        runCurrent()
        assertTrue(b.calls.toString(), b.calls.none { it.startsWith("taskaccept") })
        assertEquals(listOf(ChatTexts.ACCEPT_UNAVAILABLE), said)
        // The card is drawn again from what the PC says now.
        assertTrue(vm.state.value.taskInfo[42]!!.held)
        assertFalse(-42L in vm.state.value.busyCards)
    }

    @Test fun aTaskThatIsNotFinishedAnymoreIsNotAccepted() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention(5, 42))
        b.done()
        val vm = vm(b)
        val said = said(vm)
        vm.watchTask(42)
        runCurrent()
        b.detailsOnPc[42] = b.taskDetail.copy(status = "running", actions = emptySet())
        vm.acceptTask(42)
        runCurrent()
        assertTrue(b.calls.none { it.startsWith("taskaccept") })
        assertEquals(listOf(ChatTexts.ACCEPT_UNAVAILABLE), said)
        assertEquals("running", vm.state.value.taskInfo[42]!!.status)
    }

    @Test fun acceptFromTheCardAlwaysAsksThePcToRefuseAHeldTask() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention(5, 42))
        b.done()
        val vm = vm(b)
        val said = said(vm)
        vm.watchTask(42)
        runCurrent()
        vm.acceptTask(42)
        runCurrent()
        assertEquals(1, b.calls.count { it == "taskaccept 42" })
        assertEquals(listOf(true), b.acceptUnheld)
        assertEquals(listOf<String?>("cp1"), b.acceptCheckpoints)
        assertEquals(listOf(ChatTexts.TASK_ACCEPTED), said)
    }

    @Test fun aTaskThatRanAgainAndFinishedWithoutAHoldIsNotAcceptedAtTheFirstTap() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention(5, 42))
        b.done()
        val vm = vm(b)
        val said = said(vm)
        vm.watchTask(42)
        runCurrent()
        // A follow-up made it run again and it finished clean: another run, with a result the card never showed.
        b.detailsOnPc[42] = b.taskDetail.copy(checkpointId = "cp2")
        vm.acceptTask(42)
        runCurrent()
        assertTrue(b.calls.toString(), b.calls.none { it.startsWith("taskaccept") })
        assertEquals(listOf(ChatTexts.ACCEPT_CHANGED), said)
        // The card is drawn again from the new run, and a second tap accepts that one.
        assertEquals("cp2", vm.state.value.taskInfo[42]!!.checkpointId)
        vm.acceptTask(42)
        runCurrent()
        assertEquals(listOf<String?>("cp2"), b.acceptCheckpoints)
    }

    @Test fun thePcsRefusalToAcceptIsShownWordForWordAndTheCardIsRead() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention(5, 42))
        b.done()
        val vm = vm(b)
        val said = said(vm)
        vm.watchTask(42)
        runCurrent()
        val reason = "la tarea está retenida por la guardia; revisa sus cambios en el PC antes de aceptarla"
        b.acceptResult = refused(reason)
        // Held between the reread and the request.
        b.onAction = { b.detailsOnPc[42] = b.taskDetail.copy(held = true, actions = setOf(TaskAction.SeeChanges)) }
        val reads = b.calls.count { it == "detail 42" }
        vm.acceptTask(42)
        runCurrent()
        assertEquals(listOf(reason), said)
        assertTrue(b.calls.count { it == "detail 42" } >= reads + 2)
        assertTrue(vm.state.value.taskInfo[42]!!.held)
    }

    @Test fun twoTapsOnAcceptSendOneRequest() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention(5, 42))
        b.done()
        val vm = vm(b)
        vm.watchTask(42)
        runCurrent()
        vm.acceptTask(42)
        vm.acceptTask(42)
        runCurrent()
        assertEquals(1, b.calls.count { it == "taskaccept 42" })
    }

    // ---------- reading the cards again ----------

    @Test fun theCardsOfTheThreadAreReadAgainWhenTheLinkComes() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention(5, 42))
        b.done()
        val vm = vm(b)
        vm.watchTask(42)
        runCurrent()
        b.goOffline()
        runCurrent()
        // While the link was down the PC held the task.
        b.detailsOnPc[42] = b.taskDetail.copy(held = true, actions = setOf(TaskAction.SeeChanges))
        val reads = b.calls.count { it == "detail 42" }
        b.connectionState.value = ONLINE
        runCurrent()
        advanceTimeBy(OrbeChatViewModel.LIVE_GAP_MS + 1)
        runCurrent()
        assertTrue(b.calls.count { it == "detail 42" } > reads)
        assertTrue(vm.state.value.taskInfo[42]!!.held)
    }

    @Test fun withMoreCardsThanTheLimitTheNewestOnesAreRead() = runTest(dispatcher) {
        // 15 tasks, #101 (oldest card) to #115 (newest); the cards come in the thread in that order.
        val rows = two + (101L..115L).mapIndexed { i, t -> attention(10L + i, t) }
        val b = FakeOrbeChatBackend(rows)
        b.done()
        val vm = vm(b)
        for (t in 101L..115L) {
            b.detailsOnPc[t] = b.taskDetail.copy(id = t, status = "queued", actions = emptySet())
            vm.watchTask(t)
        }
        runCurrent()
        b.calls.clear()
        b.events.tryEmit(dev.orb.app.link.net.LinkEvent("board:changed", json("{}")))
        runCurrent()
        val read = b.calls.filter { it.startsWith("detail ") }.map { it.removePrefix("detail ").toLong() }.toSet()
        assertEquals(12, read.size)
        // The three oldest cards are the ones left out.
        assertEquals((104L..115L).toSet(), read)
    }

    // ---------- «Deshacer» ----------

    @Test fun undoSendsThePointOfReturnTheDialogWasOpenedOn() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention(5, 42))
        b.done()
        val vm = vm(b)
        vm.watchTask(42)
        runCurrent()
        vm.askUndo(42)
        runCurrent()
        assertEquals("cp1", vm.state.value.undoAsk?.checkpoint)
        // The task runs again while the dialog is open: its point of return is another one now.
        b.detailsOnPc[42] = b.taskDetail.copy(checkpointId = "cp2")
        vm.confirmUndo()
        runCurrent()
        assertEquals(listOf<String?>("cp1"), b.undoCheckpoints)
    }

    @Test fun aPcThatGivesNoPointOfReturnIsAskedAsBefore() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention(5, 42))
        b.taskDetail = b.taskDetail.copy(status = "done", actions = doneActions)
        val vm = vm(b)
        vm.watchTask(42)
        runCurrent()
        vm.askUndo(42)
        vm.confirmUndo()
        runCurrent()
        assertEquals(listOf<String?>(null), b.undoCheckpoints)
    }

    @Test fun whenThePcRefusesTheUndoNothingIsDoneItsWordsAreShownAndTheCardIsRead() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention(5, 42))
        b.done()
        val vm = vm(b)
        val said = said(vm)
        vm.watchTask(42)
        runCurrent()
        vm.askUndo(42)
        val reason = "la tarea se ha vuelto a ejecutar desde que abriste «Deshacer»; ábrela de nuevo para revisarla"
        b.undoResult = refused(reason)
        val undone = ArrayList<Long>()
        backgroundScope.launch { vm.undone.collect { undone += it } }
        vm.confirmUndo()
        runCurrent()
        assertEquals(listOf(reason), said)
        assertTrue(undone.isEmpty())
        assertNull(vm.state.value.undoAsk)
        assertFalse(-42L in vm.state.value.busyCards)
    }

    // ---------- the number of changes ----------

    @Test fun anOldCountDoesNotReplaceANewerRead() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention(5, 42))
        b.done()
        b.statOnPc = TaskStat(3, 10, 2)
        val vm = vm(b)
        vm.watchTask(42)
        runCurrent()
        assertEquals(3, vm.state.value.taskStat[42]?.files)
        // A read is held on its way; meanwhile a newer one is made and answers with other counts.
        val gate = CompletableDeferred<Unit>()
        b.statGate = gate
        b.events.tryEmit(dev.orb.app.link.net.LinkEvent("approval:changed", json("{}")))
        runCurrent()
        b.statOnPc = TaskStat(7, 70, 20)
        b.statGate = null
        vm.acceptTask(42)
        runCurrent()
        assertEquals(7, vm.state.value.taskStat[42]?.files)
        // The old count arrives late.
        gate.complete(Unit)
        runCurrent()
        assertEquals(7, vm.state.value.taskStat[42]?.files)
    }

    // ---------- folders and cut text ----------

    private fun waiting(extra: String): TaskDetail {
        val src = json(
            """{"id":42,"title":"Guardar el carrito","status":"awaiting_approval","agent":"claude","project_path":"C:/orb/tienda","folderNow":"C:/orb/tienda","sensitivity":[],
            "previewHash":"h","description":"Guarda el carrito.","events":[]$extra}""",
        )
        return OrbeParser.taskDetail(src, 42, { true })!!
    }

    @Test fun aFolderTheTaskMovedFromIsNeverApprovedFromACard() {
        val moved = waiting(""","folderMoved":true""")
        assertTrue(moved.folderMoved == true && moved.folderChanged)
        assertFalse(moved.approvable)
        assertFalse(moved.approvableFromCard)
        assertTrue(waiting(""","folderMoved":false""").approvableFromCard)
    }

    @Test fun twoFoldersWithTheSameLastNameAreAMoveWhenThePcSaysSo() {
        val d = waiting(""","folderMoved":true""").copy(project = "D:/otros/tienda", folderNow = "C:/orb/tienda")
        assertTrue(d.folderChanged)
        assertFalse(d.approvableFromCard)
        // Without the PC's word the old comparison of the two names stands: it warns, and the hash covers the folder shown.
        val old = waiting("").copy(project = "D:/otros/tienda", folderNow = "C:/orb/tienda")
        assertNull(old.folderMoved)
        assertTrue(old.folderChanged)
        assertTrue(old.approvable)
        // Without the PC saying whether the folder moved, the card does not approve directly: the dialog or the task's screen does.
        assertFalse(old.approvableFromCard)
    }

    @Test fun theGuardParametersOfAcceptOnlyGoToAPcThatChecksThem() {
        val json = { u: Boolean?, c: String?, pc: Boolean -> dev.orb.app.ui.tasks.TaskParams.accept(42, u, c, pc).toString() }
        assertEquals("""{"id":42,"unheld":true,"checkpoint":"cp1"}""", json(true, "cp1", true))
        assertEquals("""{"id":42}""", json(true, "cp1", false))
        assertEquals("""{"id":42}""", json(null, null, true))
    }

    @Test fun aFolderOutsideOrbsOwnIsNeverApprovedFromACard() {
        val d = waiting(""","folderOutside":true""")
        assertTrue(d.folderOutside)
        assertFalse(d.approvable)
        assertFalse(d.approvableFromCard)
    }

    @Test fun aCutDescriptionNeedsTheDialogButCanBeApprovedThere() {
        val d = waiting(""","descriptionCut":true""")
        assertTrue(d.descriptionCut)
        assertTrue(d.approvable)
        assertFalse(d.approvableFromCard)
    }

    @Test fun aMovedOrOutsideFolderIsNotApprovedFromTheDialogEitherAndOpensTheTask() = runTest(dispatcher) {
        for (extra in listOf(""","folderMoved":true""", ""","folderOutside":true""")) {
            val b = FakeOrbeChatBackend(two + attention(5, 42))
            b.taskDetail = waiting(extra).copy(actions = setOf(TaskAction.Approve))
            val vm = vm(b)
            val opened = ArrayList<Long>()
            backgroundScope.launch { vm.openTask.collect { opened += it } }
            vm.watchTask(42)
            runCurrent()
            vm.askApproval(42)
            runCurrent()
            assertTrue(extra, b.calls.none { it.startsWith("task 42") })
            assertNull(extra, vm.state.value.approval)
            assertEquals(extra, listOf(42L), opened)
        }
    }

    @Test fun aPcThatSaysNothingNewStillApprovesAsBefore() {
        val d = waiting("")
        assertNull(d.folderMoved)
        assertFalse(d.folderOutside || d.descriptionCut)
        assertNull(d.checkpointId)
        assertTrue(d.approvable)
        assertFalse(d.approvableFromCard)
    }
}

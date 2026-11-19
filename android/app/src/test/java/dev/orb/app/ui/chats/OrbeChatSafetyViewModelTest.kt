package dev.orb.app.ui.chats

import dev.orb.app.data.json
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.LinkException
import dev.orb.app.ui.tasks.TaskAction
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
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

/** The checks that keep a decision from a card honest: what was read last, what the PC allows now, one call per tap. */
@OptIn(ExperimentalCoroutinesApi::class)
class OrbeChatSafetyViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = kotlinx.coroutines.Dispatchers.setMain(dispatcher)
    @After fun tearDown() = kotlinx.coroutines.Dispatchers.resetMain()

    private fun TestScope.vm(b: FakeOrbeChatBackend): OrbeChatViewModel {
        val vm = OrbeChatViewModel(b, 7, clock = { 5_000L }, dispatcher = dispatcher)
        runCurrent()
        return vm
    }

    private val two = listOf(raw(1, "usuario", "El carrito no guarda"), raw(2, "orb", "Se lo encargo a Claude"))
    private val attention = raw(5, "system", "⚠️ La #42 espera tu OK", """{"kind":"attention","task":42}""")
    private val doneActions = setOf(TaskAction.SeeChanges, TaskAction.UndoHeld, TaskAction.AcceptHeld)

    private fun TestScope.said(vm: OrbeChatViewModel): ArrayList<String> {
        val out = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { out += it } }
        return out
    }

    @Test fun anOldReadThatArrivesAfterTheRejectionDoesNotBringTheButtonBack() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention)
        val cancelled = b.taskDetail.copy(status = "cancelled", actions = emptySet(), decision = "rejected")
        b.onAction = { if (it == "task 42 false") b.detailsOnPc[42] = cancelled }
        val vm = vm(b)
        vm.watchTask(42)
        runCurrent()
        // A read leaves the PC while the task still waits and is slow to arrive.
        val late = CompletableDeferred<Unit>()
        b.staleNext = late
        b.events.tryEmit(LinkEvent("board:changed", json("""{}""")))
        runCurrent()
        vm.rejectTask(42)
        runCurrent()
        assertEquals("cancelled", vm.state.value.taskInfo[42]?.status)
        late.complete(Unit)
        runCurrent()
        assertEquals("cancelled", vm.state.value.taskInfo[42]?.status)
        assertEquals("rejected", vm.state.value.taskInfo[42]?.decision)
        assertTrue(TaskAction.Approve !in vm.state.value.taskInfo[42]!!.actions)
    }

    @Test fun undoReadsTheTaskAgainAndDoesNothingIfItChangedMeanwhile() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention)
        b.taskDetail = b.taskDetail.copy(status = "done", actions = doneActions)
        val vm = vm(b)
        val said = said(vm)
        vm.watchTask(42)
        runCurrent()
        vm.askUndo(42)
        runCurrent()
        assertEquals(42L, vm.state.value.undoAsk?.task)
        // While the dialog is open the task runs again.
        b.detailsOnPc[42] = b.taskDetail.copy(status = "running", actions = emptySet())
        vm.confirmUndo()
        runCurrent()
        assertTrue(b.calls.toString(), b.calls.none { it == "undo 42" })
        assertEquals(listOf(ChatTexts.UNDO_UNAVAILABLE), said)
        assertFalse(-42L in vm.state.value.busyCards)
        assertEquals("running", vm.state.value.taskInfo[42]?.status)
    }

    @Test fun undoDoesNothingIfTheTaskCannotBeReadAnymore() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention)
        b.taskDetail = b.taskDetail.copy(status = "done", actions = doneActions)
        val vm = vm(b)
        said(vm)
        vm.watchTask(42)
        runCurrent()
        vm.askUndo(42)
        b.detailResult = Result.failure(LinkException(LinkError.Refused(404, "No existe esa tarea")))
        vm.confirmUndo()
        runCurrent()
        assertTrue(b.calls.none { it == "undo 42" })
    }

    @Test fun undoStillWorksWhenTheTaskIsAsItWas() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention)
        b.taskDetail = b.taskDetail.copy(status = "done", actions = doneActions)
        val vm = vm(b)
        vm.watchTask(42)
        runCurrent()
        vm.askUndo(42)
        vm.confirmUndo()
        runCurrent()
        assertEquals(1, b.calls.count { it == "undo 42" })
    }

    @Test fun aHeldTaskNeverOffersAcceptOrUndoToTheCard() {
        val held = json(
            """{"id":45,"title":"Limpiar","status":"blocked","agent":"codex","project_path":"C:/app-movil","sensitivity":[],"previewHash":"h","folderMoved":false,
            "held":{"reasons":"ha eliminado 2714 archivos","folder":"C:/app-movil"},"hasCheckpoint":true,"accepted":false,"events":[]}""",
        )
        val d = OrbeParser.taskDetail(held, 45, { true })!!
        assertTrue(d.held)
        assertEquals("ha eliminado 2714 archivos", d.heldReasons)
        assertEquals("C:/app-movil", d.heldFolder)
        assertTrue(TaskAction.AcceptHeld !in d.actions && TaskAction.UndoHeld !in d.actions)
        assertTrue(TaskAction.SeeChanges in d.actions)
    }

    @Test fun theHashCoversTheAgentNotWhoRunsIt() {
        val src = json(
            """{"id":42,"title":"T","status":"awaiting_approval","agent":"any","assigned_to":"claude","project_path":"C:/p","folderNow":"C:/p","sensitivity":[],
            "previewHash":"h","folderMoved":false,"description":"hace algo","user_asked":["push"],"readonly":1,"fast":0,"mode":"carpeta","reasoning":"high","events":[]}""",
        )
        val d = OrbeParser.taskDetail(src, 42, { true })!!
        assertEquals("any", d.agent)
        assertEquals("claude", d.runner)
        assertEquals(listOf("push"), d.userAsked)
        assertTrue(d.readonly)
        // What the person's own message asked for is covered by the hash and not drawn: the card cannot approve it.
        assertFalse(d.approvable)
        assertTrue(OrbeParser.taskDetail(src, 42, { true })!!.copy(userAsked = emptyList()).approvable)
    }

    // ---------- the PC's queue ----------

    private val q1 = OrbeQueued("q1", "y luego súbelo a la rama dev", 1_000L)

    @Test fun twoTapsOnRemoveFromTheQueueAskOnce() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        b.queueOnPc = listOf(q1)
        val vm = vm(b)
        val said = said(vm)
        b.events.tryEmit(stateEvent(7, busy = true, queued = 1))
        runCurrent()
        vm.removeQueued("q1")
        vm.removeQueued("q1")
        runCurrent()
        vm.removeQueued("q1")
        runCurrent()
        assertEquals(1, b.calls.count { it == "queue-remove q1" })
        assertTrue(said.toString(), said.none { it == ChatTexts.QUEUE_STARTED })
    }

    @Test fun savingAMessageEditedOnThePcDoesNotOverwriteItAndLoadsTheNewText() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        b.queueOnPc = listOf(q1)
        val vm = vm(b)
        b.events.tryEmit(stateEvent(7, busy = true, queued = 1))
        runCurrent()
        vm.openQueued("q1")
        b.queueOnPc = listOf(q1.copy(text = "y luego súbelo a main"))
        vm.saveQueued("y luego súbelo a la rama dev, por favor")
        runCurrent()
        assertTrue(b.calls.toString(), b.calls.none { it.startsWith("queue-edit") })
        val editor = vm.state.value.queueEditor!!
        assertEquals("y luego súbelo a main", editor.item.text)
        assertEquals(ChatTexts.QUEUE_CHANGED, editor.error)
        assertFalse(editor.busy)
        // Seen the new text, the person decides: now it saves.
        vm.saveQueued("y luego súbelo a main y avísame")
        runCurrent()
        assertEquals(1, b.calls.count { it == "queue-edit q1 y luego súbelo a main y avísame" })
        assertNull(vm.state.value.queueEditor)
    }

    @Test fun savingAMessageThatLeftTheQueueClosesTheEditorAndSaysSo() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        b.queueOnPc = listOf(q1)
        val vm = vm(b)
        val said = said(vm)
        b.events.tryEmit(stateEvent(7, busy = true, queued = 1))
        runCurrent()
        vm.openQueued("q1")
        b.queueOnPc = emptyList()
        vm.saveQueued("otro texto")
        runCurrent()
        assertTrue(b.calls.none { it.startsWith("queue-edit") })
        assertNull(vm.state.value.queueEditor)
        assertEquals(listOf(ChatTexts.QUEUE_STARTED), said)
    }
}

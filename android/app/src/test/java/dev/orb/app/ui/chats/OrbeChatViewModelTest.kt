package dev.orb.app.ui.chats

import dev.orb.app.data.json
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.LinkException
import dev.orb.app.ui.tasks.TaskAction
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class OrbeChatViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = kotlinx.coroutines.Dispatchers.setMain(dispatcher)
    @After fun tearDown() = kotlinx.coroutines.Dispatchers.resetMain()

    private fun TestScope.vm(b: FakeOrbeChatBackend): OrbeChatViewModel {
        val vm = OrbeChatViewModel(b, 7, clock = { 5_000L }, dispatcher = dispatcher)
        runCurrent()
        return vm
    }

    private val two = listOf(raw(1, "usuario", "El carrito no guarda"), raw(2, "orb", "Se lo encargo a Claude"))

    private fun OrbeChatViewModel.msgs() = state.value.items.filterIsInstance<ChatItem.Msg>().map { it.message }

    @Test fun showsTheSavedThreadThenTheOneFromThePc() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        b.onLoad = { b.rows.value = two + raw(3, "orb", "Listo") }
        val vm = vm(b)
        assertEquals(listOf(1L, 2L, 3L), vm.msgs().map { it.id })
        assertEquals("Carrito que no guarda", vm.state.value.title)
        assertEquals(1, b.loads)
        assertTrue(b.calls.contains("read"))
        assertEquals("preguntar", vm.state.value.mode)
    }

    @Test fun deltasMoveOnlyTheLiveText() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        val vm = vm(b)
        b.events.tryEmit(stateEvent(7, busy = true, partial = ""))
        runCurrent()
        val before = vm.state.value
        assertTrue(vm.liveInfo.value!!.busy)
        assertEquals("", vm.liveText.value.text)
        b.events.tryEmit(stateEvent(7, busy = true, partial = "Hol"))
        runCurrent()
        b.events.tryEmit(stateEvent(7, busy = true, partial = "Hola, ya"))
        runCurrent()
        assertEquals("Hola, ya", vm.liveText.value.text)
        // The list itself was not touched, so its rows are not drawn again.
        assertSame(before, vm.state.value)
    }

    @Test fun activityIsReadFromTheLastTool() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        val vm = vm(b)
        b.events.tryEmit(stateEvent(7, busy = true, tools = """[{"name":"Read","target":"store.ts"}]"""))
        runCurrent()
        assertEquals("Leyendo store.ts", vm.liveInfo.value!!.activity)
    }

    @Test fun endOfTurnReplacesTheLiveBubbleWithTheFinalLine() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        val vm = vm(b)
        b.events.tryEmit(stateEvent(7, busy = true, partial = "Hola"))
        runCurrent()
        b.events.tryEmit(stateEvent(7, busy = false, answer = raw(5, "orb", "Hola, listo")))
        runCurrent()
        assertNull(vm.liveInfo.value)
        assertEquals("", vm.liveText.value.text)
        assertEquals(listOf(1L, 2L, 5L), vm.msgs().map { it.id })
    }

    @Test fun otherConversationsAreIgnored() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        val vm = vm(b)
        b.events.tryEmit(stateEvent(99, busy = true, partial = "x"))
        runCurrent()
        assertNull(vm.liveInfo.value)
    }

    @Test fun reloadEventReadsTheThreadAgain() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        val vm = vm(b)
        val before = b.loads
        b.events.tryEmit(LinkEvent(LinkEvent.RELOAD, json("""{"conversation":"7"}""")))
        runCurrent()
        assertEquals(before + 1, b.loads)
        assertEquals(2, vm.msgs().size)
    }

    @Test fun chatNewShowsAtOnceAndIsReplacedByTheWholeLine() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        val vm = vm(b)
        b.onLoad = { b.rows.value = two + raw(4, "system", "Tarea #42 empezó") }
        b.events.tryEmit(LinkEvent("chat:new", json("""{"role":"system","body":"Tarea #42 empezó","meta":null,"conversation":7}""")))
        runCurrent()
        // After the reload the provisional copy is gone and the saved one stays.
        assertEquals(listOf(1L, 2L, 4L), vm.msgs().map { it.id })
        assertFalse(vm.state.value.items.any { (it as? ChatItem.Msg)?.provisional == true })
    }

    @Test fun sendingShowsTheMessageAtOnceAndKeepsItWhileTheLineComesBack() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        val vm = vm(b)
        vm.send("  Hazlo, y avísame  ")
        runCurrent()
        val waiting = vm.state.value.items.last() as ChatItem.Waiting
        assertEquals("Hazlo, y avísame", waiting.pending.text)
        // The sender takes it: it leaves the queue and the PC's own line replaces it, matched by its clientId.
        b.onLoad = { b.rows.value = two + raw(6, "usuario", "Hazlo, y avísame", extra = ",\"clientId\":\"c1\"") }
        b.queue.value = emptyList()
        runCurrent()
        assertEquals(listOf(1L, 2L, 6L), vm.msgs().map { it.id })
        assertFalse(vm.state.value.items.any { it is ChatItem.Waiting })
    }

    @Test fun offlineKeepsAcceptingMessages() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        val vm = vm(b)
        b.goOffline()
        runCurrent()
        assertFalse(vm.state.value.online)
        vm.send("Hazlo")
        runCurrent()
        assertEquals(PendingState.Waiting, (vm.state.value.items.last() as ChatItem.Waiting).pending.state)
        assertEquals(2, vm.msgs().size)
    }

    @Test fun aFailedMessageCanBeRetriedOrRemoved() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        val vm = vm(b)
        b.queue.value = listOf(PendingMessage("x", "no salió", PendingState.Failed, "el PC no respondió", 1))
        runCurrent()
        vm.retrySend("x")
        vm.discard("x")
        runCurrent()
        assertTrue(b.calls.containsAll(listOf("retry x", "discard x")))
        assertTrue(vm.state.value.items.none { it is ChatItem.Waiting })
    }

    private val ask = listOf(raw(1, "usuario", "hola"), raw(3, "orb", "¿Dónde guardo el carrito?", questionMeta()))

    @Test fun answeringWithAnOption() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(ask)
        val vm = vm(b)
        vm.answer(vm.msgs().last(), listOf("IndexedDB"), null, false)
        runCurrent()
        assertTrue(b.calls.contains("answer 3 IndexedDB - false"))
        val card = vm.msgs().last().card as MsgCard.Question
        assertEquals("answered", card.status)
        assertEquals("IndexedDB", card.answer)
    }

    @Test fun answeringWithOtherWordsAndSkipping() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(ask)
        val vm = vm(b)
        vm.answer(vm.msgs().last(), emptyList(), "En un archivo", false)
        runCurrent()
        assertTrue(b.calls.contains("answer 3  En un archivo false"))
        assertEquals("En un archivo", (vm.msgs().last().card as MsgCard.Question).answer)

        val b2 = FakeOrbeChatBackend(ask)
        val vm2 = vm(b2)
        vm2.answer(vm2.msgs().last(), emptyList(), null, true)
        runCurrent()
        assertTrue(b2.calls.contains("answer 3  - true"))
        assertEquals("skipped", (vm2.msgs().last().card as MsgCard.Question).status)
    }

    @Test fun aQuestionAlreadyAnsweredRefreshesAndSays() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(ask)
        val vm = vm(b)
        b.actionResult = refused("esa pregunta ya está respondida")
        val said = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { said += it } }
        val loads = b.loads
        vm.answer(vm.msgs().last(), listOf("IndexedDB"), null, false)
        runCurrent()
        assertEquals(listOf(ChatTexts.QUESTION_GONE), said)
        assertEquals(loads + 1, b.loads)
        assertEquals("pending", (vm.msgs().last().card as MsgCard.Question).status)
    }

    @Test fun acceptingAReport() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(listOf(raw(8, "orb", "Informe", """{"kind":"report","tasks":[42,43],"accepted":false}""")))
        val vm = vm(b)
        vm.accept(vm.msgs().last())
        runCurrent()
        assertTrue(b.calls.contains("accept 8"))
        assertTrue((vm.msgs().last().card as MsgCard.Report).accepted)
    }

    @Test fun permissionModeIsAskedOfThePcAndUndoneIfRefused() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        val vm = vm(b)
        vm.setMode("auto")
        runCurrent()
        assertEquals("auto", vm.state.value.mode)
        assertTrue(b.calls.contains("mode auto"))
        b.actionResult = refused("no")
        vm.setMode("preguntar")
        runCurrent()
        assertEquals("auto", vm.state.value.mode)
    }

    @Test fun aDeletedChatShowsTheA28State() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        b.loadResult = Result.failure(LinkException(LinkError.Refused(400, "Esa conversación ya no existe.")))
        val vm = vm(b)
        assertTrue(vm.state.value.deleted)
    }

    @Test fun aChatInTheTrashShowsA28AndRestoreBringsItBack() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        b.loadResult = Result.failure(LinkException(LinkError.Refused(400, "Ese chat está en la papelera. Restáuralo para seguir.")))
        val vm = vm(b)
        assertTrue(vm.state.value.deleted)
        assertTrue(vm.state.value.canRestore)
        b.loadResult = Result.success(0)
        vm.restore()
        runCurrent()
        assertTrue(b.calls.contains("restore"))
        assertFalse(vm.state.value.deleted)
    }

    @Test fun withoutTheRestoreMethodA28OffersNoRestore() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two).apply { restoreAvailable = false }
        b.loadResult = Result.failure(LinkException(LinkError.Refused(400, "Esa conversación ya no existe.")))
        val vm = vm(b)
        assertFalse(vm.state.value.canRestore)
    }

    @Test fun stopAndCompactAreRequestsToThePc() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        val vm = vm(b)
        vm.stop()
        vm.compact()
        runCurrent()
        assertTrue(b.calls.containsAll(listOf("stop", "compact")))
    }

    @Test fun approvingATaskShowsItsDetailFirst() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        val vm = vm(b)
        vm.askApproval(42)
        runCurrent()
        assertEquals("Guardar el carrito", vm.state.value.approval!!.detail.title)
        assertFalse(b.calls.any { it.startsWith("task") })
        vm.confirmApproval()
        runCurrent()
        assertTrue(b.calls.contains("task 42 true h1"))
        assertNull(vm.state.value.approval)
        vm.rejectTask(42)
        runCurrent()
        assertTrue(b.calls.contains("task 42 false h1"))
    }

    @Test fun aSecondTapOnATaskWhileTheFirstIsPendingIsIgnored() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        val vm = vm(b)
        b.detailGate = kotlinx.coroutines.CompletableDeferred()
        vm.askApproval(42)
        vm.askApproval(42)
        vm.rejectTask(42)
        runCurrent()
        assertEquals(1, b.calls.count { it.startsWith("detail") })
        assertTrue(-42L in vm.state.value.busyCards)
        b.detailGate!!.complete(Unit)
        runCurrent()
        assertFalse(-42L in vm.state.value.busyCards)
        vm.confirmApproval()
        vm.confirmApproval()
        runCurrent()
        assertEquals(1, b.calls.count { it.startsWith("task 42 true") })
        assertFalse(-42L in vm.state.value.busyCards)
    }

    @Test fun theApprovalDetailCarriesTheModelAndReadableReasons() {
        assertEquals("Claude (opus)", ChatTexts.agentWithModel("Claude", "opus"))
        assertEquals("Claude", ChatTexts.agentWithModel("Claude", null))
        assertEquals("pagos", ChatTexts.reason("financial"))
        assertEquals("otro", ChatTexts.reason("otro"))
        assertEquals("Completada", ChatTexts.taskStatus("done"))
    }

    @Test fun anAgentRequestIsDecidedOnThePc() = runTest(dispatcher) {
        val meta = """{"kind":"task-approval","session":"s1","task":42,"request":"r9","detail":"npm install idb-keyval","status":"pending"}"""
        val b = FakeOrbeChatBackend(listOf(raw(9, "system", "Claude quiere instalar un paquete", meta)))
        val vm = vm(b)
        vm.decideRequest(vm.msgs().last(), "allow")
        runCurrent()
        assertTrue(b.calls.contains("request s1 r9 allow"))
        assertEquals("allowed", (vm.msgs().last().card as MsgCard.Permission).status)
    }

    @Test fun olderLinesComeWhenAskedFor() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(listOf(raw(100, "usuario", "a"), raw(101, "orb", "b")))
        b.loadResult = Result.success(150)
        val vm = vm(b)
        b.loadResult = Result.success(120)
        b.onLoad = { before -> if (before != null) b.rows.value = listOf(raw(50, "usuario", "antes")) + b.rows.value }
        vm.loadOlder()
        runCurrent()
        assertTrue(b.calls.contains("load 100"))
        assertEquals(50L, vm.msgs().first().id)
    }

    @Test fun joiningAMidTurnPicksUpTheLiveState() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        b.chatOnPc = json("""{"conversation":7,"busy":true,"since":1,"partial":"Va por la mitad","tools":[],"queued":0,"waiting":false}""") as JsonObject
        val vm = vm(b)
        assertEquals("Va por la mitad", vm.liveText.value.text)
        assertTrue(vm.liveInfo.value!!.busy)
    }

    @Test fun aMessageThePcTookCarriesOneTickUntilItsOwnLineComesBack() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        val vm = vm(b)
        vm.send("Hazlo")
        runCurrent()
        assertEquals(PendingState.Waiting, (vm.state.value.items.last() as ChatItem.Waiting).pending.state)
        // chat.send answered (the queued copy is gone) but the thread does not have the line yet: handed over, not saved.
        b.loadResult = refused("todavía no").map { 0 }
        b.queue.value = emptyList()
        runCurrent()
        assertEquals(PendingState.Arrived, (vm.state.value.items.last() as ChatItem.Waiting).pending.state)
        // The PC's own line is the proof that it is saved.
        b.loadResult = Result.success(0)
        b.rows.value = two + raw(6, "usuario", "Hazlo", extra = ",\"clientId\":\"c1\"")
        vm.retryLoad()
        runCurrent()
        assertTrue(vm.state.value.items.none { it is ChatItem.Waiting })
        assertEquals(MsgRole.User, vm.msgs().last().role)
    }

    @Test fun theHourOfWritingTravelsWithTheQueuedMessage() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        val vm = vm(b)
        b.queue.value = listOf(PendingMessage("a", "primero", PendingState.Waiting, null, 111L), PendingMessage("b", "segundo", PendingState.Waiting, null, 222L))
        runCurrent()
        val waiting = vm.state.value.items.filterIsInstance<ChatItem.Waiting>()
        assertEquals(listOf("primero", "segundo"), waiting.map { it.pending.text })
        assertEquals(listOf(111L, 222L), waiting.map { it.pending.at })
    }

    @Test fun theBrainIsReadFromThePcAndKeptWhenItSaysNothing() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        b.brainOnPc = BrainInfo("Claude Code", "Opus", "high")
        val vm = vm(b)
        assertEquals("Opus · alto", vm.state.value.brain?.label)
        val b2 = FakeOrbeChatBackend(two)
        assertNull(vm(b2).state.value.brain)
    }

    @Test fun onlyTheRunningTasksTheThreadTalksAboutGetALiveCard() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + raw(3, "system", "Tarea #42 creada", """{"task":42}""") + raw(4, "orb", "La #43 es para Claude"))
        b.liveOnPc = listOf(
            LiveTask(42, "Registro", "codex", "Leyendo src/push.ts", null, false),
            LiveTask(43, "Prueba", "claude", null, 10, false),
            LiveTask(99, "De otro chat", "cursor", null, null, false),
        )
        val vm = vm(b)
        assertEquals(listOf(42L, 43L), vm.state.value.liveTasks.map { it.id })
        // The PC says it ended: the card goes.
        b.liveOnPc = emptyList()
        vm.refreshLive()
        dispatcher.scheduler.advanceTimeBy(OrbeChatViewModel.LIVE_GAP_MS + 1)
        runCurrent()
        assertTrue(vm.state.value.liveTasks.isEmpty())
    }

    @Test fun theTaskBehindACardKeepsItsTitleAndAgent() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + raw(5, "system", "⚠️ La #42 espera tu OK", """{"kind":"attention","task":42}"""))
        val vm = vm(b)
        vm.watchTask(42)
        runCurrent()
        assertEquals("Guardar el carrito", vm.state.value.taskInfo[42]?.title)
        assertEquals("awaiting_approval", vm.state.value.taskStatus[42])
    }

    // ---------- Approving and undoing from the card ----------

    private val attention = raw(5, "system", "⚠️ La #42 espera tu OK", """{"kind":"attention","task":42}""")
    private val doneActions = setOf(TaskAction.SeeChanges, TaskAction.UndoHeld, TaskAction.AcceptHeld)

    private fun TestScope.said(vm: OrbeChatViewModel): MutableList<String> {
        val out = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { out += it } }
        return out
    }

    private fun TestScope.opened(vm: OrbeChatViewModel): MutableList<Long> {
        val out = ArrayList<Long>()
        backgroundScope.launch { vm.openTask.collect { out += it } }
        return out
    }

    @Test fun theDialogApprovesWithTheFingerprintOfTheTextItShows() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention)
        val vm = vm(b)
        vm.watchTask(42)
        runCurrent()
        assertTrue(vm.state.value.taskInfo[42]!!.approvable)
        vm.askApproval(42)
        runCurrent()
        assertEquals("h1", vm.state.value.approval!!.detail.hash)
        assertTrue(b.calls.none { it.startsWith("task ") })
        vm.confirmApproval()
        runCurrent()
        assertEquals(1, b.calls.count { it.startsWith("task 42 true") })
        assertTrue(b.calls.contains("task 42 true h1"))
    }

    @Test fun theViewModelHasNoWayToApproveFromACard() {
        // A card only opens the task: the entry point that approved with the fingerprint a card had drawn is gone.
        assertTrue(OrbeChatViewModel::class.java.methods.none { it.name == "approveFromCard" })
    }

    @Test fun aTaskWithoutAFingerprintIsNotApprovedFromTheDialogAndOpensTheTask() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention)
        b.taskDetail = b.taskDetail.copy(hash = null)
        val vm = vm(b)
        val opened = opened(vm)
        vm.watchTask(42)
        runCurrent()
        assertFalse(vm.state.value.taskInfo[42]!!.approvable)
        vm.askApproval(42)
        runCurrent()
        assertNull(vm.state.value.approval)
        assertTrue(b.calls.none { it.startsWith("task ") })
        assertEquals(listOf(42L), opened)
    }

    @Test fun aTaskThatCannotBeDescribedIsNotApprovedFromTheDialog() = runTest(dispatcher) {
        for (broken in listOf(
            FakeOrbeChatBackend(two).taskDetail.copy(agent = null),
            FakeOrbeChatBackend(two).taskDetail.copy(title = ""),
            FakeOrbeChatBackend(two).taskDetail.copy(actions = emptySet()),
        )) {
            val b = FakeOrbeChatBackend(two + attention)
            b.taskDetail = broken
            val vm = vm(b)
            val opened = opened(vm)
            vm.watchTask(42)
            runCurrent()
            vm.askApproval(42)
            runCurrent()
            assertTrue(b.calls.none { it.startsWith("task ") })
            assertEquals(listOf(42L), opened)
        }
    }

    @Test fun aTaskNobodyHasReadYetShowsTheDescriptionBeforeAnyOk() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention)
        val vm = vm(b)
        // No watchTask: nothing was read, so the dialog reads the task and approves what it shows.
        vm.askApproval(42)
        runCurrent()
        assertEquals("h1", vm.state.value.approval!!.detail.hash)
        assertTrue(b.calls.none { it.startsWith("task ") })
        vm.confirmApproval()
        runCurrent()
        assertTrue(b.calls.contains("task 42 true h1"))
    }

    @Test fun ifTheAppDidNotKnowYetThePcRefusesTheOldFingerprintAndTheTaskIsReadAgain() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention)
        val vm = vm(b)
        val said = said(vm)
        vm.watchTask(42)
        runCurrent()
        vm.askApproval(42)
        runCurrent()
        b.detailsOnPc[42] = b.taskDetail.copy(hash = "h2")
        b.actionResult = refused("La tarea #42 cambió desde que la viste.")
        vm.confirmApproval()
        runCurrent()
        assertTrue(b.calls.contains("task 42 true h1"))
        assertEquals("h2", vm.state.value.taskInfo[42]!!.hash)
        assertEquals(1, said.size)
        assertFalse(-42L in vm.state.value.busyCards)
    }

    @Test fun rejectingFromTheCardSendsTheHashOfTheTask() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention)
        val vm = vm(b)
        b.detailsOnPc[42] = b.taskDetail.copy(status = "cancelled", actions = emptySet(), decision = "rejected")
        vm.rejectTask(42)
        runCurrent()
        assertTrue(b.calls.contains("task 42 false h1"))
        val folded = vm.state.value.taskInfo[42]!!
        assertEquals("rejected", folded.decision)
    }

    @Test fun approvingFoldsTheCardAndSaysSo() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention)
        val vm = vm(b)
        val said = said(vm)
        vm.watchTask(42)
        runCurrent()
        vm.askApproval(42)
        runCurrent()
        // What the PC answers once it approved: queued, with the approval in its history.
        b.detailsOnPc[42] = b.taskDetail.copy(status = "queued", actions = emptySet(), decision = "approved")
        vm.confirmApproval()
        runCurrent()
        assertEquals("approved", vm.state.value.taskInfo[42]!!.decision)
        assertEquals("queued", vm.state.value.taskStatus[42])
        assertEquals(listOf(ChatTexts.APPROVED_SNACK), said)
    }

    @Test fun undoAsksFirstAndOnlyTouchesThePcAfterTheYes() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention)
        b.taskDetail = b.taskDetail.copy(status = "done", actions = doneActions, hash = null)
        b.statOnPc = TaskStat(3, 42, 7)
        val vm = vm(b)
        val undone = ArrayList<Long>()
        backgroundScope.launch { vm.undone.collect { undone += it } }
        vm.watchTask(42)
        runCurrent()
        vm.askUndo(42)
        runCurrent()
        assertEquals(UndoAsk(42, "Guardar el carrito", 3), vm.state.value.undoAsk)
        assertTrue(b.calls.none { it.startsWith("undo") })
        vm.dismissUndo()
        vm.confirmUndo()
        runCurrent()
        assertTrue(b.calls.none { it.startsWith("undo") })
        vm.askUndo(42)
        vm.confirmUndo()
        runCurrent()
        assertEquals(1, b.calls.count { it == "undo 42" })
        assertEquals(listOf(42L), undone)
        assertNull(vm.state.value.undoAsk)
    }

    @Test fun undoAndAcceptOnlyExistForWhatThePcAllowsForThatTask() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention)
        // A task that still waits has no changes to undo or accept: nothing is asked, nothing is sent.
        val vm = vm(b)
        vm.watchTask(42)
        runCurrent()
        vm.askUndo(42)
        vm.acceptTask(42)
        runCurrent()
        assertNull(vm.state.value.undoAsk)
        assertTrue(b.calls.none { it.startsWith("undo") || it.startsWith("taskaccept") })
        b.detailsOnPc[42] = b.taskDetail.copy(status = "done", actions = setOf(TaskAction.AcceptHeld))
        b.events.tryEmit(LinkEvent("board:changed", json("""{}""")))
        runCurrent()
        vm.askUndo(42)
        assertNull(vm.state.value.undoAsk)
        vm.acceptTask(42)
        runCurrent()
        assertTrue(b.calls.contains("taskaccept 42"))
    }

    @Test fun theCountsOfAFinishedTaskAreOnlyAskedWhereThereAreChanges() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two + attention)
        b.taskDetail = b.taskDetail.copy(status = "done", actions = doneActions)
        b.statOnPc = TaskStat(3, 42, 7)
        val vm = vm(b)
        vm.watchTask(42)
        runCurrent()
        assertEquals(TaskStat(3, 42, 7), vm.state.value.taskStat[42])
        // An older PC says nothing usable: the card has no counts, and nothing breaks.
        val old = FakeOrbeChatBackend(two + attention)
        old.taskDetail = old.taskDetail.copy(status = "done", actions = doneActions)
        old.statOnPc = null
        val vm2 = vm(old)
        vm2.watchTask(42)
        runCurrent()
        assertNull(vm2.state.value.taskStat[42])
        assertEquals(setOf(TaskAction.SeeChanges, TaskAction.UndoHeld, TaskAction.AcceptHeld), vm2.state.value.taskInfo[42]!!.actions)
        val failing = FakeOrbeChatBackend(two + attention)
        failing.taskDetail = failing.taskDetail.copy(status = "done", actions = doneActions)
        failing.statResult = refused("x").map { null }
        val vm3 = vm(failing)
        vm3.watchTask(42)
        runCurrent()
        assertNull(vm3.state.value.taskStat[42])
    }

    // ---------- The PC's queue behind the running turn ----------

    private val q1 = OrbeQueued("q1", "y luego súbelo a la rama dev", 1_000L)
    private val q2 = OrbeQueued("q2", "avísame cuando acabe", 2_000L)

    @Test fun theQueueIsListedAndAskedAgainWhenTheStateChanges() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        b.queueOnPc = listOf(q1, q2)
        val vm = vm(b)
        assertEquals(listOf(q1, q2), vm.state.value.queue)
        assertTrue(vm.state.value.canEditQueue)
        // The PC changed it (the desktop took one out) and says so with chat:state.
        b.queueOnPc = listOf(q2)
        advanceTimeBy(1_100)
        b.events.tryEmit(stateEvent(7, busy = true, queued = 1))
        runCurrent()
        assertEquals(listOf(q2), vm.state.value.queue)
        assertTrue(b.queueReads >= 2)
    }

    @Test fun editingAQueuedMessageSendsItsIdAndTheNewText() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        b.queueOnPc = listOf(q1, q2)
        val vm = vm(b)
        vm.openQueued("q1")
        runCurrent()
        assertEquals(q1, vm.state.value.queueEditor!!.item)
        vm.saveQueued("  y luego súbelo a main  ")
        runCurrent()
        assertTrue(b.calls.contains("queue-edit q1 y luego súbelo a main"))
        assertNull(vm.state.value.queueEditor)
        assertEquals("y luego súbelo a main", vm.state.value.queue.first().text)
    }

    @Test fun removingAQueuedMessageKeepsTheOthersInOrder() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        b.queueOnPc = listOf(q1, q2)
        val vm = vm(b)
        vm.removeQueued("q1")
        runCurrent()
        assertTrue(b.calls.contains("queue-remove q1"))
        assertEquals(listOf(q2), vm.state.value.queue)
    }

    @Test fun anEmptyEditIsNotSentAndANoChangeJustCloses() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        b.queueOnPc = listOf(q1)
        val vm = vm(b)
        vm.openQueued("q1")
        vm.saveQueued("   ")
        runCurrent()
        assertEquals(ChatTexts.QUEUE_EMPTY, vm.state.value.queueEditor!!.error)
        vm.saveQueued(q1.text)
        runCurrent()
        assertNull(vm.state.value.queueEditor)
        assertTrue(b.calls.none { it.startsWith("queue-edit") })
    }

    @Test fun thePcsRefusalIsShownWordForWordAndTheEditorStaysOpen() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        b.queueOnPc = listOf(q1)
        val vm = vm(b)
        val text = "Un mensaje en cola no puede ser un comando (/clear, /compact): quítalo y envía el comando."
        b.editResult = Result.failure(LinkException(LinkError.Refused(400, text)))
        vm.openQueued("q1")
        runCurrent()
        vm.saveQueued("/clear")
        runCurrent()
        val ed = vm.state.value.queueEditor!!
        assertEquals(text, ed.error)
        assertFalse(ed.busy)
        assertEquals(q1, ed.item)
    }

    @Test fun ifTheMessageStartedWhileEditingTheEditorClosesAndSaysSo() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        b.queueOnPc = listOf(q1)
        val vm = vm(b)
        val said = said(vm)
        vm.openQueued("q1")
        runCurrent()
        // The queue no longer has it (the turn took it) and the PC says the state changed.
        b.queueOnPc = emptyList()
        advanceTimeBy(1_100)
        b.events.tryEmit(stateEvent(7, busy = true, queued = 0))
        runCurrent()
        assertNull(vm.state.value.queueEditor)
        assertEquals(listOf(ChatTexts.QUEUE_STARTED), said)
    }

    @Test fun ifTheSaveIsRefusedBecauseItLeftTheQueueTheEditorClosesAndSaysSo() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        b.queueOnPc = listOf(q1)
        val vm = vm(b)
        val said = said(vm)
        b.editResult = Result.failure(LinkException(LinkError.Refused(400, "Ese mensaje ya no está en la cola.")))
        vm.openQueued("q1")
        vm.saveQueued("otra cosa")
        runCurrent()
        assertNull(vm.state.value.queueEditor)
        assertEquals(listOf(ChatTexts.QUEUE_STARTED), said)
    }

    @Test fun aPcWithoutTheQueueKeepsTheCountOnly() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        b.queueAvailable = false
        val vm = vm(b)
        b.events.tryEmit(stateEvent(7, busy = true, queued = 2))
        runCurrent()
        assertFalse(vm.state.value.canEditQueue)
        assertEquals(0, b.queueReads)
        assertEquals(2, vm.liveInfo.value!!.queued)
        assertTrue(vm.state.value.queue.isEmpty())
    }
}

package dev.orb.app.ui.chats

import dev.orb.app.data.json
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.LinkException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
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
}

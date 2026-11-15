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
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DirectChatViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = kotlinx.coroutines.Dispatchers.setMain(dispatcher)
    @After fun tearDown() = kotlinx.coroutines.Dispatchers.resetMain()

    private fun TestScope.vm(b: FakeDirectChatBackend): DirectChatViewModel {
        val vm = DirectChatViewModel(b, "s1", clock = { 5_000L }, dispatcher = dispatcher)
        runCurrent()
        return vm
    }

    private val base = listOf(sitem(1, "user", "text", jstr("Pon un límite de 3 intentos")), sitem(2, "assistant", "text", jstr("Voy")))

    private fun DirectChatViewModel.kinds() = state.value.items.map { it::class.simpleName }
    private fun DirectChatViewModel.approval() = state.value.items.filterIsInstance<DItem.Approval>().single()

    @Test fun showsTheSavedThreadThenTheOneFromThePc() = runTest(dispatcher) {
        val b = FakeDirectChatBackend(base)
        b.onLoad = { b.rows.value = base + sitem(3, "assistant", "text", jstr("Listo")) }
        val vm = vm(b)
        assertEquals(listOf("User", "Assistant", "Assistant"), vm.kinds())
        assertEquals("Límite de reintentos", vm.state.value.title)
        assertEquals("GPT-5.5", vm.state.value.model)
        assertEquals(1, b.loads)
        assertTrue(b.calls.contains("read"))
    }

    @Test fun deltasMoveOnlyTheLiveText() = runTest(dispatcher) {
        val b = FakeDirectChatBackend(base)
        b.infoOnPc = sessionInfo(status = "running")
        val vm = vm(b)
        assertTrue(vm.state.value.busy)
        val before = vm.state.value
        b.events.tryEmit(deltaEvent("Hol")); runCurrent()
        b.events.tryEmit(deltaEvent("a, ya")); runCurrent()
        // A delta is a piece: the pieces add up.
        assertEquals("Hola, ya", vm.liveText.value.text)
        assertSame(before, vm.state.value)
    }

    @Test fun theFinalLineReplacesTheLiveTextWithoutAGap() = runTest(dispatcher) {
        val b = FakeDirectChatBackend(base)
        b.infoOnPc = sessionInfo(status = "running")
        val vm = vm(b)
        b.events.tryEmit(deltaEvent("Hola, ya")); runCurrent()
        b.events.tryEmit(itemEvent(9, "assistant", "text", jstr("Hola, ya está"))); runCurrent()
        assertEquals("Hola, ya está", vm.state.value.items.filterIsInstance<DItem.Assistant>().last().text)
        assertEquals("", vm.liveText.value.text)
    }

    @Test fun whenTheTurnEndsTheStateIsReloaded() = runTest(dispatcher) {
        val b = FakeDirectChatBackend(base)
        b.infoOnPc = sessionInfo(status = "running")
        val vm = vm(b)
        val loads = b.loads
        b.events.tryEmit(deltaEvent("a medias")); runCurrent()
        b.infoOnPc = sessionInfo(status = "idle")
        b.events.tryEmit(updateEvent("idle")); runCurrent()
        assertFalse(vm.state.value.busy)
        assertEquals("", vm.liveText.value.text)
        assertTrue(b.loads > loads)
    }

    @Test fun allowAlwaysAndDenyCarryTheExactParams() = runTest(dispatcher) {
        for ((decision, status) in listOf("allow" to "allowed", "always" to "always", "deny" to "denied")) {
            val b = FakeDirectChatBackend(base + sitem(5, "system", "approval", approvalBody()))
            val vm = vm(b)
            assertTrue(vm.approval().pending)
            vm.decide(vm.approval(), decision); runCurrent()
            assertTrue(b.calls.toString(), b.calls.contains("decide s1 r1 $decision"))
            assertEquals(status, vm.approval().status)
        }
    }

    @Test fun aPendingRequestFromTheListShowsBeforeTheThreadHasIt() = runTest(dispatcher) {
        val b = FakeDirectChatBackend(base)
        b.approvalsOnPc = listOf(json(sitem(7, "system", "approval", approvalBody("r9"))) as kotlinx.serialization.json.JsonObject)
        val vm = vm(b)
        assertEquals("r9", vm.approval().request)
        assertTrue(vm.approval().pending)
    }

    @Test fun aRequestThatIsGoneClosesTheCardAndSaysSo() = runTest(dispatcher) {
        val b = FakeDirectChatBackend(base + sitem(5, "system", "approval", approvalBody()))
        val vm = vm(b)
        val said = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { said += it } }
        b.actionResult = refused("esa petición ya no está activa: el agente ha terminado o se ha detenido")
        vm.decide(vm.approval(), "allow"); runCurrent()
        assertEquals("expired", vm.approval().status)
        assertEquals(listOf("Esa petición ya caducó"), said)
    }

    @Test fun aRequestIsNotSentTwice() = runTest(dispatcher) {
        val b = FakeDirectChatBackend(base + sitem(5, "system", "approval", approvalBody()))
        val vm = vm(b)
        val a = vm.approval()
        vm.decide(a, "allow"); vm.decide(a, "deny"); runCurrent()
        assertEquals(1, b.calls.count { it.startsWith("decide") })
    }

    @Test fun whileWorkingTheMessageSteersOrQueuesAndOtherwiseIsPlain() = runTest(dispatcher) {
        val b = FakeDirectChatBackend(base)
        b.infoOnPc = sessionInfo(status = "running")
        val vm = vm(b)
        vm.send("  mejor 5 intentos  ", SendMode.Steer); runCurrent()
        vm.send("y luego los docs", SendMode.Queue); runCurrent()
        vm.send("sin modo"); runCurrent()
        assertEquals(listOf("send steer mejor 5 intentos", "send queue y luego los docs", "send steer sin modo"), b.calls.filter { it.startsWith("send") })
        b.infoOnPc = sessionInfo(status = "idle")
        b.events.tryEmit(updateEvent("idle")); runCurrent()
        vm.send("ahora sí"); runCurrent()
        assertEquals("send - ahora sí", b.calls.last { it.startsWith("send") })
    }

    @Test fun anAgentThatCannotSteerQueuesByDefault() = runTest(dispatcher) {
        val b = FakeDirectChatBackend(base)
        b.infoOnPc = sessionInfo(status = "running", agent = "cursor")
        val vm = vm(b)
        assertFalse(vm.state.value.canSteer)
        vm.send("sin modo"); runCurrent()
        assertEquals(listOf("send queue sin modo"), b.calls.filter { it.startsWith("send") })
    }

    @Test fun theQueueTrayFollowsTheEventAndEditsGoToThePc() = runTest(dispatcher) {
        val b = FakeDirectChatBackend(base)
        b.infoOnPc = sessionInfo(status = "running")
        val vm = vm(b)
        b.events.tryEmit(queueEvent("uno", "dos", "tres")); runCurrent()
        assertEquals(listOf("uno", "dos", "tres"), vm.state.value.queue.map { it.text })
        b.queueOnPc = vm.state.value.queue
        vm.moveQueued(vm.state.value.queue[1], up = true); runCurrent()
        assertTrue(b.calls.toString(), b.calls.contains("edit 2 - false up"))
        vm.editQueued(vm.state.value.queue[2], "tres bis"); runCurrent()
        assertTrue(b.calls.toString(), b.calls.contains("edit 3 tres bis false -"))
        vm.removeQueued(vm.state.value.queue[0]); runCurrent()
        assertTrue(b.calls.toString(), b.calls.contains("edit 1 - true -"))
    }

    @Test fun aRefusedQueueEditGetsTheRealQueueBack() = runTest(dispatcher) {
        val b = FakeDirectChatBackend(base)
        val vm = vm(b)
        b.events.tryEmit(queueEvent("uno", "dos")); runCurrent()
        b.queueOnPc = vm.state.value.queue
        b.actionResult = refused("no se pudo")
        vm.removeQueued(vm.state.value.queue[0]); runCurrent()
        assertEquals(listOf("uno", "dos"), vm.state.value.queue.map { it.text })
    }

    @Test fun offlineMessagesWaitAndStayVisible() = runTest(dispatcher) {
        val b = FakeDirectChatBackend(base)
        val vm = vm(b)
        b.goOffline(); runCurrent()
        assertFalse(vm.state.value.online)
        vm.send("Hazlo y avísame"); runCurrent()
        val waiting = vm.state.value.items.last() as DItem.Waiting
        assertEquals(PendingState.Waiting, waiting.pending.state)
        assertEquals("Hazlo y avísame", waiting.pending.text)
    }

    @Test fun aSentMessageBecomesItsOwnLineWithoutShowingTwice() = runTest(dispatcher) {
        val b = FakeDirectChatBackend(base)
        val vm = vm(b)
        vm.send("Hazlo"); runCurrent()
        b.onLoad = { b.rows.value = base + sitem(6, "user", "text", jstr("Hazlo")) }
        b.outbox.value = emptyList(); runCurrent()
        assertEquals(listOf("User", "Assistant", "User"), vm.kinds())
    }

    @Test fun aQueuedMessageLeavesNoGhostLine() = runTest(dispatcher) {
        val b = FakeDirectChatBackend(base)
        b.infoOnPc = sessionInfo(status = "running")
        val vm = vm(b)
        vm.send("luego", SendMode.Queue); runCurrent()
        b.outbox.value = emptyList(); runCurrent()
        assertFalse(vm.state.value.items.any { it is DItem.Waiting })
    }

    @Test fun removedSessionShowsTheDeletedState() = runTest(dispatcher) {
        val b = FakeDirectChatBackend(base)
        val vm = vm(b)
        b.events.tryEmit(LinkEvent("session:removed", json("""{"id":"s1"}"""))); runCurrent()
        assertTrue(vm.state.value.deleted)
    }

    @Test fun aPcThatSaysItIsGoneShowsTheDeletedState() = runTest(dispatcher) {
        val b = FakeDirectChatBackend()
        b.loadError = LinkException(LinkError.Refused(400, "esa conversación ya no existe"))
        val vm = vm(b)
        assertTrue(vm.state.value.deleted)
        assertTrue(vm.state.value.loaded)
    }

    @Test fun otherSessionsEventsAreIgnored() = runTest(dispatcher) {
        val b = FakeDirectChatBackend(base)
        val vm = vm(b)
        b.events.tryEmit(LinkEvent("session:delta", json("""{"id":"zz","text":"x"}"""))); runCurrent()
        b.events.tryEmit(LinkEvent("session:removed", json("""{"id":"zz"}"""))); runCurrent()
        assertEquals("", vm.liveText.value.text)
        assertFalse(vm.state.value.deleted)
    }

    @Test fun menuActionsAskThePc() = runTest(dispatcher) {
        val b = FakeDirectChatBackend(base)
        val vm = vm(b)
        val effects = ArrayList<DirectEffect>()
        backgroundScope.launch { vm.effects.collect { effects += it } }
        vm.compact(); vm.resume(); vm.settle(); vm.rename("  Nuevo nombre "); vm.fork(); vm.stop(); runCurrent()
        val asked = b.calls.filter { it in setOf("compact", "resume", "settle", "fork", "stop") || it.startsWith("rename") }
        assertEquals(listOf("compact", "resume", "settle", "rename Nuevo nombre", "fork", "stop"), asked)
        assertEquals(listOf<DirectEffect>(DirectEffect.Open("s2")), effects)
        assertEquals("Nuevo nombre", vm.state.value.title)
    }

    @Test fun aStoppedRunOffersToContinue() = runTest(dispatcher) {
        val b = FakeDirectChatBackend(base)
        b.infoOnPc = sessionInfo(status = "limited")
        val vm = vm(b)
        assertTrue(vm.state.value.stalled)
        assertTrue(vm.state.value.limited)
        assertNull(vm.state.value.activity)
    }

    @Test fun theWorkingLineNamesTheStepInProgress() = runTest(dispatcher) {
        val b = FakeDirectChatBackend(base)
        b.infoOnPc = sessionInfo(status = "running")
        val vm = vm(b)
        b.events.tryEmit(itemEvent(10, "tool", "tool", """{"id":"t1","name":"Bash","input":{"command":"npm test"}}""")); runCurrent()
        assertEquals("Ejecutando npm test", vm.state.value.activity)
        b.events.tryEmit(itemEvent(11, "tool", "tool_result", """{"id":"t1","output":"ok"}""")); runCurrent()
        assertNull(vm.state.value.activity)
    }
}

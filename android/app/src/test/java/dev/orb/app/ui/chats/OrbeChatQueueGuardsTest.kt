package dev.orb.app.ui.chats

import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The queued messages of the PC: what the phone saw goes back with every change, and an answer is only for the editor it was sent from. */
@OptIn(ExperimentalCoroutinesApi::class)
class OrbeChatQueueGuardsTest {
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

    private val q1 = OrbeQueued("q1", "y luego súbelo a la rama dev", 1_000L)

    private fun TestScope.queued(): Pair<FakeOrbeChatBackend, OrbeChatViewModel> {
        val b = FakeOrbeChatBackend(two)
        b.queueOnPc = listOf(q1)
        val vm = vm(b)
        b.events.tryEmit(stateEvent(7, busy = true, queued = 1))
        runCurrent()
        return b to vm
    }

    @Test fun editingAndRemovingSendTheTextThePersonSaw() = runTest(dispatcher) {
        val (b, vm) = queued()
        vm.openQueued("q1")
        vm.saveQueued("y luego súbelo a main")
        runCurrent()
        assertEquals(listOf<String?>("y luego súbelo a la rama dev"), b.editExpects)
        vm.openQueued("q1")
        vm.removeQueued("q1")
        runCurrent()
        assertEquals(listOf<String?>("y luego súbelo a la rama dev", "y luego súbelo a main"), b.editExpects)
    }

    @Test fun whenThePcRefusesBecauseTheTextChangedTheEditorIsLoadedAgain() = runTest(dispatcher) {
        val (b, vm) = queued()
        vm.openQueued("q1")
        // The text changes on the PC after the phone's own read of the queue and before the save arrives.
        b.onEdit = { b.queueOnPc = listOf(q1.copy(text = "texto nuevo del PC")) }
        b.editResult = refusedList("el mensaje en cola ha cambiado desde que lo viste; ábrelo de nuevo")
        vm.saveQueued("otro texto")
        runCurrent()
        val editor = vm.state.value.queueEditor!!
        assertEquals("texto nuevo del PC", editor.item.text)
        assertEquals(ChatTexts.QUEUE_CHANGED, editor.error)
        assertFalse(editor.busy)
    }

    @Test fun removingARefusedMessageReloadsTheQueueAndSaysSo() = runTest(dispatcher) {
        val (b, vm) = queued()
        val said = said(vm)
        b.editResult = refusedList("el mensaje en cola ha cambiado desde que lo viste; ábrelo de nuevo")
        b.onEdit = { b.queueOnPc = listOf(q1.copy(text = "otro")) }
        vm.removeQueued("q1")
        runCurrent()
        assertEquals(listOf(ChatTexts.QUEUE_CHANGED_REMOVE), said)
        assertEquals("otro", vm.state.value.queue.single().text)
    }

    @Test fun anAnswerThatComesLateDoesNotTouchAnotherEditor() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        val q2 = OrbeQueued("q2", "y avísame", 2_000L)
        b.queueOnPc = listOf(q1, q2)
        val vm = vm(b)
        b.events.tryEmit(stateEvent(7, busy = true, queued = 2))
        runCurrent()
        vm.openQueued("q1")
        val gate = CompletableDeferred<Unit>()
        b.editGate = gate
        vm.saveQueued("y luego súbelo a main")
        runCurrent()
        // Closed and opened on another message while the save is on its way.
        vm.closeQueued()
        vm.openQueued("q2")
        gate.complete(Unit)
        runCurrent()
        assertEquals("q2", vm.state.value.queueEditor?.item?.id)
        assertNotNull(vm.state.value.queueEditor)
        assertFalse(vm.state.value.queueEditor!!.busy)
        assertNull(vm.state.value.queueEditor!!.error)
    }

    @Test fun aRefusalThatComesLateDoesNotWriteIntoAnotherEditor() = runTest(dispatcher) {
        val b = FakeOrbeChatBackend(two)
        val q2 = OrbeQueued("q2", "y avísame", 2_000L)
        b.queueOnPc = listOf(q1, q2)
        val vm = vm(b)
        b.events.tryEmit(stateEvent(7, busy = true, queued = 2))
        runCurrent()
        vm.openQueued("q1")
        val gate = CompletableDeferred<Unit>()
        b.editGate = gate
        b.editResult = refusedList("demasiado largo")
        vm.saveQueued("y luego súbelo a main")
        runCurrent()
        vm.closeQueued()
        vm.openQueued("q1")
        gate.complete(Unit)
        runCurrent()
        // Same message, another opening of the editor: the old answer is not for it.
        assertNull(vm.state.value.queueEditor!!.error)
    }

    private fun refusedList(msg: String) = Result.failure<List<OrbeQueued>>(LinkException(LinkError.Refused(400, msg)))
}

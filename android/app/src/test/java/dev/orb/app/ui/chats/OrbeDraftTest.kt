package dev.orb.app.ui.chats

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
class OrbeDraftViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = kotlinx.coroutines.Dispatchers.setMain(dispatcher)
    @After fun tearDown() = kotlinx.coroutines.Dispatchers.resetMain()

    private val draft = OrbeDraft(true, "api-pagos", Brain("claude", "opus", "high"))

    private fun TestScope.vm(b: FakeNewChatBackend, d: OrbeDraft = draft, created: MutableList<Long> = ArrayList()): OrbeDraftViewModel {
        val ids = generateSequence(1) { it + 1 }.map { "c$it" }.iterator()
        val vm = OrbeDraftViewModel(b, d, newId = { ids.next() }, clock = { 5L })
        backgroundScope.launch { vm.created.collect { created += it } }
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        return vm
    }

    @Test fun opensWithNothingOnThePc() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        val vm = vm(b)
        assertTrue(b.calls.isEmpty())
        assertNull(vm.state.value.pending)
        assertEquals("api-pagos", vm.state.value.project)
    }

    @Test fun theFirstMessageCreatesTheConversationWithTheChosenProjectAndBrain() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        val created = ArrayList<Long>()
        val vm = vm(b, created = created)
        vm.send("  Haz el carrito  ")
        runCurrent()
        assertEquals(listOf("orbe text=Haz el carrito setProject=true project=api-pagos brain=claude/opus/high"), b.calls)
        assertEquals(listOf(41L), created)
    }

    @Test fun withTheActiveProjectLeftAloneThePcKeepsItsOwn() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        val vm = vm(b, OrbeDraft(false, "tienda-online", null))
        vm.send("hola")
        runCurrent()
        assertEquals(listOf("orbe text=hola setProject=false project=tienda-online brain=null"), b.calls)
    }

    @Test fun aBlankMessageCreatesNothing() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        val vm = vm(b)
        vm.send("   ")
        runCurrent()
        assertTrue(b.calls.isEmpty())
        assertNull(vm.state.value.pending)
    }

    @Test fun aRefusedMessageStaysWithItsReasonAndARetryReusesTheClientId() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        b.orbeResult = offline()
        val created = ArrayList<Long>()
        val vm = vm(b, created = created)
        vm.send("hola")
        runCurrent()
        val p = vm.state.value.pending!!
        assertEquals(PendingState.Failed, p.state)
        assertEquals("hola", p.text)
        assertEquals("Sin conexión con el PC.", p.error)
        assertTrue(created.isEmpty())
        b.orbeResult = Result.success(42L)
        vm.retry()
        runCurrent()
        assertEquals(listOf("c1", "c1"), b.clientIds)
        assertEquals(listOf(42L), created)
    }

    @Test fun discardingARefusedMessageLeavesNothingBehind() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        b.orbeResult = offline()
        val vm = vm(b)
        vm.send("hola")
        runCurrent()
        vm.discard()
        assertNull(vm.state.value.pending)
        // A new message is a new attempt with a new client id.
        b.orbeResult = Result.success(43L)
        vm.send("otra")
        runCurrent()
        assertEquals(listOf("c1", "c2"), b.clientIds)
    }

    @Test fun withoutTheLinkNothingIsSent() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        b.connectionState.value = ConnectionState.Offline(null, null)
        val vm = vm(b)
        vm.send("hola")
        runCurrent()
        assertTrue(b.calls.isEmpty())
        assertNull(vm.state.value.pending)
    }

    @Test fun theBrainIsNamedWithTheCatalogsLabelsOrThePcsOwnChoice() = runTest(dispatcher) {
        assertEquals("Opus · alto", vm(FakeNewChatBackend()).state.value.brain)
        val b = FakeNewChatBackend().apply { optionsResult = Result.success(sampleOptions.copy(pcBrain = BrainInfo("Claude Code", "Sonnet", "medium"))) }
        assertEquals("Sonnet · medio", vm(b, OrbeDraft(false, null, null)).state.value.brain)
        // The PC says nothing: nothing is invented.
        assertNull(vm(FakeNewChatBackend(), OrbeDraft(false, null, null)).state.value.brain)
    }

    @Test fun theLinkStateIsKeptForTheBand() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        val vm = vm(b)
        b.connectionState.value = ConnectionState.UpdatePc
        runCurrent()
        assertEquals(ConnectionState.UpdatePc, vm.state.value.connection)
        assertEquals(false, vm.state.value.online)
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w390dp-h844dp")
class OrbeDraftScreenTest {
    @get:Rule val rule = createComposeRule()

    private fun screen(b: FakeNewChatBackend, created: MutableList<Long> = ArrayList(), back: MutableList<Unit> = ArrayList(), d: OrbeDraft = OrbeDraft(true, "api-pagos", null)): OrbeDraftViewModel {
        val vm = OrbeDraftViewModel(b, d)
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) { OrbeDraftScreen(vm, onBack = { back += Unit }, onCreated = { created += it }) }
        }
        rule.waitForIdle()
        return vm
    }

    @Test fun showsTheChosenProjectAndInvitesToWrite() {
        screen(FakeNewChatBackend())
        rule.onNodeWithText("Nuevo chat").assertIsDisplayed()
        rule.onNodeWithText("api-pagos · con Orbe").assertIsDisplayed()
        rule.onNodeWithText("Escribe lo primero que necesitas. El chat se crea en el PC al enviarlo.").assertIsDisplayed()
    }

    @Test fun leavingWithoutWritingCallsNothing() {
        val b = FakeNewChatBackend()
        val back = ArrayList<Unit>()
        screen(b, back = back)
        rule.onNodeWithContentDescription("Volver").performClick()
        assertEquals(1, back.size)
        assertTrue(b.calls.isEmpty())
    }

    @Test fun sendingTheFirstMessageCreatesTheChatAndOpensIt() {
        val b = FakeNewChatBackend()
        val created = ArrayList<Long>()
        screen(b, created)
        rule.onNode(hasSetTextAction()).performTextInput("Haz el carrito")
        rule.onNodeWithContentDescription("Enviar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("orbe text=Haz el carrito setProject=true project=api-pagos brain=null"), b.calls)
        assertEquals(listOf(41L), created)
    }

    @Test fun aRefusedFirstMessageCanBeRetriedOrDiscarded() {
        val b = FakeNewChatBackend()
        b.orbeResult = offline()
        val vm = screen(b)
        rule.onNode(hasSetTextAction()).performTextInput("Haz el carrito")
        rule.onNodeWithContentDescription("Enviar").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Haz el carrito").assertIsDisplayed()
        rule.onNodeWithText("Reintentar").assertIsDisplayed()
        rule.onNodeWithText("Descartar").performClick()
        rule.waitForIdle()
        assertNull(vm.state.value.pending)
        rule.onNodeWithText("Escribe lo primero que necesitas. El chat se crea en el PC al enviarlo.").assertIsDisplayed()
    }

    @Test fun theBoxNamesTheBrainAndKeepsTheMicrophoneOff() {
        screen(FakeNewChatBackend(), d = OrbeDraft(true, "api-pagos", Brain("claude", "opus", "high")))
        rule.onNodeWithContentDescription("Agente de este chat: Opus · alto").assertIsDisplayed()
        rule.onNodeWithContentDescription("Este móvil no tiene dictado por voz").assertIsDisplayed()
    }

    @Test fun withoutWhatThePcSaysTheBrainReadsAsThePcs() {
        screen(FakeNewChatBackend())
        rule.onNodeWithContentDescription("Agente de este chat: El del PC").assertIsDisplayed()
    }

    @Test fun withoutTheLinkTheBandSaysSo() {
        val b = FakeNewChatBackend()
        b.connectionState.value = ConnectionState.Offline(null, null)
        screen(b)
        rule.onNodeWithText("Sin conexión con tu PC. Reintentando…").assertIsDisplayed()
    }

    @Test fun withoutTheLinkTheFieldIsNotOffered() {
        val b = FakeNewChatBackend()
        b.connectionState.value = ConnectionState.Offline(null, null)
        screen(b)
        rule.onNodeWithText("Sin conexión con el PC. Para enviar el primer mensaje hace falta conexión.").assertIsDisplayed()
        assertTrue(rule.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().isEmpty())
        assertNotNull(b)
    }
}

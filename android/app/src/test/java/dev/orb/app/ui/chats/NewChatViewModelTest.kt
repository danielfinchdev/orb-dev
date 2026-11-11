package dev.orb.app.ui.chats

import dev.orb.app.link.net.ConnectionState
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
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class NewChatViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = kotlinx.coroutines.Dispatchers.setMain(dispatcher)
    @After fun tearDown() = kotlinx.coroutines.Dispatchers.resetMain()

    private class Seen(val created: ArrayList<NewChatCreated> = ArrayList(), val said: ArrayList<String> = ArrayList())

    private fun TestScope.vm(b: FakeNewChatBackend): Pair<NewChatViewModel, Seen> {
        val ids = generateSequence(1) { it + 1 }.map { "c$it" }.iterator()
        val vm = NewChatViewModel(b, newId = { ids.next() })
        val seen = Seen()
        backgroundScope.launch { vm.created.collect { seen.created += it } }
        backgroundScope.launch { vm.messages.collect { seen.said += it } }
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        return vm to seen
    }

    @Test fun startsOnOrbeWithTheActiveProjectAndTheAgentsOfThePc() = runTest(dispatcher) {
        val (vm, _) = vm(FakeNewChatBackend())
        val s = vm.state.value
        assertNull(s.agent)
        assertEquals("tienda-online", s.project)
        assertEquals(listOf("claude", "codex"), s.options.agents.map { it.id })
        assertEquals(OptionsStatus.Ready, s.optionsStatus)
    }

    @Test fun orbeSendsWithoutConversationAndOnlyWhatWasChosen() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        val (vm, seen) = vm(b)
        vm.setText("  Haz el carrito  ")
        vm.create()
        runCurrent()
        assertEquals(listOf("orbe text=Haz el carrito setProject=false project=tienda-online brain=null"), b.calls)
        assertEquals(listOf(NewChatCreated("conversation", "41")), seen.created)
    }

    @Test fun orbeSendsTheChosenProjectAndBrain() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        val (vm, _) = vm(b)
        vm.pickProject("api-pagos")
        vm.pickBrain("claude", "opus", "high")
        vm.setText("hola")
        vm.create()
        runCurrent()
        assertEquals(listOf("orbe text=hola setProject=true project=api-pagos brain=claude/opus/high"), b.calls)
    }

    @Test fun orbeWithNoProjectSaysSoExplicitly() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        val (vm, _) = vm(b)
        vm.pickProject(null)
        vm.setText("hola")
        vm.create()
        runCurrent()
        assertEquals(listOf("orbe text=hola setProject=true project=null brain=null"), b.calls)
    }

    @Test fun anAgentChatGetsItsFirstLineAndOpensAsASession() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        val (vm, seen) = vm(b)
        vm.selectAgent("codex")
        vm.pickProject(null)
        vm.setText("mira esto")
        vm.create()
        runCurrent()
        assertEquals(listOf("create agent=codex project=null model=null reasoning=null", "send s9 mira esto"), b.calls)
        assertEquals(listOf(NewChatCreated("session", "s9")), seen.created)
    }

    @Test fun anAgentChatUsesTheChosenModelAndTheActiveProject() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        val (vm, _) = vm(b)
        vm.selectAgent("claude")
        vm.pickBrain("claude", "opus", "low")
        vm.setText("hola")
        vm.create()
        runCurrent()
        assertEquals("create agent=claude project=tienda-online model=opus reasoning=low", b.calls.first())
    }

    @Test fun anErrorKeepsTheTextAndARetryReusesWhatTheFirstTryMade() = runTest(dispatcher) {
        val b = FakeNewChatBackend().apply { sendResult = offline() }
        val (vm, seen) = vm(b)
        vm.selectAgent("claude")
        vm.setText("hola")
        vm.create()
        runCurrent()
        assertEquals("hola", vm.state.value.text)
        assertFalse(vm.state.value.sending)
        assertTrue(seen.said.single().startsWith("No se pudo crear el chat en el PC"))
        assertTrue(seen.created.isEmpty())
        b.sendResult = Result.success(Unit)
        vm.create()
        runCurrent()
        // One session was created; the retry only sent the line again, with the same client id.
        assertEquals(1, b.calls.count { it.startsWith("create") })
        assertEquals(2, b.calls.count { it.startsWith("send") })
        assertEquals(1, b.clientIds.toSet().size)
        assertEquals(listOf(NewChatCreated("session", "s9")), seen.created)
    }

    @Test fun anOrbeErrorKeepsTheTextAndTheClientId() = runTest(dispatcher) {
        val b = FakeNewChatBackend().apply { orbeResult = Result.failure(LinkException(LinkError.Timeout)) }
        val (vm, seen) = vm(b)
        vm.setText("hola")
        vm.create()
        runCurrent()
        assertEquals("hola", vm.state.value.text)
        b.orbeResult = Result.success(7L)
        vm.create()
        runCurrent()
        assertEquals(1, b.clientIds.toSet().size)
        assertEquals(listOf(NewChatCreated("conversation", "7")), seen.created)
    }

    @Test fun aSecondTapWhileOneIsOnItsWayDoesNothing() = runTest(dispatcher) {
        val gate = CompletableDeferred<Unit>()
        val b = FakeNewChatBackend().apply { this.gate = gate }
        val (vm, seen) = vm(b)
        vm.setText("hola")
        vm.create()
        vm.create()
        runCurrent()
        assertTrue(vm.state.value.sending)
        vm.create()
        runCurrent()
        assertEquals(1, b.calls.size)
        gate.complete(Unit)
        runCurrent()
        assertEquals(1, seen.created.size)
    }

    @Test fun withoutTheLinkTheChatCannotBeCreated() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        b.connectionState.value = ConnectionState.Offline(null, null)
        val (vm, _) = vm(b)
        vm.setText("hola")
        assertFalse(vm.state.value.online)
        assertFalse(vm.state.value.canCreate)
        vm.create()
        runCurrent()
        assertTrue(b.calls.isEmpty())
    }

    @Test fun aBlankTextCannotBeSent() = runTest(dispatcher) {
        val (vm, _) = vm(FakeNewChatBackend())
        vm.setText("   ")
        assertFalse(vm.state.value.canCreate)
    }

    @Test fun failedOptionsStillAllowOrbe() = runTest(dispatcher) {
        val b = FakeNewChatBackend().apply { optionsResult = offline() }
        val (vm, _) = vm(b)
        assertEquals(OptionsStatus.Failed, vm.state.value.optionsStatus)
        vm.setText("hola")
        assertTrue(vm.state.value.canCreate)
        assertTrue(vm.state.value.options.agents.isEmpty())
    }

    @Test fun orbeRequestHasNoConversationAndProjectAndBrainOnlyWhenChosen() {
        val plain = NewChatParams.orbe("hola", false, "x", null)
        assertEquals(setOf("text"), plain.keys)
        val full = NewChatParams.orbe("hola", true, null, Brain("claude", "opus", null))
        assertEquals(JsonNull, full["project"])
        assertEquals("""{"agent":"claude","model":"opus"}""", full["brain"].toString())
        assertFalse("conversation" in full)
    }

    @Test fun sessionWithoutProjectIsReadOnlyAndWithOneAsksForNoPermission() {
        val none = NewChatParams.session("codex", null, null, null)
        assertEquals("\"leer\"", none["permission"].toString())
        assertFalse("project" in none)
        val withProject = NewChatParams.session("claude", "api", "opus", "high")
        assertFalse("permission" in withProject)
        assertEquals("\"api\"", withProject["project"].toString())
        assertEquals("\"high\"", withProject["reasoning"].toString())
    }

    @Test fun parsesCatalogAgentsLimitedByWhatThePcCanRun() {
        val catalog = Json.parseToJsonElement(
            """[{"id":"claude","label":"Claude Code","defaultModel":"opus","models":[{"id":"opus","label":"Opus","recommended":true,"efforts":["low","high"]},{"id":"","label":"Por defecto"}]},{"id":"codex","label":"Codex","models":[]}]""",
        )
        val state = Json.parseToJsonElement("""{"agentsAvailable":["claude"],"activeProject":{"name":"api"}}""")
        val projects = Json.parseToJsonElement("""[{"name":"api","active":true},{"name":"web","active":false}]""")
        val o = NewChatParser.parse(catalog, state, projects)
        assertEquals(listOf("claude"), o.agents.map { it.id })
        assertTrue(o.agents[0].models[0].recommended)
        assertEquals(listOf("low", "high"), o.agents[0].models[0].efforts)
        assertEquals("api", o.activeProject)
        assertEquals(listOf("api", "web"), o.projects.map { it.name })
        // A PC that does not limit its agents (null) offers all.
        val all = NewChatParser.parse(catalog, Json.parseToJsonElement("""{"agentsAvailable":null}"""), null)
        assertEquals(listOf("claude", "codex"), all.agents.map { it.id })
    }
}

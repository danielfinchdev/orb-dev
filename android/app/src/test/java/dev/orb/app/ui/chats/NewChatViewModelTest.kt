package dev.orb.app.ui.chats

import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.PcVersions
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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class NewChatViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = kotlinx.coroutines.Dispatchers.setMain(dispatcher)
    @After fun tearDown() = kotlinx.coroutines.Dispatchers.resetMain()

    private class Seen(val outcomes: ArrayList<NewChatOutcome> = ArrayList(), val said: ArrayList<String> = ArrayList())

    private fun onlineState() = ConnectionState.Online("http://pc", "PC", PcVersions(1, 1, "3.8.4"))

    private fun TestScope.vm(b: FakeNewChatBackend): Pair<NewChatViewModel, Seen> {
        val vm = NewChatViewModel(b)
        val seen = Seen()
        backgroundScope.launch { vm.outcome.collect { seen.outcomes += it } }
        backgroundScope.launch { vm.messages.collect { seen.said += it } }
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        return vm to seen
    }

    @Test fun startsOnOrbeWithTheActiveProjectAndTheAgentsOfThePc() = runTest(dispatcher) {
        val (vm, _) = vm(FakeNewChatBackend())
        val s = vm.state.value
        assertFalse(s.direct)
        assertEquals("tienda-online", s.project)
        assertEquals(listOf("claude", "codex"), s.options.agents.map { it.id })
        assertEquals(OptionsStatus.Ready, s.optionsStatus)
        assertTrue(s.canStart)
    }

    @Test fun startingOrbeWithoutTypingOpensADraftAndDoesNotCallThePc() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        val (vm, seen) = vm(b)
        vm.start()
        runCurrent()
        assertTrue(b.calls.isEmpty())
        assertEquals(listOf<NewChatOutcome>(NewChatOutcome.Draft(OrbeDraft(setProject = false, project = "tienda-online", brain = null))), seen.outcomes)
    }

    @Test fun theDraftCarriesTheChosenProjectAndBrain() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        val (vm, seen) = vm(b)
        vm.pickProject("api-pagos")
        vm.pickBrain("claude", "opus", "high")
        vm.start()
        runCurrent()
        assertTrue(b.calls.isEmpty())
        assertEquals(NewChatOutcome.Draft(OrbeDraft(true, "api-pagos", Brain("claude", "opus", "high"))), seen.outcomes.single())
    }

    @Test fun noProjectIsSaidExplicitlyInTheDraft() = runTest(dispatcher) {
        val (vm, seen) = vm(FakeNewChatBackend())
        vm.pickProject(null)
        vm.start()
        runCurrent()
        assertEquals(NewChatOutcome.Draft(OrbeDraft(true, null, null)), seen.outcomes.single())
    }

    @Test fun aDirectChatIsCreatedAtOnceWithoutAFirstLine() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        val (vm, seen) = vm(b)
        vm.selectAgent("codex")
        vm.pickProject(null)
        vm.start()
        runCurrent()
        assertEquals(listOf("create agent=codex project=null model=null reasoning=null"), b.calls)
        assertEquals(listOf<NewChatOutcome>(NewChatOutcome.Session("s9")), seen.outcomes)
    }

    @Test fun aDirectChatUsesTheChosenModelAndTheActiveProject() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        val (vm, _) = vm(b)
        vm.selectAgent("claude")
        vm.pickBrain("claude", "opus", "high")
        vm.start()
        runCurrent()
        assertEquals(listOf("create agent=claude project=tienda-online model=opus reasoning=high"), b.calls)
    }

    @Test fun choosingDirectTakesTheFirstAgentThePcCanRun() = runTest(dispatcher) {
        val (vm, _) = vm(FakeNewChatBackend())
        vm.selectDirect()
        assertTrue(vm.state.value.direct)
        assertEquals("claude", vm.state.value.agent)
        vm.selectOrbe()
        assertFalse(vm.state.value.direct)
    }

    @Test fun directChosenBeforeThePcAnswersGetsAnAgentWhenItDoes() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        b.connectionState.value = ConnectionState.Offline(null, null)
        val (vm, _) = vm(b)
        vm.selectDirect()
        assertNull(vm.state.value.agent)
        assertFalse(vm.state.value.canStart)
        b.connectionState.value = onlineState()
        runCurrent()
        assertEquals("claude", vm.state.value.agent)
        assertTrue(vm.state.value.canStart)
    }

    @Test fun onlyTheAgentsThePcCanRunAreOffered() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        b.optionsResult = Result.success(sampleOptions.copy(agents = sampleOptions.agents.filter { it.id == "codex" }))
        val (vm, _) = vm(b)
        assertEquals(listOf("codex"), vm.state.value.options.agents.map { it.id })
        vm.selectDirect()
        assertEquals("codex", vm.state.value.agent)
    }

    @Test fun aDirectChatWithoutAnyAgentCannotStart() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        b.optionsResult = Result.success(sampleOptions.copy(agents = emptyList()))
        val (vm, _) = vm(b)
        vm.selectDirect()
        assertFalse(vm.state.value.canStart)
        vm.selectOrbe()
        assertTrue(vm.state.value.canStart)
    }

    @Test fun aRefusedDirectChatTellsWhyAndCanBeTriedAgain() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        b.agentResult = offline()
        val (vm, seen) = vm(b)
        vm.selectAgent("claude")
        vm.start()
        runCurrent()
        assertEquals(1, seen.said.size)
        assertTrue(seen.said[0].startsWith("No se pudo crear el chat en el PC."))
        assertFalse(vm.state.value.starting)
        b.agentResult = Result.success("s10")
        vm.start()
        runCurrent()
        assertEquals(listOf<NewChatOutcome>(NewChatOutcome.Session("s10")), seen.outcomes)
    }

    @Test fun aSecondTapWhileOneIsOnItsWayDoesNothing() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        b.gate = CompletableDeferred()
        val (vm, seen) = vm(b)
        vm.selectAgent("claude")
        vm.start()
        runCurrent()
        assertTrue(vm.state.value.starting)
        vm.start()
        runCurrent()
        assertEquals(1, b.calls.size)
        b.gate!!.complete(Unit)
        runCurrent()
        assertEquals(1, seen.outcomes.size)
    }

    @Test fun withoutTheLinkNothingStarts() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        b.connectionState.value = ConnectionState.Offline(null, null)
        val (vm, seen) = vm(b)
        assertFalse(vm.state.value.canStart)
        vm.start()
        runCurrent()
        assertTrue(seen.outcomes.isEmpty())
        assertTrue(b.calls.isEmpty())
    }

    @Test fun failedOptionsStillAllowOrbe() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        b.optionsResult = offline()
        val (vm, seen) = vm(b)
        assertEquals(OptionsStatus.Failed, vm.state.value.optionsStatus)
        assertTrue(vm.state.value.options.agents.isEmpty())
        vm.start()
        runCurrent()
        assertTrue(seen.outcomes.single() is NewChatOutcome.Draft)
    }

    @Test fun retryingTheOptionsRecoversThem() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        b.optionsResult = offline()
        val (vm, _) = vm(b)
        b.optionsResult = Result.success(sampleOptions)
        vm.reload()
        runCurrent()
        assertEquals(OptionsStatus.Ready, vm.state.value.optionsStatus)
        assertEquals(2, vm.state.value.options.agents.size)
    }

    @Test fun anOldPcWithoutTheCatalogSaysSoAndKeepsOrbe() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        b.missing += "models.catalog"
        val (vm, seen) = vm(b)
        assertEquals(OptionsStatus.Unsupported, vm.state.value.optionsStatus)
        vm.start()
        runCurrent()
        assertTrue(seen.outcomes.single() is NewChatOutcome.Draft)
    }

    @Test fun whileThereIsNoLinkTheOptionsStayLoading() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        b.connectionState.value = ConnectionState.Offline(null, null)
        val (vm, _) = vm(b)
        assertEquals(OptionsStatus.Loading, vm.state.value.optionsStatus)
    }

    // --- «Nuevo» project ---

    @Test fun aNewProjectIsCreatedOnThePcAndChosen() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        val (vm, _) = vm(b)
        vm.openNewProject()
        assertNotNull(vm.state.value.newProject)
        vm.createProject("  tienda-nueva ")
        runCurrent()
        assertEquals(listOf("project tienda-nueva"), b.calls)
        assertNull(vm.state.value.newProject)
        assertEquals("tienda-nueva", vm.state.value.project)
        assertTrue(vm.state.value.options.projects.any { it.name == "tienda-nueva" })
    }

    @Test fun aNewProjectNeedsANameAndTheLink() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        val (vm, _) = vm(b)
        vm.openNewProject()
        vm.createProject("   ")
        runCurrent()
        assertTrue(b.calls.isEmpty())
        b.connectionState.value = ConnectionState.Offline(null, null)
        runCurrent()
        vm.createProject("x")
        runCurrent()
        assertTrue(b.calls.isEmpty())
        assertEquals(ChatTexts.NEW_CHAT_PROJECT_OFFLINE, vm.state.value.newProject?.error)
    }

    @Test fun aRefusedNewProjectKeepsTheDialogWithTheReason() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        b.projectResult = offline()
        val (vm, _) = vm(b)
        vm.openNewProject()
        vm.createProject("x")
        runCurrent()
        assertNotNull(vm.state.value.newProject)
        assertFalse(vm.state.value.newProject!!.saving)
        assertEquals("Sin conexión con el PC.", vm.state.value.newProject!!.error)
        assertEquals("tienda-online", vm.state.value.project)
    }

    @Test fun theNewProjectOptionIsMissingOnAPcThatCannotCreateProjects() = runTest(dispatcher) {
        val b = FakeNewChatBackend()
        b.missing += "projects.create"
        val (vm, _) = vm(b)
        assertFalse(vm.state.value.canCreateProject)
        vm.openNewProject()
        assertNull(vm.state.value.newProject)
    }

    @Test fun theBrainOfADirectChatIsItsAgentsModel() = runTest(dispatcher) {
        val (vm, _) = vm(FakeNewChatBackend())
        vm.selectAgent("claude")
        assertEquals("Claude Code", vm.state.value.brainLabel)
        vm.pickBrain("claude", "opus", "high")
        assertEquals("Claude Code · Opus · high", vm.state.value.brainLabel)
        vm.selectOrbe()
        assertNull(vm.state.value.brainLabel)
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

    @Test fun thePcsOwnBrainIsNamedFromItsConfigAndNeverInvented() {
        val catalog = Json.parseToJsonElement("""[{"id":"claude","label":"Claude Code","models":[{"id":"opus","label":"Opus"}]}]""")
        val named = NewChatParser.parse(
            catalog, Json.parseToJsonElement("""{"config":{"orchestrator":{"agent":"claude","model":"opus","reasoning":"high"}}}"""), null,
        )
        assertEquals("Opus · alto", named.pcBrain?.label)
        // The model of the assistant's own list wins over the catalog's.
        val own = NewChatParser.parse(
            catalog, Json.parseToJsonElement("""{"config":{"orchestrator":{"agent":"claude","model":"x","models":[{"id":"x","label":"Sonnet 5.5"}],"reasoning":"medium"}}}"""), null,
        )
        assertEquals("Sonnet 5.5 · medio", own.pcBrain?.label)
        // No model chosen: the agent is named; nothing at all: no label.
        assertEquals("Claude Code · bajo", NewChatParser.parse(catalog, Json.parseToJsonElement("""{"config":{"orchestrator":{"reasoning":"low"}}}"""), null).pcBrain?.label)
        assertNull(NewChatParser.parse(catalog, Json.parseToJsonElement("""{"config":{}}"""), null).pcBrain)
        assertNull(NewChatParser.parse(catalog, null, null).pcBrain)
    }
}

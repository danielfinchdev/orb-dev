package dev.orb.app.ui.usage

import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
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

@OptIn(ExperimentalCoroutinesApi::class)
class UsageViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = kotlinx.coroutines.Dispatchers.setMain(dispatcher)
    @After fun tearDown() = kotlinx.coroutines.Dispatchers.resetMain()

    private fun TestScope.vm(b: FakeUsageBackend): UsageViewModel {
        val vm = UsageViewModel(b)
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        return vm
    }

    @Test fun parserReadsAccountsHistoryAgentsAndGuide() {
        val acc = UsageParser.accounts(
            Json.parseToJsonElement("""[{"account":"c1","agent":"claude","label":"Claude","plan":"Max","used":2,"max":5,"windows":[{"window":"five_hour","utilization":0.42,"resetAt":1700000000000}],"cooldownUntil":null}]"""),
        ).single()
        assertEquals(0.42, acc.windows.single().utilization, 0.0)
        assertEquals(1700000000000L, acc.windows.single().resetAt)
        assertEquals(2, acc.used)
        val h = UsageParser.history(
            Json.parseToJsonElement("""{"days":[{"day":"2026-11-10","usd":1.5,"tokensIn":10,"tokensOut":5,"turns":1}],"agents":[{"agent":"claude","usd":1.5,"tokensIn":10,"tokensOut":5}],"total":{"usd":1.5,"tokensIn":10,"tokensOut":5,"turns":1}}"""),
            7,
        )!!
        assertEquals(15L, h.byDay.single().tokens)
        assertEquals(1, h.turns)
        assertNull(UsageParser.history(Json.parseToJsonElement("""{"x":1}"""), 7))
        val a = UsageParser.agents(Json.parseToJsonElement("""[{"id":"claude","label":"Claude Code","installed":true,"enabled":true,"version":"2.1","login":"si"}]""")).single()
        assertTrue(a.installed && a.enabled)
        val g = UsageParser.guide(
            Json.parseToJsonElement("""[{"id":"claude","label":"Claude","tiers":{"light":["Haiku"],"balanced":[],"heavy":["Opus"]},"picks":{"simple":{"label":"Haiku","reasoning":"low"},"normal":{"label":"Sonnet"}}}]"""),
        ).single()
        assertEquals(listOf("light", "heavy"), g.tiers.map { it.first })
        assertEquals(listOf("simple", "normal"), g.picks.map { it.level })
    }

    @Test fun windowLabelsReadInWords() {
        assertEquals("Límite de sesión", UsageTexts.windowLabel("five_hour"))
        assertEquals("Semanal · todos los modelos", UsageTexts.windowLabel("seven_day"))
        assertEquals("Semanal · Opus", UsageTexts.windowLabel("seven_day_opus"))
        assertEquals("Límite de 2 días", UsageTexts.windowLabel("2880min"))
        assertEquals("Se restablece en 1 h 30 min", UsageTexts.resetText(5_400_000, 0))
        assertEquals("Se restablece ahora", UsageTexts.resetText(10, 20))
    }

    @Test fun loadsEverySectionOnConnect() = runTest(dispatcher) {
        val vm = vm(FakeUsageBackend())
        advanceUntilIdle()
        val s = vm.state.value
        assertTrue(s.loaded)
        assertEquals(1, s.accounts.data?.size)
        assertEquals(30, s.history.data?.days)
        assertEquals(2, s.agents.data?.size)
        assertEquals(1, s.guide.data?.size)
    }

    @Test fun oneFailingSectionDoesNotHideTheOthers() = runTest(dispatcher) {
        val b = FakeUsageBackend()
        b.historyResult = { Result.failure(LinkException(LinkError.Timeout)) }
        val vm = vm(b)
        advanceUntilIdle()
        val s = vm.state.value
        assertTrue(s.loaded && !s.allFailed)
        assertTrue(s.history.failed)
        assertEquals(1, s.accounts.data?.size)
    }

    @Test fun everythingFailingIsReportedAndRetryWorks() = runTest(dispatcher) {
        val b = FakeUsageBackend()
        val boom = Result.failure<Nothing>(LinkException(LinkError.Timeout))
        b.accountList = boom
        b.historyResult = { boom }
        b.agentList = boom
        b.guideList = boom
        val vm = vm(b)
        advanceUntilIdle()
        assertTrue(vm.state.value.allFailed)
        b.accountList = Result.success(listOf(account()))
        vm.refresh()
        advanceUntilIdle()
        assertFalse(vm.state.value.allFailed)
        assertTrue(vm.state.value.loaded)
    }

    @Test fun aFailedRereadKeepsTheLastGoodAnswer() = runTest(dispatcher) {
        val b = FakeUsageBackend()
        val vm = vm(b)
        advanceUntilIdle()
        b.accountList = Result.failure(LinkException(LinkError.Timeout))
        vm.refresh()
        advanceUntilIdle()
        assertEquals(1, vm.state.value.accounts.data?.size)
        assertTrue(vm.state.value.accounts.failed)
    }

    @Test fun changingThePeriodReadsTheHistoryAgain() = runTest(dispatcher) {
        val b = FakeUsageBackend()
        val vm = vm(b)
        advanceUntilIdle()
        vm.setDays(7)
        advanceUntilIdle()
        assertEquals(7, vm.state.value.history.data?.days)
        assertEquals("history 7", b.calls.last())
    }

    @Test fun updateAsksThePcThenReadsTheAccounts() = runTest(dispatcher) {
        val b = FakeUsageBackend()
        val vm = vm(b)
        advanceUntilIdle()
        b.calls.clear()
        val got = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { got += it } }
        vm.update()
        advanceUntilIdle()
        assertEquals(listOf("refresh", "accounts"), b.calls)
        assertEquals(listOf(UsageTexts.UPDATED), got)
        assertFalse(vm.state.value.updating)
    }

    @Test fun updateIsRefusedOffline() = runTest(dispatcher) {
        val b = FakeUsageBackend()
        val vm = vm(b)
        advanceUntilIdle()
        b.connectionState.value = ConnectionState.Offline(null, null)
        advanceUntilIdle()
        b.calls.clear()
        val got = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { got += it } }
        vm.update()
        runCurrent()
        assertTrue(b.calls.isEmpty())
        assertEquals(listOf(UsageTexts.ACTION_OFFLINE), got)
    }

    @Test fun sectionsThePcLacksAreHiddenAndNotRead() = runTest(dispatcher) {
        val b = FakeUsageBackend()
        b.unavailable = setOf(ApiMethods.MODELS_GUIDE.name, ApiMethods.USAGE_HISTORY.name)
        val vm = vm(b)
        advanceUntilIdle()
        val s = vm.state.value
        assertFalse(s.canGuide)
        assertFalse(s.canHistory)
        assertNull(s.guide.data)
        assertNull(s.history.data)
        assertTrue(s.canUsage && s.canAgents)
    }
}

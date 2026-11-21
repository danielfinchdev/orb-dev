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

    @Test fun savedAccountsShowBeforeThePcAnswersAndGiveWayToItsAnswer() = runTest(dispatcher) {
        val b = FakeUsageBackend()
        b.accountsGate = kotlinx.coroutines.CompletableDeferred()
        b.savedUsage.value = SavedUsage(listOf(account("viejo")), null)
        val vm = vm(b)
        assertTrue(vm.state.value.loaded)
        assertEquals(listOf("viejo"), vm.state.value.accounts.data!!.map { it.account })
        b.accountsGate!!.complete(Unit)
        advanceUntilIdle()
        assertEquals(listOf("claude"), vm.state.value.accounts.data!!.map { it.account })
        b.savedUsage.value = SavedUsage(listOf(account("viejo")), null)
        advanceUntilIdle()
        assertEquals(listOf("claude"), vm.state.value.accounts.data!!.map { it.account })
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

    @Test fun aSlowAnswerForAnOldPeriodNeverOverwritesTheCurrentOne() = runTest(dispatcher) {
        val b = FakeUsageBackend()
        val vm = vm(b)
        advanceUntilIdle()
        val slow = kotlinx.coroutines.CompletableDeferred<Unit>()
        b.historyGates[7] = slow
        vm.setDays(7)
        runCurrent()
        vm.setDays(90)
        advanceUntilIdle()
        slow.complete(Unit)
        advanceUntilIdle()
        assertEquals(90, vm.state.value.history.data?.days)
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

    private val utc = java.util.TimeZone.getTimeZone("UTC")
    private fun hours(h: Int) = h * 3_600_000L

    @Test fun windowHeaderNamesTheWindowThatReturnsFirstAndItsLengthOnlyWhenThePcSaysIt() {
        val five = account("a", 0.5, resetAt = hours(15))
        assertEquals("Esta ventana de 5 h · vuelve 15:00", UsageTexts.windowHeader(listOf(five), 0, utc))
        // Another account's longer window that returns earlier does not win over the shortest window.
        val week = account("b", 0.1, resetAt = hours(2)).copy(windows = listOf(UsageWindow("seven_day", 0.1, hours(2))))
        assertEquals("Esta ventana de 5 h · vuelve 15:00", UsageTexts.windowHeader(listOf(week, five), 0, utc))
        // A window whose name says nothing about its length has no «de N h».
        val odd = account("c", 0.1).copy(windows = listOf(UsageWindow("cycle", 0.1, hours(16))))
        assertEquals("Esta ventana · vuelve 16:00", UsageTexts.windowHeader(listOf(odd), 0, utc))
        // The hour is the phone's: the same instant in Madrid (UTC+1 in November).
        assertEquals("Esta ventana de 5 h · vuelve 16:00", UsageTexts.windowHeader(listOf(five), 0, java.util.TimeZone.getTimeZone("Europe/Madrid")))
    }

    @Test fun windowHeaderIsMissingWithoutAResetTimeAndShowsTheDayWhenFar() {
        assertNull(UsageTexts.windowHeader(emptyList(), 0, utc))
        assertNull(UsageTexts.windowHeader(listOf(account("a", 0.5, resetAt = null)), 0, utc))
        assertNull(UsageTexts.windowHeader(listOf(account("a", 0.5, resetAt = 10)), 20, utc))
        val far = account("a", 0.5).copy(windows = listOf(UsageWindow("seven_day", 0.5, 3 * 86_400_000L + hours(9))))
        // 1 January 1970 was a Thursday; three days later is a Sunday.
        assertEquals("Esta ventana de 7 días · vuelve dom 09:00", UsageTexts.windowHeader(listOf(far), 0, utc))
    }

    @Test fun amberStartsAt85PercentOfTheFigureTheReaderSees() {
        assertFalse(UsageTexts.nearLimit(0.84))
        assertTrue(UsageTexts.nearLimit(0.85))
        assertTrue(UsageTexts.nearLimit(0.94))
        assertEquals("94 %", UsageTexts.percentText(0.94))
    }

    @Test fun historyRowsAreRealSpendNewestFirstWithBarsOverTheBusiestDay() {
        val now = 1_794_484_800_000L // 2026-11-12 12:00 UTC
        val days = listOf(
            DaySpend("2026-11-09", 0.0, 0), DaySpend("2026-11-10", 5.0, 1000), DaySpend("2026-11-11", 7.5, 2000), DaySpend("2026-11-12", 0.0, 0),
            DaySpend("2026-10-30", 2.5, 500),
        )
        val rows = UsageTexts.historyRows(days, now, utc)
        assertEquals(listOf("Ayer", "Anteayer", "30 oct"), rows.map { it.label })
        assertEquals(listOf("$7,50", "$5,00", "$2,50"), rows.map { it.value })
        assertEquals(1f, rows[0].fraction, 0f)
        assertEquals(5.0f / 7.5f, rows[1].fraction, 0.0001f)
        assertTrue(rows.none { '%' in it.label + it.value })
        // Nothing priced: the tokens give the bar and the figure.
        val unpriced = UsageTexts.historyRows(listOf(DaySpend("2026-11-12", 0.0, 1500), DaySpend("2026-11-11", 0.0, 750)), now, utc)
        assertEquals(listOf("Hoy", "Ayer"), unpriced.map { it.label })
        assertEquals(listOf("1,5 k tokens", "750 tokens"), unpriced.map { it.value })
        assertEquals(0.5f, unpriced[1].fraction, 0f)
        assertTrue(UsageTexts.historyRows(listOf(DaySpend("2026-11-12", 0.0, 0)), now, utc).isEmpty())
    }

    @Test fun parserIsTolerantWithNewFieldsOddEntriesAndMissingOnes() {
        val acc = UsageParser.accounts(
            Json.parseToJsonElement(
                """[{"account":"c1","agent":"claude","label":"Claude","windowHours":5,"stopAt":0.92,"warnAt":0.8,"heavy":1,"maxHeavy":2,
                  "modelLimits":[{"model":"opus","until":1}],"future":{"x":[1,2]},"windows":[{"window":"five_hour","utilization":1.7,"resetAt":null,"status":"ok","at":1},{"utilization":0.2},"x"]},
                  7,{"agent":"claude"},{"account":"c2","agent":"codex","windowHours":"soon"}]""",
            ),
        )
        assertEquals(listOf("c1", "c2"), acc.map { it.account })
        assertEquals(5, acc[0].windowHours)
        assertNull(acc[1].windowHours)
        assertEquals(1, acc[0].windows.size)
        assertEquals(1.0, acc[0].windows[0].utilization, 0.0)
        assertEquals("c2", acc[1].label)
        assertTrue(UsageParser.accounts(null).isEmpty())
        assertTrue(UsageParser.accounts(Json.parseToJsonElement("""{"not":"a list"}""")).isEmpty())
        val agents = UsageParser.agents(Json.parseToJsonElement("""[{"id":"claude","installed":true,"enabled":1,"login":"si","update":{"latest":"9.9"},"accounts":[{"id":"x"}]},{"label":"no id"}]"""))
        assertEquals(1, agents.size)
        assertTrue(agents[0].enabled)
    }

    @Test fun guideKeepsEveryModelThePcGives() {
        val g = UsageParser.guide(
            Json.parseToJsonElement(
                """[{"id":"claude","label":"Claude Code","tiers":{"light":["Haiku"],"balanced":["Sonnet","Sonnet 4"],"heavy":["Opus","Opus 4","Fable"],"extra":["x"]},
                  "picks":{"simple":{"label":"Haiku"},"normal":{"label":"Sonnet","reasoning":"medium"},"complejo":{"label":"Opus","reasoning":"high"}},"readPicks":{}}]""",
            ),
        ).single()
        assertEquals(listOf("Haiku", "Sonnet", "Sonnet 4", "Opus", "Opus 4", "Fable"), g.tiers.flatMap { it.second })
        assertEquals(3, g.picks.size)
    }

    @Test fun stateIsEmptyOnlyWhenEverythingTheDeviceOffersAnsweredWithNothing() = runTest(dispatcher) {
        val b = FakeUsageBackend()
        b.accountList = Result.success(emptyList())
        b.agentList = Result.success(emptyList())
        b.guideList = Result.success(emptyList())
        b.historyResult = { Result.success(sampleHistory(it, 0.0).copy(turns = 0, byDay = emptyList(), byAgent = emptyList())) }
        val vm = vm(b)
        advanceUntilIdle()
        assertTrue(vm.state.value.isEmpty)
        b.agentList = Result.success(listOf(AgentInfo("claude", "Claude Code", true, true, null, "si")))
        vm.refresh()
        advanceUntilIdle()
        assertFalse(vm.state.value.isEmpty)
    }
}

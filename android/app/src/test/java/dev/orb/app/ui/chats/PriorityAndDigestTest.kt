package dev.orb.app.ui.chats

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PriorityAndDigestTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = kotlinx.coroutines.Dispatchers.setMain(dispatcher)
    @After fun tearDown() = kotlinx.coroutines.Dispatchers.resetMain()

    private val es = InboxTexts(english = false)
    private val en = InboxTexts(english = true)

    private fun keys(list: List<ListEntry>) = list.filterIsInstance<RowEntry>().map { it.row.id }

    private val asks = row("asks").copy(waitingPermission = true, at = "2026-11-10T09:00:00.000Z")
    private val question = row("question").copy(asking = true, at = "2026-11-10T08:00:00.000Z")
    private val review = row("review").copy(needsReview = true, at = "2026-11-10T07:00:00.000Z")
    private val unseen = row("unseen", unread = 2, at = "2026-11-12T09:00:00.000Z")
    private val muted = row("muted", unread = 5, muted = true, at = "2026-11-12T10:00:00.000Z")
    private val working = row("working", state = ChatState.Working, at = "2026-11-11T09:00:00.000Z")
    private val rest = row("rest", at = "2026-11-13T09:00:00.000Z")

    @Test fun priorityRankFollowsThePcRule() {
        assertEquals(0, ChatGrouping.priorityRank(asks))
        assertEquals(0, ChatGrouping.priorityRank(question))
        assertEquals(0, ChatGrouping.priorityRank(review))
        assertEquals(1, ChatGrouping.priorityRank(unseen))
        assertEquals(2, ChatGrouping.priorityRank(working))
        assertEquals("a muted unread chat is not finished-unseen", 3, ChatGrouping.priorityRank(muted))
        assertEquals(3, ChatGrouping.priorityRank(rest))
        assertEquals("a completed chat is last even if it waits", 3, ChatGrouping.priorityRank(asks.copy(done = true)))
        assertEquals("what works wins over unread", 2, ChatGrouping.priorityRank(working.copy(unread = 3)))
    }

    @Test fun priorityListGroupsThenRecentAndIsFlat() {
        val rows = listOf(rest, working, unseen, review, asks, question, muted)
        val list = ChatGrouping.build(rows, emptyList(), ChatFilter.All, ChatOrder.Priority, null)
        assertEquals(listOf("asks", "question", "review", "unseen", "working", "rest", "muted"), keys(list))
        assertTrue("no project or section heads", list.none { it is HeaderEntry })
    }

    @Test fun pinnedStayOnTopInPriorityOrder() {
        val rows = listOf(rest.copy(pinned = true), asks)
        val list = ChatGrouping.build(rows, emptyList(), ChatFilter.All, ChatOrder.Priority, null)
        assertEquals(listOf("rest", "asks"), keys(list))
        assertEquals(true, (list.first() as HeaderEntry).pin)
    }

    @Test fun theSnapshotKeepsTheRowsStillAndNewChatsGoOnTop() {
        val frozen = ChatGrouping.priorityKeys(listOf(asks, working, rest))
        assertEquals(listOf("conversation:asks", "conversation:working", "conversation:rest"), frozen)
        // asks was answered and rest now asks: nothing moves, and a new chat goes on top
        val now = listOf(asks.copy(waitingPermission = false), working, rest.copy(asking = true), review)
        val list = ChatGrouping.build(now, emptyList(), ChatFilter.All, ChatOrder.Priority, frozen)
        assertEquals(listOf("review", "asks", "working", "rest"), keys(list))
    }

    @Test fun recentOrderIsUntouched() {
        val list = ChatGrouping.build(listOf(rest, asks), emptyList(), ChatFilter.All)
        assertEquals(listOf("rest", "asks"), keys(list))
        assertTrue(list.any { it is HeaderEntry })
    }

    @Test fun mergeMarksTheConversationsWithATaskToReview() {
        val inbox = Json.parseToJsonElement(
            """{"items":[{"key":"conversation:1","kind":"conversation","id":"1"},{"key":"conversation:2","kind":"conversation","id":"2"},{"key":"conversation:3","kind":"conversation","id":"3"}]}""",
        ).jsonObject
        val tasks = Json.parseToJsonElement(
            """[{"id":9,"status":"awaiting_approval","conversation_id":1},{"id":10,"status":"done","conversation_id":2,"held":{"reason":"x"}},{"id":11,"status":"done","conversation_id":3}]""",
        )
        val merged = InboxMerge.merge(inbox, null, null, null, tasks)
        val byId = InboxParser.parse(merged).rows.associateBy { it.id }
        assertTrue(byId.getValue("1").needsReview)
        assertTrue("a held task waits for the OK too", byId.getValue("2").needsReview)
        assertEquals(false, byId.getValue("3").needsReview)
    }

    private fun digestJson() = Json.parseToJsonElement(
        """{"day":"2026-11-15","due":true,"empty":false,"done":{"count":2,"items":[{"id":4,"title":"Fix x"},{"id":5,"title":"Docs"}]},
           "failed":{"count":0,"items":[]},"entries":{"count":1,"items":[{"project":"orb","author":"A","topic":"Cierre"}]},
           "usage":[{"agent":"claude","usd":1.5,"turns":12},{"agent":"codex","usd":0,"turns":3}],
           "waiting":{"approvals":1,"held":0}}""",
    )

    @Test fun digestLinesComeOnlyFromWhatThePcSent() {
        val d = DayDigests.parse(digestJson(), es)!!
        assertEquals(listOf("done", "entries", "approvals", "usage"), d.lines.map { it.key })
        assertEquals("Tareas hechas: 2", d.lines[0].text)
        assertEquals(listOf("#4 Fix x", "#5 Docs"), d.lines[0].items)
        assertEquals(listOf("orb: Cierre"), d.lines[1].items)
        assertEquals(listOf("Claude: 12 turnos · 1.50 USD", "Codex: 3 turnos"), d.lines[3].items)
        assertTrue(d.waiting)
        assertEquals("Tasks done: 2", DayDigests.parse(digestJson(), en)!!.lines[0].text)
        assertEquals("Waiting for your approval now: 1", DayDigests.parse(digestJson(), en)!!.lines[2].text)
    }

    @Test fun noCardWhenNotDueEmptyOrNotAnAnswer() {
        assertNull(DayDigests.parse(Json.parseToJsonElement("""{"day":"2026-11-15","due":false,"done":{"count":3,"items":[]}}"""), es))
        assertNull(DayDigests.parse(Json.parseToJsonElement("""{"day":"2026-11-15","due":true,"empty":true}"""), es))
        assertNull(DayDigests.parse(Json.parseToJsonElement("""{"day":"2026-11-15","due":true,"empty":false}"""), es))
        assertNull(DayDigests.parse(Json.parseToJsonElement("[]"), es))
        assertNull(DayDigests.parse(null, es))
    }

    @Test fun textsFollowThePhoneLanguage() {
        assertEquals(false, InboxTexts.forLanguage("es").english)
        assertEquals(false, InboxTexts.forLanguage("fr").english)
        assertEquals(true, InboxTexts.forLanguage("en").english)
        assertEquals("Prioridad", es.priority)
        assertEquals("Priority", en.priority)
    }

    private fun TestScope.vm(b: FakeChatsBackend): ChatListViewModel {
        val vm = ChatListViewModel(b, clock = { 1_000_000L }, reloadDebounceMs = 300, dispatcher = dispatcher)
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        return vm
    }

    private fun ChatListViewModel.ids() = keys(state.value.entries)

    @Test fun viewModelTakesTheOrderOnceAndReordersOnRequest() = runTest(dispatcher) {
        val b = FakeChatsBackend(listOf(working, rest, asks))
        val vm = vm(b)
        vm.setOrder(ChatOrder.Priority)
        advanceUntilIdle()
        assertEquals(listOf("asks", "working", "rest"), vm.ids())
        // the work ends and rest asks: the rows stay where they were
        b.data.value = b.data.value.copy(rows = listOf(working.copy(state = ChatState.Idle), rest.copy(asking = true), asks))
        advanceUntilIdle()
        assertEquals(listOf("asks", "working", "rest"), vm.ids())
        vm.reorder()
        advanceUntilIdle()
        assertEquals(listOf("rest", "asks", "working"), vm.ids())
        vm.setOrder(ChatOrder.Recent)
        advanceUntilIdle()
        assertEquals(ChatOrder.Recent, vm.state.value.order)
    }

    @Test fun digestShowsWhenDueAndClosingTellsThePc() = runTest(dispatcher) {
        val b = FakeChatsBackend(listOf(rest))
        b.digestResult = Result.success(digestJson())
        val vm = vm(b)
        advanceUntilIdle()
        assertEquals("2026-11-15", vm.state.value.digest?.day)
        assertEquals(1, b.digestCalls)
        vm.closeDigest()
        advanceUntilIdle()
        assertNull(vm.state.value.digest)
        assertEquals(1, b.digestSeenCalls)
    }

    @Test fun noDigestWhenThePcDoesNotAnswer() = runTest(dispatcher) {
        val b = FakeChatsBackend(listOf(rest))
        val vm = vm(b)
        advanceUntilIdle()
        assertNull(vm.state.value.digest)
        assertEquals(0, b.digestSeenCalls)
    }

    @Test fun theMenuAsksForTheSummaryEvenIfTheMorningCardWasShown() = runTest(dispatcher) {
        val b = FakeChatsBackend(listOf(rest))
        b.digestResult = Result.success(Json.parseToJsonElement("""{"day":"2026-11-15","due":false,"empty":false,"done":{"count":3,"items":[]}}"""))
        val vm = vm(b)
        advanceUntilIdle()
        assertNull(vm.state.value.digest)
        vm.showDigest()
        advanceUntilIdle()
        assertEquals("2026-11-15", vm.state.value.digest?.day)
        assertTrue(vm.state.value.canDigest)
    }

    @Test fun anEmptySummaryFromTheMenuSaysSoInsteadOfDrawingACard() = runTest(dispatcher) {
        val b = FakeChatsBackend(listOf(rest))
        b.digestResult = Result.success(Json.parseToJsonElement("""{"day":"2026-11-15","due":true,"empty":true}"""))
        val vm = vm(b)
        vm.showDigest()
        advanceUntilIdle()
        assertNull(vm.state.value.digest)
        assertEquals(ChatTexts.NO_DIGEST, vm.messages.first())
    }
}

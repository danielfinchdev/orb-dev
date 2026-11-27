package dev.orb.app.ui.notes

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.GregorianCalendar
import java.util.TimeZone

private fun json(s: String): JsonElement = Json.parseToJsonElement(s)

private val MADRID = TimeZone.getTimeZone("Europe/Madrid")
private fun at(day: Int, hour: Int, minute: Int = 0) = GregorianCalendar(MADRID).apply { clear(); set(2026, 10, day, hour, minute) }.timeInMillis

private const val DONE = """{"key":"done:42","kind":"done","title":"Orb","body":"#42 terminada y revisada","hidden":false,"route":{"view":"tasks","id":42},"target":{"type":"task","id":42},"actions":[]}"""
private const val HELD = """{"key":"held:39","kind":"held","title":"Orb","body":"Orb paró la #39 · ha eliminado 12 archivos","hidden":false,"route":{"view":"tasks","id":39},"target":{"type":"task","id":39},"actions":[]}"""
private const val UPDATE = """{"key":"update:3.8.9","kind":"update","title":"Orb","body":"Orb 3.8.9 disponible en el PC","hidden":false,"route":{"view":"chat"},"target":{"type":"version","id":"3.8.9"},"actions":[]}"""
private const val LIMIT = """{"key":"limit:claude","kind":"limit","title":"Orb","body":"Claude ya tiene límite otra vez","hidden":false,"route":{"view":"chat"},"target":{"type":"account","id":"claude"},"actions":[]}"""

class NotesParserTest {
    private fun parse(raw: String) = NotesParser.fromEvent(json(raw), 5)!!

    @Test fun eachNewKindLeadsWhereThePcSays() {
        assertEquals(NoticeTarget.TaskChanges(42), parse(DONE).target)
        assertEquals(NoticeTarget.Task(39), parse(HELD).target)
        assertEquals(NoticeTarget.Version("3.8.9"), parse(UPDATE).target)
        assertEquals(NoticeTarget.Account("claude"), parse(LIMIT).target)
        assertEquals(listOf("done", "held", "update", "limit"), listOf(DONE, HELD, UPDATE, LIMIT).map { parse(it).kind })
    }

    @Test fun targetsOfChatNotesFromTheList() {
        val chat = parse("""{"key":"conversation:7","kind":"message","title":"Orbe","body":"x","line":3,"target":{"type":"chat","id":7}}""")
        assertEquals(NoticeTarget.Chat("conversation", "7"), chat.target)
        assertEquals(NoticeTarget.ChatsTab, parse("""{"key":"orb","kind":"message","title":"Orb","body":"x","target":{"type":"chat","id":null}}""").target)
        assertEquals(NoticeTarget.Chat("session", "s9"), parse("""{"key":"session:s9","kind":"approval","title":"A","body":"x","target":{"type":"session","id":"s9"}}""").target)
        assertEquals(NoticeTarget.Task(41), parse("""{"key":"task:41","kind":"task","title":"T","body":"x","target":{"type":"task","id":41}}""").target)
        // A note with no target of its own (a live chat event) keeps leading where its card or route says.
        assertEquals(NoticeTarget.Task(41), parse("""{"key":"c","kind":"task","title":"T","body":"","card":{"method":"tasks.approve","task":41}}""").target)
    }

    @Test fun aHiddenPreviewIsKept() {
        val n = parse("""{"key":"done:42","kind":"done","title":"Orb","body":"Tienes un mensaje nuevo","hidden":true,"target":{"type":"task","id":42}}""")
        assertTrue(n.hidden)
        assertEquals(NotesTexts.lines(n), "Orb" to "Tienes un mensaje nuevo")
    }

    @Test fun anUnknownTargetOrKindStillShows() {
        val n = parse("""{"key":"x:1","kind":"newthing","title":"Orb","body":"algo","target":{"type":"gizmo","id":1}}""")
        assertNull(n.target)
        assertEquals("newthing", n.kind)
    }

    @Test fun theListKeepsTheTimeOfThePcAndTheSameIdAsTheLiveEvent() {
        val list = NotesParser.fromList(json("""{"notes":[{"id":9,"at":777,"key":"done:42","kind":"done","title":"Orb","body":"#42 terminada y revisada","hidden":false,"route":{"view":"tasks","id":42},"target":{"type":"task","id":42}},{"id":8,"at":700,"key":"conversation:7","kind":"message","title":"Orbe","body":"Hola","hidden":false,"route":{"view":"chat","id":7},"target":{"type":"chat","id":7},"line":4}]}"""), 1)
        assertEquals(listOf(777L, 700L), list.map { it.at })
        // The live note carries the same number as `nid`.
        assertEquals(parse(DONE.replaceFirst("{", """{"nid":9,""")).id, list[0].id)
        assertEquals("note:conversation:7:n8", list[1].id)
        assertTrue(NotesParser.fromList(json("""{"notes":"no"}"""), 1).isEmpty())
        assertTrue(NotesParser.fromList(null, 1).isEmpty())
    }

    @Test fun theLinesOfARowFollowTheKind() {
        assertEquals("#42 terminada y revisada" to null, NotesTexts.lines(parse(DONE)))
        assertEquals("Orb paró la #39" to "ha eliminado 12 archivos", NotesTexts.lines(parse(HELD)))
        assertEquals("Orb 3.8.9 disponible en el PC" to NotesTexts.NEWS, NotesTexts.lines(parse(UPDATE)))
        assertEquals("Claude ya tiene límite otra vez" to null, NotesTexts.lines(parse(LIMIT)))
        assertEquals("Orbe" to "Hola", NotesTexts.lines(notice("a", "Orbe")))
    }

    @Test fun noticesAreGroupedByDay() {
        val now = at(19, 12)
        assertEquals(NoticeDay.Today, NoticeDays.of(at(19, 0, 1), now, MADRID))
        assertEquals(NoticeDay.Yesterday, NoticeDays.of(at(18, 23, 59), now, MADRID))
        assertEquals(NoticeDay.Earlier, NoticeDays.of(at(17, 23, 59), now, MADRID))
        // A time a little ahead of the phone's clock still counts as today.
        assertEquals(NoticeDay.Today, NoticeDays.of(at(19, 12, 5), now, MADRID))
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class NotesFeedTest {
    private val now = 10_000_000L

    private fun TestScope.feed(store: MemoryNoticeStore? = null, max: Int = 100) = NotesFeed(store, backgroundScope, max, keepMs = 1_000_000, nowMs = { now })

    @Test fun theSameNoticeFromTheLiveEventAndTheListIsKeptOnce() {
        val f = NotesFeed(nowMs = { now })
        val live = NotesParser.fromEvent(json(DONE), now - 5)!!
        f.add(live)
        f.merge(NotesParser.fromList(json("""{"notes":[{"id":1,"at":${now - 9},"key":"done:42","kind":"done","title":"Orb","body":"#42 terminada y revisada","target":{"type":"task","id":42}}]}"""), now))
        assertEquals(1, f.rows.value.size)
        assertEquals(now - 5, f.rows.value.single().notice.at)
    }

    @Test fun readingSurvivesTheSameNoticeComingAgain() {
        val f = NotesFeed(nowMs = { now })
        f.add(notice("a", at = now - 10))
        f.markRead(listOf("a"))
        f.merge(listOf(notice("a", at = now - 10)))
        assertFalse(f.rows.value.single().unread)
    }

    @Test fun aDismissedNoticeLeavesAndDoesNotComeBackWhenThePcSendsItAgain() {
        val f = NotesFeed(nowMs = { now })
        f.add(notice("a", at = now - 10))
        f.add(notice("b", at = now - 5))
        assertTrue(f.dismiss("a"))
        assertEquals(listOf("b"), f.rows.value.map { it.notice.id })
        f.merge(listOf(notice("a", at = now - 10), notice("c", at = now - 1)))
        assertEquals(listOf("c", "b"), f.rows.value.map { it.notice.id })
        f.undoDismiss("a")
        assertEquals(listOf("c", "b", "a"), f.rows.value.map { it.notice.id })
    }

    @Test fun aWaitingPermissionRequestCannotBeSwipedAway() {
        val f = NotesFeed(nowMs = { now })
        f.setPending(listOf(notice("approval:1", at = now)))
        assertFalse(f.dismiss("approval:1"))
        assertEquals(1, f.rows.value.size)
    }

    @Test fun keepsAtMostTheNewestHundredOfTheLastSevenDays() {
        val f = NotesFeed(nowMs = { 100 * NotesFeed.KEEP_MS })
        val t = 100 * NotesFeed.KEEP_MS
        f.merge((1..130).map { notice("n$it", at = t - it) })
        f.merge(listOf(notice("old", at = t - NotesFeed.KEEP_MS - 1)))
        assertEquals(100, f.rows.value.size)
        assertEquals("n1", f.rows.value.first().notice.id)
        assertTrue(f.rows.value.none { it.notice.id == "old" })
    }

    @Test fun whatWasReceivedSurvivesTheAppClosing() = runTest(UnconfinedTestDispatcher()) {
        val store = MemoryNoticeStore()
        val first = feed(store)
        first.add(notice("a", at = now - 20))
        first.add(notice("b", at = now - 10))
        first.markRead(listOf("a"))
        first.dismiss("b")
        val second = feed(store)
        second.restore()
        // b was swiped away, a was read: both kept as they were.
        assertEquals(listOf("a"), second.rows.value.map { it.notice.id })
        assertFalse(second.rows.value.single().unread)
        second.undoDismiss("b")
        assertEquals(listOf("b", "a"), second.rows.value.map { it.notice.id })
        assertTrue(second.rows.value.first().unread)
    }

    @Test fun aNoticeThatArrivedBeforeTheRestoreFinishedKeepsItsStateAndWhatWasSaved() = runTest(UnconfinedTestDispatcher()) {
        val store = MemoryNoticeStore()
        store.merge(listOf(notice("a", at = now - 20)))
        store.markRead(listOf("a"))
        val f = feed(store)
        f.add(notice("b", at = now - 10))
        f.add(notice("a", at = now - 20))
        f.restore()
        assertEquals(listOf("b", "a"), f.rows.value.map { it.notice.id })
        assertFalse(f.rows.value.last().unread)
    }

    @Test fun anUnavailableDatabaseKeepsTheListInMemoryAndRestoresLater() = runTest(UnconfinedTestDispatcher()) {
        val store = MemoryNoticeStore().apply { available = false }
        val f = feed(store)
        f.add(notice("a", at = now - 10))
        f.restore()
        assertEquals(1, f.rows.value.size)
        store.available = true
        store.rows["z"] = StoredNotice(notice("z", at = now - 30), read = true, dismissed = false)
        f.restore()
        assertEquals(listOf("a", "z"), f.rows.value.map { it.notice.id })
    }

    @Test fun clearingForgetsEverythingAndStopsWriting() = runTest(UnconfinedTestDispatcher()) {
        val store = MemoryNoticeStore()
        val f = feed(store)
        f.add(notice("a", at = now - 10))
        f.clear()
        f.add(notice("b", at = now - 5))
        assertEquals(listOf("a"), store.rows.keys.toList())
        assertEquals(1, f.rows.value.size)
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class NotesSyncTest {
    private val now = 10_000_000L
    private val store = MemoryNoticeStore()

    private fun list(vararg at: Long, key: String = "done") = json(
        """{"notes":[${at.joinToString(",") { """{"id":$it,"at":$it,"key":"$key:$it","kind":"done","title":"Orb","body":"#$it","target":{"type":"task","id":$it}}""" }}]}""",
    )

    private fun TestScope.sync(feed: NotesFeed, answer: (Long?) -> Result<JsonElement>, asked: MutableList<Long?> = ArrayList()) =
        NotesSync(feed, { since, limit -> asked += since; assertEquals(100, limit); answer(since) }, { now })

    @Test fun firstSyncAsksForEverythingThenOnlyForNewerOnes() = runTest(UnconfinedTestDispatcher()) {
        val feed = NotesFeed(store, backgroundScope, nowMs = { now })
        val asked = ArrayList<Long?>()
        val sync = sync(feed, { if (it == null) Result.success(list(9_000_100, 9_000_000)) else Result.success(list(9_000_200)) }, asked)
        assertTrue(sync.run())
        assertEquals(9_000_100L, store.since)
        assertTrue(sync.run())
        assertEquals(listOf(null, 9_000_100L), asked)
        assertEquals(9_000_200L, store.since)
        assertEquals(listOf(9_000_200L, 9_000_100L, 9_000_000L), feed.rows.value.map { it.notice.at })
    }

    @Test fun aResyncEventReadsTheListAgain() = runTest(UnconfinedTestDispatcher()) {
        val feed = NotesFeed(store, backgroundScope, nowMs = { now })
        val asked = ArrayList<Long?>()
        val sync = sync(feed, { Result.success(list(9_000_100)) }, asked)
        onNoteEvent(dev.orb.app.link.net.LinkEvent("board:changed", kotlinx.serialization.json.JsonNull), feed, sync) { now }
        assertEquals(0, asked.size)
        onNoteEvent(dev.orb.app.link.net.LinkEvent(dev.orb.app.link.net.LinkEvent.RESYNC, kotlinx.serialization.json.JsonNull), feed, sync) { now }
        assertEquals(1, asked.size)
        assertEquals(1, feed.rows.value.size)
    }

    @Test fun reconnectingDoesNotDuplicateWhatWasAlreadyThere() = runTest(UnconfinedTestDispatcher()) {
        val feed = NotesFeed(store, backgroundScope, nowMs = { now })
        val sync = sync(feed, { Result.success(list(9_000_100, 9_000_000)) })
        sync.run()
        sync.run()
        assertEquals(2, feed.rows.value.size)
        assertEquals(2, store.rows.size)
    }

    @Test fun aFailedReadChangesNothing() = runTest(UnconfinedTestDispatcher()) {
        val feed = NotesFeed(store, backgroundScope, nowMs = { now })
        val sync = sync(feed, { Result.failure(RuntimeException("offline")) })
        assertFalse(sync.run())
        assertTrue(feed.rows.value.isEmpty())
        assertNull(store.since)
    }

    @Test fun anEmptyAnswerKeepsTheMark() = runTest(UnconfinedTestDispatcher()) {
        store.since = 123
        val feed = NotesFeed(store, backgroundScope, nowMs = { now })
        val sync = sync(feed, { Result.success(list()) })
        assertTrue(sync.run())
        assertEquals(123L, store.since)
    }

    @Test fun aNoticeSwipedAwayDoesNotReturnWithTheNextSync() = runTest(UnconfinedTestDispatcher()) {
        val feed = NotesFeed(store, backgroundScope, nowMs = { now })
        val sync = sync(feed, { Result.success(list(9_000_100)) })
        sync.run()
        val id = feed.rows.value.single().notice.id
        feed.dismiss(id)
        store.since = null
        sync.run()
        assertTrue(feed.rows.value.isEmpty())
        // ...not even after the app was closed and opened again.
        val again = NotesFeed(store, backgroundScope, nowMs = { now })
        NotesSync(again, { _, _ -> Result.success(list(9_000_100)) }, { now }).run()
        assertTrue(again.rows.value.isEmpty())
    }
}

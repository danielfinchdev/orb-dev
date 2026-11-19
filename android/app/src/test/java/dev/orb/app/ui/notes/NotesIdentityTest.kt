package dev.orb.app.ui.notes

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

private fun js(s: String): JsonElement = Json.parseToJsonElement(s)

private const val NOW = 50_000_000L

/** A `limit` notice as the PC sends it live (`nid`) and in `notes.list` (`id`). */
private fun live(nid: Long?, body: String = "Claude ya tiene límite otra vez", key: String = "limit:claude") =
    """{"key":"$key","id":20500,${if (nid != null) """"nid":$nid,""" else ""}"kind":"limit","title":"Orb","body":"$body","hidden":false,"target":{"type":"account","id":"claude"},"actions":[]}"""

private fun listed(vararg rows: Pair<Long, Long>, body: String = "Claude ya tiene límite otra vez") = NotesParser.fromList(
    js("""{"notes":[${rows.joinToString(",") { (id, at) -> """{"id":$id,"at":$at,"key":"limit:claude","kind":"limit","title":"Orb","body":"$body","hidden":false,"target":{"type":"account","id":"claude"}}""" }}]}"""), NOW,
)

@OptIn(ExperimentalCoroutinesApi::class)
class NotesIdentityTest {
    private fun TestScope.feed(store: MemoryNoticeStore? = null) = NotesFeed(store, backgroundScope, keepMs = 10_000_000_000L, nowMs = { NOW })

    @Test fun twoEqualLimitsWithDifferentNidAreTwoRows() {
        val a = NotesParser.fromEvent(js(live(5)), NOW - 100)!!
        val b = NotesParser.fromEvent(js(live(9)), NOW - 10)!!
        assertNotEquals(a.id, b.id)
        val f = NotesFeed(nowMs = { NOW })
        f.add(a); f.add(b)
        assertEquals(2, f.rows.value.size)
    }

    @Test fun readingOrDismissingOneLeavesTheNextOccurrenceNew() {
        val f = NotesFeed(nowMs = { NOW })
        val first = NotesParser.fromEvent(js(live(5)), NOW - 100)!!
        f.add(first)
        f.markRead(listOf(first.id))
        f.dismiss(first.id)
        val second = NotesParser.fromEvent(js(live(9)), NOW - 10)!!
        f.add(second)
        // The first one stays swiped away; the second is shown and unread.
        assertEquals(listOf(second.id), f.rows.value.map { it.notice.id })
        assertTrue(f.rows.value.single().unread)
    }

    @Test fun theLiveNoteAndTheListedOneAreOneRow() {
        val f = NotesFeed(nowMs = { NOW })
        f.add(NotesParser.fromEvent(js(live(9)), NOW - 10)!!)
        f.merge(listed(9L to NOW - 12))
        assertEquals(1, f.rows.value.size)
    }

    @Test fun theLiveIdOfTheNotificationIsNotTheOccurrence() {
        // `id` of a live note is the system notification's; only `nid` identifies the occurrence.
        val n = NotesParser.fromEvent(js(live(null)), NOW)!!
        assertTrue(n.id.startsWith("note:limit:claude:c"))
        assertEquals(null, n.legacyId)
    }

    @Test fun withoutNidTheOldIdentityHolds() {
        val a = NotesParser.fromEvent(js(live(null)), NOW - 100)!!
        val b = NotesParser.fromEvent(js(live(null)), NOW - 10)!!
        assertEquals(a.id, b.id)
        assertEquals(a.id, NotesParser.fromEvent(js(live(null, key = "limit:claude")), NOW)!!.id)
    }

    @Test fun savedNoticesKeepTheirStateWhenThePcStartsNumberingThem() {
        val f = NotesFeed(nowMs = { NOW })
        val old = NotesParser.fromEvent(js(live(null)), NOW - 100)!!
        val oldRead = NotesParser.fromEvent(js(live(null, "Otra cosa", "limit:codex")), NOW - 90)!!
        f.add(old); f.add(oldRead)
        f.markRead(listOf(old.id))
        f.dismiss(oldRead.id)
        // The same two notices, now with the PC's own numbers.
        f.merge(listOf(NotesParser.fromEvent(js(live(5)), NOW - 100)!!, NotesParser.fromEvent(js(live(6, "Otra cosa", "limit:codex")), NOW - 90)!!))
        val rows = f.rows.value
        // No duplicates and no state lost: the first is read, the second is still swiped away.
        assertEquals(1, rows.size)
        assertFalse(rows.single().unread)
        assertEquals("note:limit:claude:n5", rows.single().notice.id)
    }

    @Test fun anOccurrenceNewerThanTheSavedCopyStartsUnreadAndTheOldOneStays() {
        val f = NotesFeed(nowMs = { NOW })
        val old = NotesParser.fromEvent(js(live(null)), NOW - 1_000_000)!!
        f.add(old)
        f.markRead(listOf(old.id))
        f.merge(listed(12L to NOW - 1_000))
        val rows = f.rows.value
        assertEquals(2, rows.size)
        assertTrue(rows.first().unread)
        assertFalse(rows.last().unread)
    }

    @Test fun theMigrationIsKeptInTheStoreToo() = runTest(UnconfinedTestDispatcher()) {
        val store = MemoryNoticeStore()
        val first = feed(store)
        val old = NotesParser.fromEvent(js(live(null)), NOW - 100)!!
        first.add(old)
        first.markRead(listOf(old.id))
        first.merge(listed(5L to NOW - 100))
        val second = feed(store)
        second.restore()
        assertEquals(listOf("note:limit:claude:n5"), second.rows.value.map { it.notice.id })
        assertFalse(second.rows.value.single().unread)
    }

    @Test fun savedLegacyRowsAreMigratedWhenTheListArrivesBeforeTheRestore() = runTest(UnconfinedTestDispatcher()) {
        val store = MemoryNoticeStore()
        val old = NotesParser.fromEvent(js(live(null)), NOW - 100)!!
        store.merge(listOf(old))
        store.markRead(listOf(old.id))
        val f = feed(store)
        f.merge(listed(5L to NOW - 100))
        f.restore()
        assertEquals(listOf("note:limit:claude:n5"), f.rows.value.map { it.notice.id })
        assertFalse(f.rows.value.single().unread)
        assertEquals(setOf("note:limit:claude:n5"), store.rows.keys)
    }

    @Test fun markingReadBeforeTheRestoreStillReadsWhatIsSaved() = runTest(UnconfinedTestDispatcher()) {
        val store = MemoryNoticeStore()
        val n = NotesParser.fromEvent(js(live(7)), NOW - 100)!!
        store.merge(listOf(n))
        val f = feed(store)
        // The button was used before the saved list was loaded: nothing to mark yet in memory.
        f.markRead(listOf(n.id))
        f.restore()
        assertFalse(f.rows.value.single().unread)
        assertTrue(store.rows.getValue(n.id).read)
    }

    @Test fun readingAChatBeforeTheRestoreReadsEveryNoticeOfIt() = runTest(UnconfinedTestDispatcher()) {
        val store = MemoryNoticeStore()
        val a = NotesParser.fromEvent(js("""{"key":"conversation:5","nid":1,"kind":"message","title":"Orbe","body":"uno","line":1,"route":{"view":"chat","id":5}}"""), NOW - 20)!!
        val b = NotesParser.fromEvent(js("""{"key":"conversation:5","nid":2,"kind":"message","title":"Orbe","body":"dos","line":2,"route":{"view":"chat","id":5}}"""), NOW - 10)!!
        val other = NotesParser.fromEvent(js("""{"key":"conversation:6","nid":3,"kind":"message","title":"Otro","body":"x","line":1,"route":{"view":"chat","id":6}}"""), NOW - 5)!!
        store.merge(listOf(a, b, other))
        val f = feed(store)
        f.markReadKey("conversation:5")
        f.restore()
        assertEquals(setOf(other.id), f.rows.value.filter { it.unread }.map { it.notice.id }.toSet())
    }

    @Test fun readingAChatReadsAllItsNoticesButNotOthers() {
        val f = NotesFeed(nowMs = { NOW })
        val a = NotesParser.fromEvent(js("""{"key":"conversation:5","nid":1,"kind":"message","title":"Orbe","body":"uno","line":1,"route":{"view":"chat","id":5}}"""), NOW - 20)!!
        val b = NotesParser.fromEvent(js("""{"key":"conversation:5","nid":2,"kind":"message","title":"Orbe","body":"dos","line":2,"route":{"view":"chat","id":5}}"""), NOW - 10)!!
        val s = NotesParser.fromEvent(js("""{"key":"session:5","nid":3,"kind":"approval","title":"A","body":"x","card":{"method":"sessions.approve","id":"5","request":"r"}}"""), NOW - 5)!!
        f.merge(listOf(a, b, s))
        f.markReadKey("conversation:5")
        assertEquals(setOf(s.id), f.rows.value.filter { it.unread }.map { it.notice.id }.toSet())
    }

    @Test fun aChatThatNoLongerExistsTakesItsNoticesOutAndTheyStayOut() {
        val f = NotesFeed(nowMs = { NOW })
        val a = NotesParser.fromEvent(js("""{"key":"conversation:5","nid":1,"kind":"message","title":"Orbe","body":"uno","line":1,"route":{"view":"chat","id":5}}"""), NOW - 20)!!
        val other = NotesParser.fromEvent(js("""{"key":"conversation:6","nid":2,"kind":"message","title":"Otro","body":"x","line":1,"route":{"view":"chat","id":6}}"""), NOW - 5)!!
        f.merge(listOf(a, other))
        f.dismissChat("conversation", "5")
        assertEquals(listOf(other.id), f.rows.value.map { it.notice.id })
        f.merge(listOf(a))
        assertEquals(listOf(other.id), f.rows.value.map { it.notice.id })
    }
}

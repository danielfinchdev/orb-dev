package dev.orb.app.data

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class CacheSyncTest {
    private lateinit var db: OrbCacheDatabase
    private lateinit var sync: CacheSync
    private lateinit var repo: CacheRepository
    private var now = 1_000L

    @Before fun setUp() {
        db = memoryDb()
        sync = CacheSync(db.cache(), db.outbox(), clock = { now })
        repo = CacheRepository(db.cache())
    }

    @After fun tearDown() = db.close()

    private fun inbox(n: Int, from: Int = 0) = buildString {
        append("""{"zone":"orb","unread":3,"sections":[],"items":[""")
        append((from until from + n).joinToString(",") { """{"key":"conversation:$it","kind":"conversation","id":$it,"conversation":$it,"title":"Chat $it","project":"p","at":"2026-01-01T00:${"%02d".format(it % 60)}:00Z","unread":${it % 2}}""" })
        append("]}")
    }

    @Test fun inboxRowsAreUpsertedInThePcsOrder() = runTest {
        sync.applyInbox(json(inbox(3)))
        val rows = repo.conversations().first()
        assertEquals(listOf("conversation:0", "conversation:1", "conversation:2"), rows.map { it.key })
        assertEquals("c:1", rows[1].threadId)
        assertEquals(1, rows[1].unread)
        sync.applyInbox(json(inbox(2)))
        assertEquals(2, repo.conversations().first().size)
        assertNotNull(repo.snapshot("inbox.meta:orb").first())
    }

    @Test fun onlyTheLatest50ConversationsAreKeptAndTheirMessagesGoWithThem() = runTest {
        sync.applyInbox(json(inbox(10)))
        sync.applyChat(0, json("""[{"id":1,"role":"usuario","body":"old","at":"x"}]"""))
        // 60 items in a minute-per-item scale: item 0..9 are the oldest of the 60 and fall out.
        val big = buildString {
            append("""{"items":[""")
            append((0 until 60).joinToString(",") { """{"key":"conversation:$it","kind":"conversation","id":$it,"conversation":$it,"at":"2026-01-01T00:${"%02d".format(it)}:00Z"}""" })
            append("]}")
        }
        sync.applyInbox(json(big))
        val rows = repo.conversations().first()
        assertEquals(50, rows.size)
        assertTrue(rows.none { it.key == "conversation:0" })
        assertTrue(repo.messages("c:0").first().isEmpty())
    }

    @Test fun onlyTheLatest300MessagesOfAThreadAreKept() = runTest {
        val rows = (1..320).joinToString(",") { """{"id":$it,"role":"asistente","body":"m$it","at":"t"}""" }
        sync.applyChat(7, json("[$rows]"))
        val kept = repo.messages("c:7").first()
        assertEquals(300, kept.size)
        assertEquals(21L, kept.first().msgId)
        assertEquals(320L, kept.last().msgId)
        // A second page of newer lines keeps the window moving.
        sync.applyChat(7, json("""[{"id":321,"role":"usuario","body":"new","at":"t"}]"""))
        val after = repo.messages("c:7").first()
        assertEquals(300, after.size)
        assertEquals(22L, after.first().msgId)
    }

    @Test fun cachedChatReadsBackWithoutAnyPcAndKeepsTheRawMarkdown() = runTest {
        val body = "Euler: \$e^{i\\\\pi}+1=0\$\\n```mermaid\\ngraph TD; A-->B\\n```"
        sync.applyChat(null, json("""[{"id":5,"role":"asistente","body":"$body","at":"2026-01-01T00:00:00Z"}]"""))
        sync.applySessionItems("s1", json("""[{"id":9,"role":"user","kind":"text","body":"hola","at":"t"}]"""))
        // Nothing but the repository is used here: no PC, no link.
        val general = repo.messages(ThreadId.ORB).first()
        assertEquals(1, general.size)
        assertTrue(general[0].raw.contains("graph TD; A-->B"))
        assertTrue(general[0].raw.contains("e^{i"))
        assertEquals("asistente", general[0].role)
        assertEquals(1, repo.messages(ThreadId.session("s1")).first().size)
        assertEquals(now, repo.lastSyncedAt().first())
    }

    @Test fun nothingWasSyncedYet() = runTest {
        assertNull(repo.lastSyncedAt().first())
        assertTrue(repo.conversations().first().isEmpty())
        assertNull(repo.snapshot("usage").first())
    }

    @Test fun tasksListReplacesThePreviousOne() = runTest {
        sync.applyTasks(json("""[{"id":1,"status":"done","updated_at":"b"},{"id":2,"status":"running","updated_at":"c"}]"""))
        assertEquals(listOf(1L, 2L), repo.tasks().first().map { it.id })
        sync.applyTasks(json("""[{"id":2,"status":"done","updated_at":"d"}]"""))
        val rows = repo.tasks().first()
        assertEquals(listOf(2L), rows.map { it.id })
        assertEquals("done", rows[0].status)
    }

    @Test fun snapshotsKeepTheJsonAsReceived() = runTest {
        sync.applySnapshot("usage", json("""{"five":{"pct":12}}"""))
        assertEquals("""{"five":{"pct":12}}""", repo.snapshot("usage").first())
    }

    @Test fun anEchoedClientIdRemovesTheSentCopyFromTheQueue() = runTest {
        val out = OutboxRepository(db.outbox(), clock = { now }, newId = { "id-1" })
        out.enqueueChat("7", "hello")
        db.outbox().markSending("id-1")
        db.outbox().markSent("id-1", now)
        assertNotNull(db.outbox().get("id-1"))
        sync.applyChat(7, json("""[{"id":10,"role":"usuario","body":"hello","at":"t","meta":{"clientId":"id-1"}}]"""))
        assertNull(db.outbox().get("id-1"))
    }

    @Test fun malformedResultsAreIgnored() = runTest {
        sync.applyInbox(json("""{"nope":1}"""))
        sync.applyChat(1, json("\"text\""))
        sync.applyTasks(json("[1,2,{\"x\":1}]"))
        assertTrue(repo.conversations().first().isEmpty())
        assertTrue(repo.tasks().first().isEmpty())
    }
}

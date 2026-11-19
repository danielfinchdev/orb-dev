package dev.orb.app.data

import androidx.room.Room
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.execSQL
import dev.orb.app.ui.notes.Notice
import dev.orb.app.ui.notes.NoticeKinds
import dev.orb.app.ui.notes.NoticeTarget
import dev.orb.app.ui.notes.RoomNoticeStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

private fun n(id: String, at: Long, kind: String = NoticeKinds.MESSAGE, target: NoticeTarget? = NoticeTarget.Chat("conversation", "7"), hidden: Boolean = false) =
    Notice(id, "Orbe", "Hola", kind, at, target, hidden)

class NoticeStoreTest {
    private lateinit var db: OrbCacheDatabase
    private lateinit var store: RoomNoticeStore

    @Before fun setUp() {
        db = memoryDb()
        store = RoomNoticeStore { db.notices() }
    }

    @After fun tearDown() = db.close()

    @Test fun savesEveryKindOfTargetAndReadsItBack() = runTest {
        val all = listOf(
            n("a", 1, target = NoticeTarget.Chat("session", "s1")), n("b", 2, target = NoticeTarget.Task(41)),
            n("c", 3, NoticeKinds.DONE, NoticeTarget.TaskChanges(42)), n("d", 4, NoticeKinds.UPDATE, NoticeTarget.Version("3.8.9"), hidden = true),
            n("e", 5, NoticeKinds.LIMIT, NoticeTarget.Account("claude")), n("f", 6, target = NoticeTarget.ChatsTab), n("g", 7, target = null),
        )
        store.merge(all)
        val back = store.load()!!.map { it.notice }.sortedBy { it.at }
        assertEquals(all, back)
        assertTrue(store.load()!!.none { it.read || it.dismissed })
    }

    @Test fun aKnownNoticeKeepsWhatThePersonDidWithIt() = runTest {
        store.merge(listOf(n("a", 10), n("b", 20)))
        store.markRead(listOf("a"))
        store.setDismissed("b", true)
        // The PC hands the same notices over again, with its own times.
        store.merge(listOf(n("a", 11), n("b", 21)))
        val saved = store.load()!!.associateBy { it.notice.id }
        assertTrue(saved.getValue("a").read)
        assertEquals(11L, saved.getValue("a").notice.at)
        assertTrue(saved.getValue("b").dismissed)
        assertFalse(saved.getValue("b").read)
    }

    @Test fun markAllReadAndUndoDismiss() = runTest {
        store.merge(listOf(n("a", 1), n("b", 2)))
        store.setDismissed("a", true)
        store.markRead(null)
        assertTrue(store.load()!!.all { it.read })
        store.setDismissed("a", false)
        assertFalse(store.load()!!.first { it.notice.id == "a" }.dismissed)
    }

    @Test fun pruningKeepsTheNewestWithinTheDays() = runTest {
        store.merge((1..10).map { n("n$it", it * 100L) })
        store.prune(cutoff = 350, keep = 4)
        assertEquals(listOf("n10", "n9", "n8", "n7"), store.load()!!.map { it.notice.id })
        store.prune(cutoff = 900, keep = 4)
        assertEquals(listOf("n10", "n9"), store.load()!!.map { it.notice.id })
    }

    @Test fun theSyncMarkIsKept() = runTest {
        assertNull(store.since())
        store.setSince(5_000)
        store.setSince(6_000)
        assertEquals(6_000L, store.since())
    }

    @Test fun anUnavailableDatabaseLoadsNothingAndSavesNothing() = runTest {
        val none = RoomNoticeStore { null }
        assertNull(none.load())
        none.merge(listOf(n("a", 1)))
        none.markRead(null)
        assertNull(none.since())
    }
}

class NoticesLifecycleTest {
    @get:Rule val tmp = TemporaryFolder()

    private class PlainKeys : CacheKeyProvider {
        private var key: ByteArray? = null
        override fun load(): CacheKeyState = key?.let { CacheKeyState.Ready(it.copyOf()) } ?: CacheKeyState.Missing
        override fun create(): ByteArray = ByteArray(32) { 3 }.also { key = it }
        override fun clear() { key = null }
    }

    @Test fun unlinkingTakesTheNoticesAway() = runTest {
        val file = tmp.newFolder().resolve("orb-cache.db")
        val keys = PlainKeys()
        val factory = DatabaseFactory(file, keys) { f, _ ->
            Room.databaseBuilder(object : android.content.ContextWrapper(null) { override fun getDatabasePath(name: String): File = File(name) }, OrbCacheDatabase::class.java, f.absolutePath)
                .setDriver(BundledSQLiteDriver()).setQueryCoroutineContext(Dispatchers.Unconfined)
                .setJournalMode(androidx.room.RoomDatabase.JournalMode.WRITE_AHEAD_LOGGING).build()
        }
        val store = RoomNoticeStore { factory.open()?.notices() }
        factory.open()!!.notices().put(with(RoomNoticeStore) { n("a", 1).toEntity() })
        // One write and nothing else before the wipe: the JVM's bundled driver keeps a file busy after more.
        CacheWipe(factory, keys).wipe()
        assertFalse(file.exists())
        // Linking again starts from nothing.
        assertTrue(store.load()!!.isEmpty())
        assertNull(store.since())
        factory.close()
    }

    @Test fun theVersionOneDatabaseMigratesKeepingTheUnsentMessages() = runTest {
        val file = tmp.newFolder().resolve("old.db")
        val schema = Json.parseToJsonElement(File("schemas/dev.orb.app.data.OrbCacheDatabase/1.json").readText()).jsonObject["database"]!!.jsonObject
        BundledSQLiteDriver().open(file.absolutePath).use { c: SQLiteConnection ->
            for (e in schema["entities"]!!.jsonArray) {
                val o = e.jsonObject
                val table = o["tableName"]!!.jsonPrimitive.content
                c.execSQL(o["createSql"]!!.jsonPrimitive.content.replace("\${TABLE_NAME}", table))
                for (i in (o["indices"] as? JsonArray).orEmpty()) c.execSQL(i.jsonObject["createSql"]!!.jsonPrimitive.content.replace("\${TABLE_NAME}", table))
            }
            for (q in schema["setupQueries"]!!.jsonArray) c.execSQL(q.jsonPrimitive.content)
            c.execSQL(
                "INSERT INTO outbox (clientId, target, conversationId, sessionId, text, attachments, extra, groupKey, createdAt, state, attempts, lastError, nextAttemptAt, sentAt) " +
                    "VALUES ('c1', 'chat', '5', NULL, 'sin enviar', '[]', '{}', 'chat:5', 1, 'pending', 0, NULL, 0, NULL)",
            )
            c.execSQL("PRAGMA user_version = 1")
        }
        val db = Room.databaseBuilder(object : android.content.ContextWrapper(null) {
            override fun getDatabasePath(name: String): File = File(name)
        }, OrbCacheDatabase::class.java, file.absolutePath)
            .setDriver(BundledSQLiteDriver()).setQueryCoroutineContext(Dispatchers.Unconfined)
            .setJournalMode(androidx.room.RoomDatabase.JournalMode.WRITE_AHEAD_LOGGING)
            .addMigrations(OrbCacheDatabase.MIGRATION_1_2).build()
        try {
            assertEquals("sin enviar", db.outbox().get("c1")!!.text)
            val store = RoomNoticeStore { db.notices() }
            db.notices().put(with(RoomNoticeStore) { n("a", 1).toEntity() })
            assertNotNull(store.load()!!.single())
        } finally {
            db.close()
        }
    }
}

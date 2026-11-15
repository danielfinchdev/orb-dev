package dev.orb.app.data

import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class OutboxSenderTest {
    private lateinit var db: OrbCacheDatabase
    private val pc = FakePc()
    private val connection = MutableStateFlow<ConnectionState>(ONLINE)
    private var ids = 0

    @Before fun setUp() { db = memoryDb() }
    @After fun tearDown() = db.close()

    private fun TestScope.repo() = OutboxRepository(db.outbox(), clock = { currentTime }, newId = { "id-${++ids}" })
    private fun TestScope.sender(repo: OutboxRepository) =
        OutboxSender(repo, apiOf(pc), connection, backgroundScope, clock = { currentTime }).also { it.start() }

    private suspend fun state(id: String) = db.outbox().get(id)?.state

    @Test fun sendsInCreationOrderOneAtATimePerConversation() = runTest {
        val gate = CompletableDeferred<Unit>()
        pc.answer = { c -> if (c.text == "a1") gate.await(); Result.success(JsonObject(emptyMap())) }
        val repo = repo()
        val a1 = repo.enqueueChat("1", "a1")
        val a2 = repo.enqueueChat("1", "a2")
        val b1 = repo.enqueueChat("2", "b1")
        sender(repo)
        runCurrent()
        // a2 waits behind a1; another conversation is not held up by it.
        assertEquals(listOf("a1", "b1"), pc.calls.map { it.text })
        assertEquals(OutboxState.SENDING, state(a1))
        assertEquals(OutboxState.PENDING, state(a2))
        assertEquals(OutboxState.SENT, state(b1))
        gate.complete(Unit)
        runCurrent()
        assertEquals(listOf("a1", "b1", "a2"), pc.calls.map { it.text })
        assertEquals(OutboxState.SENT, state(a2))
    }

    @Test fun theCallCarriesTheItemsOwnClientIdAndParams() = runTest {
        val repo = repo()
        val id = repo.enqueueChat("12", "hola", listOf("up1.png"), JsonObject(mapOf("project" to JsonPrimitive("orb"))))
        val sid = repo.enqueueSession("sess", "yo")
        sender(repo)
        runCurrent()
        val chat = pc.calls.first { it.method == "chat.send" }
        assertEquals(id, chat.clientId)
        assertEquals(JsonPrimitive(12), chat.params["conversation"])
        assertEquals("orb", (chat.params["project"] as JsonPrimitive).content)
        assertTrue(chat.params["images"].toString().contains("up1.png"))
        val session = pc.calls.first { it.method == "sessions.send" }
        assertEquals(sid, session.clientId)
        assertEquals("sess", (session.params["id"] as JsonPrimitive).content)
    }

    @Test fun aTimeoutRetriesWithTheSameClientIdAfterABackoff() = runTest {
        var n = 0
        pc.answer = { if (++n == 1) failure(LinkError.Timeout) else Result.success(JsonObject(emptyMap())) }
        val repo = repo()
        val id = repo.enqueueChat("1", "hi")
        sender(repo)
        runCurrent()
        assertEquals(1, pc.calls.size)
        val waiting = db.outbox().get(id)!!
        assertEquals(OutboxState.PENDING, waiting.state)
        assertEquals(1, waiting.attempts)
        assertEquals(3_000L, waiting.nextAttemptAt)
        advanceTimeBy(2_900)
        runCurrent()
        assertEquals(1, pc.calls.size)
        advanceTimeBy(200)
        runCurrent()
        assertEquals(2, pc.calls.size)
        assertEquals(pc.calls[0].clientId, pc.calls[1].clientId)
        assertEquals(id, pc.calls[1].clientId)
        assertEquals(OutboxState.SENT, state(id))
    }

    @Test fun backoffGrowsFrom3To30Seconds() {
        assertEquals(listOf(3_000L, 6_000L, 12_000L, 24_000L, 30_000L, 30_000L), (1..6).map { retryBackoffMs(it) })
    }

    @Test fun offlineWaitsForTheConnection() = runTest {
        connection.value = OFFLINE
        val repo = repo()
        val id = repo.enqueueChat("1", "later")
        sender(repo)
        runCurrent()
        advanceTimeBy(60_000)
        assertTrue(pc.calls.isEmpty())
        assertEquals(OutboxState.PENDING, state(id))
        connection.value = ONLINE
        runCurrent()
        assertEquals(1, pc.calls.size)
        assertEquals(OutboxState.SENT, state(id))
    }

    @Test fun anOfflineAnswerGoesBackToPendingWithoutCountingAnAttempt() = runTest {
        var n = 0
        pc.answer = { if (++n == 1) failure(LinkError.Offline) else Result.success(JsonObject(emptyMap())) }
        val repo = repo()
        val id = repo.enqueueChat("1", "x")
        sender(repo)
        runCurrent()
        val after = db.outbox().get(id)!!
        assertEquals(OutboxState.PENDING, after.state)
        assertEquals(0, after.attempts)
        // The link drops and comes back: the message goes at once, not after the backoff.
        connection.value = OFFLINE
        runCurrent()
        connection.value = ONLINE
        runCurrent()
        assertEquals(2, pc.calls.size)
        assertEquals(OutboxState.SENT, state(id))
    }

    @Test fun aRefusalFailsTheMessageAndHoldsItsConversationUntilRetry() = runTest {
        pc.answer = { c -> if (c.text == "bad") failure(LinkError.Refused(400, "invalid message", "bad")) else Result.success(JsonObject(emptyMap())) }
        val repo = repo()
        val bad = repo.enqueueChat("1", "bad")
        val next = repo.enqueueChat("1", "next")
        val other = repo.enqueueChat("2", "other")
        sender(repo)
        runCurrent()
        advanceTimeBy(120_000)
        val failed = db.outbox().get(bad)!!
        assertEquals(OutboxState.FAILED, failed.state)
        assertTrue(failed.lastError!!.contains("400"))
        assertTrue(!failed.lastError!!.contains("bad message"))
        assertEquals(OutboxState.PENDING, state(next))
        assertEquals(OutboxState.SENT, state(other))
        // «Reintentar» with the PC now accepting it.
        pc.answer = { Result.success(JsonObject(emptyMap())) }
        assertTrue(repo.retry(bad))
        runCurrent()
        assertEquals(OutboxState.SENT, state(bad))
        assertEquals(OutboxState.SENT, state(next))
        assertEquals(listOf("bad", "other", "bad", "next"), pc.calls.map { it.text })
    }

    @Test fun notLinkedAlsoFails() = runTest {
        pc.answer = { failure(LinkError.NotLinked) }
        val repo = repo()
        val id = repo.enqueueChat(null, "hi")
        sender(repo)
        runCurrent()
        assertEquals(OutboxState.FAILED, state(id))
        assertEquals("not linked", db.outbox().get(id)!!.lastError)
        // A failed message can be deleted.
        assertTrue(repo.delete(id))
        assertNull(db.outbox().get(id))
    }

    @Test fun aRestartTurnsSendingBackIntoPendingAndSendsItWithTheSameId() = runTest {
        val repo = repo()
        val id = repo.enqueueChat("1", "crashed")
        assertTrue(db.outbox().markSending(id) > 0)
        assertEquals(OutboxState.SENDING, state(id))
        sender(repo)
        runCurrent()
        assertEquals(id, pc.calls.single().clientId)
        assertEquals(OutboxState.SENT, state(id))
    }

    @Test fun aSendingMessageCannotBeDeleted() = runTest {
        val repo = repo()
        val id = repo.enqueueChat("1", "x")
        db.outbox().markSending(id)
        assertTrue(!repo.delete(id))
    }

    @Test fun sentMessagesAreRemovedAfter24Hours() = runTest {
        val repo = repo()
        val id = repo.enqueueChat("1", "x")
        sender(repo)
        runCurrent()
        assertEquals(OutboxState.SENT, state(id))
        advanceTimeBy(OutboxSender.SENT_RETENTION_MS + 1_000)
        repo.enqueueChat("1", "y")
        runCurrent()
        assertNull(db.outbox().get(id))
    }

    @Test fun theQueueOfAConversationIsObservable() = runTest {
        val repo = repo()
        connection.value = OFFLINE
        repo.enqueueChat("1", "one")
        repo.enqueueChat("1", "two")
        repo.enqueueChat("2", "elsewhere")
        sender(repo)
        runCurrent()
        assertEquals(listOf("one", "two"), repo.queuedForChat("1").first().map { it.text })
        assertEquals(1, repo.queuedForChat("2").first().size)
        assertEquals(3, repo.queued().first().size)
    }
}

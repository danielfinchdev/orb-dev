package dev.orb.app.data

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.UUID

/** The queue of messages written on the phone. The UI writes here; [OutboxSender] drains it. */
class OutboxRepository(
    private val dao: OutboxDao,
    private val clock: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    private val _changes = MutableSharedFlow<Unit>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    /** Fires after every write, so the sender wakes up without polling. */
    val changes: Flow<Unit> get() = _changes

    /** A message for the assistant; [conversationId] null starts a new conversation. Returns its clientId. */
    suspend fun enqueueChat(conversationId: String?, text: String, attachments: List<String> = emptyList(), extra: JsonObject = JsonObject(emptyMap())): String =
        enqueue(OutboxTarget.CHAT, conversationId, null, text, attachments, extra)

    /** A message for a direct conversation with an agent. */
    suspend fun enqueueSession(sessionId: String, text: String, attachments: List<String> = emptyList(), extra: JsonObject = JsonObject(emptyMap())): String =
        enqueue(OutboxTarget.SESSION, null, sessionId, text, attachments, extra)

    private suspend fun enqueue(target: String, conversationId: String?, sessionId: String?, text: String, attachments: List<String>, extra: JsonObject): String {
        val id = newId()
        val now = clock()
        dao.insert(
            OutboxEntity(
                clientId = id, target = target, conversationId = conversationId, sessionId = sessionId, text = text,
                attachments = JsonArray(attachments.map { JsonPrimitive(it) }).toString(), extra = extra.toString(),
                groupKey = groupKeyOf(target, conversationId, sessionId), createdAt = now, state = OutboxState.PENDING,
                attempts = 0, lastError = null, nextAttemptAt = now, sentAt = null,
            ),
        )
        changed()
        return id
    }

    /** What waits in one chat (`conversationId` null: a new conversation) or session, for the «en espera» line. */
    fun queuedForChat(conversationId: String?): Flow<List<OutboxEntity>> = dao.observeGroup(groupKeyOf(OutboxTarget.CHAT, conversationId, null))
    fun queuedForSession(sessionId: String): Flow<List<OutboxEntity>> = dao.observeGroup(groupKeyOf(OutboxTarget.SESSION, null, sessionId))
    fun queued(): Flow<List<OutboxEntity>> = dao.observeQueued()

    /** «Reintentar» on a failed message. */
    suspend fun retry(clientId: String): Boolean = (dao.retry(clientId, clock()) > 0).also { if (it) changed() }

    /** «Eliminar». A message that is being sent right now cannot be removed. */
    suspend fun delete(clientId: String): Boolean = (dao.delete(clientId) > 0).also { if (it) changed() }

    /** The PC's echo of the message arrived: the queued copy can go. */
    suspend fun acknowledge(clientId: String) { dao.deleteSent(clientId) }

    internal suspend fun queuedNow() = dao.queued()
    internal suspend fun resetSending() { if (dao.resetSending() > 0) changed() }
    internal suspend fun markSending(id: String) = dao.markSending(id) > 0
    internal suspend fun markPending(id: String, attempts: Int, error: String?, nextAt: Long) { dao.markPending(id, attempts, error, nextAt); changed() }
    internal suspend fun markSent(id: String) { dao.markSent(id, clock()); changed() }
    internal suspend fun markFailed(id: String, error: String) { dao.markFailed(id, error); changed() }
    internal suspend fun releaseBackoff() { dao.releaseBackoff(clock()); changed() }
    internal suspend fun purgeSent(olderThanMs: Long) { dao.purgeSent(clock() - olderThanMs) }
    internal fun changed() { _changes.tryEmit(Unit) }

    companion object {
        /** Messages of the same conversation are one group; all messages of a new conversation share one too. */
        fun groupKeyOf(target: String, conversationId: String?, sessionId: String?): String =
            if (target == OutboxTarget.SESSION) "s:$sessionId" else "c:${conversationId ?: "new"}"
    }
}

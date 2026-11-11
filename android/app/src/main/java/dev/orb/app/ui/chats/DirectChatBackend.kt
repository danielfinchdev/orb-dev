package dev.orb.app.ui.chats

import dev.orb.app.AppContainer
import dev.orb.app.LinkRuntime
import dev.orb.app.data.OutboxState
import dev.orb.app.data.ThreadId
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.LinkException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * What one direct chat needs from the PC and the cache. Every action is a request to the PC; the phone only keeps the
 * encrypted copy of the last answer and the messages written without a connection.
 */
interface DirectChatBackend {
    val connection: StateFlow<ConnectionState>
    val events: SharedFlow<LinkEvent>

    /** The thread as last saved in the cache (raw rows of `sessions.items`, oldest first). */
    fun cached(session: String): Flow<List<String>>

    /** Title and project of the chat from the saved list. */
    fun header(session: String): Flow<ChatRow?>

    /** Messages written here that the PC has not confirmed. */
    fun pending(session: String): Flow<List<PendingMessage>>

    /** Reads the thread from the PC and saves it; [before] = the oldest id held. → the ids that came. */
    suspend fun load(session: String, before: Long? = null): Result<List<Long>>

    /** The conversation's row (agent, model, state); null when the PC does not list it any more. */
    suspend fun info(session: String): Result<SessionInfo?>

    /** Requests of this conversation that wait for the person, as items (they can be here before the thread reloads). */
    suspend fun approvals(session: String): Result<List<JsonObject>>
    suspend fun queue(session: String): Result<List<QueuedMsg>>
    suspend fun markRead(session: String): Result<Unit>

    /** Puts the message in the send queue; [mode] is `steer` or `queue` while the agent works, null otherwise. */
    suspend fun send(session: String, text: String, mode: String?): Result<String>
    suspend fun retry(clientId: String): Boolean
    suspend fun discard(clientId: String): Boolean

    suspend fun decide(session: String, request: String, decision: String): Result<Unit>
    suspend fun editQueued(session: String, queueId: Long, text: String? = null, remove: Boolean = false, move: String? = null): Result<Unit>
    suspend fun stop(session: String): Result<Unit>
    suspend fun compact(session: String): Result<Unit>
    suspend fun resume(session: String): Result<Unit>
    suspend fun fork(session: String): Result<String>
    suspend fun settle(session: String): Result<Unit>
    suspend fun archive(session: String): Result<Unit>
    suspend fun rename(session: String, title: String): Result<Unit>
}

class RuntimeDirectChatBackend(private val container: AppContainer, private val runtime: LinkRuntime) : DirectChatBackend {
    private val api get() = runtime.api
    override val connection get() = runtime.client.connection
    override val events get() = runtime.client.events

    override fun cached(session: String): Flow<List<String>> = flow {
        val dao = container.cacheDao() ?: return@flow
        emitAll(dao.observeMessages(ThreadId.session(session)).map { rows -> rows.map { it.raw } })
    }

    override fun header(session: String): Flow<ChatRow?> = flow {
        val dao = container.cacheDao() ?: return@flow
        val key = "session:$session"
        emitAll(
            kotlinx.coroutines.flow.combine(
                dao.observeConversations(RuntimeChatsBackend.ZONE), dao.observeSnapshot("inbox.meta:${RuntimeChatsBackend.ZONE}"),
            ) { rows, meta -> InboxParser.fromCache(rows.map { it.raw }, meta?.json).rows.firstOrNull { it.key == key } },
        )
    }

    override fun pending(session: String): Flow<List<PendingMessage>> = flow {
        val outbox = container.outbox() ?: return@flow
        emitAll(
            outbox.queuedForSession(session).map { rows ->
                rows.map {
                    PendingMessage(
                        it.clientId, it.text,
                        when (it.state) { OutboxState.FAILED -> PendingState.Failed; OutboxState.SENDING -> PendingState.Sending; else -> PendingState.Waiting },
                        it.lastError, it.createdAt,
                    )
                }
            },
        )
    }

    override suspend fun load(session: String, before: Long?): Result<List<Long>> {
        val rows = api.sessions.items(
            buildJsonObject { put("id", session); put("limit", DirectChatViewModel.PAGE); if (before != null) put("before", before) },
        ).getOrElse { return Result.failure(it) }
        container.cacheSync()?.applySessionItems(session, rows)
        return Result.success((rows as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.long("id") })
    }

    override suspend fun info(session: String): Result<SessionInfo?> {
        for (archived in listOf(false, true)) {
            val rows = api.sessions.list(buildJsonObject { put("archived", archived) }).getOrElse { return Result.failure(it) }
            (rows as? JsonArray)?.firstNotNullOfOrNull { (it as? JsonObject)?.takeIf { o -> o.str("id") == session } }
                ?.let { return Result.success(DirectParser.info(it)) }
        }
        return Result.success(null)
    }

    override suspend fun approvals(session: String): Result<List<JsonObject>> = api.approvals.list().map { list ->
        (list as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
            .filter { o -> (o["session"] as? JsonObject)?.str("id") == session || o.str("session_id") == session }
    }

    override suspend fun queue(session: String): Result<List<QueuedMsg>> =
        api.sessions.queue(buildJsonObject { put("id", session) }).map { DirectParser.queue(it) }

    override suspend fun markRead(session: String) =
        api.inbox.markRead(buildJsonObject { put("kind", "session"); put("id", session) }).map { }

    override suspend fun send(session: String, text: String, mode: String?): Result<String> = runCatching {
        val outbox = container.outbox() ?: throw LinkException(LinkError.NotLinked)
        // The mode travels with the queued message so a correction written offline is still a correction on reconnect.
        outbox.enqueueSession(session, text, extra = if (mode == null) JsonObject(emptyMap()) else buildJsonObject { put("mode", mode) })
    }

    override suspend fun retry(clientId: String) = container.outbox()?.retry(clientId) ?: false
    override suspend fun discard(clientId: String) = container.outbox()?.delete(clientId) ?: false

    override suspend fun decide(session: String, request: String, decision: String) =
        api.sessions.approve(buildJsonObject { put("id", session); put("request", request); put("decision", decision) }).map { }

    override suspend fun editQueued(session: String, queueId: Long, text: String?, remove: Boolean, move: String?) = api.sessions.editQueued(
        buildJsonObject {
            put("id", session); put("queueId", queueId)
            if (text != null) put("text", text)
            if (remove) put("remove", true)
            if (move != null) put("move", move)
        },
    ).map { }

    override suspend fun stop(session: String) = api.sessions.stop(buildJsonObject { put("id", session) }).map { }
    override suspend fun compact(session: String) = api.sessions.compact(buildJsonObject { put("id", session) }).map { }
    override suspend fun resume(session: String) = api.sessions.resume(buildJsonObject { put("id", session) }).map { }
    override suspend fun settle(session: String) = api.sessions.settle(buildJsonObject { put("id", session) }).map { }

    override suspend fun archive(session: String) =
        api.sessions.update(buildJsonObject { put("id", session); put("archived", true) }).map { }

    override suspend fun rename(session: String, title: String) =
        api.sessions.update(buildJsonObject { put("id", session); put("title", title) }).map { }

    override suspend fun fork(session: String): Result<String> = api.sessions.fork(buildJsonObject { put("id", session) }).mapCatching {
        (it as? JsonObject)?.str("id") ?: throw LinkException(LinkError.BadAnswer)
    }
}

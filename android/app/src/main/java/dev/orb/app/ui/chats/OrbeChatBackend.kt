package dev.orb.app.ui.chats

import dev.orb.app.AppContainer
import dev.orb.app.LinkRuntime
import dev.orb.app.data.OutboxState
import dev.orb.app.data.ThreadId
import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.LinkException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** What `app.state` says that matters to one chat. */
data class PcSnapshot(val mode: String?, val chat: JsonObject?)

/** The task behind an approval card, as the PC describes it, to show before the person agrees. */
data class TaskDetail(val id: Long, val title: String, val status: String?, val agent: String?, val project: String?, val reasons: List<String>, val hash: String?)

/**
 * What one Orbe chat needs from the PC and the cache. Every action is a request to the PC; the phone only keeps the
 * encrypted copy of the last answer and the queue of what was written without a connection.
 */
interface OrbeChatBackend {
    val connection: StateFlow<ConnectionState>
    val events: SharedFlow<LinkEvent>

    /** The thread as last saved in the cache (raw rows of `chat.list`, oldest first). */
    fun cached(conversation: Long): Flow<List<String>>

    /** Title and project of the chat from the saved list. */
    fun header(conversation: Long): Flow<ChatRow?>

    /** Messages written here that the PC has not confirmed. */
    fun pending(conversation: Long): Flow<List<PendingMessage>>

    /** Reads the thread from the PC and saves it; [before] = the oldest id held, for earlier lines. → the lines that came. */
    suspend fun load(conversation: Long, before: Long? = null): Result<Int>

    suspend fun markRead(conversation: Long): Result<Unit>
    fun available(m: ApiMethod): Boolean

    /** Puts the message in the send queue; it leaves for the PC as soon as there is a link. */
    suspend fun send(conversation: Long, text: String): Result<String>
    suspend fun retry(clientId: String): Boolean
    suspend fun discard(clientId: String): Boolean

    suspend fun stop(conversation: Long): Result<Unit>
    suspend fun compact(conversation: Long): Result<Unit>
    suspend fun answer(id: Long, choices: List<String>, other: String?, skip: Boolean): Result<Unit>
    suspend fun accept(id: Long): Result<Unit>

    /** `app.state`: the permission mode, and this conversation's live state when it is answering or has a queue. */
    suspend fun snapshot(conversation: Long): Result<PcSnapshot>
    suspend fun setMode(mode: String): Result<Unit>

    suspend fun taskDetail(id: Long): Result<TaskDetail>
    suspend fun decideTask(id: Long, approve: Boolean, hash: String?): Result<Unit>
    suspend fun decideRequest(session: String, request: String, decision: String): Result<Unit>
}

class RuntimeOrbeChatBackend(private val container: AppContainer, private val runtime: LinkRuntime) : OrbeChatBackend {
    private val api get() = runtime.api
    override val connection get() = runtime.client.connection
    override val events get() = runtime.client.events

    override fun cached(conversation: Long): Flow<List<String>> = flow {
        val dao = container.cacheDao() ?: return@flow
        emitAll(dao.observeMessages(ThreadId.chat(conversation)).map { rows -> rows.map { it.raw } })
    }

    override fun header(conversation: Long): Flow<ChatRow?> = flow {
        val dao = container.cacheDao() ?: return@flow
        val key = "conversation:$conversation"
        emitAll(
            combine(dao.observeConversations(RuntimeChatsBackend.ZONE), dao.observeSnapshot("inbox.meta:${RuntimeChatsBackend.ZONE}")) { rows, meta ->
                InboxParser.fromCache(rows.map { it.raw }, meta?.json).rows.firstOrNull { it.key == key }
            },
        )
    }

    override fun pending(conversation: Long): Flow<List<PendingMessage>> = flow {
        val outbox = container.outbox() ?: return@flow
        emitAll(
            outbox.queuedForChat(conversation.toString()).map { rows ->
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

    override suspend fun load(conversation: Long, before: Long?): Result<Int> {
        val result = api.chat.list(buildJsonObject { put("conversation", conversation); if (before != null) put("before", before) })
        val rows = result.getOrElse { return Result.failure(it) }
        container.cacheSync()?.applyChat(conversation, rows)
        return Result.success((rows as? JsonArray)?.size ?: 0)
    }

    override suspend fun markRead(conversation: Long) =
        api.inbox.markRead(buildJsonObject { put("kind", "conversation"); put("id", conversation) }).map { }

    override fun available(m: ApiMethod) = api.available(m)

    override suspend fun send(conversation: Long, text: String): Result<String> =
        runCatching { container.outbox()?.enqueueChat(conversation.toString(), text) ?: throw LinkException(LinkError.NotLinked) }

    override suspend fun retry(clientId: String) = container.outbox()?.retry(clientId) ?: false
    override suspend fun discard(clientId: String) = container.outbox()?.delete(clientId) ?: false

    override suspend fun stop(conversation: Long) = api.chat.stop(buildJsonObject { put("conversation", conversation) }).map { }
    override suspend fun compact(conversation: Long) = api.chat.compact(buildJsonObject { put("conversation", conversation) }).map { }

    override suspend fun answer(id: Long, choices: List<String>, other: String?, skip: Boolean) = api.chat.answer(
        buildJsonObject {
            put("id", id)
            if (skip) put("skip", true)
            else if (choices.isNotEmpty()) put("choices", buildJsonArray { choices.forEach { add(JsonPrimitive(it)) } })
            else put("other", other.orEmpty())
        },
    ).map { }

    override suspend fun accept(id: Long) = api.chat.accept(buildJsonObject { put("id", id) }).map { }

    override suspend fun snapshot(conversation: Long): Result<PcSnapshot> = api.app.state().map { s ->
        val o = s as? JsonObject
        PcSnapshot(
            mode = ((o?.get("config") as? JsonObject)?.get("permissions") as? JsonObject)?.str("mode"),
            chat = (o?.get("chats") as? JsonArray).orEmpty().firstOrNull { (it as? JsonObject)?.long("conversation") == conversation } as? JsonObject,
        )
    }

    override suspend fun setMode(mode: String) = api.permissions.setMode(buildJsonObject { put("mode", mode) }).map { }

    override suspend fun taskDetail(id: Long): Result<TaskDetail> = api.tasks.get(buildJsonObject { put("id", id) }).mapCatching { el ->
        val o = el as? JsonObject ?: throw LinkException(LinkError.BadAnswer)
        TaskDetail(
            id = o.long("id") ?: id, title = o.str("title").orEmpty(), status = o.str("status"), agent = o.str("agent"),
            project = o.str("project_path") ?: o.str("project"),
            reasons = (o["sensitivity"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.content },
            hash = o.str("previewHash"),
        )
    }

    override suspend fun decideTask(id: Long, approve: Boolean, hash: String?) = api.tasks.approve(
        buildJsonObject {
            put("id", id)
            put("decision", if (approve) "approved" else "rejected")
            // The fingerprint the person saw: a task that changed meanwhile is refused instead of approved blind.
            if (hash != null) put("hash", hash)
        },
    ).map { }

    override suspend fun decideRequest(session: String, request: String, decision: String) =
        api.sessions.approve(buildJsonObject { put("id", session); put("request", request); put("decision", decision) }).map { }
}

/** Reads the PC's refusals by their text: the engine sends them without a code. */
object ChatErrors {
    fun deleted(e: Throwable): Boolean = refusal(e)?.contains("ya no existe", ignoreCase = true) == true
    fun questionGone(e: Throwable): Boolean =
        refusal(e)?.let { it.contains("ya está respondida", ignoreCase = true) || it.contains("already been answered", ignoreCase = true) } == true
    fun requestGone(e: Throwable): Boolean =
        refusal(e)?.let { it.contains("ya no está activa", ignoreCase = true) || it.contains("no longer active", ignoreCase = true) } == true

    private fun refusal(e: Throwable): String? = ((e as? LinkException)?.error as? LinkError.Refused)?.error
}


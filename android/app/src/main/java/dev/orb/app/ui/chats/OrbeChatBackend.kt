package dev.orb.app.ui.chats

import dev.orb.app.AppContainer
import dev.orb.app.LinkRuntime
import dev.orb.app.data.OutboxState
import dev.orb.app.data.ThreadId
import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.api.ApiMethods
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

/**
 * The task behind a card, as the PC describes it in one `tasks.get`: what the person sees before agreeing and the [hash] of
 * exactly that, which goes back with the OK. The PC's fingerprint (`approval.mjs › contentHash`) covers the description, the
 * `agent`, the model, the folder, the sensitivity tags, the reasoning, the fast flag, the mode, read-only and the Preguntar
 * level; every one of those is a field here so the card can show what the hash covers and nothing less.
 * [actions] are the ones the PC allows for it now (the same rule as the task's own screen).
 */
data class TaskDetail(
    val id: Long, val title: String, val status: String?, val agent: String?, val project: String?, val reasons: List<String>,
    val hash: String?, val model: String? = null,
    /** `auto` / `preguntar`: how the task was created; with [approvalRequired] it tells whether Auto let it through. */
    val autonomy: String? = null,
    val approvalRequired: Boolean? = null,
    val held: Boolean = false,
    val accepted: Boolean = false,
    val undone: Boolean = false,
    val actions: Set<dev.orb.app.ui.tasks.TaskAction> = emptySet(),
    /** The agent that reviewed the task (`tasks.get.review`), when one did. */
    val reviewAgent: String? = null,
    /** What the person last decided on the PC for this task: `approved` or `rejected` (from its history), else null. */
    val decision: String? = null,
    /** What the task will really do: the brief the agent gets. The hash covers it, the title is not covered. */
    val description: String? = null,
    val readonly: Boolean = false,
    /** `carpeta` or `aislada`. */
    val mode: String? = null,
    val reasoning: String? = null,
    val fast: Boolean = false,
    /** What the person's own message asked for (`user_asked`): covered by the hash, and the card has no room to word it. */
    val userAsked: List<String> = emptyList(),
    /** The agent that runs it now (`assigned_to`), which may differ from the [agent] the OK is about. */
    val runner: String? = null,
    /** Why Orb stopped it, and the folder the PC has for it now, when the task is held for review. */
    val heldReasons: String = "",
    val heldFolder: String? = null,
    /** `tasks.get.folderNow`: the folder the PC fingerprints (its current one); absent on a PC that does not say it. */
    val folderNow: String? = null,
    /** The folder now is not the one stored when the task was created (`folderMoved`); null on a PC that does not say. */
    val folderMoved: Boolean? = null,
    /** The folder is outside Orb's own folder, so the phone only gets its last name (`folderOutside`). */
    val folderOutside: Boolean = false,
    /** The description the phone got is not exactly the one the fingerprint covers (`descriptionCut`): paths of Orb's folder are shortened. */
    val descriptionCut: Boolean = false,
    /** The task's point of return as the PC names it now; it changes when the task runs again. Null: no point, or a PC that does not say. */
    val checkpointId: String? = null,
) {
    /** The folder the OK is about: the one the hash covers when the PC says it, else the stored one. */
    val folderShown: String? get() = folderNow?.takeIf { it.isNotBlank() } ?: project

    /** The project moved since the task was created: [project] is the stored folder, [folderNow] the one that will be used. */
    val folderChanged: Boolean get() = folderMoved ?: (!folderNow.isNullOrBlank() && !project.isNullOrBlank() && folderNow != project)

    /** The hash covers the folder the PC has now, so a card can only vouch for it when the PC says which one that is. */
    val folderKnown: Boolean get() = !folderNow.isNullOrBlank() && "ruta_cambiada" !in reasons

    /**
     * Whether the answer carries everything the OK is about. Anything the hash covers that it does not (the current folder of a
     * task whose folder moved, what the person's message asked for) cannot be read whole from here.
     */
    val approvable: Boolean get() = title.isNotBlank() && !agent.isNullOrBlank() && !hash.isNullOrBlank() && status == "awaiting_approval" &&
        !description.isNullOrBlank() && folderKnown && userAsked.isEmpty() && folderMoved != true && !folderOutside
}

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

    /** Asks the PC to bring this conversation back from its trash. */
    suspend fun restore(conversation: Long): Result<Unit>

    /** Puts the message in the send queue; it leaves for the PC as soon as there is a link. */
    suspend fun send(conversation: Long, text: String, images: List<String> = emptyList()): Result<String>
    suspend fun retry(clientId: String): Boolean
    suspend fun discard(clientId: String): Boolean

    suspend fun stop(conversation: Long): Result<Unit>
    suspend fun compact(conversation: Long): Result<Unit>
    suspend fun answer(id: Long, choices: List<String>, other: String?, skip: Boolean): Result<Unit>
    suspend fun accept(id: Long): Result<Unit>

    /** `app.state`: the permission mode, and this conversation's live state when it is answering or has a queue. */
    suspend fun snapshot(conversation: Long): Result<PcSnapshot>
    suspend fun setMode(mode: String): Result<Unit>

    /** The brain of this conversation (`chat.settings`, read only); null when the PC does not offer it or says nothing usable. */
    suspend fun brain(conversation: Long): Result<BrainInfo?>

    /** The tasks running on the PC now (`tasks.live`); empty when the PC does not offer it. */
    suspend fun liveTasks(): Result<List<LiveTask>>

    suspend fun taskDetail(id: Long): Result<TaskDetail>

    /** What a finished task changed, as counts only (`tasks.diff {stat}`); null when the PC says nothing usable. */
    suspend fun taskStat(id: Long): Result<TaskStat?>
    suspend fun decideTask(id: Long, approve: Boolean, hash: String?): Result<Unit>

    /** `tasks.accept` / `tasks.undo` of one task. */
    /**
     * [unheld]: the PC refuses, changing nothing, a task that Orb holds or that is no longer finished. [checkpoint]: the run the
     * person saw; the PC refuses a task that ran again since.
     */
    suspend fun acceptTask(id: Long, unheld: Boolean = false, checkpoint: String? = null): Result<Unit>

    /** [checkpoint]: the point of return the person saw; the PC refuses to undo if the task has another one now. */
    suspend fun undoTask(id: Long, checkpoint: String? = null): Result<Unit>

    /** The messages waiting in the PC's queue behind the running turn (`chat.queue`). */
    suspend fun queue(conversation: Long): Result<List<OrbeQueued>>

    /** Changes ([text]) or removes ([remove]) one queued message; → the queue that is left. */
    /** [expect]: the text the person saw; the PC refuses to change a message that has another text now. */
    suspend fun editQueued(conversation: Long, queueId: String, text: String?, remove: Boolean, expect: String? = null): Result<List<OrbeQueued>>
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
    override suspend fun restore(conversation: Long) = api.conversationsRestore(conversation.toString()).map { }

    override suspend fun send(conversation: Long, text: String, images: List<String>): Result<String> =
        runCatching { container.outbox()?.enqueueChat(conversation.toString(), text, images) ?: throw LinkException(LinkError.NotLinked) }

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

    override suspend fun brain(conversation: Long): Result<BrainInfo?> =
        if (!api.available(ApiMethods.CHAT_SETTINGS)) Result.success(null)
        else api.chat.settings(buildJsonObject { put("conversation", conversation) }).map { OrbeParser.brain(it) }

    override suspend fun liveTasks(): Result<List<LiveTask>> =
        if (!api.available(ApiMethods.TASKS_LIVE)) Result.success(emptyList()) else api.tasks.live().map { OrbeParser.liveTasks(it) }

    override suspend fun taskDetail(id: Long): Result<TaskDetail> =
        api.tasks.get(buildJsonObject { put("id", id) }).mapCatching { el -> OrbeParser.taskDetail(el, id, api::available) ?: throw LinkException(LinkError.BadAnswer) }

    override suspend fun taskStat(id: Long): Result<TaskStat?> =
        if (!api.available(ApiMethods.TASKS_DIFF)) Result.success(null)
        else api.tasks.diff(buildJsonObject { put("id", id); put("stat", true) }).map { OrbeParser.taskStat(it) }

    override suspend fun acceptTask(id: Long, unheld: Boolean, checkpoint: String?) =
        api.tasks.accept(dev.orb.app.ui.tasks.TaskParams.accept(id, unheld, checkpoint, api.knowsSafetyGuards)).map { }

    override suspend fun undoTask(id: Long, checkpoint: String?) =
        api.tasks.undo(buildJsonObject { put("id", id); if (checkpoint != null) put("checkpoint", checkpoint) }).map { }

    override suspend fun queue(conversation: Long): Result<List<OrbeQueued>> =
        if (!api.available(ApiMethods.CHAT_QUEUE)) Result.success(emptyList())
        else api.chat.queue(buildJsonObject { put("conversation", conversation) }).map { OrbeParser.queue(it) }

    override suspend fun editQueued(conversation: Long, queueId: String, text: String?, remove: Boolean, expect: String?): Result<List<OrbeQueued>> =
        api.chat.editQueued(
            buildJsonObject {
                put("conversation", conversation)
                put("queueId", queueId)
                if (expect != null) put("expect", expect)
                if (remove) put("remove", true) else put("text", text.orEmpty())
            },
        ).map { OrbeParser.queue(it) }

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

/** Reads the PC's refusals by their text: the engine sends them without a code, in the language Orb is set to on the PC. */
object ChatErrors {
    /** What the PC itself said when it refused, word for word; null when the failure was not a refusal. */
    fun pcText(e: Throwable): String? = refusal(e)?.takeIf { it.isNotBlank() }
    /** The PC refused because the queued message has another text now than the one the person saw. */
    fun queuedChanged(e: Throwable): Boolean =
        refusal(e)?.let { it.contains("ha cambiado desde que lo viste", ignoreCase = true) || it.contains("has changed since you saw it", ignoreCase = true) } == true

    fun queuedGone(e: Throwable): Boolean =
        refusal(e)?.let { it.contains("ya no está en la cola", ignoreCase = true) || it.contains("no longer in the queue", ignoreCase = true) } == true

    fun deleted(e: Throwable): Boolean =
        refusal(e)?.let {
            it.contains("ya no existe", ignoreCase = true) || it.contains("en la papelera", ignoreCase = true) ||
                it.contains("no longer exists", ignoreCase = true) || it.contains("in the trash", ignoreCase = true)
        } == true
    fun questionGone(e: Throwable): Boolean =
        refusal(e)?.let { it.contains("ya está respondida", ignoreCase = true) || it.contains("already been answered", ignoreCase = true) } == true
    fun requestGone(e: Throwable): Boolean =
        refusal(e)?.let { it.contains("ya no está activa", ignoreCase = true) || it.contains("no longer active", ignoreCase = true) } == true

    private fun refusal(e: Throwable): String? = ((e as? LinkException)?.error as? LinkError.Refused)?.error
}


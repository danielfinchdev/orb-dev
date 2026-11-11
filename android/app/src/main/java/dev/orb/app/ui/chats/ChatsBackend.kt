package dev.orb.app.ui.chats

import androidx.compose.runtime.Immutable
import dev.orb.app.AppContainer
import dev.orb.app.LinkRuntime
import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.LinkException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Immutable
data class SearchMessage(
    val key: String, val ref: ChatRef, val chatTitle: String, val project: String?,
    val text: String, val at: String?, val from: Speaker?, val fromName: String?,
)

@Immutable
data class SearchTask(val id: Long, val title: String, val status: String?, val project: String?, val snippet: String?)

@Immutable
data class SearchProject(val name: String, val chats: Int)

@Immutable
data class SearchResults(
    val chats: List<ChatRow>, val messages: List<SearchMessage>, val tasks: List<SearchTask>, val projects: List<SearchProject>,
) {
    val total get() = chats.size + messages.size + tasks.size + projects.size

    companion object {
        val Empty = SearchResults(emptyList(), emptyList(), emptyList(), emptyList())
    }
}

/**
 * What the chat screens need from the PC and the cache. Every action is a request to the PC; the phone only keeps
 * the encrypted copy of the last answer. An interface so the view models can be tested without a link.
 */
interface ChatsBackend {
    val connection: StateFlow<ConnectionState>
    val events: SharedFlow<LinkEvent>

    /** The list as last saved in the cache; it changes whenever [refreshInbox] stores a newer answer. */
    fun inbox(): Flow<InboxData>

    /** Asks the PC for the list and saves it in the cache. */
    suspend fun refreshInbox(): Result<Unit>

    /** `app.state`, saved in the cache; its answer carries the PC's theme. */
    suspend fun appState(): Result<JsonElement>

    /** Whether the linked PC can run [m]; what it cannot do is hidden, never shown disabled. */
    fun available(m: ApiMethod): Boolean

    suspend fun pin(ref: ChatRef, pinned: Boolean): Result<Unit>
    suspend fun markRead(ref: ChatRef): Result<Unit>
    suspend fun mute(ref: ChatRef, muted: Boolean): Result<Unit>

    /** [untilIso] null brings the chat back. */
    suspend fun snooze(ref: ChatRef, untilIso: String?): Result<Unit>
    suspend fun rename(ref: ChatRef, title: String): Result<Unit>

    /** The PC's own «Completar»: an Orbe chat is marked done, a direct chat is settled. Both stay searchable. */
    suspend fun archive(ref: ChatRef): Result<Unit>
    suspend fun moveToSection(ref: ChatRef, section: Long?): Result<Unit>
    suspend fun createSection(name: String): Result<Long>
    suspend fun renameSection(id: Long, name: String): Result<Unit>
    suspend fun deleteSection(id: Long): Result<Unit>

    /** Asks the PC to move the chat to its trash; [confirmed] exists only after the person agreed in the dialog. */
    suspend fun trash(ref: ChatRef, confirmed: dev.orb.app.link.api.Confirmed): Result<Unit>

    /** Asks the PC to bring a trashed chat back. */
    suspend fun restore(ref: ChatRef): Result<Unit>

    /** Search on the PC; [q] has at least 2 characters. */
    suspend fun search(q: String): Result<SearchResults>

    /** Search over what is saved on the phone, for when the PC cannot be reached. */
    suspend fun searchSaved(q: String): SearchResults
}

class RuntimeChatsBackend(private val container: AppContainer, private val runtime: LinkRuntime) : ChatsBackend {
    private val api get() = runtime.api
    override val connection get() = runtime.client.connection
    override val events get() = runtime.client.events

    override fun inbox(): Flow<InboxData> = flow {
        // The database opens in the background; until then there is nothing to show.
        val dao = container.cacheDao() ?: return@flow
        emitAll(
            combine(dao.observeConversations(ZONE), dao.observeSnapshot("inbox.meta:$ZONE")) { rows, meta ->
                InboxParser.fromCache(rows.map { it.raw }, meta?.json)
            },
        )
    }

    override suspend fun refreshInbox(): Result<Unit> = coroutineScope {
        val inbox = async { api.inbox.list(buildJsonObject { put("zone", ZONE) }) }
        val conversations = async { api.conversations.list() }
        val sessions = async { api.sessions.list(buildJsonObject { put("archived", false) }) }
        val approvals = async { api.approvals.list() }
        val list = inbox.await().getOrElse { return@coroutineScope Result.failure(it) } as? JsonObject
            ?: return@coroutineScope Result.failure(LinkException(LinkError.BadAnswer))
        // The extra lists only complete the rows; without them the list still shows what the inbox itself says.
        val merged = InboxMerge.merge(list, conversations.await().getOrNull(), sessions.await().getOrNull(), approvals.await().getOrNull())
        container.cacheSync()?.applyInbox(merged, ZONE)
        Result.success(Unit)
    }

    override suspend fun appState(): Result<JsonElement> {
        val result = api.app.state()
        result.getOrNull()?.let { container.cacheSync()?.applySnapshot("app.state", it) }
        return result
    }

    override fun available(m: ApiMethod) = api.available(m)

    private fun ChatRef.params(extra: JsonObjectBuilder.() -> Unit = {}) = buildJsonObject {
        put("kind", kind.wire)
        if (kind == ChatKind.Orbe) put("id", id.toLongOrNull() ?: 0L) else put("id", id)
        extra()
    }

    private fun Result<JsonElement>.unit(): Result<Unit> = map { }

    override suspend fun pin(ref: ChatRef, pinned: Boolean) =
        (if (pinned) api.inbox.pin(ref.params()) else api.inbox.unpin(ref.params())).unit()

    override suspend fun markRead(ref: ChatRef) = api.inbox.markRead(ref.params()).unit()
    override suspend fun mute(ref: ChatRef, muted: Boolean) = api.inbox.mute(ref.params { put("muted", muted) }).unit()
    override suspend fun snooze(ref: ChatRef, untilIso: String?) =
        api.inbox.snooze(ref.params { put("until", untilIso?.let { JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull) }).unit()

    override suspend fun rename(ref: ChatRef, title: String): Result<Unit> = when (ref.kind) {
        ChatKind.Orbe -> api.conversations.update(buildJsonObject { put("id", ref.id.toLongOrNull() ?: 0L); put("title", title) })
        ChatKind.Agent -> api.sessions.update(buildJsonObject { put("id", ref.id); put("title", title) })
    }.unit()

    override suspend fun archive(ref: ChatRef): Result<Unit> = when (ref.kind) {
        ChatKind.Orbe -> api.conversations.update(buildJsonObject { put("id", ref.id.toLongOrNull() ?: 0L); put("done", true) })
        ChatKind.Agent -> api.sessions.settle(buildJsonObject { put("id", ref.id); put("settled", true) })
    }.unit()

    override suspend fun moveToSection(ref: ChatRef, section: Long?) =
        api.inbox.sectionsMove(ref.params { put("section", section?.let { JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull) }).unit()

    override suspend fun createSection(name: String): Result<Long> =
        api.inbox.sectionsCreate(buildJsonObject { put("zone", ZONE); put("name", name) }).mapCatching { r ->
            ((r as? JsonObject)?.get("id") as? JsonPrimitive)?.content?.toLongOrNull() ?: throw LinkException(LinkError.BadAnswer)
        }

    override suspend fun renameSection(id: Long, name: String) =
        api.inbox.sectionsRename(buildJsonObject { put("id", id); put("name", name) }).unit()

    override suspend fun deleteSection(id: Long) = api.inbox.sectionsDelete(buildJsonObject { put("id", id) }).unit()

    override suspend fun trash(ref: ChatRef, confirmed: dev.orb.app.link.api.Confirmed): Result<Unit> =
        (if (ref.kind == ChatKind.Orbe) api.conversationsTrash(ref.id, confirmed) else api.sessionsTrash(ref.id, confirmed)).map { }

    override suspend fun restore(ref: ChatRef): Result<Unit> =
        (if (ref.kind == ChatKind.Orbe) api.conversationsRestore(ref.id) else api.sessionsRestore(ref.id)).unit()

    override suspend fun search(q: String): Result<SearchResults> = coroutineScope {
        val chats = async { api.inbox.search(buildJsonObject { put("q", q); put("zone", ZONE) }) }
        val tasks = async { api.tasks.search(buildJsonObject { put("q", q) }) }
        val found = chats.await().getOrElse { return@coroutineScope Result.failure(it) }
        val known = inbox().first().rows
        Result.success(SearchParser.parse(q, found, tasks.await().getOrNull(), known))
    }

    override suspend fun searchSaved(q: String): SearchResults = SearchParser.local(q, inbox().first().rows)

    companion object {
        const val ZONE = "orb"
    }
}

object SearchParser {
    /** `inbox.search` + `tasks.search`; [known] (the cached rows) fills what a direct chat's bare mark lacks. */
    fun parse(q: String, inboxSearch: JsonElement, tasksSearch: JsonElement?, known: List<ChatRow>): SearchResults {
        val byKey = known.associateBy { it.key }
        val obj = inboxSearch as? JsonObject
        val chats = (obj?.get("items") as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.let(InboxParser::row) }
            .map { r -> byKey[r.key]?.takeIf { r.title == ChatTexts.UNTITLED } ?: r }
        val messages = (obj?.get("messages") as? JsonArray).orEmpty().mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            val key = o.str("key") ?: return@mapNotNull null
            val line = o["line"] as? JsonObject ?: return@mapNotNull null
            val text = line.str("text") ?: return@mapNotNull null
            val from = line["from"] as? JsonObject
            val ref = ChatRef(ChatKind.fromWire(o.str("kind") ?: key.substringBefore(':')), o.str("id") ?: key.substringAfter(':'))
            val row = byKey[ref.key]
            SearchMessage(
                key = key + "#" + (line.str("id") ?: text.hashCode()), ref = ref,
                chatTitle = o.str("title")?.takeIf { it.isNotBlank() } ?: row?.title ?: ChatTexts.UNTITLED,
                project = row?.project, text = oneLine(text), at = line.str("at"),
                from = when (from?.str("type")) { "user" -> Speaker.User; "orbe" -> Speaker.Orbe; "system" -> Speaker.System; else -> null },
                fromName = from?.str("name"),
            )
        }
        val tasks = (tasksSearch as? JsonArray).orEmpty().mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            SearchTask(o.long("id") ?: return@mapNotNull null, o.str("title") ?: return@mapNotNull null, o.str("status"), o.str("project"), o.str("snippet"))
        }
        return SearchResults(chats, messages, tasks, projects(q, known))
    }

    /** Offline: titles, last lines and project names saved on the phone. */
    fun local(q: String, known: List<ChatRow>): SearchResults {
        val needle = q.trim().lowercase()
        val chats = known.filter { r ->
            !r.done && (r.title.lowercase().contains(needle) || r.lastText?.lowercase()?.contains(needle) == true || r.project?.lowercase()?.contains(needle) == true)
        }
        return SearchResults(chats, emptyList(), emptyList(), projects(q, known))
    }

    /** Projects are not a search of their own on the PC; their names come from the chats' projects. */
    fun projects(q: String, known: List<ChatRow>): List<SearchProject> {
        val needle = q.trim().lowercase()
        return known.filter { !it.done }.mapNotNull { it.project }.groupingBy { it }.eachCount()
            .filterKeys { it.lowercase().contains(needle) }.map { SearchProject(it.key, it.value) }.sortedBy { it.name.lowercase() }
    }
}

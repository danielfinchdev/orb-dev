package dev.orb.app.ui.notes

import androidx.compose.runtime.Immutable
import dev.orb.app.ui.chats.int
import dev.orb.app.ui.chats.long
import dev.orb.app.ui.chats.str
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** Where tapping a notice leads. */
sealed interface NoticeTarget {
    /** [kind] is the wire kind of a chat: `conversation` (Orbe) or `session` (an agent). */
    data class Chat(val kind: String, val id: String) : NoticeTarget
    data class Task(val id: Long) : NoticeTarget
}

@Immutable
data class Notice(
    val id: String,
    val title: String,
    val body: String,
    /** `message`, `approval` or `task`, as the PC names what the notice is about. */
    val kind: String,
    val at: Long,
    val target: NoticeTarget?,
)

@Immutable
data class NoticeRow(val notice: Notice, val unread: Boolean)

object NotesParser {
    /** A `note` event of the PC (the same payload the desktop shows as a notification). Null when it says nothing. */
    fun fromEvent(payload: JsonElement, nowMs: Long): Notice? {
        val o = payload as? JsonObject ?: return null
        val key = o.str("key") ?: return null
        val kind = o.str("kind") ?: "message"
        val body = o.str("body").orEmpty()
        val title = o.str("title").orEmpty().ifBlank { "Orb" }
        val card = o["card"] as? JsonObject
        val route = o["route"] as? JsonObject
        val target = when {
            card?.str("method") == "tasks.approve" -> card.long("task")?.let { NoticeTarget.Task(it) }
            card?.str("method") == "sessions.approve" -> card.str("id")?.let { NoticeTarget.Chat("session", it) }
            key.startsWith("session:") -> NoticeTarget.Chat("session", key.removePrefix("session:"))
            route?.str("view") == "chat" -> route.long("id")?.let { NoticeTarget.Chat("conversation", it.toString()) }
            else -> null
        }
        // One notice per line of a chat; a line without an id is told apart by its time.
        val line = o.long("line")?.toString() ?: nowMs.toString()
        return Notice("note:$key:$line", title, body, kind, nowMs, target)
    }

    /** The permission requests `app.state` lists as waiting. */
    fun approvals(state: JsonElement?, nowMs: Long): List<Notice> =
        ((state as? JsonObject)?.get("approvals") as? JsonArray).orEmpty().mapNotNull { x ->
            val o = x as? JsonObject ?: return@mapNotNull null
            val id = o.str("id") ?: o.int("id")?.toString() ?: return@mapNotNull null
            val body = o["body"] as? JsonObject
            val session = o.str("session_id") ?: o.int("session_id")?.toString()
            Notice(
                id = "approval:$id", title = body?.str("title").orEmpty().ifBlank { "Permiso pendiente" },
                body = body?.str("reason").orEmpty(), kind = "approval", at = nowMs,
                target = session?.let { NoticeTarget.Chat("session", it) },
            )
        }
}

/**
 * The phone's own list of notices. The PC keeps no list the phone can read (its bell is a window thing), so this one is
 * built from the `note` events received while the app is open and from the permission requests `app.state` lists.
 */
class NotesFeed(private val max: Int = 100) {
    private val live = MutableStateFlow<List<Notice>>(emptyList())
    private val pending = MutableStateFlow<List<Notice>>(emptyList())
    private val read = MutableStateFlow<Set<String>>(emptySet())
    private val _rows = MutableStateFlow<List<NoticeRow>>(emptyList())
    val rows: StateFlow<List<NoticeRow>> = _rows.asStateFlow()

    private fun publish() {
        val readIds = read.value
        _rows.value = (pending.value + live.value).distinctBy { it.id }.sortedByDescending { it.at }
            .map { NoticeRow(it, it.id !in readIds) }
    }

    fun add(n: Notice) {
        live.update { (listOf(n) + it.filterNot { o -> o.id == n.id }).take(max) }
        publish()
    }

    /** Replaces the permission requests that wait on the PC; one that was answered there disappears. */
    fun setPending(list: List<Notice>) {
        // A request keeps the time it was first seen, so reading the state again does not move it to the top.
        val seen = pending.value.associate { it.id to it.at }
        pending.value = list.map { n -> seen[n.id]?.let { n.copy(at = it) } ?: n }
        publish()
    }

    /** [ids] null marks everything read. */
    fun markRead(ids: Collection<String>?) {
        read.update { it + (ids ?: _rows.value.map { r -> r.notice.id }) }
        publish()
    }

    fun clear() {
        live.value = emptyList()
        pending.value = emptyList()
        read.value = emptySet()
        publish()
    }
}

package dev.orb.app.ui.notes

import androidx.compose.runtime.Immutable
import dev.orb.app.ui.chats.int
import dev.orb.app.ui.chats.long
import dev.orb.app.ui.chats.str
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import java.util.Calendar
import java.util.GregorianCalendar
import java.util.TimeZone

/** Where tapping a notice leads. */
sealed interface NoticeTarget {
    /** [kind] is the wire kind of a chat: `conversation` (Orbe) or `session` (an agent). */
    data class Chat(val kind: String, val id: String) : NoticeTarget
    data class Task(val id: Long) : NoticeTarget

    /** What a finished task changed (the «terminada y revisada» notice leads here, as the mockup draws it). */
    data class TaskChanges(val id: Long) : NoticeTarget

    /** An Orb version the PC announces; [id] is its number. */
    data class Version(val id: String) : NoticeTarget

    /** An account of Uso y agentes, by the PC's id. */
    data class Account(val id: String) : NoticeTarget

    /** A notice of the Orbe chat that names no conversation: the best the phone can do is the chat list. */
    data object ChatsTab : NoticeTarget
}

/** What a notice is about, as the PC names it in the `kind` of a `note`. */
object NoticeKinds {
    const val MESSAGE = "message"
    const val APPROVAL = "approval"
    const val TASK = "task"
    const val DONE = "done"
    const val HELD = "held"
    const val LIMIT = "limit"
    const val UPDATE = "update"

    /** Information only: no buttons anywhere, a tap just opens the app at its destination. */
    fun isInfo(kind: String) = kind == DONE || kind == HELD || kind == LIMIT || kind == UPDATE
}

@Immutable
data class Notice(
    val id: String,
    val title: String,
    val body: String,
    /** A [NoticeKinds] value, or one a newer PC invented (shown as a plain message). */
    val kind: String,
    val at: Long,
    val target: NoticeTarget?,
    /** The PC's preview setting was off: [body] is a generic text, never the real one. */
    val hidden: Boolean = false,
)

@Immutable
data class NoticeRow(val notice: Notice, val unread: Boolean)

object NotesParser {
    /** A `note` event of the PC (the same payload the desktop shows as a notification). Null when it says nothing. */
    fun fromEvent(payload: JsonElement, nowMs: Long): Notice? {
        val o = payload as? JsonObject ?: return null
        return build(o, nowMs)
    }

    /** The answer of `notes.list`: each notice keeps the time the PC gave it. */
    fun fromList(result: JsonElement?, nowMs: Long): List<Notice> =
        (((result as? JsonObject)?.get("notes")) as? JsonArray).orEmpty().mapNotNull { x ->
            val o = x as? JsonObject ?: return@mapNotNull null
            build(o, o.long("at") ?: nowMs)
        }

    private fun build(o: JsonObject, at: Long): Notice? {
        val key = o.str("key") ?: return null
        val kind = o.str("kind") ?: NoticeKinds.MESSAGE
        val body = o.str("body").orEmpty()
        val title = o.str("title").orEmpty().ifBlank { "Orb" }
        // One notice per line of a chat; without one, the same kind, title and text count as the same notice
        // (the time would make every repeat of the event look new).
        val line = o.long("line")?.toString() ?: "c" + listOf(kind, title, body).joinToString("\u0000").hashCode().toUInt().toString(16)
        return Notice("note:$key:$line", title, body, kind, at, targetOf(o, key, kind), o.flag("hidden"))
    }

    /** The destination: the one the PC states (`target`), else the one a live chat note implies (its card, key or route). */
    private fun targetOf(o: JsonObject, key: String, kind: String): NoticeTarget? {
        val card = o["card"] as? JsonObject
        val route = o["route"] as? JsonObject
        val stated = o["target"] as? JsonObject
        val id = stated?.let { it.str("id") ?: it.long("id")?.toString() }
        when (stated?.str("type")) {
            "task" -> id?.toLongOrNull()?.let { return if (kind == NoticeKinds.DONE) NoticeTarget.TaskChanges(it) else NoticeTarget.Task(it) }
            "version" -> id?.let { return NoticeTarget.Version(it) }
            "account" -> id?.let { return NoticeTarget.Account(it) }
            "session" -> id?.let { return NoticeTarget.Chat("session", it) }
            "chat" -> return id?.let { NoticeTarget.Chat("conversation", it) } ?: NoticeTarget.ChatsTab
        }
        return when {
            card?.str("method") == "tasks.approve" -> card.long("task")?.let { NoticeTarget.Task(it) }
            card?.str("method") == "sessions.approve" -> card.str("id")?.let { NoticeTarget.Chat("session", it) }
            key.startsWith("session:") -> NoticeTarget.Chat("session", key.removePrefix("session:"))
            route?.str("view") == "chat" -> route.long("id")?.let { NoticeTarget.Chat("conversation", it.toString()) } ?: NoticeTarget.ChatsTab
            else -> null
        }
    }

    private fun JsonObject.flag(k: String) = (this[k] as? kotlinx.serialization.json.JsonPrimitive)?.content == "true"

    /** The permission requests `app.state` lists as waiting. */
    fun approvals(state: JsonElement?, nowMs: Long): List<Notice> =
        ((state as? JsonObject)?.get("approvals") as? JsonArray).orEmpty().mapNotNull { x ->
            val o = x as? JsonObject ?: return@mapNotNull null
            val id = o.str("id") ?: o.int("id")?.toString() ?: return@mapNotNull null
            val body = o["body"] as? JsonObject
            val session = o.str("session_id") ?: o.int("session_id")?.toString()
            Notice(
                id = "approval:$id", title = body?.str("title").orEmpty().ifBlank { "Permiso pendiente" },
                body = body?.str("reason").orEmpty(), kind = NoticeKinds.APPROVAL, at = nowMs,
                target = session?.let { NoticeTarget.Chat("session", it) },
            )
        }
}

/** The part of the day a notice belongs to, for the headings of the list. */
enum class NoticeDay { Today, Yesterday, Earlier }

object NoticeDays {
    fun of(at: Long, nowMs: Long, tz: TimeZone = TimeZone.getDefault()): NoticeDay {
        val days = dayNumber(nowMs, tz) - dayNumber(at, tz)
        return when {
            days <= 0 -> NoticeDay.Today
            days == 1L -> NoticeDay.Yesterday
            else -> NoticeDay.Earlier
        }
    }

    private fun dayNumber(ms: Long, tz: TimeZone): Long {
        val c = GregorianCalendar(tz).apply { timeInMillis = ms }
        val utc = GregorianCalendar(TimeZone.getTimeZone("UTC")).apply { clear(); set(c.get(Calendar.YEAR), c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH)) }
        return utc.timeInMillis / 86_400_000L
    }
}

/** A notice as the store keeps it: what the person did with it travels with the text. */
data class StoredNotice(val notice: Notice, val read: Boolean, val dismissed: Boolean)

/** Where the list is kept between runs (the encrypted database); every call may fail, the list then lives in memory only. */
interface NoticeStore {
    /** Null while the database cannot be used. */
    suspend fun load(): List<StoredNotice>?

    /** Saves notices: new ones unread, known ones keep what the person did with them. */
    suspend fun merge(list: List<Notice>)
    suspend fun markRead(ids: Collection<String>?)
    suspend fun setDismissed(id: String, dismissed: Boolean)
    suspend fun prune(cutoff: Long, keep: Int)

    /** The PC's time of the newest notice `notes.list` handed over, to ask only for newer ones next time. */
    suspend fun since(): Long?
    suspend fun setSince(at: Long)
}

/**
 * The phone's list of notices. It is built from the `note` events received, from `notes.list` (what the PC sent while the
 * phone was away) and from the permission requests `app.state` lists as waiting. Everything but the waiting requests is
 * written through [store], in order, by [scope]; without them the list lives in memory only.
 *
 * What the PC keeps (7 days, 100 notices) is also what the phone keeps. A notice swiped away stays in the list as
 * a hidden one so the same notice coming again from the PC does not bring it back.
 */
class NotesFeed(
    private val store: NoticeStore? = null,
    scope: CoroutineScope? = null,
    private val max: Int = MAX,
    private val keepMs: Long = KEEP_MS,
    private val nowMs: () -> Long = System::currentTimeMillis,
) {
    private val entries = MutableStateFlow<Map<String, StoredNotice>>(emptyMap())
    private val pending = MutableStateFlow<List<Notice>>(emptyList())
    private val pendingRead = MutableStateFlow<Set<String>>(emptySet())
    private val _rows = MutableStateFlow<List<NoticeRow>>(emptyList())
    val rows: StateFlow<List<NoticeRow>> = _rows.asStateFlow()

    private var restored = false
    private val writes = Channel<suspend NoticeStore.() -> Unit>(Channel.UNLIMITED)

    init {
        // One writer, so what happened first is saved first (a swipe and its «Deshacer» must not cross).
        if (store != null && scope != null) scope.launch { for (w in writes) runCatching { store.w() } }
    }

    private fun save(w: suspend NoticeStore.() -> Unit) {
        if (store != null) writes.trySend(w)
    }

    private fun publish() {
        val pend = pending.value.map { StoredNotice(it, it.id in pendingRead.value, false) }
        _rows.value = (pend + entries.value.values).filterNot { it.dismissed }.distinctBy { it.notice.id }
            .sortedByDescending { it.notice.at }.map { NoticeRow(it.notice, !it.read) }
    }

    /** Loads what was kept, once; whatever arrived meanwhile stays, together with what the person did with it. */
    suspend fun restore() {
        if (restored) return
        val s = store ?: return
        val saved = runCatching { s.load() }.getOrNull() ?: return
        restored = true
        entries.update { now ->
            val both = saved.associateBy { it.notice.id }.toMutableMap()
            for ((id, n) in now) {
                val old = both[id]
                both[id] = if (old == null) n else n.copy(notice = n.notice.copy(at = maxOf(old.notice.at, n.notice.at)), read = n.read || old.read, dismissed = n.dismissed || old.dismissed)
            }
            trim(both)
        }
        publish()
    }

    /** A notice that just arrived (a live event). */
    fun add(n: Notice) = merge(listOf(n))

    /** Notices from `notes.list`: those the phone already has are not added again. */
    fun merge(list: List<Notice>) {
        if (list.isEmpty()) return
        entries.update { current ->
            val next = LinkedHashMap(current)
            for (n in list) {
                val old = next[n.id]
                next[n.id] = if (old == null) StoredNotice(n, read = false, dismissed = false) else old.copy(notice = n.copy(at = maxOf(old.notice.at, n.at)))
            }
            trim(next)
        }
        save { merge(list) }
        save { prune(nowMs() - keepMs, max) }
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
        val all = ids ?: _rows.value.map { it.notice.id }
        pendingRead.update { it + all }
        entries.update { cur -> cur.mapValues { (id, e) -> if (id in all) e.copy(read = true) else e } }
        save { markRead(ids) }
        publish()
    }

    /** Hides a stored notice (a waiting permission request cannot be hidden: it is the PC's state). True when it was hidden. */
    fun dismiss(id: String): Boolean {
        if (entries.value[id] == null) return false
        entries.update { cur -> cur[id]?.let { cur + (id to it.copy(dismissed = true)) } ?: cur }
        save { setDismissed(id, true) }
        publish()
        return true
    }

    fun undoDismiss(id: String) {
        entries.update { cur -> cur[id]?.let { cur + (id to it.copy(dismissed = false)) } ?: cur }
        save { setDismissed(id, false) }
        publish()
    }

    /** The PC's time up to which `notes.list` was already read; null when it never was. */
    suspend fun since(): Long? = runCatching { store?.since() }.getOrNull()
    fun saveSince(at: Long) = save { setSince(at) }

    /** The phone was unlinked: nothing stays, in memory or waiting to be written. */
    fun clear() {
        writes.close()
        entries.value = emptyMap()
        pending.value = emptyList()
        pendingRead.value = emptySet()
        publish()
    }

    private fun trim(map: Map<String, StoredNotice>): Map<String, StoredNotice> {
        val cutoff = nowMs() - keepMs
        val kept = map.values.filter { it.notice.at >= cutoff }.sortedByDescending { it.notice.at }.take(max)

        return kept.associateBy { it.notice.id }
    }

    companion object {
        /** What the PC keeps for the phones. */
        const val MAX = 100
        const val KEEP_MS = 7L * 24 * 60 * 60 * 1000
    }
}

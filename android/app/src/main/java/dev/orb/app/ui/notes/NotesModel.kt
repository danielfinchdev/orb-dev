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
    /**
     * The id this notice would have without the PC's own identifier (the chat line, or a hash of kind, title and text). Set
     * only when the id is the PC's, so a copy kept under the old id can hand its read and dismissed state over.
     */
    val legacyId: String? = null,
) {
    /** The chat or source this notice came from (the `key` of the PC's note), taken from the id; null for a permission request. */
    val sourceKey: String? get() = if (id.startsWith("note:")) id.removePrefix("note:").substringBeforeLast(':') else null
}

@Immutable
data class NoticeRow(val notice: Notice, val unread: Boolean)

object NotesParser {
    /** A `note` event of the PC (the same payload the desktop shows as a notification). Null when it says nothing. */
    fun fromEvent(payload: JsonElement, nowMs: Long): Notice? {
        val o = payload as? JsonObject ?: return null
        // A live note carries the saved row's id as `nid`; its own `id` is the id of the system notification.
        return build(o, nowMs, o.long("nid"))
    }

    /** The answer of `notes.list`: each notice keeps the time the PC gave it. */
    fun fromList(result: JsonElement?, nowMs: Long): List<Notice> =
        (((result as? JsonObject)?.get("notes")) as? JsonArray).orEmpty().mapNotNull { x ->
            val o = x as? JsonObject ?: return@mapNotNull null
            build(o, o.long("at") ?: nowMs, o.long("id"))
        }

    private fun build(o: JsonObject, at: Long, occurrence: Long?): Notice? {
        val key = o.str("key") ?: return null
        val kind = o.str("kind") ?: NoticeKinds.MESSAGE
        val body = o.str("body").orEmpty()
        val title = o.str("title").orEmpty().ifBlank { "Orb" }
        // The PC numbers every occurrence (`nid` live, `id` in the list), so two equal notices are two rows and one notice
        // seen live and in the list is one. Without it (an older PC): one notice per line of a chat, and without a line the
        // same kind, title and text count as the same notice (the time would make every repeat look new).
        val line = o.long("line")?.toString() ?: "c" + listOf(kind, title, body).joinToString("\u0000").hashCode().toUInt().toString(16)
        val legacy = "note:$key:$line"
        val id = occurrence?.takeIf { it > 0 }?.let { "note:$key:n$it" }
        return Notice(id ?: legacy, title, body, kind, at, targetOf(o, key, kind), o.flag("hidden"), legacyId = legacy.takeIf { id != null })
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

    /** Forgets the notices under these ids (a copy kept under the old id once the PC's own identifier replaced it). */
    suspend fun remove(ids: Collection<String>)

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
    private val pendingReadKeys = MutableStateFlow<Set<String>>(emptySet())
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
        var marked = emptyList<String>()
        var adopted = emptyList<Adoption>()
        entries.update { now ->
            // A read mark made before the list was loaded (a notification button with the app just started) still counts.
            val readNow = pendingRead.value
            val keys = pendingReadKeys.value
            val both = saved.map { s ->
                if (s.read || (s.notice.id !in readNow && s.notice.sourceKey !in keys)) s else s.copy(read = true)
            }.associateBy { it.notice.id }.toMutableMap()
            val unreadBefore = saved.filter { !it.read }.map { it.notice.id }.toSet()
            marked = both.values.filter { it.read && it.notice.id in unreadBefore }.map { it.notice.id }
            val handed = ArrayList<Adoption>()
            for ((id, n) in now) {
                val old = both[id]
                var row = if (old == null) n else n.copy(notice = n.notice.copy(at = maxOf(old.notice.at, n.notice.at)), read = n.read || old.read, dismissed = n.dismissed || old.dismissed)
                // The copy kept under the old id may be saved next to this one already (written before the list was loaded).
                val legacy = n.notice.legacyId?.let { both[it] }
                if (legacy != null && inherits(n.notice, legacy.notice)) {
                    row = row.copy(notice = row.notice.copy(at = maxOf(row.notice.at, legacy.notice.at)), read = row.read || legacy.read, dismissed = row.dismissed || legacy.dismissed)
                    handed += Adoption(legacy.notice.id, row)
                }
                both[id] = row
            }
            adopted = handed
            for (a in handed) both.remove(a.oldId)
            trim(both)
        }
        if (marked.isNotEmpty()) save { markRead(marked) }
        saveAdoptions(adopted)
        publish()
    }

    /** A notice that just arrived (a live event). */
    fun add(n: Notice) = merge(listOf(n))

    /** Notices from `notes.list`: those the phone already has are not added again. */
    fun merge(list: List<Notice>) {
        if (list.isEmpty()) return
        var adopted = emptyList<Adoption>()
        entries.update { current ->
            val next = LinkedHashMap(current)
            val handed = ArrayList<Adoption>()
            for (n in list) {
                val old = next[n.id]
                if (old != null) { next[n.id] = old.copy(notice = n.copy(at = maxOf(old.notice.at, n.at))); continue }
                // The same notice kept before the PC numbered its notices: what the person did with it carries over.
                val legacy = n.legacyId?.let { current[it] }
                if (legacy != null && inherits(n, legacy.notice)) {
                    next[n.id] = StoredNotice(n.copy(at = maxOf(n.at, legacy.notice.at)), legacy.read, legacy.dismissed)
                    handed += Adoption(legacy.notice.id, next.getValue(n.id))
                } else next[n.id] = StoredNotice(n, read = false, dismissed = false)
            }
            adopted = handed
            for (a in handed) next.remove(a.oldId)
            trim(next)
        }
        save { merge(list) }
        saveAdoptions(adopted)
        save { prune(nowMs() - keepMs, max) }
        publish()
    }

    private class Adoption(val oldId: String, val row: StoredNotice)

    /**
     * An occurrence inherits what was done to the old copy only if the old copy could have been it: one that happened after
     * the old copy's last time is a new occurrence of the same text (the limit came back) and starts unread.
     */
    private fun inherits(n: Notice, old: Notice) = n.at <= old.at + CLOCK_SLACK_MS

    private fun saveAdoptions(list: List<Adoption>) {
        if (list.isEmpty()) return
        save {
            for (a in list) {
                merge(listOf(a.row.notice))
                if (a.row.read) markRead(listOf(a.row.notice.id))
                if (a.row.dismissed) setDismissed(a.row.notice.id, true)
            }
            remove(list.map { it.oldId })
        }
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

    /** Marks read every notice of one chat (the `key` of the PC's note): what a notification button that covers a chat does. */
    fun markReadKey(key: String) {
        pendingReadKeys.update { it + key }
        val ids = entries.value.values.filter { it.notice.sourceKey == key }.map { it.notice.id }
        if (ids.isNotEmpty()) markRead(ids)
    }

    /** The chat is gone from the PC: its notices leave the list (hidden, so the PC's copy does not bring them back). */
    fun dismissChat(kind: String, id: String) {
        val hit = entries.value.values.filter { !it.dismissed && it.notice.target == NoticeTarget.Chat(kind, id) }.map { it.notice.id }.toSet()
        if (hit.isEmpty()) return
        entries.update { cur -> cur.mapValues { (k, e) -> if (k in hit) e.copy(dismissed = true) else e } }
        for (h in hit) save { setDismissed(h, true) }
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
        pendingReadKeys.value = emptySet()
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

        /** The PC's clock and the phone's differ a little; a notice this close to the old copy's time was already folded into it. */
        const val CLOCK_SLACK_MS = 2L * 60 * 1000
    }
}

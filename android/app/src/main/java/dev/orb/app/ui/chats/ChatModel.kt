package dev.orb.app.ui.chats

import androidx.compose.runtime.Immutable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/** An assistant (Orbe) conversation or a direct conversation with an agent; routes carry [wire] as `kind`. */
enum class ChatKind(val wire: String) {
    Orbe("conversation"), Agent("session");

    companion object {
        fun fromWire(s: String?) = if (s == "session") Agent else Orbe
    }
}

/** What identifies a chat on the PC: the pair most inbox methods take. */
@Immutable
data class ChatRef(val kind: ChatKind, val id: String) {
    val key get() = "${kind.wire}:$id"
}

enum class ChatState { Idle, Working, Paused }

enum class Speaker { User, Orbe, Agent, System }

@Immutable
data class ChatRow(
    val key: String,
    val kind: ChatKind,
    val id: String,
    val title: String,
    val project: String?,
    val lastText: String?,
    val lastFrom: Speaker?,
    val lastFromName: String?,
    /** ISO time of the last line (or of the last update when there is none). */
    val at: String?,
    val unread: Int,
    val state: ChatState,
    val pinned: Boolean,
    val pinOrder: Int?,
    val muted: Boolean,
    /** ISO time until which the chat is postponed; null = not postponed. */
    val snoozedUntil: String?,
    val section: Long?,
    /** The agent id (`claude`, `codex`...) of a direct chat, or the brain of an Orbe chat when the PC said so. */
    val agent: String?,
    val done: Boolean,
    /** A direct chat is waiting for the person to allow something. */
    val waitingPermission: Boolean,
    /** An Orbe chat is waiting for the person's answer to a question. */
    val asking: Boolean,
) {
    val ref get() = ChatRef(kind, id)
    val direct get() = kind == ChatKind.Agent
}

@Immutable
data class ChatSection(val id: Long, val name: String, val position: Int, val count: Int, val unread: Int)

@Immutable
data class InboxData(val rows: List<ChatRow>, val sections: List<ChatSection>, val unread: Int) {
    companion object {
        val Empty = InboxData(emptyList(), emptyList(), 0)
    }
}

/** Agent ids the PC uses, with the name shown to the person. Unknown ids keep their own name. */
fun agentName(agent: String?): String? = when (agent) {
    null, "" -> null
    "claude" -> "Claude"
    "codex" -> "Codex"
    "cursor" -> "Cursor"
    "gemini" -> "Gemini"
    "acp" -> "ACP"
    else -> agent.replaceFirstChar { it.uppercase() }
}

object InboxParser {
    /** Parses one item of `inbox.list` (possibly completed by [InboxMerge]); null when it has no key. */
    fun row(o: JsonObject): ChatRow? {
        val key = o.str("key") ?: return null
        val kind = ChatKind.fromWire(o.str("kind") ?: key.substringBefore(':'))
        val id = o.str("id") ?: key.substringAfter(':', "")
        if (id.isEmpty()) return null
        val last = o["lastMessage"] as? JsonObject
        val from = last?.get("from") as? JsonObject
        val speaker = when (from?.str("type")) {
            "user" -> Speaker.User
            "orbe" -> Speaker.Orbe
            "system" -> Speaker.System
            else -> null
        }
        val state = when (o.str("state")) {
            "working" -> ChatState.Working
            "paused" -> ChatState.Paused
            else -> ChatState.Idle
        }
        return ChatRow(
            key = key, kind = kind, id = id,
            title = o.str("title")?.takeIf { it.isNotBlank() } ?: ChatTexts.UNTITLED,
            project = o.str("project")?.takeIf { it.isNotBlank() },
            lastText = last?.str("text")?.takeIf { it.isNotBlank() }?.let(::oneLine),
            lastFrom = speaker, lastFromName = from?.str("name"),
            at = last?.str("at") ?: o.str("at"),
            unread = o.int("unread") ?: 0, state = state,
            pinned = o.bool("pinned"), pinOrder = o.int("pinOrder"), muted = o.bool("muted"),
            snoozedUntil = o.str("snoozedUntil"), section = o.long("section"),
            agent = o.str("agent"), done = o.bool("done"), waitingPermission = o.bool("asks"), asking = o.bool("asking"),
        )
    }

    fun sections(meta: JsonObject?): List<ChatSection> =
        (meta?.get("sections") as? JsonArray).orEmpty().mapNotNull { el ->
            val s = el as? JsonObject ?: return@mapNotNull null
            ChatSection(
                s.long("id") ?: return@mapNotNull null, s.str("name") ?: return@mapNotNull null,
                s.int("position") ?: 0, s.int("count") ?: 0, s.int("unread") ?: 0,
            )
        }.sortedBy { it.position }

    private fun unreadOf(rows: List<ChatRow>) = rows.sumOf { if (it.muted || it.snoozedUntil != null) 0 else it.unread }

    /** The whole `inbox.list` answer. */
    fun parse(result: JsonElement?): InboxData {
        val obj = result as? JsonObject ?: return InboxData.Empty
        val rows = (obj["items"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.let(::row) }
        return InboxData(rows, sections(obj), obj.int("unread") ?: unreadOf(rows))
    }

    /** Rows from the cache: each row's `raw` JSON plus the stored `inbox.meta` snapshot (sections, unread). */
    fun fromCache(raws: List<String>, metaJson: String?): InboxData {
        val json = kotlinx.serialization.json.Json
        val rows = raws.mapNotNull { raw -> (runCatching { json.parseToJsonElement(raw) }.getOrNull() as? JsonObject)?.let(::row) }
        val meta = metaJson?.let { runCatching { json.parseToJsonElement(it) }.getOrNull() as? JsonObject }
        return InboxData(rows, sections(meta), meta?.int("unread") ?: unreadOf(rows))
    }
}

/**
 * `inbox.list` only describes Orbe conversations fully; a direct chat comes as a bare mark (no title, project or time),
 * and the agent of an Orbe chat is not in it. The rest comes from `sessions.list`, `conversations.list` and
 * `approvals.list`, the same three the PC's own window merges.
 */
object InboxMerge {
    fun merge(inbox: JsonObject, conversations: JsonElement?, sessions: JsonElement?, approvals: JsonElement?): JsonObject {
        val convs = (conversations as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }.associateBy { it.str("id") }
        val sess = (sessions as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
            .filter { it.str("kind") == "chat" && !it.bool("archived") }.associateBy { it.str("id") }
        val asks = (approvals as? JsonArray).orEmpty().mapNotNull {
            val o = it as? JsonObject
            (o?.get("session") as? JsonObject)?.str("id") ?: o?.str("session_id")
        }.toSet()
        val seen = HashSet<String>()
        val out = ArrayList<JsonElement>()
        for (el in (inbox["items"] as? JsonArray).orEmpty()) {
            val o = el as? JsonObject ?: continue
            val id = o.str("id") ?: continue
            if (o.str("kind") == "session") {
                // A mark of a chat that is archived or gone has no row to show.
                val s = sess[id] ?: continue
                seen += id
                out += enrichSession(o, s, asks)
            } else {
                val c = convs[id]
                val extra = HashMap<String, JsonElement>()
                c?.str("agent")?.let { extra["agent"] = JsonPrimitive(it) }
                if (c?.bool("asking") == true) extra["asking"] = JsonPrimitive(true)
                out += JsonObject(o + extra)
            }
        }
        // Direct chats nobody has pinned or muted have no mark at all, so the inbox does not list them.
        for ((id, s) in sess) {
            if (id == null || id in seen) continue
            val base = buildJsonObject {
                put("key", "session:$id"); put("kind", "session"); put("id", id)
                put("pinned", false); put("muted", false); put("unread", 0)
            }
            out += enrichSession(base, s, asks)
        }
        return JsonObject(inbox + ("items" to JsonArray(out)))
    }

    private fun enrichSession(mark: JsonObject, s: JsonObject, asks: Set<String?>): JsonObject {
        val extra = HashMap<String, JsonElement>()
        s.str("title")?.let { extra["title"] = JsonPrimitive(it) }
        s.str("project")?.let { extra["project"] = JsonPrimitive(it) }
        s.str("agent")?.let { extra["agent"] = JsonPrimitive(it) }
        s.str("updated_at")?.let { extra["at"] = JsonPrimitive(it) }
        extra["state"] = JsonPrimitive(if (s.str("status") == "running") "working" else "idle")
        extra["done"] = JsonPrimitive(s.bool("settled"))
        extra["asks"] = JsonPrimitive(s.str("id") in asks)
        return JsonObject(mark + extra)
    }
}

/** Keeps a chat's text on one line, trimmed to what a row can show. */
fun oneLine(s: String): String = s.replace(Regex("\\s+"), " ").trim().take(160)

internal fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.takeUnless { it is JsonNull }?.contentOrNull
internal fun JsonObject.int(k: String): Int? = (this[k] as? JsonPrimitive)?.intOrNull
internal fun JsonObject.long(k: String): Long? = (this[k] as? JsonPrimitive)?.longOrNull
// SQLite flags come as 0/1 as well as true/false.
internal fun JsonObject.bool(k: String): Boolean = (this[k] as? JsonPrimitive)?.let { it.booleanOrNull ?: (it.intOrNull == 1) } ?: false

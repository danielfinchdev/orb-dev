package dev.orb.app.ui.chats

import androidx.compose.runtime.Immutable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

@Immutable
data class DigestLine(val key: String, val text: String, val items: List<String>)

/** What `inbox.digest` registered for [day]. Only what the PC sent: a part with nothing registered has no line. */
@Immutable
data class DayDigest(val day: String, val lines: List<DigestLine>, val waiting: Boolean)

object DayDigests {
    /** → the card to show, or null: the PC says it was shown already (`due` false, unless [ignoreDue]: it was asked for), the day is empty or the answer is not one. */
    fun parse(result: JsonElement?, t: InboxTexts = InboxTexts.current(), ignoreDue: Boolean = false): DayDigest? {
        val o = result as? JsonObject ?: return null
        if ((!ignoreDue && !o.bool("due")) || o.bool("empty")) return null
        val day = o.str("day") ?: return null
        val lines = ArrayList<DigestLine>()
        fun section(name: String) = o[name] as? JsonObject
        fun items(s: JsonObject?, text: (JsonObject) -> String?) =
            (s?.get("items") as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.let(text) }
        section("done")?.int("count")?.takeIf { it > 0 }?.let { n ->
            lines += DigestLine("done", t.done(n), items(section("done")) { x -> "#${x.str("id") ?: "?"} ${x.str("title").orEmpty()}".trim() })
        }
        section("failed")?.int("count")?.takeIf { it > 0 }?.let { n ->
            lines += DigestLine("failed", t.failed(n), items(section("failed")) { x -> "#${x.str("id") ?: "?"} ${x.str("title").orEmpty()}".trim() })
        }
        section("entries")?.int("count")?.takeIf { it > 0 }?.let { n ->
            lines += DigestLine("entries", t.entries(n), items(section("entries")) { x -> "${x.str("project").orEmpty()}: ${x.str("topic").orEmpty()}" })
        }
        val waiting = section("waiting")
        val approvals = waiting?.int("approvals") ?: 0
        val held = waiting?.int("held") ?: 0
        if (approvals > 0) lines += DigestLine("approvals", t.approvals(approvals), emptyList())
        if (held > 0) lines += DigestLine("held", t.held(held), emptyList())
        val usage = (o["usage"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
        if (usage.isNotEmpty()) {
            lines += DigestLine("usage", t.usage, usage.map { u ->
                val usd = (u["usd"] as? JsonPrimitive)?.doubleOrNull ?: 0.0
                val agent = u.str("agent")
                "${agentName(agent) ?: agent.orEmpty()}: ${t.turns(u.int("turns") ?: 0)}" +
                    if (usd > 0.0) " · ${String.format(java.util.Locale.US, "%.2f", usd)} USD" else ""
            })
        }
        if (lines.isEmpty()) return null
        return DayDigest(day, lines, waiting = approvals > 0 || held > 0)
    }
}

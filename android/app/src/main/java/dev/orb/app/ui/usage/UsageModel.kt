package dev.orb.app.ui.usage

import androidx.compose.runtime.Immutable
import dev.orb.app.ui.chats.bool
import dev.orb.app.ui.chats.int
import dev.orb.app.ui.chats.long
import dev.orb.app.ui.chats.str
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/** One limit window of an account's plan (`five_hour`, `seven_day`, `300min`…). */
@Immutable
data class UsageWindow(val window: String, /** 0..1 as the agent reports it. */ val utilization: Double, val resetAt: Long?)

@Immutable
data class UsageAccount(
    val account: String,
    val agent: String,
    val label: String,
    val plan: String?,
    val windows: List<UsageWindow>,
    /** Tasks used and allowed in the PC's own window, when it counts them. */
    val used: Int?,
    val max: Int?,
    val cooldownUntil: Long?,
    val cooldownReason: String?,
    /** The length of the PC's own task window, when it says it (the «Tareas N de M» count lives in it). */
    val windowHours: Int? = null,
)

@Immutable
data class DaySpend(val day: String, val usd: Double, val tokens: Long)

@Immutable
data class AgentSpend(val agent: String, val usd: Double, val tokens: Long)

@Immutable
data class UsageHistory(
    val days: Int,
    val usd: Double,
    val tokensIn: Long,
    val tokensOut: Long,
    val turns: Int,
    val byDay: List<DaySpend>,
    val byAgent: List<AgentSpend>,
)

@Immutable
data class AgentInfo(val id: String, val label: String, val installed: Boolean, val enabled: Boolean, val version: String?, val login: String?)

@Immutable
data class ModelPick(val level: String, val label: String, val reasoning: String?)

@Immutable
data class ModelGuideAgent(
    val id: String,
    val label: String,
    /** tier (`light`, `balanced`, `heavy`) to the model names of that kind. */
    val tiers: List<Pair<String, List<String>>>,
    val picks: List<ModelPick>,
)

private fun JsonObject.dbl(k: String): Double? = (this[k] as? JsonPrimitive)?.doubleOrNull
private fun JsonObject.obj(k: String) = this[k] as? JsonObject
private fun JsonObject.arr(k: String) = this[k] as? JsonArray

object UsageParser {
    fun accounts(el: JsonElement?): List<UsageAccount> = (el as? JsonArray).orEmpty().mapNotNull { x ->
        val o = x as? JsonObject ?: return@mapNotNull null
        val id = o.str("account") ?: return@mapNotNull null
        val agent = o.str("agent") ?: return@mapNotNull null
        UsageAccount(
            account = id, agent = agent, label = o.str("label") ?: id, plan = o.str("plan"),
            windows = o.arr("windows").orEmpty().mapNotNull { w ->
                val wo = w as? JsonObject ?: return@mapNotNull null
                UsageWindow(wo.str("window") ?: return@mapNotNull null, (wo.dbl("utilization") ?: return@mapNotNull null).coerceIn(0.0, 1.0), wo.long("resetAt"))
            },
            used = o.int("used"), max = o.int("max"), cooldownUntil = o.long("cooldownUntil"), cooldownReason = o.str("cooldownReason"),
            windowHours = o.int("windowHours")?.takeIf { it > 0 },
        )
    }

    fun history(el: JsonElement?, days: Int): UsageHistory? {
        val o = el as? JsonObject ?: return null
        val total = o.obj("total") ?: return null
        fun tokens(r: JsonObject) = (r.long("tokensIn") ?: 0L) + (r.long("tokensOut") ?: 0L)
        return UsageHistory(
            days = days, usd = total.dbl("usd") ?: 0.0, tokensIn = total.long("tokensIn") ?: 0L, tokensOut = total.long("tokensOut") ?: 0L,
            turns = total.int("turns") ?: 0,
            byDay = o.arr("days").orEmpty().mapNotNull { (it as? JsonObject)?.let { d -> DaySpend(d.str("day") ?: return@let null, d.dbl("usd") ?: 0.0, tokens(d)) } },
            byAgent = o.arr("agents").orEmpty().mapNotNull { (it as? JsonObject)?.let { a -> AgentSpend(a.str("agent") ?: return@let null, a.dbl("usd") ?: 0.0, tokens(a)) } },
        )
    }

    fun agents(el: JsonElement?): List<AgentInfo> = (el as? JsonArray).orEmpty().mapNotNull { x ->
        val o = x as? JsonObject ?: return@mapNotNull null
        val id = o.str("id") ?: return@mapNotNull null
        AgentInfo(id, o.str("label") ?: id, o.bool("installed"), o.bool("enabled"), o.str("version"), o.str("login"))
    }

    fun guide(el: JsonElement?): List<ModelGuideAgent> = (el as? JsonArray).orEmpty().mapNotNull { x ->
        val o = x as? JsonObject ?: return@mapNotNull null
        val id = o.str("id") ?: return@mapNotNull null
        val tiers = Tiers.mapNotNull { t ->
            val names = o.obj("tiers")?.arr(t).orEmpty().mapNotNull { (it as? JsonPrimitive)?.content }
            if (names.isEmpty()) null else t to names
        }
        val picks = Levels.mapNotNull { l ->
            val p = o.obj("picks")?.obj(l) ?: return@mapNotNull null
            ModelPick(l, p.str("label") ?: return@mapNotNull null, p.str("reasoning"))
        }
        ModelGuideAgent(id, o.str("label") ?: id, tiers, picks)
    }

    val Tiers = listOf("light", "balanced", "heavy")
    val Levels = listOf("simple", "normal", "complejo")
}

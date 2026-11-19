package dev.orb.app.ui.schedules

import androidx.compose.runtime.Immutable
import dev.orb.app.ui.chats.bool
import dev.orb.app.ui.chats.int
import dev.orb.app.ui.chats.long
import dev.orb.app.ui.chats.str
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

/** The frequencies the PC accepts, in the order the form offers them. */
val ScheduleEvery = listOf("daily", "weekly", "every_hours", "hourly", "once")

@Immutable
data class ScheduleItem(
    val id: Long,
    val project: String,
    val title: String,
    val description: String,
    val agent: String,
    val readonly: Boolean,
    val every: String,
    val atTime: String,
    val weekdays: List<Int>,
    val enabled: Boolean,
    /** An assistant-made schedule waits for the person's approval once before it runs on its own. */
    val approved: Boolean,
    val nextRun: String?,
    val lastRun: String?,
    val lastTask: Long?,
    val sameChat: Boolean,
    /** The PC's own description of the frequency, already in the app language («Cada lunes a las 09:00»). */
    val whenText: String,
    /** The IANA zone the schedule's wall time is read in; null when it follows the PC's own zone. */
    val tz: String? = null,
    /** The day of the month of a monthly schedule. */
    val monthDay: Int? = null,
)

/** What the form sends to `schedules.create`. */
@Immutable
data class NewSchedule(
    val project: String,
    val title: String,
    val description: String,
    val every: String,
    /** `HH:mm`, or `YYYY-MM-DDTHH:mm` for a single run. */
    val atTime: String,
    val weekdays: List<Int>,
    val hours: Int,
    val readonly: Boolean,
    val sameChat: Boolean,
    /** An agent id, or `any` to let the PC choose; the PC rejects an unknown one. */
    val agent: String = "any",
    /** A model id of [agent]; null keeps the agent's own default. */
    val model: String? = null,
)

object SchedulesParser {
    fun list(el: JsonElement?): List<ScheduleItem> = (el as? JsonArray).orEmpty().mapNotNull { x ->
        val o = x as? JsonObject ?: return@mapNotNull null
        val id = o.long("id") ?: return@mapNotNull null
        val title = o.str("title") ?: return@mapNotNull null
        val every = o.str("every") ?: return@mapNotNull null
        ScheduleItem(
            id = id, project = o.str("project").orEmpty(), title = title, description = o.str("description").orEmpty(),
            agent = o.str("agent") ?: "any", readonly = o.bool("readonly"), every = every, atTime = o.str("at_time").orEmpty(),
            weekdays = (o["weekdays"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.intOrNull },
            enabled = o.bool("enabled"), approved = o.bool("approved"),
            nextRun = o.str("next_run"), lastRun = o.str("last_run"), lastTask = o.long("last_task"),
            sameChat = o.bool("same_chat"), whenText = o.str("when") ?: every,
            tz = o.str("tz")?.takeIf { it.isNotBlank() }, monthDay = o.int("month_day"),
        )
    }

    /** The project names of a `projects.list` answer. */
    fun projectNames(el: JsonElement?): List<String> =
        (el as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.str("name") }

    fun hours(item: ScheduleItem): Int = item.atTime.toIntOrNull() ?: 6
}

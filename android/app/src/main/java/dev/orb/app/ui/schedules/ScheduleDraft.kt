package dev.orb.app.ui.schedules

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.saveable.mapSaver

/** The ways a schedule can repeat, as the sheet offers them: the days of the week are the mockup's own. */
object ScheduleKind {
    const val DAYS = "days"
    const val MONTHLY = "monthly"
    const val EVERY_HOURS = "every_hours"
    const val HOURLY = "hourly"
    const val ONCE = "once"
    val all = listOf(DAYS, MONTHLY, EVERY_HOURS, HOURLY, ONCE)

    /** What the PC calls a frequency, in this sheet's terms; null for one the sheet cannot show. */
    fun of(every: String): String? = when (every) {
        "daily", "weekly" -> DAYS
        "monthly" -> MONTHLY
        "every_hours" -> EVERY_HOURS
        "hourly" -> HOURLY
        "once" -> ONCE
        else -> null
    }

    fun label(kind: String) = when (kind) {
        DAYS -> SchedulesTexts.KIND_DAYS
        else -> SchedulesTexts.everyLabel(kind)
    }
}

/**
 * What the create and edit sheet holds while the person fills it. Pure data: turning it into what the PC takes, and
 * telling what changed since the schedule was opened, is done here so a test can check it without a screen.
 *
 * Text fields stay text ([hours], [monthDay]) so a half-typed number is not lost; [days] are 0-6 with Sunday = 0, as the PC has them.
 */
@Immutable
data class ScheduleDraft(
    val title: String = "",
    val what: String = "",
    val kind: String = ScheduleKind.DAYS,
    val days: Set<Int> = setOf(1),
    val time: String = "09:00",
    val monthDay: String = "1",
    val hours: String = "6",
    val date: String = "",
    val project: String? = null,
    val agent: String = "any",
    val model: String? = null,
    val readonly: Boolean = false,
    val sameChat: Boolean = false,
    val tz: String = "",
    val notify: Boolean = true,
    val askAlways: Boolean = false,
    /** The schedule repeats in a way this app cannot show: its timing is left exactly as the PC has it. */
    val foreignTiming: Boolean = false,
) {
    private val hoursValue get() = hours.toIntOrNull()?.takeIf { it in 1..168 }
    private val monthDayValue get() = monthDay.toIntOrNull()?.takeIf { it in 1..31 }

    private fun timingReady() = foreignTiming || when (kind) {
        ScheduleKind.DAYS -> days.isNotEmpty() && ScheduleWhen.isTime(time)
        ScheduleKind.MONTHLY -> monthDayValue != null && ScheduleWhen.isTime(time)
        ScheduleKind.EVERY_HOURS -> hoursValue != null
        ScheduleKind.HOURLY -> true
        else -> ScheduleWhen.dateTime(date, time).isNotEmpty()
    }

    /** True when the PC has what it needs: a name, the instructions, a project and a frequency it can read. */
    fun ready(project: String?) = title.isNotBlank() && what.isNotBlank() && !project.isNullOrBlank() && timingReady()

    private fun every() = when (kind) {
        ScheduleKind.DAYS -> if (days.size == 7) "daily" else "weekly"
        else -> kind
    }

    private fun atTime() = when (kind) {
        ScheduleKind.EVERY_HOURS, ScheduleKind.HOURLY -> "00:00"
        ScheduleKind.ONCE -> ScheduleWhen.dateTime(date, time)
        else -> time
    }

    private fun weekdays() = if (every() == "weekly") days.sorted() else emptyList()

    /** [pcFields]: the PC takes the monthly day, the zone, the phone notice and the permission level (a 3.8.8 PC). */
    fun toNew(project: String, pcFields: Boolean) = NewSchedule(
        project = project, title = title.trim(), description = what.trim(), every = every(), atTime = atTime(), weekdays = weekdays(),
        hours = hoursValue ?: 6, readonly = readonly, sameChat = sameChat, agent = agent, model = model.takeIf { agent != "any" },
        monthDay = monthDayValue.takeIf { pcFields && kind == ScheduleKind.MONTHLY },
        tz = tz.trim().takeIf { pcFields && it.isNotEmpty() },
        notifyMobile = notify.takeIf { pcFields },
        autonomy = "preguntar".takeIf { pcFields && askAlways },
    )

    private fun sameTiming(o: ScheduleDraft) = kind == o.kind && time == o.time && when (kind) {
        ScheduleKind.DAYS -> days == o.days
        ScheduleKind.MONTHLY -> monthDay.trim() == o.monthDay.trim()
        ScheduleKind.EVERY_HOURS -> hours.trim() == o.hours.trim()
        ScheduleKind.ONCE -> date == o.date
        else -> true
    }

    /**
     * Only what differs from [initial] (the draft the schedule opened with), so an edit never rewrites what the person
     * did not touch. The timing goes whole when any part of it changed.
     */
    fun toPatch(initial: ScheduleDraft, project: String, initialProject: String, pcFields: Boolean): SchedulePatch {
        val timing = !foreignTiming && !sameTiming(initial)
        val agentChanged = agent != initial.agent
        return SchedulePatch(
            title = title.trim().takeIf { it != initial.title.trim() },
            description = what.trim().takeIf { it != initial.what.trim() },
            project = project.takeIf { it != initialProject },
            agent = agent.takeIf { agentChanged },
            // Changing the agent drops the old agent's model: the PC would keep a model the new agent does not have.
            model = if (agentChanged || model != initial.model) model.orEmpty().takeIf { agent != "any" || agentChanged } else null,
            readonly = readonly.takeIf { it != initial.readonly },
            sameChat = sameChat.takeIf { it != initial.sameChat },
            every = every().takeIf { timing },
            atTime = atTime().takeIf { timing },
            hours = hoursValue.takeIf { timing && kind == ScheduleKind.EVERY_HOURS },
            weekdays = weekdays().takeIf { timing },
            monthDay = monthDayValue.takeIf { timing && kind == ScheduleKind.MONTHLY },
            tz = tz.trim().takeIf { pcFields && it != initial.tz.trim() },
            notifyMobile = notify.takeIf { pcFields && it != initial.notify },
            autonomy = "preguntar".takeIf { pcFields && askAlways && !initial.askAlways },
        )
    }

    companion object {
        private val ALL_DAYS = (0..6).toSet()

        /** The draft of a schedule the PC already has. */
        fun of(s: ScheduleItem): ScheduleDraft {
            val kind = ScheduleKind.of(s.every)
            val onceDate = ScheduleWhen.datePart(s.atTime)
            return ScheduleDraft(
                title = s.title, what = s.description, kind = kind ?: ScheduleKind.DAYS,
                days = when (s.every) { "daily" -> ALL_DAYS; else -> s.weekdays.filter { it in 0..6 }.toSet().ifEmpty { setOf(1) } },
                time = if (s.every == "once") ScheduleWhen.timePart(s.atTime).ifEmpty { "09:00" } else s.atTime.takeIf(ScheduleWhen::isTime) ?: "09:00",
                monthDay = (s.monthDay ?: 1).toString(), hours = SchedulesParser.hours(s).toString(), date = onceDate,
                project = s.project, agent = s.agent, model = s.model, readonly = s.readonly, sameChat = s.sameChat,
                tz = s.tz.orEmpty(), notify = s.notifyMobile ?: true, askAlways = s.autonomy == "preguntar",
                foreignTiming = kind == null,
            )
        }

        /** Survives a rotation or the process being recreated while the sheet is open. */
        val Saver = mapSaver(
            save = { d ->
                mapOf(
                    "title" to d.title, "what" to d.what, "kind" to d.kind, "days" to d.days.sorted().joinToString(","), "time" to d.time,
                    "monthDay" to d.monthDay, "hours" to d.hours, "date" to d.date, "project" to d.project, "agent" to d.agent,
                    "model" to d.model, "readonly" to d.readonly, "sameChat" to d.sameChat, "tz" to d.tz, "notify" to d.notify,
                    "askAlways" to d.askAlways, "foreign" to d.foreignTiming,
                )
            },
            restore = { m ->
                ScheduleDraft(
                    title = m["title"] as String, what = m["what"] as String, kind = m["kind"] as String,
                    days = (m["days"] as String).split(',').mapNotNull { it.toIntOrNull() }.toSet(), time = m["time"] as String,
                    monthDay = m["monthDay"] as String, hours = m["hours"] as String, date = m["date"] as String, project = m["project"] as String?,
                    agent = m["agent"] as String, model = m["model"] as String?, readonly = m["readonly"] as Boolean, sameChat = m["sameChat"] as Boolean,
                    tz = m["tz"] as String, notify = m["notify"] as Boolean, askAlways = m["askAlways"] as Boolean, foreignTiming = m["foreign"] as Boolean,
                )
            },
        )
    }
}

package dev.orb.app.ui.schedules

import dev.orb.app.ui.chats.ChatTime
import java.util.Calendar
import java.util.GregorianCalendar
import java.util.TimeZone

/**
 * The «Próxima» and «Última» lines of a row. Plain java.util on purpose: the app supports Android 7, where java.time is
 * not there. The PC sends moments in UTC and the wall time a schedule is read in (`at_time`) in its own zone.
 */
object ScheduleStamps {
    private val DAYS = arrayOf("dom", "lun", "mar", "mié", "jue", "vie", "sáb")
    private val MONTHS = arrayOf("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")

    /** What the PC's zone is called when the schedule does not name one: only its offset is known, never the city. */
    const val PC_ZONE = "hora del PC"
    const val PHONE_ZONE = "hora del móvil"

    /** A zone to write times in, and the name to put after them. */
    class Zone(val zone: TimeZone, val label: String)

    /** «Europe/Madrid» → «Madrid», «America/Argentina/Buenos_Aires» → «Buenos Aires». */
    fun city(id: String): String = id.substringAfterLast('/').replace('_', ' ')

    /**
     * The zone [s] runs in: the one it names; else the PC's, whose offset follows from the schedule's own wall time and
     * its next run; else (hourly schedules have no wall time) the phone's, said as such.
     */
    fun zoneOf(s: ScheduleItem, phone: TimeZone): Zone {
        s.tz?.let { id ->
            // An unknown id makes TimeZone fall back to GMT, which would print wrong hours.
            val z = TimeZone.getTimeZone(id)
            if (z.id == id) return Zone(z, city(id))
        }
        impliedOffset(s)?.let { return Zone(it, PC_ZONE) }
        return Zone(phone, PHONE_ZONE)
    }

    private fun impliedOffset(s: ScheduleItem): TimeZone? {
        val next = ChatTime.parse(s.nextRun) ?: return null
        val wall = when (s.every) {
            "daily", "weekly", "monthly" -> s.atTime
            "once" -> ScheduleWhen.timePart(s.atTime)
            else -> return null
        }
        if (!ScheduleWhen.isTime(wall)) return null
        val (h, m) = ScheduleWhen.hourMinute(wall)
        val utc = GregorianCalendar(TimeZone.getTimeZone("UTC")).apply { timeInMillis = next }
        val utcMinutes = utc.get(Calendar.HOUR_OF_DAY) * 60 + utc.get(Calendar.MINUTE)
        // Offsets run from −12 h to +14 h; the wall time is the next run seen from the PC's zone.
        var diff = ((h * 60 + m - utcMinutes) % 1440 + 1440) % 1440
        if (diff >= 14 * 60 + 15) diff -= 1440
        if (diff % 15 != 0) return null
        val sign = if (diff < 0) "-" else "+"
        val a = kotlin.math.abs(diff)
        return TimeZone.getTimeZone("GMT$sign%02d:%02d".format(a / 60, a % 60))
    }

    private fun dayNumber(c: Calendar): Long {
        val utc = GregorianCalendar(TimeZone.getTimeZone("UTC")).apply { clear(); set(c.get(Calendar.YEAR), c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH)) }
        return utc.timeInMillis / 86_400_000L
    }

    private fun clock(c: Calendar) = "${c.get(Calendar.HOUR_OF_DAY)}:${c.get(Calendar.MINUTE).toString().padStart(2, '0')}"

    /** «hoy», «mañana», «lun 16» and, from a month away, «lun 16 dic»: the day of [then] seen from [now]. */
    private fun dayAhead(then: Calendar, now: Calendar): String {
        val days = dayNumber(then) - dayNumber(now)
        val named = "${DAYS[then.get(Calendar.DAY_OF_WEEK) - 1]} ${then.get(Calendar.DAY_OF_MONTH)}"
        return when {
            days == 0L -> "hoy"
            days == 1L -> "mañana"
            days > 25 -> "$named ${MONTHS[then.get(Calendar.MONTH)]}"
            else -> named
        }
    }

    /** «Próxima: lun 16, 9:00 (Madrid)»; null when the schedule has no next run. */
    fun next(s: ScheduleItem, nowMs: Long, phone: TimeZone): String? {
        val at = ChatTime.parse(s.nextRun) ?: return null
        val z = zoneOf(s, phone)
        val then = GregorianCalendar(z.zone).apply { timeInMillis = at }
        val now = GregorianCalendar(z.zone).apply { timeInMillis = nowMs }
        return "${SchedulesTexts.NEXT}: ${dayAhead(then, now)}, ${clock(then)} (${z.label})"
    }

    /** «Última: ayer, bien»; the outcome is left out while the task of that run is unknown. */
    fun last(s: ScheduleItem, outcome: String?, nowMs: Long, phone: TimeZone): String? {
        val at = ChatTime.parse(s.lastRun) ?: return null
        val then = GregorianCalendar(phone).apply { timeInMillis = at }
        val now = GregorianCalendar(phone).apply { timeInMillis = nowMs }
        val days = dayNumber(now) - dayNumber(then)
        val day = when {
            days <= 0L -> "hoy"
            days == 1L -> "ayer"
            days in 2..6 -> "${DAYS[then.get(Calendar.DAY_OF_WEEK) - 1]} ${then.get(Calendar.DAY_OF_MONTH)}"
            else -> "${then.get(Calendar.DAY_OF_MONTH)} ${MONTHS[then.get(Calendar.MONTH)]}"
        }
        return listOfNotNull("${SchedulesTexts.LAST}: $day", outcome).joinToString(", ")
    }

    /** The words for how the task of the last run ended, from its status on the PC; null for one the app does not know. */
    fun outcome(status: String?): String? = when (status) {
        "done", "accepted" -> "bien"
        "failed" -> "con error"
        "blocked" -> "bloqueada"
        "limited" -> "con límite"
        "cancelled" -> "cancelada"
        "running" -> "en curso"
        "queued", "pending" -> "en cola"
        "awaiting_approval" -> "esperando tu OK"
        "review" -> "en revisión"
        "paused" -> "en pausa"
        else -> null
    }

    /** «9:00 (Madrid)» for a schedule with a wall time, «sin hora fija» for an hourly one. */
    fun clockLine(s: ScheduleItem, phone: TimeZone): String {
        val z = zoneOf(s, phone)
        val time = when (s.every) {
            "daily", "weekly", "monthly" -> s.atTime.takeIf(ScheduleWhen::isTime)
            "once" -> ScheduleWhen.timePart(s.atTime).takeIf { it.isNotEmpty() }
            else -> null
        } ?: return SchedulesTexts.NO_FIXED_TIME
        val (h, m) = ScheduleWhen.hourMinute(time)
        val zone = if (s.tz != null || s.every == "once" || z.label == PC_ZONE) z.label else SchedulesTexts.PC_ZONE_NOTE
        return "$h:${m.toString().padStart(2, '0')} ($zone)"
    }
}

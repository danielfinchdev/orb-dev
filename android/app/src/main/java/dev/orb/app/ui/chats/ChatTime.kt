package dev.orb.app.ui.chats

import java.util.Calendar
import java.util.GregorianCalendar
import java.util.TimeZone

/**
 * Times of the chat list. Plain java.util on purpose: the app supports Android 7, where java.time is not there.
 * The PC sends ISO times in UTC (`2026-11-11T09:41:00.000Z`).
 */
object ChatTime {
    private val DAYS = arrayOf("dom", "lun", "mar", "mié", "jue", "vie", "sáb")
    private val MONTHS = arrayOf("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")
    private val ISO = Regex("""^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?""")

    /** Epoch milliseconds of an ISO time, or null when it is not one. Offsets other than `Z` are not used by the PC. */
    fun parse(iso: String?): Long? {
        val m = ISO.find(iso ?: return null) ?: return null
        val g = m.groupValues
        return GregorianCalendar(TimeZone.getTimeZone("UTC")).apply {
            clear()
            set(g[1].toInt(), g[2].toInt() - 1, g[3].toInt(), g[4].toInt(), g[5].toInt(), g[6].toIntOrNull() ?: 0)
        }.timeInMillis
    }

    fun iso(epochMs: Long): String {
        val c = GregorianCalendar(TimeZone.getTimeZone("UTC")).apply { timeInMillis = epochMs }
        fun p(n: Int) = n.toString().padStart(2, '0')
        return "${c.get(Calendar.YEAR)}-${p(c.get(Calendar.MONTH) + 1)}-${p(c.get(Calendar.DAY_OF_MONTH))}T${p(c.get(Calendar.HOUR_OF_DAY))}:${p(c.get(Calendar.MINUTE))}:${p(c.get(Calendar.SECOND))}.000Z"
    }

    /** «10:41» today, «ayer», the weekday within the last week, else «3 nov». Empty when there is no time. */
    fun short(iso: String?, nowMs: Long, tz: TimeZone = TimeZone.getDefault()): String {
        val t = parse(iso) ?: return ""
        val then = GregorianCalendar(tz).apply { timeInMillis = t }
        val now = GregorianCalendar(tz).apply { timeInMillis = nowMs }
        val days = (dayNumber(now) - dayNumber(then)).toInt()
        return when {
            days == 0 -> "${then.get(Calendar.HOUR_OF_DAY)}:${then.get(Calendar.MINUTE).toString().padStart(2, '0')}"
            days == 1 -> "ayer"
            days in 2..6 -> DAYS[then.get(Calendar.DAY_OF_WEEK) - 1]
            else -> "${then.get(Calendar.DAY_OF_MONTH)} ${MONTHS[then.get(Calendar.MONTH)]}"
        }
    }

    /** Local calendar day as a whole number, so two times can be compared by day across month ends. */
    private fun dayNumber(c: Calendar): Long {
        val utc = GregorianCalendar(TimeZone.getTimeZone("UTC")).apply { clear(); set(c.get(Calendar.YEAR), c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH)) }
        return utc.timeInMillis / 86_400_000L
    }

    /** Whether a postponement is still in force at [nowMs]. */
    fun snoozed(until: String?, nowMs: Long): Boolean = (parse(until) ?: 0L) > nowMs

    /** 9:00 local time of the next day, as an ISO UTC time. */
    fun tomorrowMorning(nowMs: Long, tz: TimeZone = TimeZone.getDefault()): String {
        val c = GregorianCalendar(tz).apply { timeInMillis = nowMs; add(Calendar.DAY_OF_MONTH, 1); set(Calendar.HOUR_OF_DAY, 9); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }
        return iso(c.timeInMillis)
    }
}

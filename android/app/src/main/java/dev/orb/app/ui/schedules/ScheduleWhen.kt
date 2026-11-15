package dev.orb.app.ui.schedules

import java.util.Calendar
import java.util.TimeZone

/**
 * The wall-clock strings the PC stores in `at_time`: `HH:mm`, or `YYYY-MM-DDTHH:mm` for a single run. The PC reads them
 * in its own time zone, so the pickers never convert anything: what the person picks is what is sent.
 */
object ScheduleWhen {
    private val TIME = Regex("""^([01]\d|2[0-3]):[0-5]\d$""")
    private val DATE = Regex("""^\d{4}-\d{2}-\d{2}$""")

    fun time(hour: Int, minute: Int) = "%02d:%02d".format(hour, minute)

    fun date(year: Int, month: Int, day: Int) = "%04d-%02d-%02d".format(year, month, day)

    fun isTime(s: String) = TIME.matches(s)

    /** `HH:mm` → hour and minute, or 9:00 when it is not a valid time. */
    fun hourMinute(s: String): Pair<Int, Int> =
        if (isTime(s)) s.substring(0, 2).toInt() to s.substring(3, 5).toInt() else 9 to 0

    fun dateTime(date: String, time: String) = if (DATE.matches(date) && isTime(time)) "${date}T$time" else ""

    /** The date part of a `YYYY-MM-DDTHH:mm`, or "". */
    fun datePart(dateTime: String) = dateTime.substringBefore('T', "").takeIf { DATE.matches(it) }.orEmpty()

    /** The time part of a `YYYY-MM-DDTHH:mm`, or "". */
    fun timePart(dateTime: String) = dateTime.substringAfter('T', "").takeIf { isTime(it) }.orEmpty()

    // The Material date picker works in UTC midnights, so the calendar day is read and built in UTC too.
    fun dateFromPicker(utcMillis: Long): String {
        val c = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { timeInMillis = utcMillis }
        return date(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
    }

    fun pickerFromDate(date: String): Long? {
        if (!DATE.matches(date)) return null
        val c = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
            clear()
            set(date.substring(0, 4).toInt(), date.substring(5, 7).toInt() - 1, date.substring(8, 10).toInt())
        }
        return c.timeInMillis
    }
}

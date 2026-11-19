package dev.orb.app.ui.schedules

import dev.orb.app.ui.chats.ChatTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.TimeZone

class ScheduleStampsTest {
    private val madrid = TimeZone.getTimeZone("Europe/Madrid")
    private val utc = TimeZone.getTimeZone("UTC")

    // «Now» is Thursday 12 November 2026, 12:00 in Madrid (11:00 UTC).
    private val now = ChatTime.parse("2026-11-12T11:00:00.000Z")!!

    @Test fun theNextRunIsWrittenInTheZoneOfTheSchedule() {
        val s = schedule(1, tz = "Europe/Madrid", nextRun = "2026-11-16T08:00:00.000Z")
        assertEquals("Próxima: lun 16, 9:00 (Madrid)", ScheduleStamps.next(s, now, utc))
    }

    @Test fun withoutAZoneTheOffsetOfThePcFollowsFromTheWallTime() {
        val winter = schedule(1, atTime = "09:00", nextRun = "2026-11-16T08:00:00.000Z")
        assertEquals("Próxima: lun 16, 9:00 (hora del PC)", ScheduleStamps.next(winter, now, utc))
        // The same wall time in summer is one hour earlier in UTC: the offset is read from that very run.
        val summer = schedule(1, atTime = "09:00", nextRun = "2026-07-20T07:00:00.000Z")
        val july = ChatTime.parse("2026-07-01T07:00:00.000Z")!!
        assertEquals("Próxima: lun 20, 9:00 (hora del PC)", ScheduleStamps.next(summer, july, utc))
    }

    @Test fun anHourlyScheduleHasNoWallTimeSoItUsesThePhoneZoneAndSaysSo() {
        val s = schedule(1, every = "hourly", atTime = "00:00", nextRun = "2026-11-12T12:00:00.000Z")
        assertEquals("Próxima: hoy, 13:00 (hora del móvil)", ScheduleStamps.next(s, now, madrid))
    }

    @Test fun todayAndTomorrowAreSaidAsSuch() {
        val today = schedule(1, tz = "Europe/Madrid", nextRun = "2026-11-12T17:00:00.000Z")
        assertEquals("Próxima: hoy, 18:00 (Madrid)", ScheduleStamps.next(today, now, utc))
        val tomorrow = schedule(1, tz = "Europe/Madrid", nextRun = "2026-11-13T08:00:00.000Z")
        assertEquals("Próxima: mañana, 9:00 (Madrid)", ScheduleStamps.next(tomorrow, now, utc))
        val far = schedule(1, tz = "America/Argentina/Buenos_Aires", nextRun = "2026-12-21T12:00:00.000Z")
        assertEquals("Próxima: lun 21 dic, 9:00 (Buenos Aires)", ScheduleStamps.next(far, now, utc))
    }

    @Test fun anUnknownZoneNameIsNotTrusted() {
        val s = schedule(1, tz = "Mars/Olympus", atTime = "09:00", nextRun = "2026-11-16T08:00:00.000Z")
        assertEquals("Próxima: lun 16, 9:00 (hora del PC)", ScheduleStamps.next(s, now, utc))
    }

    @Test fun noNextRunSaysNothing() {
        assertNull(ScheduleStamps.next(schedule(1, nextRun = null), now, utc))
    }

    @Test fun theLastRunSaysTheDayAndHowItWent() {
        val yesterday = schedule(1, lastRun = "2026-11-11T22:30:00.000Z", lastTask = 4)
        assertEquals("Última: ayer, bien", ScheduleStamps.last(yesterday, ScheduleStamps.outcome("done"), now, madrid))
        assertEquals("Última: ayer", ScheduleStamps.last(yesterday, null, now, madrid))
        assertEquals("Última: hoy, con error", ScheduleStamps.last(schedule(1, lastRun = "2026-11-12T08:00:00.000Z"), ScheduleStamps.outcome("failed"), now, madrid))
        assertEquals("Última: lun 9, bien", ScheduleStamps.last(schedule(1, lastRun = "2026-11-09T10:00:00.000Z"), "bien", now, madrid))
        assertEquals("Última: 20 sep", ScheduleStamps.last(schedule(1, lastRun = "2026-09-20T10:00:00.000Z"), null, now, madrid))
        assertNull(ScheduleStamps.last(schedule(1, lastRun = null), null, now, madrid))
    }

    @Test fun theOutcomeWordsCoverTheKnownStatusesAndNotAnUnknownOne() {
        assertEquals("bien", ScheduleStamps.outcome("done"))
        assertEquals("en curso", ScheduleStamps.outcome("running"))
        assertEquals("cancelada", ScheduleStamps.outcome("cancelled"))
        assertNull(ScheduleStamps.outcome("something-new"))
        assertNull(ScheduleStamps.outcome(null))
    }

    @Test fun theClockLineNamesTheZoneOrSaysThereIsNoFixedTime() {
        assertEquals("9:00 (Madrid)", ScheduleStamps.clockLine(schedule(1, tz = "Europe/Madrid"), utc))
        assertEquals("9:00 (hora del PC)", ScheduleStamps.clockLine(schedule(1, nextRun = "2026-11-16T08:00:00.000Z"), utc))
        assertEquals("Sin hora fija", ScheduleStamps.clockLine(schedule(1, every = "hourly", atTime = "00:00"), utc))
        assertEquals("10:00 (Madrid)", ScheduleStamps.clockLine(schedule(1, every = "once", atTime = "2026-12-01T10:00", tz = "Europe/Madrid"), utc))
    }
}

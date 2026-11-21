package dev.orb.app.ui.schedules

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScheduleWhenTest {
    @Test fun timesAreZeroPaddedAndValidated() {
        assertEquals("07:05", ScheduleWhen.time(7, 5))
        assertTrue(ScheduleWhen.isTime("23:59"))
        assertFalse(ScheduleWhen.isTime("24:00"))
        assertEquals(9 to 0, ScheduleWhen.hourMinute("nope"))
        assertEquals(18 to 30, ScheduleWhen.hourMinute("18:30"))
    }

    @Test fun dateTimeNeedsBothParts() {
        assertEquals("2026-11-16T09:00", ScheduleWhen.dateTime("2026-11-16", "09:00"))
        assertEquals("", ScheduleWhen.dateTime("", "09:00"))
        assertEquals("2026-11-16", ScheduleWhen.datePart("2026-11-16T09:00"))
        assertEquals("09:00", ScheduleWhen.timePart("2026-11-16T09:00"))
    }

    @Test fun pickerMillisRoundTripOnTheSameCalendarDay() {
        val ms = ScheduleWhen.pickerFromDate("2026-03-29")!!
        assertEquals("2026-03-29", ScheduleWhen.dateFromPicker(ms))
        assertNull(ScheduleWhen.pickerFromDate(""))
    }

    @Test fun aSingleRunSplitsIntoItsDayAndItsHour() {
        assertEquals("", ScheduleWhen.datePart("09:00"))
        assertEquals("", ScheduleWhen.timePart("2026-11-16"))
        assertEquals("", ScheduleWhen.timePart("2026-11-16T25:00"))
        assertEquals("", ScheduleWhen.dateTime("2026-11-16", "9:00"))
    }

    @Test fun anInvalidTimeFallsBackToNineAndMidnightIsValid() {
        assertEquals(9 to 0, ScheduleWhen.hourMinute("24:00"))
        assertTrue(ScheduleWhen.isTime("00:00"))
        assertFalse(ScheduleWhen.isTime("9:00"))
    }
}

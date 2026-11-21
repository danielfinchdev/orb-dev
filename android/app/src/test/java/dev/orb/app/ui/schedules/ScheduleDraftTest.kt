package dev.orb.app.ui.schedules

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScheduleDraftTest {
    private fun open(s: ScheduleItem) = ScheduleDraft.of(s)

    @Test fun aNewDraftNeedsANameTheInstructionsAProjectAndADay() {
        val d = ScheduleDraft()
        assertFalse(d.ready("app"))
        val named = d.copy(title = "Tests", what = "Corre los tests")
        assertTrue(named.ready("app"))
        assertFalse(named.ready(null))
        assertFalse(named.copy(what = "  ").ready("app"))
        assertFalse(named.copy(days = emptySet()).ready("app"))
    }

    @Test fun allSevenDaysMakeADailyScheduleAndFewerAWeeklyOne() {
        val base = ScheduleDraft(title = "t", what = "d", time = "08:15")
        val daily = base.copy(days = (0..6).toSet()).toNew("app", pcFields = true)
        assertEquals("daily", daily.every)
        assertEquals(emptyList<Int>(), daily.weekdays)
        val weekly = base.copy(days = setOf(5, 1)).toNew("app", pcFields = true)
        assertEquals("weekly", weekly.every)
        assertEquals(listOf(1, 5), weekly.weekdays)
        assertEquals("08:15", weekly.atTime)
    }

    @Test fun eachFrequencyBuildsWhatThePcReads() {
        val base = ScheduleDraft(title = "t", what = "d")
        val monthly = base.copy(kind = ScheduleKind.MONTHLY, monthDay = "31", time = "23:30").toNew("app", pcFields = true)
        assertEquals("monthly", monthly.every)
        assertEquals(31, monthly.monthDay)
        assertEquals("23:30", monthly.atTime)
        val hours = base.copy(kind = ScheduleKind.EVERY_HOURS, hours = "12").toNew("app", pcFields = true)
        assertEquals("every_hours" to 12, hours.every to hours.hours)
        assertEquals("00:00", hours.atTime)
        assertEquals("hourly", base.copy(kind = ScheduleKind.HOURLY).toNew("app", true).every)
        val once = base.copy(kind = ScheduleKind.ONCE, date = "2026-12-01", time = "10:00").toNew("app", true)
        assertEquals("once" to "2026-12-01T10:00", once.every to once.atTime)
    }

    @Test fun aSingleRunNeedsADateAndAMonthlyOneADayInRange() {
        val base = ScheduleDraft(title = "t", what = "d")
        assertFalse(base.copy(kind = ScheduleKind.ONCE).ready("app"))
        assertTrue(base.copy(kind = ScheduleKind.ONCE, date = "2026-12-01").ready("app"))
        assertFalse(base.copy(kind = ScheduleKind.MONTHLY, monthDay = "32").ready("app"))
        assertFalse(base.copy(kind = ScheduleKind.MONTHLY, monthDay = "").ready("app"))
        assertFalse(base.copy(kind = ScheduleKind.EVERY_HOURS, hours = "0").ready("app"))
    }

    @Test fun anOlderPcGetsNoneOfTheNewFields() {
        val d = ScheduleDraft(title = "t", what = "d", kind = ScheduleKind.MONTHLY, tz = "Europe/Madrid", notify = false, askAlways = true)
        val n = d.toNew("app", pcFields = false)
        assertNull(n.monthDay)
        assertNull(n.tz)
        assertNull(n.notifyMobile)
        assertNull(n.autonomy)
        val full = d.toNew("app", pcFields = true)
        assertEquals("Europe/Madrid", full.tz)
        assertEquals(false, full.notifyMobile)
        assertEquals("preguntar", full.autonomy)
    }

    @Test fun anUntouchedEditSendsNothing() {
        for (s in listOf(
            schedule(1), schedule(2, every = "daily", whenText = "x"), schedule(3, every = "monthly", monthDay = 5, tz = "Europe/Madrid"),
            schedule(4, every = "every_hours", atTime = "6"), schedule(5, every = "hourly", atTime = "00:00"),
            schedule(6, every = "once", atTime = "2026-12-01T10:00", agent = "claude", model = "opus", readonly = true, autonomy = "preguntar", notifyMobile = false),
        )) {
            val d = open(s)
            assertTrue("${s.every}: ${d.toPatch(d, s.project, s.project, true)}", d.toPatch(d, s.project, s.project, true).isEmpty)
        }
    }

    @Test fun anEditSendsTheTimingWholeWhenAnyPartChanged() {
        val s = schedule(1, every = "weekly", weekdays = listOf(1))
        val d = open(s)
        val p = d.copy(time = "10:30").toPatch(d, s.project, s.project, true)
        assertEquals("weekly", p.every)
        assertEquals("10:30", p.atTime)
        assertEquals(listOf(1), p.weekdays)
        assertNull(p.title)
        val daily = d.copy(days = (0..6).toSet()).toPatch(d, s.project, s.project, true)
        assertEquals("daily", daily.every)
        assertEquals(emptyList<Int>(), daily.weekdays)
    }

    @Test fun aFrequencyTheAppDoesNotKnowIsNeverRewrittenByAnEdit() {
        val s = schedule(1, every = "yearly", whenText = "yearly")
        val d = open(s)
        assertTrue(d.foreignTiming)
        val p = d.copy(title = "Otro", time = "11:00", days = setOf(2)).toPatch(d, s.project, s.project, true)
        assertEquals("Otro", p.title)
        assertNull(p.every)
        assertNull(p.atTime)
        assertNull(p.weekdays)
        assertTrue(d.ready(s.project))
    }

    @Test fun aMonthlyScheduleOpensWithItsDayAndStaysMonthly() {
        val s = schedule(1, every = "monthly", monthDay = 15, atTime = "08:00", weekdays = emptyList())
        val d = open(s)
        assertEquals(ScheduleKind.MONTHLY, d.kind)
        assertEquals("15", d.monthDay)
        val p = d.copy(monthDay = "20").toPatch(d, s.project, s.project, true)
        assertEquals("monthly" to 20, p.every to p.monthDay)
    }

    @Test fun changingTheAgentClearsTheOldModel() {
        val s = schedule(1, agent = "claude", model = "opus")
        val d = open(s)
        val p = d.copy(agent = "codex", model = null).toPatch(d, s.project, s.project, true)
        assertEquals("codex", p.agent)
        assertEquals("", p.model)
        val onlyModel = d.copy(model = "sonnet").toPatch(d, s.project, s.project, true)
        assertNull(onlyModel.agent)
        assertEquals("sonnet", onlyModel.model)
    }

    @Test fun zoneNoticeAndPermissionsAreSentOnlyWhenTheyChanged() {
        val s = schedule(1, tz = "Europe/Madrid", notifyMobile = true)
        val d = open(s)
        val changed = d.copy(tz = "", notify = false, askAlways = true)
        val p = changed.toPatch(d, s.project, s.project, true)
        assertEquals("", p.tz)
        assertEquals(false, p.notifyMobile)
        assertEquals("preguntar", p.autonomy)
        assertTrue(changed.toPatch(d, s.project, s.project, false).isEmpty)
    }

    @Test fun aLockedOptionIsNeverSentBack() {
        val s = schedule(1, readonly = true, autonomy = "preguntar")
        val d = open(s)
        assertTrue(d.readonly && d.askAlways)
        assertTrue(d.toPatch(d, s.project, s.project, true).isEmpty)
    }

    @Test fun theProjectOnlyTravelsWhenItChanged() {
        val s = schedule(1)
        val d = open(s)
        assertNull(d.toPatch(d, "app-movil", "app-movil", true).project)
        assertEquals("api-pagos", d.toPatch(d, "api-pagos", "app-movil", true).project)
    }
}

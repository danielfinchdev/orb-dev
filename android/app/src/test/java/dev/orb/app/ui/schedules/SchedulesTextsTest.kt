package dev.orb.app.ui.schedules

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SchedulesTextsTest {
    private fun row(every: String, whenText: String = every, extra: String = "") = SchedulesParser.list(
        Json.parseToJsonElement(
            """[{"id":1,"project":"p","title":"t","description":"d","every":"$every","at_time":"09:00","weekdays":[],"enabled":1,"approved":1,"when":"$whenText"$extra}]""",
        ),
    ).single()

    @Test fun aMonthlyScheduleIsNotShownAsASingleRun() {
        assertEquals("Cada mes", SchedulesTexts.everyLabel("monthly"))
        assertNotEquals("Una sola vez", SchedulesTexts.everyLabel("monthly"))
    }

    @Test fun everyKnownFrequencyKeepsItsOwnName() {
        assertEquals("Cada día", SchedulesTexts.everyLabel("daily"))
        assertEquals("Cada semana", SchedulesTexts.everyLabel("weekly"))
        assertEquals("Cada N horas", SchedulesTexts.everyLabel("every_hours"))
        assertEquals("Cada hora", SchedulesTexts.everyLabel("hourly"))
        assertEquals("Una sola vez", SchedulesTexts.everyLabel("once"))
    }

    @Test fun aFrequencyTheAppDoesNotKnowIsSaidAsSuch() {
        assertEquals("Frecuencia definida en el PC", SchedulesTexts.everyLabel("yearly"))
        assertEquals("Frecuencia definida en el PC", SchedulesTexts.whenLine(row("yearly")))
    }

    @Test fun theMonthlyRowSaysItsDayOfTheMonth() {
        val s = row("monthly", whenText = "el día 5 de cada mes a las 09:00", extra = ""","month_day":5,"tz":"Europe/Madrid"""")
        assertEquals(5, s.monthDay)
        assertEquals("Europe/Madrid", s.tz)
        assertEquals("El día 5 de cada mes a las 9:00", SchedulesTexts.whenLine(s))
    }

    @Test fun aMonthlyRowWithoutTheSentenceIsBuiltFromItsFields() {
        val s = row("monthly", extra = ""","month_day":31""")
        assertEquals("El día 31 de cada mes a las 9:00", SchedulesTexts.whenLine(s))
        assertNull(row("daily").tz)
    }

    @Test fun thePcSentenceKeepsItsCapitalAndDropsTheLeadingZero() {
        assertEquals("Cada lunes a las 9:00", SchedulesTexts.whenLine(row("weekly", "cada lunes a las 09:00")))
        assertEquals("Cada día a las 23:30", SchedulesTexts.whenLine(row("daily", "cada día a las 23:30")))
    }
}

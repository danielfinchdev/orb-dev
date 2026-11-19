package dev.orb.app.ui.tasks

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.TimeZone

class TaskBoardTest {
    private val madrid = TimeZone.getTimeZone("Europe/Madrid")

    private fun row(src: String): TaskRow = TasksParser.row(Json.parseToJsonElement(src) as JsonObject)!!

    private fun line(t: TaskRow, paused: Boolean = false) = TaskLines.status(t, paused, madrid)

    // The PC's words, read leniently

    @Test fun aFolderWaitCarriesTheTaskThatHoldsIt() {
        val t = row("""{"id":45,"status":"queued","waiting":{"kind":"folder","by":41}}""")
        assertEquals("folder", t.waiting!!.kind)
        assertEquals(41L, t.waiting!!.by)
    }

    @Test fun aNoticeWithItsAccountTimeAndPercentIsRead() {
        val w = row("""{"id":44,"status":"queued","waiting":{"kind":"notice","text":"Límite","account":"Claude","until":"2026-11-19T14:00:00.000Z","percent":94}}""").waiting!!
        assertEquals("Claude", w.account)
        assertEquals("2026-11-19T14:00:00.000Z", w.until)
        assertEquals(94, w.percent)
    }

    @Test fun numbersThatComeAsTextOrDecimalsAreStillRead() {
        val w = row("""{"id":1,"status":"queued","waiting":{"kind":"notice","by":"7","percent":93.6,"account":null,"until":null}}""").waiting!!
        assertEquals(7L, w.by)
        assertEquals(94, w.percent)
        assertNull(w.account)
        assertNull(w.until)
    }

    @Test fun anUnknownKindAndMissingFieldsDoNotBreakTheRow() {
        val t = row("""{"id":2,"status":"queued","waiting":{"kind":"something-new"}}""")
        assertEquals("En cola", TaskLines.status(t, false, madrid)!!.text)
    }

    @Test fun acceptedAndTheLimitReturnTimeAreRead() {
        val t = row("""{"id":3,"status":"done","accepted":true,"limited_until":"2026-11-19T14:00:00.000Z"}""")
        assertTrue(t.accepted)
        assertEquals("2026-11-19T14:00:00.000Z", t.limitedUntil)
    }

    // The sections

    @Test fun everyStatusLandsInASection() {
        fun s(status: String, held: TaskHeld? = null) = TaskBoard.sectionOf(task(1, status = status, held = held))
        assertEquals(TaskSection.Approve, s("awaiting_approval"))
        assertEquals(TaskSection.Approve, s("blocked", TaskHeld("borra 3 archivos", null)))
        assertEquals(TaskSection.Running, s("running"))
        assertEquals(TaskSection.Queued, s("queued"))
        assertEquals(TaskSection.Problems, s("failed"))
        assertEquals(TaskSection.Problems, s("blocked"))
        assertEquals(TaskSection.Problems, s("limited"))
        assertEquals(TaskSection.Done, s("done"))
        assertEquals(TaskSection.Done, s("cancelled"))
        // a status this phone does not know is kept, not hidden
        assertEquals(TaskSection.Done, s("something-new"))
    }

    // The lines of a row, with the words of the mockup

    @Test fun identityIsNumberProjectAndAgent() {
        assertEquals("#43 · app-movil · Codex", TaskLines.identity(task(43, project = "app-movil", agent = "codex")))
        assertEquals("#41 · app-movil", TaskLines.identity(task(41, project = "app-movil", agent = null)))
    }

    @Test fun aRowThatWaitsForTheOkSaysWhyWhenThePcDid() {
        val held = task(43, status = "blocked", held = TaskHeld("borra 214 archivos", null))
        assertEquals(TaskLine(LineMark.Hand, "Espera tu OK: borra 214 archivos", LineTone.Warn), line(held))
        assertEquals("Espera tu OK", line(task(44, status = "awaiting_approval"))!!.text)
    }

    @Test fun aRunningTaskSaysProjectAndAgentWithoutItsNumber() {
        assertEquals("app-movil · Cursor", TaskLines.workers(task(42, project = "app-movil", agent = "cursor")))
        assertEquals("app-movil", TaskLines.workers(task(42, project = "app-movil", agent = null)))
    }

    @Test fun aRowThatAsksForTheOkPutsTheTagsOfThePcIntoWords() {
        val row = task(46, status = "awaiting_approval", reasons = listOf("destructive", "financial", "algo_nuevo"))
        assertEquals("Espera tu OK: elimina datos, pagos, algo_nuevo", line(row)!!.text)
        // The PC's own words for a held task win over the tags.
        val held = task(43, status = "blocked", reasons = listOf("publish"), held = TaskHeld("borra 214 archivos", null))
        assertEquals("Espera tu OK: borra 214 archivos", line(held)!!.text)
    }

    @Test fun aChosenSectionAloneIsDrawnEvenWhenEmpty() {
        val rows = listOf(task(1, status = "queued"), task(2, status = "running"), task(3, status = "done"))
        assertEquals(listOf(TaskSection.Running), TaskBoard.groups(rows, TaskFilter.Active, TaskSection.Running).map { it.section })
        assertEquals(listOf(2L), TaskBoard.groups(rows, TaskFilter.Active, TaskSection.Running).single().rows.map { it.id })
        assertEquals(emptyList<TaskRow>(), TaskBoard.groups(rows, TaskFilter.Active, TaskSection.Problems).single().rows)
        // The finished view ignores the chips.
        assertEquals(listOf(TaskSection.Done), TaskBoard.groups(rows, TaskFilter.Done, TaskSection.Running).map { it.section })
    }

    @Test fun whenATaskWasMadeIsToldAsAnAgeAndThenAsADay() {
        val at = "2026-11-11T09:00:00.000Z"
        val t = dev.orb.app.ui.chats.ChatTime.parse(at)!!
        assertEquals("hace un momento", TaskLines.ago(at, t + 20_000))
        assertEquals("hace 12 min", TaskLines.ago(at, t + 12 * 60_000L))
        assertEquals("hace 3 h", TaskLines.ago(at, t + 3 * 3_600_000L + 5 * 60_000L))
        // from a day on it is a day, whatever the time zone says it is called
        assertTrue(TaskLines.ago(at, t + 40 * 3_600_000L)!!.startsWith("el ") || TaskLines.ago(at, t + 40 * 3_600_000L) == "ayer")
        assertNull(TaskLines.ago(null, t))
    }

    @Test fun waitingForOneOrSeveralTasks() {
        val one = task(41, waiting = TaskWait("deps", null, listOf(WaitDep(43, "queued", false))))
        assertEquals("Espera a la #43", line(one)!!.text)
        val two = task(41, waiting = TaskWait("deps", null, listOf(WaitDep(2, "queued", false), WaitDep(5, "running", false))))
        assertEquals("Espera a las #2, #5", line(two)!!.text)
        val held = task(41, waiting = TaskWait("deps", null, listOf(WaitDep(43, "blocked", true))))
        assertEquals("Espera a la #43: #43 está por aprobar", line(held)!!.text)
        val stuck = task(41, waiting = TaskWait("deps", null, listOf(WaitDep(43, "failed", false))))
        assertEquals("Espera a la #43: #43 está detenida", line(stuck)!!.text)
    }

    @Test fun pausedAndManualQueues() {
        assertEquals("Cola en pausa", line(task(1, waiting = TaskWait("paused", null, emptyList())))!!.text)
        assertEquals("Inicio manual", line(task(1, waiting = TaskWait("manual", null, emptyList())))!!.text)
        // a queued task the PC gave no reason for still says the queue is paused
        assertEquals("Cola en pausa", line(task(1), paused = true)!!.text)
        assertNull(line(task(1), paused = false))
    }

    @Test fun aTaskThatWritesInTheFolderOfAnotherOne() {
        assertEquals(TaskLine(LineMark.Folder, "Otra tarea escribe en esta carpeta (#41)"), line(task(45, waiting = TaskWait("folder", null, emptyList(), by = 41))))
        assertEquals("Otra tarea escribe en esta carpeta", line(task(45, waiting = TaskWait("folder", null, emptyList())))!!.text)
    }

    @Test fun aUsageLimitNoticeTellsAccountLevelAndTheLocalTime() {
        val full = task(44, waiting = TaskWait("notice", "texto", emptyList(), account = "Claude", until = "2026-11-19T14:00:00.000Z", percent = 94))
        assertEquals(TaskLine(LineMark.Gauge, "Claude al 94 % del límite · vuelve a las 15:00"), line(full))
        val noPercent = task(44, waiting = TaskWait("notice", "texto", emptyList(), account = "Claude", until = "2026-11-19T14:00:00.000Z"))
        assertEquals("Claude al límite · vuelve a las 15:00", line(noPercent)!!.text)
    }

    @Test fun aNoticeWithoutAccountOrTimeKeepsThePcsWords() {
        assertEquals("No hay agente libre", line(task(44, waiting = TaskWait("notice", "No hay agente libre", emptyList())))!!.text)
        assertEquals("No hay agente libre", line(task(44, waiting = TaskWait("notice", "No hay agente libre", emptyList(), account = "Claude")))!!.text)
        assertEquals("En espera", line(task(44, waiting = TaskWait("notice", null, emptyList())))!!.text)
        // an unreadable time is the same as none
        assertEquals("Hola", line(task(44, waiting = TaskWait("notice", "Hola", emptyList(), account = "Claude", until = "mañana")))!!.text)
    }

    @Test fun aLimitedTaskSaysWhenItComesBack() {
        assertEquals(TaskLine(LineMark.Gauge, "Límite de uso · vuelve a las 15:00", LineTone.Error), line(task(9, status = "limited", limitedUntil = "2026-11-19T14:00:00.000Z")))
        assertEquals("Límite de uso", line(task(9, status = "limited"))!!.text)
    }

    @Test fun finishedTasksSayCompletedOrAccepted() {
        assertEquals("Completada", line(task(1, status = "done"))!!.text)
        assertEquals("Aceptada", line(task(1, status = "done", accepted = true))!!.text)
        assertEquals("Cancelada", line(task(1, status = "cancelled"))!!.text)
        assertEquals("Deshecha", line(task(1, status = "done", undone = true))!!.text)
    }

    @Test fun theBarLineSaysWhatTheQueueIsDoing() {
        assertEquals("Cola en pausa · 3 esperando", TaskTexts.queueLine(true, 2, 3))
        assertEquals("Cola en pausa", TaskTexts.queueLine(true, 0, 0))
        assertEquals("2 en curso · 3 esperando", TaskTexts.queueLine(false, 2, 3))
        assertEquals("1 en curso", TaskTexts.queueLine(false, 1, 0))
        assertEquals("Cola en marcha", TaskTexts.queueLine(false, 0, 0))
    }
}

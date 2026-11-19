package dev.orb.app.ui.tasks

import androidx.compose.runtime.Immutable
import dev.orb.app.ui.chats.ChatTime
import dev.orb.app.ui.chats.agentName
import java.util.TimeZone

/** The sections of the board, in the order they are drawn. */
enum class TaskSection { Approve, Running, Queued, Problems, Done }

/** What the board shows: the four live sections, those plus the finished ones, or only the finished ones. */
enum class TaskFilter { Active, All, Done }

@Immutable
data class TaskGroup(val section: TaskSection, val rows: List<TaskRow>)

object TaskBoard {
    fun sectionOf(t: TaskRow): TaskSection = when {
        t.needsApproval -> TaskSection.Approve
        t.running -> TaskSection.Running
        t.status == "queued" || t.status == "pending" -> TaskSection.Queued
        t.problem -> TaskSection.Problems
        // «done», «cancelled» and anything a newer PC adds: nothing is hidden because the phone does not know the word
        else -> TaskSection.Done
    }

    /** The four live sections are always drawn (an empty one says «0», as the mockup does); the finished ones only when asked for. */
    fun groups(rows: List<TaskRow>, filter: TaskFilter, only: TaskSection? = null): List<TaskGroup> {
        val by = rows.groupBy(::sectionOf)
        // A chosen chip shows its section alone, even when it is empty (the header says «0»).
        if (only != null && filter != TaskFilter.Done) return listOf(TaskGroup(only, by[only].orEmpty()))
        val wanted = when (filter) {
            TaskFilter.Active -> TaskSection.entries - TaskSection.Done
            TaskFilter.All -> TaskSection.entries.filter { it != TaskSection.Done || by[it].orEmpty().isNotEmpty() }
            TaskFilter.Done -> listOf(TaskSection.Done)
        }
        return wanted.map { TaskGroup(it, by[it].orEmpty()) }
    }

    /** What the search box matches on the rows already loaded (for when the PC cannot be asked). */
    fun local(rows: List<TaskRow>, q: String): List<dev.orb.app.ui.chats.SearchTask> {
        val needle = q.trim().lowercase()
        return rows.filter { r ->
            r.title.lowercase().contains(needle) || r.project?.lowercase()?.contains(needle) == true || r.result?.lowercase()?.contains(needle) == true
        }.map { dev.orb.app.ui.chats.SearchTask(it.id, it.title, it.status, it.project, null) }
    }
}

/** The mark that opens the second line of a row. */
enum class LineMark { None, Hand, Clock, Gauge, Folder, Alert, Check }

enum class LineTone { Muted, Warn, Error, Ok }

@Immutable
data class TaskLine(val mark: LineMark, val text: String, val tone: LineTone = LineTone.Muted)

object TaskLines {
    /** «#43 · app-movil · Codex»: the number, the project and the agent when each is known. */
    fun identity(t: TaskRow): String =
        listOfNotNull("#${t.id}", t.project?.takeIf { it.isNotBlank() }, agentName(t.agent)).joinToString(" · ")

    /** «app-movil · Cursor»: what a running task shows, without its number (the bar below says it is alive). */
    fun workers(t: TaskRow): String = TaskTexts.projectAgent(t.project, agentName(t.agent))

    /** «hace 12 min», «hace 3 h», «ayer», «el 3 nov»: when a task was made, as it follows a «creada»; null without a time. */
    fun ago(iso: String?, nowMs: Long): String? {
        val t = ChatTime.parse(iso) ?: return null
        val minutes = ((nowMs - t) / 60_000L).toInt()
        return when {
            minutes < 1 -> TaskTexts.AGO_NOW
            minutes < 60 -> TaskTexts.agoMinutes(minutes)
            minutes < 24 * 60 -> TaskTexts.agoHours(minutes / 60)
            else -> ChatTime.short(iso, nowMs).let { if (it == "ayer") it else "el $it" }
        }
    }

    /** «15:00» in the phone's time zone for an ISO moment; null when the PC sent none or something unreadable. */
    fun clock(iso: String?, tz: TimeZone = TimeZone.getDefault()): String? = ChatTime.parse(iso)?.let { ChatTime.clock(it, tz) }

    /**
     * The line under [identity]: the reason a task waits, what it is waiting for from the person, or how it ended.
     * Null when there is nothing to add (a running task draws its bar instead).
     */
    fun status(t: TaskRow, queuePaused: Boolean, tz: TimeZone = TimeZone.getDefault()): TaskLine? = when (TaskBoard.sectionOf(t)) {
        // The PC's own words when it held the task; otherwise the tags of why it asks, put into words.
        TaskSection.Approve -> TaskLine(LineMark.Hand, t.held?.let { TaskTexts.waitsForOk(it.reasons) } ?: TaskTexts.waitsForOk(t.reasons), LineTone.Warn)
        TaskSection.Running -> t.note?.takeIf { it.isNotBlank() }?.let { TaskLine(LineMark.None, it) }
        TaskSection.Queued -> queued(t, queuePaused, tz)
        TaskSection.Problems -> when (t.status) {
            "limited" -> TaskLine(LineMark.Gauge, TaskTexts.limitedBack(clock(t.limitedUntil, tz)), LineTone.Error)
            else -> TaskLine(LineMark.Alert, TaskTexts.status(t.status), LineTone.Error)
        }
        TaskSection.Done -> when {
            t.undone -> TaskLine(LineMark.Check, TaskTexts.UNDONE)
            t.status == "done" -> TaskLine(LineMark.Check, if (t.accepted) TaskTexts.ALREADY_ACCEPTED else TaskTexts.status("done"), LineTone.Ok)
            else -> TaskLine(LineMark.None, TaskTexts.status(t.status))
        }
    }

    private fun queued(t: TaskRow, queuePaused: Boolean, tz: TimeZone): TaskLine? {
        val w = t.waiting ?: return if (queuePaused) TaskLine(LineMark.Clock, TaskTexts.PAUSED_TITLE) else null
        return when {
            w.kind == "paused" -> TaskLine(LineMark.Clock, TaskTexts.PAUSED_TITLE)
            w.kind == "manual" -> TaskLine(LineMark.Clock, TaskTexts.WAIT_MANUAL)
            w.kind == "deps" && w.on.isNotEmpty() -> TaskLine(LineMark.Clock, TaskTexts.waitsFor(w.on), if (w.on.any { it.held }) LineTone.Warn else LineTone.Muted)
            w.kind == "folder" -> TaskLine(LineMark.Folder, TaskTexts.waitFolder(w.by))
            w.kind == "notice" -> TaskLine(LineMark.Gauge, TaskTexts.noticeText(w, clock(w.until, tz)))
            else -> TaskLine(LineMark.Clock, TaskTexts.WAIT_TURN)
        }
    }
}

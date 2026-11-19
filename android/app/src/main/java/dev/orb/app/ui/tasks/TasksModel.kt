package dev.orb.app.ui.tasks

import androidx.compose.runtime.Immutable
import dev.orb.app.ui.chats.agentName
import dev.orb.app.ui.chats.bool
import dev.orb.app.ui.chats.long
import dev.orb.app.ui.chats.str
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

@Immutable
data class WaitDep(val id: Long, val status: String?, val held: Boolean)

/**
 * Why a queued task waits: `paused`, `manual`, `deps`, `folder` (another task writes there: [by]) or `notice` (the PC's own
 * words in [text]; a usage limit also says the [account], when it comes back as [until] and how full it is as [percent]).
 */
@Immutable
data class TaskWait(
    val kind: String,
    val text: String?,
    val on: List<WaitDep>,
    val by: Long? = null,
    val account: String? = null,
    val until: String? = null,
    val percent: Int? = null,
)

/** The cross review of a finished task (`tasks.get.review`): which task did it, who, what it concluded and when. */
@Immutable
data class TaskReview(val task: Long?, val verdict: String?, val agent: String?, val at: String?)

/** What a task did that needs a look before the work stays. */
@Immutable
data class TaskHeld(val reasons: String, val folder: String?)

@Immutable
data class TaskRow(
    val id: Long,
    val title: String,
    val project: String?,
    val status: String,
    val agent: String?,
    val model: String?,
    val readonly: Boolean,
    val createdAt: String?,
    val waiting: TaskWait?,
    val held: TaskHeld?,
    val undone: Boolean,
    val result: String?,
    val percent: Int? = null,
    val note: String? = null,
    /** The person already accepted the result of a finished task. */
    val accepted: Boolean = false,
    /** When a task stopped by a usage limit continues by itself (ISO). */
    val limitedUntil: String? = null,
    /** The PC's own tags for why the task asks for an OK first (`sensitivity`), not yet turned into words. */
    val reasons: List<String> = emptyList(),
    /** The schedule that created the task, when one did. */
    val scheduleId: Long? = null,
) {
    val needsApproval get() = status == "awaiting_approval" || held != null
    val problem get() = held == null && (status == "failed" || status == "blocked" || status == "limited")
    val running get() = status == "running"
}

@Immutable
data class TasksData(val tasks: List<TaskRow>, val paused: Boolean) {
    companion object {
        val Empty = TasksData(emptyList(), false)
    }
}

@Immutable
data class TaskEvent(val actor: String?, val kind: String?, val detail: String, val at: String?)

@Immutable
data class TaskLink(val id: Long, val title: String, val status: String?)

@Immutable
data class TaskDetail(
    val row: TaskRow,
    val description: String,
    val reasoning: String?,
    val mode: String?,
    val branch: String?,
    val folder: String?,
    val createdBy: String?,
    val modelLabel: String?,
    val accountLabel: String?,
    val accepted: Boolean,
    val hasCheckpoint: Boolean,
    val previewHash: String?,
    val dependencies: List<TaskLink>,
    val children: List<TaskLink>,
    val events: List<TaskEvent>,
    /** The task as an OK sees it (what the approval fingerprint covers); the same value the chat's card is drawn from. */
    val facts: dev.orb.app.ui.chats.TaskDetail? = null,
    /** The task's point of return as the PC names it now; null without a point or on a PC that does not say. */
    val checkpointId: String? = null,
    val review: TaskReview? = null,
) {
    val id get() = row.id
}

@Immutable
data class DiffFile(val status: String, val path: String, val added: Int, val removed: Int, val binary: Boolean, val patch: String, val cut: Boolean)

/**
 * What `tasks.diff` says. [reason] is why there is no diff (`nophoto`, `nogit`, `notdone`, `gone`, `joinedbyhand`, `nophotoafter`, `resolveonpc`, `unknownrun`) and [hidden] how many files
 * were left out because they look like secrets. [checkpointId] is the run the diff belongs to; [runKnown] tells a PC that does
 * not send the field at all (an older one) from one that sends it empty because it cannot tell.
 */
@Immutable
data class TaskDiff(
    val available: Boolean, val files: List<DiffFile>, val more: Int,
    val reason: String? = null, val hidden: Int = 0, val checkpointId: String? = null, val runKnown: Boolean = false,
) {
    val added get() = files.sumOf { it.added }
    val removed get() = files.sumOf { it.removed }

    /**
     * Whether this diff is of the run [taskRun] the task is at now. A PC that says nothing about the run (an older one), or a
     * diff that is not there, cannot disagree; a PC that says it must say the same run, or nothing here may be decided from it.
     */
    fun isOfRun(taskRun: String?): Boolean = !available || !runKnown || (checkpointId != null && taskRun != null && checkpointId == taskRun)

    /** Whether the PC gave a reason for having no diff that this app does not know: nothing is offered from it. */
    val unknownReason get() = !available && reason != null && reason !in KNOWN_REASONS

    /** The task's work was joined by hand on the PC: the stored diff no longer describes the folder, the PC allows no undo. */
    val joinedByHand get() = !available && reason == JOINED_BY_HAND

    /** The PC could not take the final photo: there is nothing to see, so nothing is decided from here. */
    val noFinalPhoto get() = !available && reason == NO_PHOTO_AFTER

    /**
     * Whether «Aceptar» may be offered for this diff. With a diff in sight it is; without one only where the PC allows the
     * accept and no file is touched. [undone] is the task's own record: a task already undone has nothing left to accept.
     * Anything not listed here (unfinished merge, no final photo, unknown reason, task still running) offers nothing.
     */
    fun allowsAccept(undone: Boolean): Boolean = when {
        available || reason == null -> true
        reason == NO_PHOTO -> !undone
        reason in ACCEPT_WITHOUT_DIFF -> true
        else -> false
    }

    /**
     * Whether «Deshacer» may be offered for this diff. Undoing sends the whole folder back to before the task, so it is only
     * offered when the person has seen what changes (a diff) or the PC keeps a copy to restore from a folder without git.
     */
    val allowsUndo: Boolean get() = available || reason == null || reason == NO_GIT

    companion object {
        const val JOINED_BY_HAND = "joinedbyhand"
        const val NO_PHOTO_AFTER = "nophotoafter"
        const val NO_PHOTO = "nophoto"
        const val RESOLVE_ON_PC = "resolveonpc"
        const val UNKNOWN_RUN = "unknownrun"
        const val NO_GIT = "nogit"
        const val GONE = "gone"
        val ACCEPT_WITHOUT_DIFF = setOf(NO_GIT, JOINED_BY_HAND, UNKNOWN_RUN, GONE)
        val KNOWN_REASONS = setOf(NO_PHOTO, NO_GIT, "notdone", GONE, JOINED_BY_HAND, NO_PHOTO_AFTER, RESOLVE_ON_PC, UNKNOWN_RUN)
    }
}

/** An agent `tasks.reassign` accepts, with the account and model the PC would use for it, as it describes them. */
@Immutable
data class AgentChoice(val id: String, val label: String, val detail: String? = null)

object TasksParser {
    private fun int(o: JsonObject, k: String): Int? = (o[k] as? JsonPrimitive)?.intOrNull

    private fun wait(el: JsonElement?): TaskWait? {
        val o = el as? JsonObject ?: return null
        val kind = o.str("kind") ?: return null
        val on = (o["on"] as? JsonArray).orEmpty().mapNotNull { d ->
            val dep = d as? JsonObject ?: return@mapNotNull null
            WaitDep(dep.long("id") ?: return@mapNotNull null, dep.str("status"), dep.bool("held"))
        }
        // The PC may send numbers as text; each field is read leniently and an unreadable one is simply absent.
        fun number(k: String) = (o[k] as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content?.toDoubleOrNull()
        return TaskWait(
            kind, o.str("text"), on, by = number("by")?.toLong(), account = o.str("account")?.takeIf { it.isNotBlank() },
            until = o.str("until")?.takeIf { it.isNotBlank() }, percent = number("percent")?.let { Math.round(it).toInt() },
        )
    }

    private fun held(el: JsonElement?): TaskHeld? {
        val o = el as? JsonObject ?: return null
        return TaskHeld(o.str("reasons").orEmpty(), o.str("folder"))
    }

    fun row(o: JsonObject): TaskRow? {
        val id = o.long("id") ?: return null
        return TaskRow(
            id = id, title = o.str("title").orEmpty().ifBlank { "Tarea #$id" }, project = o.str("project"),
            status = o.str("status").orEmpty(), agent = o.str("assigned_to") ?: o.str("agent"), model = o.str("model"),
            readonly = o.bool("readonly"), createdAt = o.str("created_at"),
            waiting = wait(o["waiting"]), held = held(o["held"]),
            // A list entry says `undone: true`; the detail carries the PC's own record of it.
            undone = o["undone"].let { it != null && it !is JsonNull && (it !is JsonPrimitive || it.content != "false") },
            result = o.str("result"), accepted = o.bool("accepted"), limitedUntil = o.str("limited_until")?.takeIf { it.isNotBlank() },
            reasons = (o["sensitivity"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.takeUnless { p -> p is JsonNull }?.content?.takeIf { c -> c.isNotBlank() } },
            scheduleId = o.long("schedule_id"),
        )
    }

    fun list(el: JsonElement): List<TaskRow> = (el as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.let(::row) }

    /** `tasks.live` → progress by task id. */
    fun live(el: JsonElement?): Map<Long, Pair<Int?, String?>> = (el as? JsonArray).orEmpty().mapNotNull { x ->
        val o = x as? JsonObject ?: return@mapNotNull null
        (o.long("id") ?: return@mapNotNull null) to (int(o, "percent") to o.str("note"))
    }.toMap()

    fun mergeLive(rows: List<TaskRow>, live: Map<Long, Pair<Int?, String?>>): List<TaskRow> =
        if (live.isEmpty()) rows else rows.map { r -> live[r.id]?.let { (p, n) -> r.copy(percent = p, note = n) } ?: r }

    private fun links(el: JsonElement?): List<TaskLink> = (el as? JsonArray).orEmpty().mapNotNull { x ->
        val o = x as? JsonObject ?: return@mapNotNull null
        TaskLink(o.long("id") ?: return@mapNotNull null, o.str("title").orEmpty(), o.str("status"))
    }

    fun detail(el: JsonElement): TaskDetail? {
        val o = el as? JsonObject ?: return null
        val row = row(o) ?: return null
        return TaskDetail(
            row = row, description = o.str("description").orEmpty(), reasoning = o.str("reasoning"), mode = o.str("mode"),
            branch = o.str("branch"),
            // the folder the approval fingerprint covers (the PC's current one); older PCs only have the stored one
            folder = o.str("folderNow")?.takeIf { it.isNotBlank() } ?: o.str("project_path"), createdBy = o.str("created_by"),
            modelLabel = o.str("modelLabel"), accountLabel = o.str("accountLabel"), accepted = o.bool("accepted"),
            hasCheckpoint = o.bool("hasCheckpoint"), previewHash = o.str("previewHash"),
            dependencies = links(o["dependencies"]), children = links(o["children"]),
            events = (o["events"] as? JsonArray).orEmpty().mapNotNull { x ->
                val e = x as? JsonObject ?: return@mapNotNull null
                TaskEvent(e.str("actor"), e.str("kind"), e.str("detail").orEmpty(), e.str("at"))
            },
            facts = dev.orb.app.ui.chats.OrbeParser.approvalFacts(o, row.id), checkpointId = o.str("checkpointId")?.takeIf { it.isNotBlank() },
            review = (o["review"] as? JsonObject)?.let { r -> TaskReview(r.long("task"), r.str("verdict"), r.str("agent"), r.str("at")) },
        )
    }

    fun diff(el: JsonElement): TaskDiff {
        val o = el as? JsonObject ?: return TaskDiff(false, emptyList(), 0)
        val files = (o["files"] as? JsonArray).orEmpty().mapNotNull { x ->
            val f = x as? JsonObject ?: return@mapNotNull null
            DiffFile(
                status = f.str("status") ?: "M", path = f.str("path") ?: return@mapNotNull null,
                added = int(f, "added") ?: 0, removed = int(f, "removed") ?: 0,
                binary = f.bool("binary"), patch = f.str("patch").orEmpty(), cut = f.bool("cut"),
            )
        }
        return TaskDiff(
            o.bool("available"), files, int(o, "more") ?: 0, reason = o.str("reason")?.takeIf { it.isNotBlank() }, hidden = int(o, "hidden") ?: 0,
            checkpointId = o.str("checkpointId")?.takeIf { it.isNotBlank() }, runKnown = o.containsKey("checkpointId"),
        )
    }

    fun agents(catalog: JsonElement?): List<AgentChoice> = (catalog as? JsonArray).orEmpty().mapNotNull { x ->
        val o = x as? JsonObject ?: return@mapNotNull null
        val id = o.str("id") ?: return@mapNotNull null
        val label = o.str("label") ?: agentName(id) ?: id
        // The model the PC would use by default and the account it would run on, when that account has a name of its own.
        val default = o.str("defaultModel")?.takeIf { it.isNotBlank() }
        val model = (o["models"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }.firstOrNull { it.str("id") == default }?.str("label")?.takeIf { it.isNotBlank() } ?: default
        val account = ((o["accounts"] as? JsonArray).orEmpty().firstOrNull() as? JsonObject)?.str("label")?.takeIf { it.isNotBlank() && it != label }
        AgentChoice(id, label, listOfNotNull(account, model).joinToString(" · ").ifBlank { null })
    }
}

enum class DiffLineKind { Add, Del, Hunk, Context, Note }

@Immutable
data class DiffLine(val kind: DiffLineKind, val text: String, val no: Int? = null)

object DiffParser {
    private val HUNK = Regex("""^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@""")

    /** The body of one file's patch: its header lines (`diff --git`, `index`, `---`, `+++`) are dropped. */
    fun lines(patch: String): List<DiffLine> {
        if (patch.isEmpty()) return emptyList()
        val out = ArrayList<DiffLine>()
        var body = false
        // The line numbers of the hunk being read: a removed line carries its old number, the others the new one.
        var old = 0
        var new = 0
        for (line in patch.split('\n')) {
            if (!body) {
                if (line.startsWith("@@")) body = true else continue
            }
            out += when {
                line.startsWith("@@") -> {
                    HUNK.find(line)?.let { m -> old = m.groupValues[1].toInt(); new = m.groupValues[2].toInt() }
                    DiffLine(DiffLineKind.Hunk, line)
                }
                line.startsWith("+") -> DiffLine(DiffLineKind.Add, line.substring(1), new++)
                line.startsWith("-") -> DiffLine(DiffLineKind.Del, line.substring(1), old++)
                line.startsWith("\\") -> DiffLine(DiffLineKind.Note, line.removePrefix("\\ ").trim())
                else -> DiffLine(DiffLineKind.Context, line.removePrefix(" "), new.also { old++; new++ })
            }
        }
        // A patch ends with a newline: the empty tail is not a line.
        if (out.lastOrNull()?.let { it.kind == DiffLineKind.Context && it.text.isEmpty() } == true) out.removeAt(out.lastIndex)
        return out
    }
}

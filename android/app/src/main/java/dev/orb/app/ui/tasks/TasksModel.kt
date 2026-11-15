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

/** Why a queued task waits: `paused`, `manual`, `deps` or `notice` (the PC's own words in [text]). */
@Immutable
data class TaskWait(val kind: String, val text: String?, val on: List<WaitDep>)

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
) {
    val id get() = row.id
}

@Immutable
data class DiffFile(val status: String, val path: String, val added: Int, val removed: Int, val binary: Boolean, val patch: String, val cut: Boolean)

@Immutable
data class TaskDiff(val available: Boolean, val files: List<DiffFile>, val more: Int) {
    val added get() = files.sumOf { it.added }
    val removed get() = files.sumOf { it.removed }
}

@Immutable
data class AgentChoice(val id: String, val label: String)

object TasksParser {
    private fun int(o: JsonObject, k: String): Int? = (o[k] as? JsonPrimitive)?.intOrNull

    private fun wait(el: JsonElement?): TaskWait? {
        val o = el as? JsonObject ?: return null
        val kind = o.str("kind") ?: return null
        val on = (o["on"] as? JsonArray).orEmpty().mapNotNull { d ->
            val dep = d as? JsonObject ?: return@mapNotNull null
            WaitDep(dep.long("id") ?: return@mapNotNull null, dep.str("status"), dep.bool("held"))
        }
        return TaskWait(kind, o.str("text"), on)
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
            result = o.str("result"),
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
            branch = o.str("branch"), folder = o.str("project_path"), createdBy = o.str("created_by"),
            modelLabel = o.str("modelLabel"), accountLabel = o.str("accountLabel"), accepted = o.bool("accepted"),
            hasCheckpoint = o.bool("hasCheckpoint"), previewHash = o.str("previewHash"),
            dependencies = links(o["dependencies"]), children = links(o["children"]),
            events = (o["events"] as? JsonArray).orEmpty().mapNotNull { x ->
                val e = x as? JsonObject ?: return@mapNotNull null
                TaskEvent(e.str("actor"), e.str("kind"), e.str("detail").orEmpty(), e.str("at"))
            },
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
        return TaskDiff(o.bool("available"), files, int(o, "more") ?: 0)
    }

    fun agents(catalog: JsonElement?): List<AgentChoice> = (catalog as? JsonArray).orEmpty().mapNotNull { x ->
        val o = x as? JsonObject ?: return@mapNotNull null
        val id = o.str("id") ?: return@mapNotNull null
        AgentChoice(id, o.str("label") ?: agentName(id) ?: id)
    }
}

enum class DiffLineKind { Add, Del, Hunk, Context, Note }

@Immutable
data class DiffLine(val kind: DiffLineKind, val text: String)

object DiffParser {
    /** The body of one file's patch: its header lines (`diff --git`, `index`, `---`, `+++`) are dropped. */
    fun lines(patch: String): List<DiffLine> {
        if (patch.isEmpty()) return emptyList()
        val out = ArrayList<DiffLine>()
        var body = false
        for (line in patch.split('\n')) {
            if (!body) {
                if (line.startsWith("@@")) body = true else continue
            }
            out += when {
                line.startsWith("@@") -> DiffLine(DiffLineKind.Hunk, line)
                line.startsWith("+") -> DiffLine(DiffLineKind.Add, line.substring(1))
                line.startsWith("-") -> DiffLine(DiffLineKind.Del, line.substring(1))
                line.startsWith("\\") -> DiffLine(DiffLineKind.Note, line.removePrefix("\\ ").trim())
                else -> DiffLine(DiffLineKind.Context, line.removePrefix(" "))
            }
        }
        // A patch ends with a newline: the empty tail is not a line.
        if (out.lastOrNull()?.let { it.kind == DiffLineKind.Context && it.text.isEmpty() } == true) out.removeAt(out.lastIndex)
        return out
    }
}

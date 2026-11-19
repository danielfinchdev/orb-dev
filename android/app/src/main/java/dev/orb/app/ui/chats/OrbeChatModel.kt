package dev.orb.app.ui.chats

import androidx.compose.runtime.Immutable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull

enum class MsgRole { User, Orbe, System }

@Immutable
data class QuestionOption(val label: String, val description: String?)

/** What a message of the PC carries besides its text (`meta.kind`). Unknown kinds stay plain lines so nothing is lost. */
@Immutable
sealed interface MsgCard {
    data object None : MsgCard
    data class Question(
        val header: String?, val question: String, val options: List<QuestionOption>, val multi: Boolean,
        val status: String, val answer: String?,
    ) : MsgCard {
        val pending get() = status == "pending"
    }

    data class Report(val tasks: List<Long>, val accepted: Boolean) : MsgCard

    /** An agent asks to run something (`task-approval`/`approval`): answered with sessions.approve. */
    data class Permission(val session: String?, val request: String?, val task: Long?, val detail: String?, val status: String) : MsgCard

    /** A task that waits for the person's OK (`attention`): its current state is read from the PC. */
    data class TaskAttention(val task: Long) : MsgCard

    /** A finished task, with the agent's technical report folded away. */
    data class TaskEnd(val result: String) : MsgCard
}

@Immutable
data class ChatMessage(
    val id: Long,
    val role: MsgRole,
    val body: String,
    val at: String?,
    val card: MsgCard,
    val clientId: String?,
    /** The task the PC says this line is about (`meta.task`), whatever kind of line it is. */
    val task: Long? = null,
)

/** A message written on the phone that the PC has not confirmed yet. */
@Immutable
data class PendingMessage(val clientId: String, val text: String, val state: PendingState, val error: String?, val at: Long)

/** [Arrived]: the PC took the message (`chat.send` answered) but its own line has not come back yet. */
enum class PendingState { Waiting, Sending, Arrived, Failed }

/** What the assistant is doing now (`chat:state`), without the streamed text, which lives apart so it can change fast. */
@Immutable
data class LiveInfo(val busy: Boolean, val waiting: Boolean, val queued: Int, val since: Long?, val activity: String?, val hasText: Boolean)

/** The brain a conversation thinks with, as the PC names it (`chat.settings`). Nothing here is guessed. */
@Immutable
data class BrainInfo(val agentLabel: String?, val modelLabel: String?, val reasoning: String?) {
    /** «Opus · alto»: the model (or the agent when the PC names no model) and the reasoning level. */
    val label: String?
        get() = listOfNotNull((modelLabel ?: agentLabel)?.takeIf { it.isNotBlank() }, reasoning?.let(::reasoningWord)).joinToString(" · ").ifEmpty { null }

    companion object {
        fun reasoningWord(level: String): String = when (level) {
            "low" -> "bajo"
            "medium" -> "medio"
            "high" -> "alto"
            "xhigh" -> "extra"
            else -> level
        }
    }
}

/** A message that waits in the PC's queue behind the running turn (`chat.queue`); [id] is the PC's own. */
@Immutable
data class OrbeQueued(val id: String, val text: String, val at: Long)

/**
 * What a finished task changed, counts only (`tasks.diff {stat:true}`). The line counts are null when the PC cut the list.
 * [checkpointId] is the run those counts belong to ([runKnown]: the PC said so at all) and [notReady] that the PC has no diff
 * of the last run yet. [reason] is why the PC has no diff to count (carries no counts: it only says which decision may be offered
 * on the card) and [unreadable] that the answer cannot be trusted at all, so the card decides nothing.
 */
@Immutable
data class TaskStat(
    val files: Int, val added: Int?, val removed: Int?,
    val checkpointId: String? = null, val runKnown: Boolean = false, val notReady: Boolean = false,
    val reason: String? = null, val unreadable: Boolean = false,
) {
    /** Whether this is a count of changed files and may be shown as one. */
    val hasCounts get() = !notReady && reason == null && !unreadable

    /** The PC's no-diff answer as the changes screen reads it, so a card and that screen decide the same way. */
    private val asDiff get() = dev.orb.app.ui.tasks.TaskDiff(false, emptyList(), 0, reason = reason)

    /** Whether «Aceptar» may be on the card: with counts it is; without a diff only where the changes screen offers it too. */
    fun allowsAccept(undone: Boolean): Boolean = !unreadable && !notReady && (reason == null || asDiff.allowsAccept(undone))

    /** Whether «Deshacer» may be on the card: with counts, or on a folder without git (restored from the PC's copy). */
    val allowsUndo: Boolean get() = !unreadable && !notReady && (reason == null || asDiff.allowsUndo)

    /** Whether the counts are of the run [taskRun] the task is at now; a PC that does not name the run cannot disagree. */
    fun isOfRun(taskRun: String?): Boolean = !notReady && (!runKnown || (checkpointId != null && taskRun != null && checkpointId == taskRun))
}

/** A task that is running now (`tasks.live`): what it is doing, said by the PC. */
@Immutable
data class LiveTask(val id: Long, val title: String, val agent: String?, val doing: String?, val percent: Int?, val waiting: Boolean)

object OrbeParser {
    private val json = Json { ignoreUnknownKeys = true }

    fun parse(raw: String): ChatMessage? = (runCatching { json.parseToJsonElement(raw) }.getOrNull() as? JsonObject)?.let(::message)

    fun message(o: JsonObject): ChatMessage? {
        val id = o.long("id") ?: return null
        val role = when (o.str("role")) {
            "usuario" -> MsgRole.User
            "orb" -> MsgRole.Orbe
            else -> MsgRole.System
        }
        val meta = o["meta"] as? JsonObject
        return ChatMessage(
            id = id, role = role, body = o.str("body").orEmpty(), at = o.str("at"), card = card(role, meta),
            clientId = o.str("clientId") ?: meta?.str("clientId"), task = meta?.long("task"),
        )
    }

    private fun card(role: MsgRole, meta: JsonObject?): MsgCard {
        meta ?: return MsgCard.None
        return when (meta.str("kind")) {
            "question" -> MsgCard.Question(
                header = meta.str("header"), question = meta.str("question").orEmpty(),
                options = (meta["options"] as? JsonArray).orEmpty().mapNotNull { el ->
                    val o = el as? JsonObject
                    val label = o?.str("label") ?: (el as? JsonPrimitive)?.contentOrNull
                    label?.let { QuestionOption(it, o?.str("description")) }
                },
                multi = meta.bool("multi"), status = meta.str("status") ?: "pending", answer = answerText(meta["answer"]),
            )
            "report" -> {
                val tasks = (meta["tasks"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.longOrNull }
                if (tasks.isEmpty()) MsgCard.None else MsgCard.Report(tasks, meta.bool("accepted"))
            }
            "task-approval", "approval" -> MsgCard.Permission(
                session = meta.str("session"), request = meta.str("request"), task = meta.long("task"), detail = meta.str("detail"),
                // The assistant's own old requests are over once it is not waiting any more; only a task's can still be open.
                status = meta.str("status") ?: if (meta.str("kind") == "task-approval") "pending" else "expired",
            )
            "attention" -> meta.long("task")?.let { MsgCard.TaskAttention(it) } ?: MsgCard.None
            // A task that ended without a written result still ends: its card is drawn from the task itself.
            "task-end" -> if (meta.long("task") != null || meta.str("result") != null) MsgCard.TaskEnd(meta.str("result").orEmpty()) else MsgCard.None
            else -> MsgCard.None
        }
    }

    /** The answer of an answered question: a label, a list of them or the person's own words. */
    private fun answerText(el: kotlinx.serialization.json.JsonElement?): String? = when (el) {
        null, is JsonNull -> null
        is JsonPrimitive -> el.contentOrNull
        is JsonArray -> el.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.joinToString(", ").ifBlank { null }
        is JsonObject -> listOfNotNull(
            (el["choices"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }?.joinToString(", "),
            el.str("other"),
        ).filter { it.isNotBlank() }.joinToString(" · ").ifBlank { null }
    }

    /** `chat:state` → what is shown about the turn; the streamed text itself is [partial]. */
    fun live(state: JsonObject): LiveInfo {
        val steps = (state["tools"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
        val last = steps.lastOrNull()
        val partial = partial(state)
        return LiveInfo(
            busy = state.bool("busy"), waiting = state.bool("waiting"), queued = (state.long("queued") ?: 0L).toInt(),
            since = state.long("since"), activity = last?.let { ToolText.step(it.str("name"), it.str("target")) },
            hasText = partial.isNotEmpty(),
        )
    }

    fun partial(state: JsonObject): String = (state["partial"] as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty()

    /** The final line a finished turn carries, if the PC sent it along. */
    fun answer(state: JsonObject): ChatMessage? = (state["answer"] as? JsonObject)?.let(::message)

    /** `chat.settings` → the brain; null when the PC says nothing usable. */
    fun brain(el: kotlinx.serialization.json.JsonElement?): BrainInfo? {
        val o = el as? JsonObject ?: return null
        val info = BrainInfo(o.str("agentLabel"), o.str("modelLabel"), o.str("reasoning"))
        return info.takeIf { it.label != null }
    }

    /** `tasks.live` → the running tasks. */
    fun liveTasks(el: kotlinx.serialization.json.JsonElement?): List<LiveTask> = (el as? JsonArray).orEmpty().mapNotNull { x ->
        val o = x as? JsonObject ?: return@mapNotNull null
        val id = o.long("id") ?: return@mapNotNull null
        val waiting = (o["waiting"] as? JsonPrimitive)?.let { it.longOrNull?.let { n -> n > 0 } ?: (it.contentOrNull == "true") } ?: false
        LiveTask(
            id, o.str("title").orEmpty(), o.str("agent"), (o.str("last") ?: o.str("note"))?.lineSequence()?.firstOrNull()?.take(160)?.ifBlank { null },
            o.long("percent")?.toInt(), waiting,
        )
    }

    fun conversationOf(payload: JsonObject): Long? = payload.long("conversation")

    private val DECISIONS = setOf("task.approved", "task.rejected", "approval.required")

    /**
     * `tasks.get` → what a card shows and the fingerprint of it. Everything comes from this one answer, so the [TaskDetail.hash]
     * always belongs to the text beside it. [can] says which methods the PC has, as the task's own screen asks it.
     */
    fun taskDetail(el: kotlinx.serialization.json.JsonElement?, id: Long, can: (dev.orb.app.link.api.ApiMethod) -> Boolean): TaskDetail? {
        val o = el as? JsonObject ?: return null
        val parsed = dev.orb.app.ui.tasks.TasksParser.detail(o)
        val review = o["review"] as? JsonObject
        val held = parsed?.row?.held
        return approvalFacts(o, id).copy(
            held = held != null, heldReasons = held?.reasons.orEmpty(), heldFolder = held?.folder,
            accepted = parsed?.accepted == true, undone = parsed?.row?.undone == true,
            actions = parsed?.let { cardActions(it, can) }.orEmpty(),
            reviewAgent = review?.str("agent"),
            decision = parsed?.events?.lastOrNull { it.kind in DECISIONS }?.kind?.let { if (it == "task.approved") "approved" else if (it == "task.rejected") "rejected" else null },
        )
    }

    /**
     * The fields of `tasks.get` that the approval fingerprint covers, as one value: the chat's card and dialog and the task's own
     * screen all draw an OK from this, so none of them can show less than another.
     */
    fun approvalFacts(o: JsonObject, id: Long): TaskDetail = TaskDetail(
        id = o.long("id") ?: id, title = o.str("title").orEmpty(), status = o.str("status"),
        // `agent` is what the fingerprint covers; `assigned_to` is who runs it now.
        agent = o.str("agent"), runner = o.str("assigned_to"),
        project = o.str("project_path"), folderNow = o.str("folderNow"),
        reasons = (o["sensitivity"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.content },
        hash = o.str("previewHash"), model = o.str("model"),
        autonomy = o.str("autonomy"),
        approvalRequired = (o["approval"] as? JsonObject)?.takeIf { it["required"] != null }?.bool("required"),
        description = o.str("description"), readonly = o.bool("readonly"), mode = o.str("mode"), reasoning = o.str("reasoning"),
        fast = o.bool("fast"), userAsked = stringList(o["user_asked"]),
        folderMoved = o["folderMoved"]?.takeIf { it is JsonPrimitive && it !is kotlinx.serialization.json.JsonNull }?.let { o.bool("folderMoved") },
        folderOutside = o.bool("folderOutside"), descriptionCut = o.bool("descriptionCut"), checkpointId = o.str("checkpointId")?.takeIf { it.isNotBlank() },
    )

    // `user_asked` arrives as a list (the PC parses it) but an old row may still hold the JSON text of one.
    private fun stringList(el: kotlinx.serialization.json.JsonElement?): List<String> = when (el) {
        is JsonArray -> el.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
        is JsonPrimitive -> runCatching { (Json.parseToJsonElement(el.content) as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull } }.getOrDefault(emptyList())
        else -> emptyList()
    }

    /**
     * What a card may offer: the task screen's own rule ([dev.orb.app.ui.tasks.TaskActions]) plus «Aceptar» and «Deshacer» for
     * finished work, with the conditions of the changes screen (done or held, a checkpoint, not undone, not accepted) and
     * only where the PC has the method. Nothing else is offered from a card.
     */
    internal fun cardActions(d: dev.orb.app.ui.tasks.TaskDetail, can: (dev.orb.app.link.api.ApiMethod) -> Boolean): Set<dev.orb.app.ui.tasks.TaskAction> {
        val held = d.row.held != null
        val finished = held || d.row.status == "done"
        val out = LinkedHashSet(dev.orb.app.ui.tasks.TaskActions.of(d, can))
        // A task Orb stopped is reviewed on the task's changes screen, which shows what the PC rechecks before «Aceptar» and
        // asks before «Deshacer»; a card never offers either one, so accepting never skips why it was held.
        if (held) { out -= dev.orb.app.ui.tasks.TaskAction.AcceptHeld; out -= dev.orb.app.ui.tasks.TaskAction.UndoHeld; return out }
        if (!d.accepted && !d.row.undone && finished && can(dev.orb.app.link.api.ApiMethods.TASKS_ACCEPT)) out += dev.orb.app.ui.tasks.TaskAction.AcceptHeld
        if (d.hasCheckpoint && !d.row.undone && finished && can(dev.orb.app.link.api.ApiMethods.TASKS_UNDO)) out += dev.orb.app.ui.tasks.TaskAction.UndoHeld
        return out
    }

    /**
     * `tasks.diff {stat:true}` → file and line counts, or null when there is nothing to count. A PC that does not know `stat`
     * answers with whole patches (and may have cut them): its numbers are not trusted, so the card shows none.
     */
    fun taskStat(el: kotlinx.serialization.json.JsonElement?): TaskStat? {
        val d = dev.orb.app.ui.tasks.TasksParser.diff(el ?: return null)
        // The PC has no diff of the last run yet: no counts, but the card must not offer a decision on it. A reason this app does not
        // know, or no reason at all, is an answer that cannot be trusted: the card then decides nothing.
        if (!d.available) return when {
            d.reason == "notdone" -> TaskStat(0, null, null, notReady = true)
            d.reason != null && d.reason in dev.orb.app.ui.tasks.TaskDiff.KNOWN_REASONS -> TaskStat(0, null, null, reason = d.reason)
            else -> TaskStat(0, null, null, unreadable = true)
        }
        if (d.files.any { it.patch.isNotEmpty() }) return TaskStat(0, null, null, unreadable = true)
        val n = d.files.size + d.more
        if (n == 0) return null
        return TaskStat(n, d.added.takeIf { d.more == 0 }, d.removed.takeIf { d.more == 0 }, checkpointId = d.checkpointId, runKnown = d.runKnown)
    }

    /** `chat.queue` / `chat.editQueued` → the queue in the PC's order; an entry without an id is dropped. */
    fun queue(el: kotlinx.serialization.json.JsonElement?): List<OrbeQueued> = (el as? JsonArray).orEmpty().mapNotNull { x ->
        val o = x as? JsonObject ?: return@mapNotNull null
        OrbeQueued(o.str("id") ?: return@mapNotNull null, o.str("text").orEmpty(), o.long("at") ?: 0L)
    }
}

/** What a tool does, in words: the same table as the PC's own chat, so the phone says the same thing. */
object ToolText {
    private val kinds = listOf(
        Regex("^(read|read_file|view|cat|open_file)$", RegexOption.IGNORE_CASE) to "read",
        Regex("^(grep|glob|search|find|ls|list_dir|codebase_search|file_search)", RegexOption.IGNORE_CASE) to "search",
        Regex("^(bash|shell|exec|command|run|terminal|powershell)", RegexOption.IGNORE_CASE) to "run",
        Regex("^(edit|write|multiedit|notebookedit|apply_patch|create_file|str_replace)", RegexOption.IGNORE_CASE) to "edit",
        Regex("^(webfetch|websearch|fetch|web_search|browse)", RegexOption.IGNORE_CASE) to "web",
        Regex("^orb_create_task$") to "task", Regex("^orb_(board|list_tasks|get_task|wait_tasks)$") to "board",
        Regex("^orb_read_log$") to "readLog", Regex("^orb_write_log$") to "writeLog", Regex("^orb_ask$") to "ask",
        Regex("^orb_(set_project|create_project|add_project)$") to "project", Regex("^orb_schedule$") to "schedule",
        Regex("^orb_browser_") to "browser", Regex("^orb_(send_message|read_messages)$") to "messages",
        Regex("^(todowrite|todo)", RegexOption.IGNORE_CASE) to "plan", Regex("^(task|agent|delegate)", RegexOption.IGNORE_CASE) to "delegate",
        Regex("^tool_?search$", RegexOption.IGNORE_CASE) to "tools", Regex("^opti_propose$") to "propose", Regex("^opti_") to "pc",
    )
    private val withTarget = mapOf(
        "read" to ("Leyendo" to "Leyendo archivos"), "search" to ("Buscando" to "Buscando en el proyecto"),
        "run" to ("Ejecutando" to "Ejecutando un comando"), "edit" to ("Editando" to "Editando archivos"),
        "web" to ("Consultando" to "Consultando la web"),
    )
    private val fixed = mapOf(
        "task" to "Creando una tarea", "board" to "Mirando el tablero", "readLog" to "Leyendo la bitácora",
        "writeLog" to "Escribiendo en la bitácora", "ask" to "Preparando una pregunta", "project" to "Preparando el proyecto",
        "schedule" to "Programando una tarea", "browser" to "Usando el navegador", "messages" to "Revisando los mensajes",
        "plan" to "Organizando los pasos", "delegate" to "Repartiendo el trabajo", "tools" to "Preparando sus herramientas",
        "pc" to "Revisando el PC", "propose" to "Preparando una propuesta",
    )

    // «mcp__orb__orb_ask», «orb:orb_ask», «orb-orb_ask» → «orb_ask»: each agent names a server's tools its own way.
    fun bare(name: String?): String = (name ?: "").replace(Regex("^mcp__[^_]+(?:_[^_]+)*?__"), "").replace(Regex("^(orb|opti)[:-](?=(orb|opti)_)"), "")

    private val past = mapOf(
        "read" to "Leyó", "search" to "Buscó", "run" to "Ejecutó en el PC", "edit" to "Editó", "web" to "Consultó",
    )

    /** The class of a tool (`run`, `edit`, `read`…), or null when it is not one of the known ones. */
    fun kindOf(rawName: String?): String? = kinds.firstOrNull { it.first.containsMatchIn(bare(rawName)) }?.second

    /** The finished form of a step, split into the verb and what it acted on («Ejecutó en el PC» + «npm test»). */
    fun did(rawName: String?, target: String?): Pair<String, String> {
        val kind = kindOf(rawName)
        val verb = past[kind]
        if (verb != null) return verb to target.orEmpty()
        val said = step(rawName, target).let { if (it.startsWith("Usando ")) "Usó ${it.removePrefix("Usando ")}" else it }
        return said to ""
    }

    /** What a call acted on: a command, a path, a pattern or an address, whichever the input carries first. */
    fun targetOf(input: kotlinx.serialization.json.JsonElement?): String? {
        val o = input as? JsonObject ?: return (input as? JsonPrimitive)?.takeIf { it.isString }?.content?.lineSequence()?.firstOrNull()?.take(200)
        val key = listOf("command", "cmd", "file_path", "filePath", "path", "pattern", "query", "url", "description").firstOrNull { o.str(it) != null }
        return key?.let { o.str(it) }?.lineSequence()?.firstOrNull()?.take(200)
    }

    fun step(rawName: String?, target: String?): String {
        val name = bare(rawName)
        val kind = kinds.firstOrNull { it.first.containsMatchIn(name) }?.second
        withTarget[kind]?.let { (with, without) -> return if (target.isNullOrBlank()) without else "$with $target" }
        fixed[kind]?.let { return it }
        // An unknown tool is named only when it reads as a word, never «mcp__…» or «server_tool_name».
        return if (Regex("^[A-Za-z][A-Za-z ]{1,30}$").matches(name)) "Usando $name" else "Usando una herramienta"
    }
}

/** «1 min 3 s» like the PC's own chat. */
fun elapsedText(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return when {
        s < 60 -> "$s s"
        s < 3600 -> "${s / 60} min ${s % 60} s"
        else -> "${s / 3600} h ${(s % 3600) / 60} min"
    }
}


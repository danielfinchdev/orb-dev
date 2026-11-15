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
)

/** A message written on the phone that the PC has not confirmed yet. */
@Immutable
data class PendingMessage(val clientId: String, val text: String, val state: PendingState, val error: String?, val at: Long)

enum class PendingState { Waiting, Sending, Failed }

/** What the assistant is doing now (`chat:state`), without the streamed text, which lives apart so it can change fast. */
@Immutable
data class LiveInfo(val busy: Boolean, val waiting: Boolean, val queued: Int, val since: Long?, val activity: String?, val hasText: Boolean)

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
            clientId = o.str("clientId") ?: meta?.str("clientId"),
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
            "task-end" -> meta.str("result")?.let { MsgCard.TaskEnd(it) } ?: MsgCard.None
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

    fun conversationOf(payload: JsonObject): Long? = payload.long("conversation")
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


package dev.orb.app.ui.chats

import androidx.compose.runtime.Immutable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** What the PC says about one direct conversation (a row of `sessions.list`, or a `session:update`). */
@Immutable
data class SessionInfo(
    val id: String,
    val title: String?,
    val project: String?,
    val agent: String?,
    val model: String?,
    val status: String?,
    val permission: String?,
    val settled: Boolean,
    val archived: Boolean,
    val contextUsed: Long?,
    val contextSize: Long?,
) {
    val busy get() = status == "running"

    /** Stopped by the account's limit or by Orb closing: the PC offers «Continuar». */
    val stalled get() = status == "interrupted" || status == "limited"
    val limited get() = status == "limited"
    val contextPercent: Int? get() = if (contextUsed != null && contextSize != null && contextSize > 0) ((contextUsed * 100) / contextSize).toInt() else null

    /** Claude and Codex read a correction at their next step; the others only queue it. */
    val canSteer get() = agent == "claude" || agent == "codex"
    val canCompact get() = agent == "claude" || agent == "codex"
}

/** A message written while the agent works, waiting in the PC's queue. */
@Immutable
data class QueuedMsg(val id: Long, val text: String, val images: Int)

/** One saved line of the conversation as the PC sends it. */
@Immutable
data class RawItem(val id: Long, val role: String, val kind: String, val body: JsonElement, val at: String?)

/** One tool call (or changed file) with its result, once it arrives. */
@Immutable
data class ToolStep(
    val id: Long,
    val callId: String?,
    val verb: String,
    val target: String,
    val input: String,
    val output: String?,
    val failed: Boolean,
    /** The same step said while it runs («Ejecutando npm test»), for the line under the working agent. */
    val now: String = verb,
) {
    val running get() = output == null && !failed
}

@Immutable
data class PlanStep(val text: String, val done: Boolean)

/** A display row. Keys are stable (`i:<id>`) so the list moves instead of redrawing. */
@Immutable
sealed interface DItem {
    val key: String
    val contentType: String

    data class User(val id: Long, val text: String, val images: Int, val steer: Boolean, val at: String?) : DItem {
        override val key get() = "i:$id"
        override val contentType get() = "user"
    }

    data class Assistant(val id: Long, val text: String, val at: String?) : DItem {
        override val key get() = "i:$id"
        override val contentType get() = "assistant"
    }

    data class Reasoning(val id: Long, val text: String) : DItem {
        override val key get() = "i:$id"
        override val contentType get() = "reasoning"
    }

    /** Consecutive tool calls and changed files; its key is its first item so it keeps its place as steps are added. */
    data class Activity(val firstId: Long, val steps: List<ToolStep>) : DItem {
        override val key get() = "i:$firstId"
        override val contentType get() = "activity"
    }

    data class Plan(val id: Long, val steps: List<PlanStep>, val text: String?) : DItem {
        override val key get() = "i:$id"
        override val contentType get() = "plan"
    }

    data class Note(val id: Long, val text: String) : DItem {
        override val key get() = "i:$id"
        override val contentType get() = "note"
    }

    data class Failure(val id: Long, val text: String) : DItem {
        override val key get() = "i:$id"
        override val contentType get() = "failure"
    }

    /** An agent's request to do something; [status] is `pending` until the person (or the PC) decides. */
    data class Approval(
        val id: Long, val request: String, val tool: String?, val title: String, val reason: String?, val summary: String?,
        val input: String?, val status: String, val at: String?,
    ) : DItem {
        override val key get() = "i:$id"
        override val contentType get() = "approval"
        val pending get() = status == "pending"
    }

    /** Written on the phone, not confirmed by the PC yet. */
    data class Waiting(val pending: PendingMessage) : DItem {
        override val key get() = "q:${pending.clientId}"
        override val contentType get() = "pending"
    }
}

object DirectParser {
    private val json = Json { ignoreUnknownKeys = true }
    private const val CLIP = 1500

    fun parseRaw(raw: String): RawItem? = (runCatching { json.parseToJsonElement(raw) }.getOrNull() as? JsonObject)?.let(::item)

    fun item(o: JsonObject): RawItem? {
        val id = o.long("id") ?: return null
        return RawItem(id, o.str("role").orEmpty(), o.str("kind").orEmpty(), o["body"] ?: JsonNull, o.str("at"))
    }

    fun info(o: JsonObject): SessionInfo? {
        val id = o.str("id") ?: return null
        val ctx = o["context"] as? JsonObject
        return SessionInfo(
            id = id, title = o.str("title"), project = o.str("project"), agent = o.str("agent"), model = o.str("model"),
            status = o.str("status"), permission = o.str("permission"), settled = o.bool("settled"), archived = o.bool("archived"),
            contextUsed = ctx?.long("used"), contextSize = ctx?.long("size"),
        )
    }

    fun queue(el: JsonElement?): List<QueuedMsg> = (el as? JsonArray).orEmpty().mapNotNull { e ->
        val o = e as? JsonObject ?: return@mapNotNull null
        QueuedMsg(o.long("id") ?: return@mapNotNull null, o.str("text").orEmpty(), (o["images"] as? JsonArray)?.size ?: 0)
    }

    /** Turns the ordered lines into display rows: a call and its result become one step, a run of steps one card. */
    fun display(items: List<RawItem>, decided: Map<Long, String> = emptyMap()): List<DItem> {
        val out = ArrayList<DItem>(items.size)
        val calls = HashMap<String, Int>()
        var activity: MutableList<ToolStep>? = null
        var activityFirst = 0L

        fun closeActivity() {
            val steps = activity ?: return
            out += DItem.Activity(activityFirst, steps.toList())
            activity = null
        }

        fun add(step: ToolStep) {
            if (activity == null) { activity = ArrayList(); activityFirst = step.id }
            activity!!.add(step)
        }

        fun attach(result: RawItem): Boolean {
            val body = result.body as? JsonObject ?: return false
            val call = body.str("id") ?: return false
            val steps = activity ?: return false
            val at = steps.indexOfFirst { it.callId == call }
            if (at < 0) return false
            val failed = body["error"]?.let { it !is JsonNull && (it as? JsonPrimitive)?.contentOrNull != "false" } == true
            val text = text(body["output"]).ifBlank { text(body["error"]) }
            steps[at] = steps[at].copy(output = clip(text), failed = failed)
            return true
        }

        for (it in items) {
            when {
                it.kind == "tool" -> {
                    val b = it.body as? JsonObject
                    val name = b?.str("name")
                    val input = b?.get("input")
                    val (verb, target) = ToolText.did(name, ToolText.targetOf(input))
                    add(ToolStep(it.id, b?.str("id"), verb, target, inputText(input), null, false, ToolText.step(name, ToolText.targetOf(input))))
                }
                it.kind == "tool_result" -> {
                    if (!attach(it)) {
                        // A result whose call is not here (older page): shown as its own step so nothing is lost.
                        add(ToolStep(it.id, null, ChatTexts.TOOL_RESULT, "", "", clip(text((it.body as? JsonObject)?.get("output") ?: it.body)), false))
                    }
                }
                it.kind == "file" -> {
                    val b = it.body as? JsonObject
                    add(ToolStep(it.id, null, fileVerb(b?.str("change")), b?.str("path").orEmpty(), "", "", false))
                }
                else -> {
                    closeActivity()
                    display(it, decided)?.let(out::add)
                }
            }
        }
        closeActivity()
        return out
    }

    private fun display(it: RawItem, decided: Map<Long, String>): DItem? {
        val body = it.body
        return when {
            it.role == "user" -> {
                val o = body as? JsonObject
                val text = o?.str("text") ?: (body as? JsonPrimitive)?.contentOrNull.orEmpty()
                DItem.User(it.id, text, (o?.get("images") as? JsonArray)?.size ?: 0, o?.bool("steer") == true, it.at)
            }
            it.role == "error" -> DItem.Failure(it.id, text(body))
            it.kind == "approval" -> approval(it, decided[it.id])
            it.kind == "reasoning" -> text(body).takeIf { t -> t.isNotBlank() }?.let { t -> DItem.Reasoning(it.id, t) }
            it.kind == "text" && it.role == "assistant" -> DItem.Assistant(it.id, text(body), it.at)
            it.kind == "plan" -> plan(it)
            it.kind == "usage" -> usage(it)
            it.kind == "image" -> DItem.Note(it.id, ChatTexts.IMAGE_ATTACHED)
            else -> text(body).takeIf { t -> t.isNotBlank() }?.let { t -> DItem.Note(it.id, t) }
        }
    }

    private fun approval(it: RawItem, local: String?): DItem.Approval? {
        val o = it.body as? JsonObject ?: return null
        val request = o.str("id") ?: return null
        val status = local ?: o.str("status") ?: "pending"
        return DItem.Approval(
            it.id, request, o.str("tool"), o.str("title").orEmpty(), o.str("reason")?.takeIf { r -> r.isNotBlank() },
            o.str("summary")?.takeIf { s -> s.isNotBlank() }, o["input"]?.let { i -> inputText(i) }?.takeIf { s -> s.isNotBlank() }, status, it.at,
        )
    }

    private fun plan(it: RawItem): DItem {
        val steps = (it.body as? JsonArray ?: (it.body as? JsonObject)?.get("steps") as? JsonArray ?: (it.body as? JsonObject)?.get("entries") as? JsonArray)
            ?.mapNotNull { e ->
                val o = e as? JsonObject
                val t = o?.str("content") ?: o?.str("text") ?: o?.str("step") ?: (e as? JsonPrimitive)?.contentOrNull
                t?.let { s -> PlanStep(s, o?.str("status") == "completed" || o?.bool("done") == true) }
            }.orEmpty()
        return DItem.Plan(it.id, steps, if (steps.isEmpty()) text(it.body).ifBlank { null } else null)
    }

    private fun usage(it: RawItem): DItem.Note? {
        val o = it.body as? JsonObject ?: return null
        val inT = o.long("inputTokens")
        val outT = o.long("outputTokens")
        if (inT == null && outT == null) return null
        return DItem.Note(it.id, ChatTexts.usage(inT, outT))
    }

    private fun fileVerb(change: String?) = when (change) { "add", "create", "added" -> "Creó"; "delete", "deleted" -> "Borró"; else -> "Editó" }

    private fun inputText(input: JsonElement?): String = when (input) {
        null, is JsonNull -> ""
        is JsonPrimitive -> clip(input.contentOrNull.orEmpty())
        is JsonObject -> clip(input.str("command") ?: input.str("cmd") ?: input.toString())
        else -> clip(input.toString())
    }

    internal fun text(el: JsonElement?): String = when (el) {
        null, is JsonNull -> ""
        is JsonPrimitive -> el.contentOrNull.orEmpty()
        else -> el.toString()
    }

    private fun clip(s: String): String = if (s.length <= CLIP) s else s.take(CLIP) + "…"
}

package dev.orb.app.notify

import dev.orb.app.ui.chats.str
import dev.orb.app.ui.notes.NoticeTarget
import dev.orb.app.ui.notes.NotesParser
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** One button of a PC notice (`src/shared/notes.mjs`): [open] means it must open the app instead of acting. */
data class NoteAction(val id: String, val title: String, val input: Boolean, val open: Boolean)

/** A `note` event of the PC, as it describes the notification to show. */
data class PcNote(
    val key: String,
    val id: Int,
    val kind: String,
    val title: String,
    val body: String,
    val silent: Boolean,
    val actions: List<NoteAction>,
    val card: JsonObject?,
    val route: JsonObject?,
    /** One-use tokens for `/api/note-action`, by action id, when the PC minted them for this phone. */
    val acts: Map<String, String>,
    val target: NoticeTarget?,
)

object PcNotes {
    const val FIRST_ID = 20_000
    const val ID_COUNT = 10_000

    /** The id of a chat's notification, so new lines replace it (`noteId` of `src/shared/notes.mjs`). */
    fun idOf(key: String): Int {
        var h = 2166136261u
        var i = 0
        while (i < key.length) {
            val cp = key.codePointAt(i)
            h = (h xor cp.toUInt()) * 16777619u
            i += Character.charCount(cp)
        }
        return FIRST_ID + (h % ID_COUNT.toUInt()).toInt()
    }

    fun parse(payload: JsonElement): PcNote? {
        val o = payload as? JsonObject ?: return null
        val key = o.str("key") ?: return null
        val actions = (o["actions"] as? JsonArray).orEmpty().mapNotNull { x ->
            val a = x as? JsonObject ?: return@mapNotNull null
            val id = a.str("id") ?: return@mapNotNull null
            NoteAction(id, a.str("title") ?: id, a.flag("input"), a.flag("open"))
        }
        val acts = (o["acts"] as? JsonObject)
            ?.mapNotNull { (k, v) -> (v as? JsonPrimitive)?.takeIf { it.isString }?.content?.let { k to it } }
            .orEmpty().toMap()
        return PcNote(
            key = key,
            id = o.str("id")?.toIntOrNull()?.takeIf { it in FIRST_ID until FIRST_ID + ID_COUNT } ?: idOf(key),
            kind = o.str("kind") ?: "message",
            title = o.str("title").orEmpty().ifBlank { "Orb" },
            body = o.str("body").orEmpty(),
            silent = o.flag("silent"),
            actions = actions,
            card = o["card"] as? JsonObject,
            route = o["route"] as? JsonObject,
            acts = acts,
            target = NotesParser.fromEvent(payload, 0)?.target,
        )
    }

    private fun JsonObject.flag(k: String) = (this[k] as? JsonPrimitive)?.content == "true"
}

/** What tapping a notification (or a button that cannot act by itself) opens. */
@Serializable
data class JobTarget(val type: String, val kind: String = "", val id: String = "") {
    fun toNotice(): NoticeTarget? = when (type) {
        "chat" -> NoticeTarget.Chat(kind, id)
        "task" -> id.toLongOrNull()?.let { NoticeTarget.Task(it) }
        "chats" -> NoticeTarget.ChatsTab
        else -> null
    }

    companion object {
        fun of(t: NoticeTarget?): JobTarget? = when (t) {
            is NoticeTarget.Chat -> JobTarget("chat", t.kind, t.id)
            is NoticeTarget.Task -> JobTarget("task", id = t.id.toString())
            NoticeTarget.ChatsTab -> JobTarget("chats")
            null -> null
        }
    }
}

/**
 * What one notification button does. It lives in app-private storage ([NoteJobs]), never in the PendingIntent: only a
 * one-use token travels in the intent, so another app cannot make up an action for a notification.
 */
@Serializable
data class NoteJob(
    /** The notification it belongs to; the jobs of a notification go together when one is used. */
    val group: Int,
    /** `tap`, `reply`, `allow` or `deny` (or the id of a button that opens the app). */
    val action: String,
    val title: String,
    /** The PC call to make; with neither this nor [token] the job only opens the app. */
    val method: String? = null,
    val params: JsonObject? = null,
    /** The parameter the typed reply goes in. */
    val textParam: String? = null,
    /** A token minted by the PC for `/api/note-action`. */
    val token: String? = null,
    val target: JobTarget? = null,
    val at: Long = 0,
) {
    val acts: Boolean get() = method != null || token != null
}

enum class NoteChannel(val id: String) {
    Messages("orb-chats"), Approvals("orb-approvals"), Status("orb-status")
}

data class PlannedAction(val job: NoteJob, val label: String, val input: Boolean)

/** The notification to show for a note, before any Android class is involved. */
data class NotificationPlan(
    val id: Int,
    val channel: NoteChannel,
    val title: String,
    val text: String,
    /** What the lock screen shows when the content is hidden. */
    val publicTitle: String,
    val publicText: String,
    val lockScreen: LockScreenNotice,
    val silent: Boolean,
    val tap: NoteJob,
    val actions: List<PlannedAction>,
)

object NotePlanner {
    const val MAX_ACTIONS = 3

    fun plan(note: PcNote, settings: NotifySettings): NotificationPlan {
        val target = JobTarget.of(note.target)
        // With the Orb lock on, the real chat title is not kept in the jobs (they sit in plain preferences) and no
        // button can answer from the notification: approving or replying would skip the fingerprint.
        val jobTitle = if (settings.appLock) "Orb" else note.title
        val tap = NoteJob(note.id, "tap", jobTitle, target = target)
        val actions = if (settings.appLock) emptyList() else note.actions.take(MAX_ACTIONS).map { a ->
            PlannedAction(jobFor(note, a, target), a.title, input = a.input && !a.open)
        }
        val approval = note.kind != "message"
        val hidden = if (approval) NotifyTexts.HIDDEN_APPROVAL else NotifyTexts.HIDDEN_MESSAGE
        return NotificationPlan(
            id = note.id,
            channel = if (approval) NoteChannel.Approvals else NoteChannel.Messages,
            title = if (settings.appLock) "Orb" else note.title,
            text = if (settings.appLock) hidden else note.body,
            publicTitle = "Orb",
            publicText = hidden,
            // With the Orb lock on the text never leaves the app, whatever was chosen; «nothing» stays nothing.
            lockScreen = if (settings.appLock && settings.lockScreen == LockScreenNotice.Full) LockScreenNotice.Generic else settings.lockScreen,
            silent = note.silent,
            tap = tap,
            actions = actions,
        )
    }

    private fun jobFor(note: PcNote, a: NoteAction, target: JobTarget?): NoteJob {
        val open = NoteJob(note.id, a.id, note.title, target = target)
        if (a.open) return open
        if (a.id == "reply" && a.input) {
            val route = note.route
            if (route?.str("view") != "chat") return open
            val conversation = (route["id"] as? JsonPrimitive)?.takeIf { !it.isString }
            val params = buildJsonObject { if (conversation != null) put("conversation", conversation) }
            return open.copy(method = "chat.send", params = params, textParam = "text")
        }
        if (a.id == "allow" || a.id == "deny") {
            note.acts[a.id]?.let { return open.copy(token = it) }
            val card = note.card
            if (card?.str("method") == "sessions.approve") {
                val session = card.str("id")
                val request = card.str("request")
                if (session != null && request != null) {
                    return open.copy(
                        method = "sessions.approve",
                        params = buildJsonObject { put("id", session); put("request", request); put("decision", a.id) },
                    )
                }
            }
        }
        return open
    }
}

/** Spanish texts of the notices. */
object NotifyTexts {
    const val HIDDEN_MESSAGE = "Tienes un mensaje nuevo"
    const val HIDDEN_APPROVAL = "Orb necesita tu respuesta"
    const val SENDING = "Enviando…"
    const val NOTHING_TYPED = "Escribe algo para responder."
    const val SENT = "Enviado"
    const val ALLOWED = "Aprobado"
    const val DENIED = "Rechazado"
    const val LOCKED = "Desbloquea el móvil o abre Orb para responder."
    const val EXPIRED = "Esta notificación ya no se puede contestar desde aquí. Ábrela en Orb."
    const val OFFLINE = "No se pudo llegar al PC."
    const val TIMEOUT = "El PC no contestó a tiempo."
    const val NOT_LINKED = "Este móvil ya no está enlazado."
    const val BAD_ANSWER = "Respuesta del PC no válida."

    const val CHANNEL_MESSAGES = "Mensajes"
    const val CHANNEL_APPROVALS = "Aprobaciones"
    const val CHANNEL_STATUS = "Estado de la conexión"

    fun failed(why: String) = "No se pudo: $why"
    fun connected(pc: String?) = if (pc.isNullOrBlank()) "Orb conectado" else "Orb conectado a $pc"
    fun searching(pc: String?) = if (pc.isNullOrBlank()) "Buscando el PC…" else "Buscando a $pc…"
}

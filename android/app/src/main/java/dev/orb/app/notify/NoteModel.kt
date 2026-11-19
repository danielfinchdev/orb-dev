package dev.orb.app.notify

import dev.orb.app.ui.chats.str
import dev.orb.app.ui.notes.NoticeKinds
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
    /** The id this notice has in the notices list, so a button of the notification can mark that very notice read. */
    val notice: String? = null,
    /** The PC says this one must stay silent (a muted chat, a schedule told not to notify); the phone shows nothing then. */
    val quiet: Boolean = false,
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
        val parsed = NotesParser.fromEvent(payload, 0)
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
            target = parsed?.target,
            notice = parsed?.id,
            quiet = o.flag("quiet") || o.flag("muted"),
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
        "taskChanges" -> id.toLongOrNull()?.let { NoticeTarget.TaskChanges(it) }
        "version" -> NoticeTarget.Version(id)
        "account" -> NoticeTarget.Account(id)
        else -> null
    }

    companion object {
        fun of(t: NoticeTarget?): JobTarget? = when (t) {
            is NoticeTarget.Chat -> JobTarget("chat", t.kind, t.id)
            is NoticeTarget.Task -> JobTarget("task", id = t.id.toString())
            is NoticeTarget.TaskChanges -> JobTarget("taskChanges", id = t.id.toString())
            is NoticeTarget.Version -> JobTarget("version", id = t.id)
            is NoticeTarget.Account -> JobTarget("account", id = t.id)
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
    /** The notice of the list this notification shows: a tap or «Marcar leído» reads it there too. */
    val notice: String? = null,
    /** «Marcar leído» marks every notice of this chat (the `key` of the PC's note) read, not only the last line. */
    val chat: String? = null,
    /**
     * «Marcar leído»: it only marks the notices on this phone, with no call to the PC and no token of the PC. Only the app sets
     * it, when it builds that button; nothing the PC sends, whatever the id of its action, can turn a button into one.
     */
    val local: Boolean = false,
) {
    val acts: Boolean get() = method != null || token != null || local

    companion object {
        /** The id the app gives its own «Marcar leído»; an action of the PC with this id is discarded. */
        const val READ = "read"
    }
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

    /** The ids of the buttons each kind may carry; any other kind, known or not, gets none that acts. */
    private val ALLOWED = mapOf(
        NoticeKinds.MESSAGE to setOf("reply"),
        NoticeKinds.APPROVAL to setOf("allow", "deny"),
        NoticeKinds.TASK to setOf("allow"),
    )

    fun plan(note: PcNote, settings: NotifySettings): NotificationPlan {
        val target = JobTarget.of(note.target)
        // With the Orb lock on, the real chat title is not kept in the jobs (they sit in plain preferences) and no
        // button can answer from the notification: approving or replying would skip the fingerprint.
        val jobTitle = if (settings.appLock) "Orb" else note.title
        val tap = NoteJob(note.id, "tap", jobTitle, target = target, notice = note.notice, chat = note.key)
        val kind = note.kind
        val read = readButton(note)
        val allowed = ALLOWED[kind].orEmpty()
        val actions = when {
            // With the Orb lock on nothing answers around the fingerprint; kinds that carry no buttons (the PC's own events and
            // any kind this app does not know) only open the app with a tap.
            settings.appLock || allowed.isEmpty() -> emptyList()
            else -> note.actions.filter { it.id != NoteJob.READ && it.id in allowed }.take(MAX_ACTIONS - read.size).map { a ->
                // A task that waits for approval is signed in the app with its confirmation: its buttons only open the app.
                val safe = if (kind == NoticeKinds.TASK) a.copy(open = true) else a
                PlannedAction(jobFor(note, safe, target), a.title, input = a.input && !safe.open)
            } + read
        }
        val asksYou = kind == NoticeKinds.APPROVAL || kind == NoticeKinds.TASK
        val hidden = when {
            asksYou -> NotifyTexts.HIDDEN_APPROVAL
            kind == NoticeKinds.MESSAGE -> NotifyTexts.HIDDEN_MESSAGE
            else -> NotifyTexts.HIDDEN_NOTICE
        }
        return NotificationPlan(
            id = note.id,
            // Done, limit and update notices are information, like a message; a held task needs the person, like an approval.
            channel = if (asksYou || kind == NoticeKinds.HELD) NoteChannel.Approvals else NoteChannel.Messages,
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

    /** «Marcar leído» on a chat's notification: it marks the notice read on this phone and takes the notification away. */
    private fun readButton(note: PcNote): List<PlannedAction> =
        if (note.kind == NoticeKinds.MESSAGE && note.notice != null) {
            listOf(PlannedAction(NoteJob(note.id, NoteJob.READ, note.title, notice = note.notice, chat = note.key, local = true), NotifyTexts.MARK_READ, input = false))
        } else emptyList()

    private fun jobFor(note: PcNote, a: NoteAction, target: JobTarget?): NoteJob {
        val open = NoteJob(note.id, a.id, note.title, target = target, notice = note.notice, chat = note.key)
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

    /** What the PC says too when the preview is off for a notice that is not a chat line. */
    const val HIDDEN_NOTICE = "Tienes un aviso nuevo"
    const val HIDDEN_APPROVAL = "Orb necesita tu respuesta"
    const val MARK_READ = "Marcar leído"
    const val SENDING = "Enviando…"
    const val NOTHING_TYPED = "Escribe algo para responder."
    const val READ = "Leído"
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
    const val CHANNEL_STATUS = "Estado"

    fun failed(why: String) = "No se pudo: $why"
    fun connected(pc: String?) = if (pc.isNullOrBlank()) "Orb conectado" else "Orb conectado a $pc"
    fun searching(pc: String?) = if (pc.isNullOrBlank()) "Buscando el PC…" else "Buscando a $pc…"
    const val OFFLINE_PC = "Sin conexión con tu PC"
}

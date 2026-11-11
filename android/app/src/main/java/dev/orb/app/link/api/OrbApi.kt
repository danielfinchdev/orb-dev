package dev.orb.app.link.api

import dev.orb.app.link.net.LinkClient
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.UUID

/**
 * Every method the app can ask the PC to run. The constructor is internal and only [ApiMethods] makes them: [OrbApi]
 * can only call a method listed here, and a test checks this list against the PC's own table of methods a linked phone
 * may call (src/domain/security/permissions.mjs, exported as vectors/remote-methods.json).
 * [requiresPc]: a method the PC learns in that version (older PCs lack it); the app hides it unless the PC lists it in
 * `me.methods`.
 */
class ApiMethod internal constructor(val name: String, val requiresPc: String? = null) {
    override fun toString() = name
}

object ApiMethods {
    private val registry = ArrayList<ApiMethod>()
    private fun m(name: String, requiresPc: String? = null) = ApiMethod(name, requiresPc).also { registry.add(it) }

    // Methods every PC since 3.8 has.
    val INBOX_LIST = m("inbox.list")
    val INBOX_SEARCH = m("inbox.search")
    val INBOX_PIN = m("inbox.pin")
    val INBOX_UNPIN = m("inbox.unpin")
    val INBOX_REORDER_PINS = m("inbox.reorderPins")
    val INBOX_MUTE = m("inbox.mute")
    val INBOX_SNOOZE = m("inbox.snooze")
    val INBOX_MARK_READ = m("inbox.markRead")
    val INBOX_SECTIONS_LIST = m("inbox.sections.list")
    val INBOX_SECTIONS_CREATE = m("inbox.sections.create")
    val INBOX_SECTIONS_RENAME = m("inbox.sections.rename")
    val INBOX_SECTIONS_DELETE = m("inbox.sections.delete")
    val INBOX_SECTIONS_REORDER = m("inbox.sections.reorder")
    val INBOX_SECTIONS_MOVE = m("inbox.sections.move")
    val CONVERSATIONS_LIST = m("conversations.list")
    val CONVERSATIONS_SEARCH = m("conversations.search")
    val CONVERSATIONS_UPDATE = m("conversations.update")
    val CHAT_LIST = m("chat.list")
    val CHAT_STOP = m("chat.stop")
    val CHAT_COMPACT = m("chat.compact")
    val CHAT_ANSWER = m("chat.answer")
    val CHAT_ACCEPT = m("chat.accept")
    val CHAT_SETTINGS = m("chat.settings")
    val SESSIONS_LIST = m("sessions.list")
    val SESSIONS_CREATE = m("sessions.create")
    val SESSIONS_ITEMS = m("sessions.items")
    val SESSIONS_QUEUE = m("sessions.queue")
    val SESSIONS_EDIT_QUEUED = m("sessions.editQueued")
    val SESSIONS_APPROVE = m("sessions.approve")
    val SESSIONS_RESUME = m("sessions.resume")
    val SESSIONS_FORK = m("sessions.fork")
    val SESSIONS_SETTLE = m("sessions.settle")
    val SESSIONS_STOP = m("sessions.stop")
    val SESSIONS_COMPACT = m("sessions.compact")
    val SESSIONS_UPDATE = m("sessions.update")
    val TASKS_LIST = m("tasks.list")
    val TASKS_LIVE = m("tasks.live")
    val TASKS_GET = m("tasks.get")
    val TASKS_APPROVE = m("tasks.approve")
    val TASKS_RETRY = m("tasks.retry")
    val TASKS_CANCEL = m("tasks.cancel")
    val TASKS_REASSIGN = m("tasks.reassign")
    val TASKS_FOLLOWUP = m("tasks.followup")
    val TASKS_UNDO = m("tasks.undo")
    val TASKS_DIFF = m("tasks.diff")
    val TASKS_LAUNCH_ANYWAY = m("tasks.launchAnyway")
    val TASKS_SEARCH = m("tasks.search")
    val TASKS_ACCEPT = m("tasks.accept")
    val TASKS_REVIEW = m("tasks.review")
    val PROJECTS_LIST = m("projects.list")
    val PROJECTS_ICONS = m("projects.icons")
    val PROJECTS_CREATE = m("projects.create")
    val PROJECTS_SET_ACTIVE = m("projects.setActive")
    val PROJECTS_BRANCH = m("projects.branch")
    val PROJECTS_INFO = m("projects.info")
    val PROJECTS_REVIEW = m("projects.review")
    val PROJECTS_SECURITY_REVIEW = m("projects.securityReview")
    val PROJECTS_FINISH = m("projects.finish")
    val PROJECTS_FINISHED = m("projects.finished")
    val PROJECTS_REOPEN = m("projects.reopen")
    val SCHEDULES_LIST = m("schedules.list")
    val SCHEDULES_CREATE = m("schedules.create")
    val SCHEDULES_UPDATE = m("schedules.update")
    val SCHEDULES_RUN = m("schedules.run")
    val APPROVALS_LIST = m("approvals.list")
    val USAGE_GET = m("usage.get")
    val USAGE_NOW = m("usage.now")
    val USAGE_REFRESH = m("usage.refresh")
    val USAGE_HISTORY = m("usage.history")
    val AGENTS_STATUS = m("agents.status")
    val LOGS_LIST = m("logs.list")
    val LOGS_READ = m("logs.read")
    val WHITEBOARD_LOAD = m("whiteboard.load")
    val WHITEBOARD_SAVE = m("whiteboard.save")
    val WHITEBOARD_NOTE = m("whiteboard.note")
    val ACTIVITY_LIST = m("activity.list")
    val MODELS_GUIDE = m("models.guide")
    val MODELS_CATALOG = m("models.catalog")
    val MENTIONS_OPTIONS = m("mentions.options")
    val PERMISSIONS_SET_MODE = m("permissions.setMode")
    val CONTROL_PAUSE = m("control.pause")
    val CONTROL_RESUME = m("control.resume")
    val APP_STATE = m("app.state")
    val CHAT_SEND = m("chat.send")
    val SESSIONS_SEND = m("sessions.send")
    val TASKS_CREATE = m("tasks.create")

    // Approved on 2026-11-11; the PC side comes with 3.8.4, so older PCs lack them.
    val PC_SCREENSHOT = m("pc.screenshot", requiresPc = "3.8.4")
    val CONVERSATIONS_TRASH = m("conversations.trash", requiresPc = "3.8.4")
    val CONVERSATIONS_RESTORE = m("conversations.restore", requiresPc = "3.8.4")
    val SESSIONS_TRASH = m("sessions.trash", requiresPc = "3.8.4")
    val SESSIONS_RESTORE = m("sessions.restore", requiresPc = "3.8.4")
    val PROJECTS_MERGE_PR = m("projects.mergePr", requiresPc = "3.8.4")
    val PROJECTS_PRS = m("projects.prs", requiresPc = "3.8.4")
    val PROJECTS_PR = m("projects.pr", requiresPc = "3.8.4")
    val NOTES_MARK_READ = m("notes.markRead", requiresPc = "3.8.4")

    val all: List<ApiMethod> get() = registry.toList()
}

/** Only the UI layer may create a [Confirmed] token, after the user confirmed: using it elsewhere is a compile error. */
@RequiresOptIn(level = RequiresOptIn.Level.ERROR, message = "Only the UI layer creates a Confirmed token, after the user confirmed the action.")
@Retention(AnnotationRetention.BINARY)
annotation class UserConfirmation

enum class ConfirmAction { TrashConversation, TrashSession, MergePr }

/** Deleting and merging cannot be called without one; it names the action and the target it was given for. */
class Confirmed @UserConfirmation constructor(val action: ConfirmAction, val target: String)

/** What a trash call returns so the person can undo it. */
class Undo(val token: JsonElement)

/**
 * Thin typed wrappers over the PC's methods, grouped by area. Params are JSON objects for now (the PC's own shapes);
 * strong types come with the screens that need them. The app is a remote control: nothing here runs on the phone.
 */
class OrbApi(private val pc: PcCaller, private val newId: () -> String = { UUID.randomUUID().toString() }) {
    constructor(client: LinkClient) : this(PcCaller.of(client))

    /** Whether the linked PC can run [m] (always true for the methods every PC has). */
    fun available(m: ApiMethod) = m.requiresPc == null || pc.supports(m.name)

    private suspend fun run(m: ApiMethod, params: JsonObject = NONE): Result<JsonElement> =
        if (!available(m)) Result.failure(LinkException(LinkError.Unsupported(m.name))) else pc.call(m.name, params)

    private fun JsonObject.with(k: String, v: String) = JsonObject(this + (k to JsonPrimitive(v)))

    inner class Inbox {
        suspend fun list(params: JsonObject = NONE) = run(ApiMethods.INBOX_LIST, params)
        suspend fun search(params: JsonObject = NONE) = run(ApiMethods.INBOX_SEARCH, params)
        suspend fun pin(params: JsonObject = NONE) = run(ApiMethods.INBOX_PIN, params)
        suspend fun unpin(params: JsonObject = NONE) = run(ApiMethods.INBOX_UNPIN, params)
        suspend fun reorderPins(params: JsonObject = NONE) = run(ApiMethods.INBOX_REORDER_PINS, params)
        suspend fun mute(params: JsonObject = NONE) = run(ApiMethods.INBOX_MUTE, params)
        suspend fun snooze(params: JsonObject = NONE) = run(ApiMethods.INBOX_SNOOZE, params)
        suspend fun markRead(params: JsonObject = NONE) = run(ApiMethods.INBOX_MARK_READ, params)
        suspend fun sectionsList(params: JsonObject = NONE) = run(ApiMethods.INBOX_SECTIONS_LIST, params)
        suspend fun sectionsCreate(params: JsonObject = NONE) = run(ApiMethods.INBOX_SECTIONS_CREATE, params)
        suspend fun sectionsRename(params: JsonObject = NONE) = run(ApiMethods.INBOX_SECTIONS_RENAME, params)
        suspend fun sectionsDelete(params: JsonObject = NONE) = run(ApiMethods.INBOX_SECTIONS_DELETE, params)
        suspend fun sectionsReorder(params: JsonObject = NONE) = run(ApiMethods.INBOX_SECTIONS_REORDER, params)
        suspend fun sectionsMove(params: JsonObject = NONE) = run(ApiMethods.INBOX_SECTIONS_MOVE, params)
    }

    val inbox = Inbox()

    inner class Conversations {
        suspend fun list(params: JsonObject = NONE) = run(ApiMethods.CONVERSATIONS_LIST, params)
        suspend fun search(params: JsonObject = NONE) = run(ApiMethods.CONVERSATIONS_SEARCH, params)
        suspend fun update(params: JsonObject = NONE) = run(ApiMethods.CONVERSATIONS_UPDATE, params)
    }

    val conversations = Conversations()

    inner class Chat {
        suspend fun list(params: JsonObject = NONE) = run(ApiMethods.CHAT_LIST, params)
        suspend fun stop(params: JsonObject = NONE) = run(ApiMethods.CHAT_STOP, params)
        suspend fun compact(params: JsonObject = NONE) = run(ApiMethods.CHAT_COMPACT, params)
        suspend fun answer(params: JsonObject = NONE) = run(ApiMethods.CHAT_ANSWER, params)
        suspend fun accept(params: JsonObject = NONE) = run(ApiMethods.CHAT_ACCEPT, params)
        suspend fun settings(params: JsonObject = NONE) = run(ApiMethods.CHAT_SETTINGS, params)
    }

    val chat = Chat()

    inner class Sessions {
        suspend fun list(params: JsonObject = NONE) = run(ApiMethods.SESSIONS_LIST, params)
        suspend fun create(params: JsonObject = NONE) = run(ApiMethods.SESSIONS_CREATE, params)
        suspend fun items(params: JsonObject = NONE) = run(ApiMethods.SESSIONS_ITEMS, params)
        suspend fun queue(params: JsonObject = NONE) = run(ApiMethods.SESSIONS_QUEUE, params)
        suspend fun editQueued(params: JsonObject = NONE) = run(ApiMethods.SESSIONS_EDIT_QUEUED, params)
        suspend fun approve(params: JsonObject = NONE) = run(ApiMethods.SESSIONS_APPROVE, params)
        suspend fun resume(params: JsonObject = NONE) = run(ApiMethods.SESSIONS_RESUME, params)
        suspend fun fork(params: JsonObject = NONE) = run(ApiMethods.SESSIONS_FORK, params)
        suspend fun settle(params: JsonObject = NONE) = run(ApiMethods.SESSIONS_SETTLE, params)
        suspend fun stop(params: JsonObject = NONE) = run(ApiMethods.SESSIONS_STOP, params)
        suspend fun compact(params: JsonObject = NONE) = run(ApiMethods.SESSIONS_COMPACT, params)
        suspend fun update(params: JsonObject = NONE) = run(ApiMethods.SESSIONS_UPDATE, params)
    }

    val sessions = Sessions()

    inner class Tasks {
        suspend fun list(params: JsonObject = NONE) = run(ApiMethods.TASKS_LIST, params)
        suspend fun live(params: JsonObject = NONE) = run(ApiMethods.TASKS_LIVE, params)
        suspend fun get(params: JsonObject = NONE) = run(ApiMethods.TASKS_GET, params)
        suspend fun approve(params: JsonObject = NONE) = run(ApiMethods.TASKS_APPROVE, params)
        suspend fun retry(params: JsonObject = NONE) = run(ApiMethods.TASKS_RETRY, params)
        suspend fun cancel(params: JsonObject = NONE) = run(ApiMethods.TASKS_CANCEL, params)
        suspend fun reassign(params: JsonObject = NONE) = run(ApiMethods.TASKS_REASSIGN, params)
        suspend fun followup(params: JsonObject = NONE) = run(ApiMethods.TASKS_FOLLOWUP, params)
        suspend fun undo(params: JsonObject = NONE) = run(ApiMethods.TASKS_UNDO, params)
        suspend fun diff(params: JsonObject = NONE) = run(ApiMethods.TASKS_DIFF, params)
        suspend fun launchAnyway(params: JsonObject = NONE) = run(ApiMethods.TASKS_LAUNCH_ANYWAY, params)
        suspend fun search(params: JsonObject = NONE) = run(ApiMethods.TASKS_SEARCH, params)
        suspend fun accept(params: JsonObject = NONE) = run(ApiMethods.TASKS_ACCEPT, params)
        suspend fun review(params: JsonObject = NONE) = run(ApiMethods.TASKS_REVIEW, params)
    }

    val tasks = Tasks()

    inner class Projects {
        suspend fun list(params: JsonObject = NONE) = run(ApiMethods.PROJECTS_LIST, params)
        suspend fun icons(params: JsonObject = NONE) = run(ApiMethods.PROJECTS_ICONS, params)
        suspend fun create(params: JsonObject = NONE) = run(ApiMethods.PROJECTS_CREATE, params)
        suspend fun setActive(params: JsonObject = NONE) = run(ApiMethods.PROJECTS_SET_ACTIVE, params)
        suspend fun branch(params: JsonObject = NONE) = run(ApiMethods.PROJECTS_BRANCH, params)
        suspend fun info(params: JsonObject = NONE) = run(ApiMethods.PROJECTS_INFO, params)
        suspend fun review(params: JsonObject = NONE) = run(ApiMethods.PROJECTS_REVIEW, params)
        suspend fun securityReview(params: JsonObject = NONE) = run(ApiMethods.PROJECTS_SECURITY_REVIEW, params)
        suspend fun finish(params: JsonObject = NONE) = run(ApiMethods.PROJECTS_FINISH, params)
        suspend fun finished(params: JsonObject = NONE) = run(ApiMethods.PROJECTS_FINISHED, params)
        suspend fun reopen(params: JsonObject = NONE) = run(ApiMethods.PROJECTS_REOPEN, params)
    }

    val projects = Projects()

    inner class Schedules {
        suspend fun list(params: JsonObject = NONE) = run(ApiMethods.SCHEDULES_LIST, params)
        suspend fun create(params: JsonObject = NONE) = run(ApiMethods.SCHEDULES_CREATE, params)
        suspend fun update(params: JsonObject = NONE) = run(ApiMethods.SCHEDULES_UPDATE, params)
        suspend fun run(params: JsonObject = NONE) = run(ApiMethods.SCHEDULES_RUN, params)
    }

    val schedules = Schedules()

    inner class Approvals {
        suspend fun list(params: JsonObject = NONE) = run(ApiMethods.APPROVALS_LIST, params)
    }

    val approvals = Approvals()

    inner class Usage {
        suspend fun get(params: JsonObject = NONE) = run(ApiMethods.USAGE_GET, params)
        suspend fun now(params: JsonObject = NONE) = run(ApiMethods.USAGE_NOW, params)
        suspend fun refresh(params: JsonObject = NONE) = run(ApiMethods.USAGE_REFRESH, params)
        suspend fun history(params: JsonObject = NONE) = run(ApiMethods.USAGE_HISTORY, params)
    }

    val usage = Usage()

    inner class Agents {
        suspend fun status(params: JsonObject = NONE) = run(ApiMethods.AGENTS_STATUS, params)
    }

    val agents = Agents()

    inner class Logs {
        suspend fun list(params: JsonObject = NONE) = run(ApiMethods.LOGS_LIST, params)
        suspend fun read(params: JsonObject = NONE) = run(ApiMethods.LOGS_READ, params)
    }

    val logs = Logs()

    inner class Whiteboard {
        suspend fun load(params: JsonObject = NONE) = run(ApiMethods.WHITEBOARD_LOAD, params)
        suspend fun save(params: JsonObject = NONE) = run(ApiMethods.WHITEBOARD_SAVE, params)
        suspend fun note(params: JsonObject = NONE) = run(ApiMethods.WHITEBOARD_NOTE, params)
    }

    val whiteboard = Whiteboard()

    inner class Activity {
        suspend fun list(params: JsonObject = NONE) = run(ApiMethods.ACTIVITY_LIST, params)
    }

    val activity = Activity()

    inner class Models {
        suspend fun guide(params: JsonObject = NONE) = run(ApiMethods.MODELS_GUIDE, params)
        suspend fun catalog(params: JsonObject = NONE) = run(ApiMethods.MODELS_CATALOG, params)
    }

    val models = Models()

    inner class Mentions {
        suspend fun options(params: JsonObject = NONE) = run(ApiMethods.MENTIONS_OPTIONS, params)
    }

    val mentions = Mentions()

    inner class Permissions {
        suspend fun setMode(params: JsonObject = NONE) = run(ApiMethods.PERMISSIONS_SET_MODE, params)
    }

    val permissions = Permissions()

    inner class Control {
        suspend fun pause(params: JsonObject = NONE) = run(ApiMethods.CONTROL_PAUSE, params)
        suspend fun resume(params: JsonObject = NONE) = run(ApiMethods.CONTROL_RESUME, params)
    }

    val control = Control()

    inner class AppState {
        suspend fun state(params: JsonObject = NONE) = run(ApiMethods.APP_STATE, params)
    }

    val app = AppState()

    /** Sends a line to the assistant. [clientId] lets the PC tell a re-sent message from a new one. */
    suspend fun chatSend(params: JsonObject, clientId: String = newId()) = run(ApiMethods.CHAT_SEND, params.with("clientId", clientId))

    /** Sends a line to a direct conversation with an agent. */
    suspend fun sessionsSend(params: JsonObject, clientId: String = newId()) = run(ApiMethods.SESSIONS_SEND, params.with("clientId", clientId))

    /** «Nueva tarea». */
    suspend fun tasksCreate(params: JsonObject) = run(ApiMethods.TASKS_CREATE, params)

    /** «Captura del PC» → the path the PC saved it at. */
    suspend fun pcScreenshot(): Result<String> = run(ApiMethods.PC_SCREENSHOT).fold(
        onSuccess = { r -> ((r as? JsonObject)?.get("path") as? JsonPrimitive)?.takeIf { it.isString }?.content?.let { Result.success(it) } ?: Result.failure(badShape()) },
        onFailure = { Result.failure(it) },
    )

    /** «Borrar chat» of the assistant: undoable with [conversationsRestore] while the undo token lives. */
    suspend fun conversationsTrash(id: String, confirmed: Confirmed): Result<Undo> {
        require(confirmed.action == ConfirmAction.TrashConversation && confirmed.target == id) { "the confirmation is for another action" }
        return run(ApiMethods.CONVERSATIONS_TRASH, idOf(id)).asUndo()
    }

    suspend fun conversationsRestore(id: String) = run(ApiMethods.CONVERSATIONS_RESTORE, idOf(id))

    suspend fun sessionsTrash(id: String, confirmed: Confirmed): Result<Undo> {
        require(confirmed.action == ConfirmAction.TrashSession && confirmed.target == id) { "the confirmation is for another action" }
        return run(ApiMethods.SESSIONS_TRASH, idOf(id)).asUndo()
    }

    suspend fun sessionsRestore(id: String) = run(ApiMethods.SESSIONS_RESTORE, idOf(id))

    /** «Fusionar PR»: [method] is the merge method (`merge`, `squash`, `rebase`) when the person picked one. */
    suspend fun projectsMergePr(name: String, number: Int, method: String? = null, confirmed: Confirmed): Result<JsonElement> {
        require(confirmed.action == ConfirmAction.MergePr && confirmed.target == "$name#$number") { "the confirmation is for another action" }
        val params = buildJsonObject {
            put("name", name)
            put("number", number)
            if (method != null) put("method", method)
        }
        return run(ApiMethods.PROJECTS_MERGE_PR, params)
    }

    /** The open pull requests of a project. */
    suspend fun projectsPrs(name: String): Result<JsonElement> = run(ApiMethods.PROJECTS_PRS, buildJsonObject { put("name", name) })

    /** One pull request of a project (state, checks, files). */
    suspend fun projectsPr(name: String, number: Int): Result<JsonElement> =
        run(ApiMethods.PROJECTS_PR, buildJsonObject { put("name", name); put("number", number) })

    /** Marks notes as read: the given [ids], or all of them when [ids] is null. */
    suspend fun notesMarkRead(ids: List<String>? = null): Result<JsonElement> =
        run(ApiMethods.NOTES_MARK_READ, buildJsonObject { if (ids != null) put("ids", JsonArray(ids.map { JsonPrimitive(it) })) })

    private fun idOf(id: String) = buildJsonObject { put("id", id) }

    private fun badShape() = LinkException(LinkError.BadAnswer)

    private fun Result<JsonElement>.asUndo(): Result<Undo> = fold(
        onSuccess = { r -> (r as? JsonObject)?.get("undo")?.let { Result.success(Undo(it)) } ?: Result.failure(badShape()) },
        onFailure = { Result.failure(it) },
    )

    companion object {
        val NONE = JsonObject(emptyMap())
    }
}

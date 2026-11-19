package dev.orb.app.ui.chats

import dev.orb.app.data.OFFLINE
import dev.orb.app.data.ONLINE
import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.LinkException
import dev.orb.app.ui.tasks.TaskAction
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** `chat.list` rows as the PC sends them. */
fun raw(id: Long, role: String, body: String, meta: String? = null, extra: String = ""): String =
    """{"id":$id,"conversation_id":7,"role":"$role","body":${JsonPrimitive(body)},"meta":${meta ?: "null"},"at":"2026-11-11T09:${(id % 60).toString().padStart(2, '0')}:00.000Z"$extra}"""

fun questionMeta(status: String = "pending", answer: String? = null, multi: Boolean = false) =
    """{"kind":"question","question":"¿Dónde guardo el carrito?","header":"Almacenamiento","multi":$multi,"status":"$status","answer":${answer?.let { JsonPrimitive(it) } ?: "null"},
        "options":[{"label":"IndexedDB","description":"Guarda más datos"},{"label":"localStorage","description":"Más sencillo"}]}""".trimIndent()

fun stateEvent(conversation: Long, busy: Boolean, partial: String = "", tools: String = "[]", answer: String? = null, queued: Int = 0): LinkEvent {
    val src = """{"conversation":$conversation,"busy":$busy,"since":1000,"partial":${JsonPrimitive(partial)},"tools":$tools,"queued":$queued,"waiting":false${answer?.let { ""","answer":$it""" } ?: ""}}"""
    return LinkEvent("chat:state", dev.orb.app.data.json(src))
}

class FakeOrbeChatBackend(initial: List<String> = emptyList()) : OrbeChatBackend {
    val connectionState = MutableStateFlow<ConnectionState>(ONLINE)
    override val connection get() = connectionState
    override val events = MutableSharedFlow<LinkEvent>(extraBufferCapacity = 64, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val rows = MutableStateFlow(initial)
    val headerRow = MutableStateFlow<ChatRow?>(row("7", title = "Carrito que no guarda", project = "tienda-online"))
    val queue = MutableStateFlow<List<PendingMessage>>(emptyList())
    override fun cached(conversation: Long): Flow<List<String>> = rows
    override fun header(conversation: Long): Flow<ChatRow?> = headerRow
    override fun pending(conversation: Long): Flow<List<PendingMessage>> = queue

    val calls = ArrayList<String>()
    var loadResult: Result<Int> = Result.success(0)
    /** Mimics the cache the PC's answer fills. */
    var onLoad: (Long?) -> Unit = {}
    var loads = 0
    var actionResult: Result<Unit> = Result.success(Unit)
    var modeOnPc: String? = "preguntar"
    var chatOnPc: JsonObject? = null
    var taskDetail = TaskDetail(42, "Guardar el carrito", "awaiting_approval", "claude", "C:/tienda", listOf("red"), "h1", folderNow = "C:/tienda", actions = setOf(TaskAction.Approve), description = "Guarda el carrito en IndexedDB al cambiar.")
    /** What `tasks.get` answers per task; a task not listed answers [taskDetail]. */
    val detailsOnPc = HashMap<Long, TaskDetail>()
    var statOnPc: TaskStat? = null
    var statResult: Result<TaskStat?>? = null
    var queueAvailable = true
    var queueOnPc: List<OrbeQueued> = emptyList()
    var queueResult: Result<List<OrbeQueued>>? = null
    var editResult: Result<List<OrbeQueued>>? = null
    /** Holds `chat.editQueued` open so a test can change the editor while the answer is on its way. */
    var editGate: kotlinx.coroutines.CompletableDeferred<Unit>? = null
    /** Runs when `chat.editQueued` is called, before it answers: the PC changing while the request is on its way. */
    var onEdit: () -> Unit = {}
    var queueReads = 0
    /** Called with the text of each action that changes a task, so a test can make the PC answer as it would afterwards. */
    var onAction: (String) -> Unit = {}

    override suspend fun load(conversation: Long, before: Long?): Result<Int> {
        loads++
        calls += "load ${before ?: ""}".trim()
        if (loadResult.isSuccess) onLoad(before)
        return loadResult
    }

    override suspend fun markRead(conversation: Long): Result<Unit> { calls += "read"; return Result.success(Unit) }
    var setModeAvailable = true
    var restoreAvailable = true
    override fun available(m: ApiMethod) = when (m) {
        dev.orb.app.link.api.ApiMethods.CONVERSATIONS_RESTORE -> restoreAvailable
        dev.orb.app.link.api.ApiMethods.CHAT_QUEUE, dev.orb.app.link.api.ApiMethods.CHAT_EDIT_QUEUED -> queueAvailable
        else -> setModeAvailable
    }
    var restoreResult: Result<Unit> = Result.success(Unit)
    override suspend fun restore(conversation: Long): Result<Unit> { calls += "restore"; return restoreResult }

    var sendCount = 0
    override suspend fun send(conversation: Long, text: String, images: List<String>): Result<String> {
        val id = "c${++sendCount}"
        calls += if (images.isEmpty()) "send $text" else "send $text +${images.joinToString(",")}"
        queue.value = queue.value + PendingMessage(id, text, PendingState.Waiting, null, sendCount.toLong())
        return Result.success(id)
    }

    override suspend fun retry(clientId: String): Boolean { calls += "retry $clientId"; return true }
    override suspend fun discard(clientId: String): Boolean { calls += "discard $clientId"; queue.value = queue.value.filter { it.clientId != clientId }; return true }
    override suspend fun stop(conversation: Long): Result<Unit> { calls += "stop"; return actionResult }
    override suspend fun compact(conversation: Long): Result<Unit> { calls += "compact"; return actionResult }
    override suspend fun answer(id: Long, choices: List<String>, other: String?, skip: Boolean): Result<Unit> {
        calls += "answer $id ${choices.joinToString("|")} ${other ?: "-"} $skip"
        return actionResult
    }
    override suspend fun accept(id: Long): Result<Unit> { calls += "accept $id"; return actionResult }
    override suspend fun snapshot(conversation: Long): Result<PcSnapshot> = Result.success(PcSnapshot(modeOnPc, chatOnPc))
    override suspend fun setMode(mode: String): Result<Unit> { calls += "mode $mode"; return actionResult }
    /** Holds taskDetail open so a test can tap twice while the first answer is pending. */
    var detailGate: kotlinx.coroutines.CompletableDeferred<Unit>? = null
    /** What `chat.settings` and `tasks.live` answer; null / empty = the PC does not say. */
    var brainOnPc: BrainInfo? = null
    var liveOnPc: List<LiveTask> = emptyList()
    var brainReads = 0
    var liveReads = 0
    override suspend fun brain(conversation: Long): Result<BrainInfo?> { brainReads++; return Result.success(brainOnPc) }
    override suspend fun liveTasks(): Result<List<LiveTask>> { liveReads++; return Result.success(liveOnPc) }

    /** Makes the next `tasks.get` answer as the PC was when it was asked and hold the answer until this completes. */
    var staleNext: kotlinx.coroutines.CompletableDeferred<Unit>? = null
    /** When set, `tasks.get` answers this instead (a task in the trash, an error). */
    var detailResult: Result<TaskDetail>? = null
    override suspend fun taskDetail(id: Long): Result<TaskDetail> {
        calls += "detail $id"
        detailResult?.let { detailGate?.await(); return it }
        val stale = staleNext?.also { staleNext = null }
        if (stale != null) { val old = detailsOnPc[id] ?: taskDetail; stale.await(); return Result.success(old) }
        detailGate?.await()
        return Result.success(detailsOnPc[id] ?: taskDetail)
    }
    /** Holds the next `tasks.diff {stat}` open after it was answered, so its (then old) answer arrives late. */
    var statGate: kotlinx.coroutines.CompletableDeferred<Unit>? = null
    override suspend fun taskStat(id: Long): Result<TaskStat?> {
        calls += "stat $id"
        val answer = statResult ?: Result.success(statOnPc)
        statGate?.let { g -> statGate = null; g.await() }
        return answer
    }
    override suspend fun acceptTask(id: Long, unheld: Boolean): Result<Unit> {
        calls += "taskaccept $id"; acceptUnheld += unheld; onAction("taskaccept $id"); return acceptResult ?: actionResult
    }
    override suspend fun undoTask(id: Long, checkpoint: String?): Result<Unit> {
        calls += "undo $id"; undoCheckpoints += checkpoint; onAction("undo $id"); return undoResult ?: actionResult
    }
    /** What `tasks.accept` / `tasks.undo` answer when it should differ from [actionResult]. */
    var acceptResult: Result<Unit>? = null
    /** The `unheld` / `checkpoint` / `expect` of each call, in order. */
    val acceptUnheld = ArrayList<Boolean>()
    val undoCheckpoints = ArrayList<String?>()
    val editExpects = ArrayList<String?>()
    var undoResult: Result<Unit>? = null
    override suspend fun queue(conversation: Long): Result<List<OrbeQueued>> { queueReads++; calls += "queue"; return queueResult ?: Result.success(queueOnPc) }
    override suspend fun editQueued(conversation: Long, queueId: String, text: String?, remove: Boolean, expect: String?): Result<List<OrbeQueued>> {
        calls += if (remove) "queue-remove $queueId" else "queue-edit $queueId $text"
        editExpects += expect
        onEdit()
        editGate?.await()
        editResult?.let { return it }
        queueOnPc = if (remove) queueOnPc.filter { it.id != queueId } else queueOnPc.map { if (it.id == queueId) it.copy(text = text.orEmpty()) else it }
        return Result.success(queueOnPc)
    }
    override suspend fun decideTask(id: Long, approve: Boolean, hash: String?): Result<Unit> { calls += "task $id $approve $hash"; onAction("task $id $approve"); return actionResult }
    override suspend fun decideRequest(session: String, request: String, decision: String): Result<Unit> { calls += "request $session $request $decision"; return actionResult }

    fun goOffline() { connectionState.value = OFFLINE }
}

fun refused(msg: String) = Result.failure<Unit>(LinkException(LinkError.Refused(400, msg)))


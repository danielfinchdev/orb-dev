package dev.orb.app.ui.chats

import dev.orb.app.data.OFFLINE
import dev.orb.app.data.ONLINE
import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.LinkException
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
    var taskDetail = TaskDetail(42, "Guardar el carrito", "awaiting_approval", "claude", "C:/tienda", listOf("red"), "h1")

    override suspend fun load(conversation: Long, before: Long?): Result<Int> {
        loads++
        calls += "load ${before ?: ""}".trim()
        if (loadResult.isSuccess) onLoad(before)
        return loadResult
    }

    override suspend fun markRead(conversation: Long): Result<Unit> { calls += "read"; return Result.success(Unit) }
    var setModeAvailable = true
    var restoreAvailable = true
    override fun available(m: ApiMethod) = if (m == dev.orb.app.link.api.ApiMethods.CONVERSATIONS_RESTORE) restoreAvailable else setModeAvailable
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
    override suspend fun taskDetail(id: Long): Result<TaskDetail> { calls += "detail $id"; detailGate?.await(); return Result.success(taskDetail) }
    override suspend fun decideTask(id: Long, approve: Boolean, hash: String?): Result<Unit> { calls += "task $id $approve $hash"; return actionResult }
    override suspend fun decideRequest(session: String, request: String, decision: String): Result<Unit> { calls += "request $session $request $decision"; return actionResult }

    fun goOffline() { connectionState.value = OFFLINE }
}

fun refused(msg: String) = Result.failure<Unit>(LinkException(LinkError.Refused(400, msg)))


package dev.orb.app.ui.chats

import dev.orb.app.data.OFFLINE
import dev.orb.app.data.ONLINE
import dev.orb.app.data.json
import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkEvent
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** A `sessions.items` row as the PC sends it; [body] is JSON text. */
fun sitem(id: Long, role: String, kind: String, body: String): String =
    """{"id":$id,"session_id":"s1","role":"$role","kind":"$kind","body":$body,"at":"2026-11-11T09:${(id % 60).toString().padStart(2, '0')}:00.000Z"}"""

fun jstr(s: String) = JsonPrimitive(s).toString()

fun approvalBody(request: String = "r1", status: String = "pending") =
    """{"id":"$request","tool":"Bash","title":"npm run db:migrate -- --env=dev","reason":"Cambia la base de datos de desarrollo.","input":{"command":"npm run db:migrate -- --env=dev"},"status":"$status"}"""

fun sessionInfo(status: String = "idle", agent: String = "codex") = SessionInfo(
    id = "s1", title = "Límite de reintentos", project = "api-pagos", agent = agent, model = "GPT-5.5", status = status, permission = "editar",
    settled = false, archived = false, contextUsed = 58, contextSize = 100,
)

fun itemEvent(id: Long, role: String, kind: String, body: String) = LinkEvent("session:item", json(sitem(id, role, kind, body)))
fun deltaEvent(piece: String) = LinkEvent("session:delta", json("""{"id":"s1","text":${JsonPrimitive(piece)}}"""))
fun updateEvent(status: String) = LinkEvent("session:update", json("""{"id":"s1","title":"Límite de reintentos","agent":"codex","status":"$status"}"""))
fun queueEvent(vararg texts: String) = LinkEvent(
    "session:queue", json("""{"id":"s1","queue":[${texts.mapIndexed { i, t -> """{"id":${i + 1},"text":${JsonPrimitive(t)},"images":[]}""" }.joinToString(",")}]}"""),
)

class FakeDirectChatBackend(initial: List<String> = emptyList()) : DirectChatBackend {
    val connectionState = MutableStateFlow<ConnectionState>(ONLINE)
    override val connection get() = connectionState
    override val events = MutableSharedFlow<LinkEvent>(extraBufferCapacity = 64, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val rows = MutableStateFlow(initial)
    val headerRow = MutableStateFlow<ChatRow?>(row("s1", kind = ChatKind.Agent, title = "Límite de reintentos", project = "api-pagos", agent = "codex"))
    val outbox = MutableStateFlow<List<PendingMessage>>(emptyList())
    override fun cached(session: String): Flow<List<String>> = rows
    override fun header(session: String): Flow<ChatRow?> = headerRow
    override fun pending(session: String): Flow<List<PendingMessage>> = outbox

    val calls = ArrayList<String>()
    var loads = 0
    var onLoad: () -> Unit = {}
    var loadError: Throwable? = null
    var infoOnPc: SessionInfo? = sessionInfo()
    var approvalsOnPc: List<JsonObject> = emptyList()
    var queueOnPc: List<QueuedMsg> = emptyList()
    var actionResult: Result<Unit> = Result.success(Unit)
    var forkId = "s2"

    override suspend fun load(session: String, before: Long?): Result<List<Long>> {
        loads++
        calls += "load ${before ?: ""}".trim()
        loadError?.let { return Result.failure(it) }
        onLoad()
        return Result.success(rows.value.mapNotNull { DirectParser.parseRaw(it)?.id })
    }

    override suspend fun info(session: String) = Result.success(infoOnPc)
    override suspend fun approvals(session: String) = Result.success(approvalsOnPc)
    override suspend fun queue(session: String) = Result.success(queueOnPc)
    override suspend fun markRead(session: String): Result<Unit> { calls += "read"; return Result.success(Unit) }
    var restoreAvailable = true
    var restoreResult: Result<Unit> = Result.success(Unit)
    override fun available(m: dev.orb.app.link.api.ApiMethod) = restoreAvailable
    override suspend fun restore(session: String): Result<Unit> { calls += "restore"; return restoreResult }

    var sendCount = 0
    override suspend fun send(session: String, text: String, mode: String?): Result<String> {
        val id = "c${++sendCount}"
        calls += "send ${mode ?: "-"} $text"
        outbox.value = outbox.value + PendingMessage(id, text, PendingState.Waiting, null, sendCount.toLong())
        return Result.success(id)
    }

    override suspend fun retry(clientId: String): Boolean { calls += "retry $clientId"; return true }
    override suspend fun discard(clientId: String): Boolean { calls += "discard $clientId"; outbox.value = outbox.value.filter { it.clientId != clientId }; return true }

    override suspend fun decide(session: String, request: String, decision: String): Result<Unit> { calls += "decide $session $request $decision"; return actionResult }
    override suspend fun editQueued(session: String, queueId: Long, text: String?, remove: Boolean, move: String?): Result<Unit> {
        calls += "edit $queueId ${text ?: "-"} $remove ${move ?: "-"}"
        return actionResult
    }
    override suspend fun stop(session: String): Result<Unit> { calls += "stop"; return actionResult }
    override suspend fun compact(session: String): Result<Unit> { calls += "compact"; return actionResult }
    override suspend fun resume(session: String): Result<Unit> { calls += "resume"; return actionResult }
    override suspend fun fork(session: String): Result<String> { calls += "fork"; return Result.success(forkId) }
    override suspend fun settle(session: String): Result<Unit> { calls += "settle"; return actionResult }
    override suspend fun archive(session: String): Result<Unit> { calls += "archive"; return actionResult }
    override suspend fun rename(session: String, title: String): Result<Unit> { calls += "rename $title"; return actionResult }

    fun goOffline() { connectionState.value = OFFLINE }
}

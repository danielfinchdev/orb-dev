package dev.orb.app.ui.tasks

import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.LinkException
import dev.orb.app.link.net.PcVersions
import dev.orb.app.ui.chats.SearchTask
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow

fun task(
    id: Long, title: String = "Tarea $id", status: String = "queued", project: String? = "api-pagos", agent: String? = "claude",
    waiting: TaskWait? = null, held: TaskHeld? = null, result: String? = null, undone: Boolean = false,
) = TaskRow(
    id = id, title = title, project = project, status = status, agent = agent, model = null, readonly = false,
    createdAt = "2026-11-11T09:00:00.000Z", waiting = waiting, held = held, undone = undone, result = result,
)

fun detail(
    row: TaskRow, description: String = "Hace algo", accepted: Boolean = false, hasCheckpoint: Boolean = false, previewHash: String? = null,
    events: List<TaskEvent> = emptyList(), dependencies: List<TaskLink> = emptyList(), children: List<TaskLink> = emptyList(),
    facts: dev.orb.app.ui.chats.TaskDetail? = null, checkpointId: String? = null,
) = TaskDetail(
    row = row, description = description, reasoning = "medium", mode = "carpeta", branch = null, folder = "C:/p", createdBy = "orbe",
    modelLabel = null, accountLabel = null, accepted = accepted, hasCheckpoint = hasCheckpoint, previewHash = previewHash,
    dependencies = dependencies, children = children, events = events, facts = facts, checkpointId = checkpointId,
)

class FakeTasksBackend(initial: List<TaskRow> = emptyList(), paused: Boolean = false) : TasksBackend {
    val connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Online("http://pc", "PC", PcVersions(1, 1, "3.8.4")))
    override val connection get() = connectionState
    override val events = MutableSharedFlow<LinkEvent>(extraBufferCapacity = 16, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    var data = TasksData(initial, paused)
    var listResult: Result<TasksData>? = null
    var listCount = 0
    var unavailable: Set<String> = emptySet()
    val calls = ArrayList<String>()
    val undoCheckpoints = ArrayList<String?>()
    val acceptCheckpoints = ArrayList<String?>()
    var actionResult: Result<Unit> = Result.success(Unit)
    var launchResult: Result<Boolean> = Result.success(false)
    var searchResult: Result<List<SearchTask>> = Result.success(emptyList())
    val searches = ArrayList<String>()
    var projectList: Result<List<String>> = Result.success(listOf("api-pagos", "app-movil"))
    var agentList: Result<List<AgentChoice>> = Result.success(listOf(AgentChoice("claude", "Claude"), AgentChoice("codex", "Codex")))
    var details = HashMap<Long, Result<TaskDetail>>()
    var diffs = HashMap<Long, Result<TaskDiff>>()
    var gate: CompletableDeferred<Unit>? = null
    var diffGate: CompletableDeferred<Unit>? = null
    val reads = ArrayList<String>()

    override fun available(m: ApiMethod) = m.name !in unavailable

    val savedFlow = MutableStateFlow<TasksData?>(null)
    override fun saved() = kotlinx.coroutines.flow.flow { savedFlow.collect { if (it != null) emit(it) } }

    override suspend fun list(): Result<TasksData> { listCount++; return listResult ?: Result.success(data) }
    override suspend fun search(q: String): Result<List<SearchTask>> { searches += q; return searchResult }

    private suspend fun act(name: String): Result<Unit> {
        calls += name
        gate?.await()
        return actionResult
    }

    override suspend fun setPaused(paused: Boolean): Result<Unit> {
        val r = act("paused $paused")
        if (r.isSuccess) data = data.copy(paused = paused)
        return r
    }

    override suspend fun projects() = projectList
    override suspend fun create(project: String, title: String, description: String) = act("create $project|$title|$description")
    override suspend fun get(id: Long): Result<TaskDetail> { reads += "get"; return details[id] ?: Result.failure(LinkException(LinkError.Offline)) }
    override suspend fun diff(id: Long): Result<TaskDiff> { reads += "diff"; diffGate?.await(); return diffs[id] ?: Result.failure(LinkException(LinkError.Offline)) }
    override suspend fun agents() = agentList
    override suspend fun launchAnyway(id: Long): Result<Boolean> { calls += "launch $id"; gate?.await(); return launchResult }
    override suspend fun reassign(id: Long, agent: String, reasoning: String) = act("reassign $id $agent $reasoning")
    override suspend fun followup(id: Long, text: String) = act("followup $id $text")
    override suspend fun retry(id: Long) = act("retry $id")
    override suspend fun cancel(id: Long) = act("cancel $id")
    override suspend fun review(id: Long) = act("review $id")
    override suspend fun accept(id: Long, checkpoint: String?) = act("accept $id").also { acceptCheckpoints += checkpoint }
    override suspend fun undo(id: Long, checkpoint: String?) = act("undo $id").also { undoCheckpoints += checkpoint }
    override suspend fun decide(id: Long, approve: Boolean, hash: String) = act("decide $id $approve $hash")
}

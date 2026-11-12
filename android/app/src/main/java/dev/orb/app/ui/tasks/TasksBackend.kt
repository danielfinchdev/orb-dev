package dev.orb.app.ui.tasks

import dev.orb.app.LinkRuntime
import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.LinkException
import dev.orb.app.ui.chats.SearchTask
import dev.orb.app.ui.chats.bool
import dev.orb.app.ui.chats.long
import dev.orb.app.ui.chats.str
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The reasoning levels `tasks.reassign` and `tasks.create` accept. */
val TaskReasoning = listOf("low", "medium", "high")

/**
 * What the task screens need from the PC. Every action is a request to the PC; nothing runs on the phone.
 * An interface so the view models can be tested without a link.
 */
interface TasksBackend {
    val connection: StateFlow<ConnectionState>
    val events: SharedFlow<LinkEvent>

    /** Whether the linked PC can run [m]; what it cannot do is hidden, never shown disabled. */
    fun available(m: ApiMethod): Boolean

    suspend fun list(): Result<TasksData>
    suspend fun search(q: String): Result<List<SearchTask>>

    /** `control.pause` / `control.resume`. */
    suspend fun setPaused(paused: Boolean): Result<Unit>
    suspend fun projects(): Result<List<String>>
    suspend fun create(project: String, title: String, description: String): Result<Unit>

    suspend fun get(id: Long): Result<TaskDetail>
    suspend fun diff(id: Long): Result<TaskDiff>
    suspend fun agents(): Result<List<AgentChoice>>

    /** → whether the queue stays paused for the others. */
    suspend fun launchAnyway(id: Long): Result<Boolean>
    suspend fun reassign(id: Long, agent: String, reasoning: String): Result<Unit>
    suspend fun followup(id: Long, text: String): Result<Unit>
    suspend fun retry(id: Long): Result<Unit>
    suspend fun cancel(id: Long): Result<Unit>
    suspend fun review(id: Long): Result<Unit>
    suspend fun accept(id: Long): Result<Unit>
    suspend fun undo(id: Long): Result<Unit>

    /** [hash] is the fingerprint the person saw: a task that changed meanwhile is refused instead of approved blind. */
    suspend fun decide(id: Long, approve: Boolean, hash: String): Result<Unit>
}

class RuntimeTasksBackend(private val runtime: LinkRuntime) : TasksBackend {
    private val api get() = runtime.api
    override val connection get() = runtime.client.connection
    override val events get() = runtime.client.events

    override fun available(m: ApiMethod) = api.available(m)

    private fun idOf(id: Long) = buildJsonObject { put("id", id) }
    private fun Result<JsonElement>.unit(): Result<Unit> = map { }
    private fun bad(): Throwable = LinkException(LinkError.BadAnswer)

    override suspend fun list(): Result<TasksData> = coroutineScope {
        val list = async { api.tasks.list() }
        val live = async { if (api.available(ApiMethods.TASKS_LIVE)) api.tasks.live().getOrNull() else null }
        val state = async { api.app.state().getOrNull() }
        val answer = list.await().getOrElse { return@coroutineScope Result.failure(it) }
        if (answer !is JsonArray) return@coroutineScope Result.failure(bad())
        val rows = TasksParser.mergeLive(TasksParser.list(answer), TasksParser.live(live.await()))
        val paused = ((state.await() as? JsonObject)?.bool("paused")) ?: rows.any { it.waiting?.kind == "paused" }
        Result.success(TasksData(rows, paused))
    }

    override suspend fun search(q: String): Result<List<SearchTask>> = api.tasks.search(buildJsonObject { put("q", q) }).mapCatching { el ->
        (el as? JsonArray ?: throw bad()).mapNotNull { x ->
            val o = x as? JsonObject ?: return@mapNotNull null
            SearchTask(o.long("id") ?: return@mapNotNull null, o.str("title") ?: return@mapNotNull null, o.str("status"), o.str("project"), o.str("snippet"))
        }
    }

    override suspend fun setPaused(paused: Boolean) = (if (paused) api.control.pause() else api.control.resume()).unit()

    override suspend fun projects(): Result<List<String>> = api.projects.list().mapCatching { el ->
        (el as? JsonArray ?: throw bad()).mapNotNull { (it as? JsonObject)?.str("name") }
    }

    override suspend fun create(project: String, title: String, description: String) = api.tasksCreate(
        buildJsonObject { put("project", project); put("title", title); put("description", description) },
    ).unit()

    override suspend fun get(id: Long): Result<TaskDetail> = api.tasks.get(idOf(id)).mapCatching { TasksParser.detail(it) ?: throw bad() }

    override suspend fun diff(id: Long): Result<TaskDiff> = api.tasks.diff(idOf(id)).mapCatching { TasksParser.diff(it) }

    override suspend fun agents(): Result<List<AgentChoice>> = api.models.catalog().map { TasksParser.agents(it) }

    override suspend fun launchAnyway(id: Long): Result<Boolean> =
        api.tasks.launchAnyway(idOf(id)).map { (it as? JsonObject)?.bool("paused") == true }

    override suspend fun reassign(id: Long, agent: String, reasoning: String) =
        api.tasks.reassign(buildJsonObject { put("id", id); put("agent", agent); put("reasoning", reasoning) }).unit()

    override suspend fun followup(id: Long, text: String) = api.tasks.followup(buildJsonObject { put("id", id); put("text", text) }).unit()
    override suspend fun retry(id: Long) = api.tasks.retry(idOf(id)).unit()
    override suspend fun cancel(id: Long) = api.tasks.cancel(idOf(id)).unit()
    override suspend fun review(id: Long) = api.tasks.review(idOf(id)).unit()
    override suspend fun accept(id: Long) = api.tasks.accept(idOf(id)).unit()
    override suspend fun undo(id: Long) = api.tasks.undo(idOf(id)).unit()

    override suspend fun decide(id: Long, approve: Boolean, hash: String) = api.tasks.approve(
        buildJsonObject {
            put("id", id)
            put("decision", if (approve) "approved" else "rejected")
            put("hash", hash)
        },
    ).unit()
}

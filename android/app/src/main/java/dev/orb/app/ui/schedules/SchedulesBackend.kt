package dev.orb.app.ui.schedules

import dev.orb.app.LinkRuntime
import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.LinkException
import dev.orb.app.ui.chats.AgentOption
import dev.orb.app.ui.chats.NewChatParser
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** What the scheduled-tasks screen needs from the PC. Every action is a request; nothing runs on the phone. */
interface SchedulesBackend {
    val connection: StateFlow<ConnectionState>
    val events: SharedFlow<LinkEvent>

    /** Whether the linked PC can run [m]; what it cannot do is hidden. */
    fun available(m: ApiMethod): Boolean

    suspend fun list(): Result<List<ScheduleItem>>

    /** The project names a schedule can belong to. */
    suspend fun projects(): Result<List<String>>
    /** The agents the PC can run now, with their models, for the agent and model choice. */
    suspend fun agents(): Result<List<AgentOption>>
    suspend fun create(s: NewSchedule): Result<Unit>

    /** Only the fields that are not null change. */
    suspend fun update(id: Long, enabled: Boolean? = null, approve: Boolean = false, title: String? = null, description: String? = null): Result<Unit>
    suspend fun run(id: Long): Result<Unit>
}

class RuntimeSchedulesBackend(private val runtime: LinkRuntime) : SchedulesBackend {
    private val api get() = runtime.api
    override val connection get() = runtime.client.connection
    override val events get() = runtime.client.events

    override fun available(m: ApiMethod) = api.available(m)

    private fun Result<JsonElement>.unit(): Result<Unit> = map { }

    override suspend fun list(): Result<List<ScheduleItem>> = api.schedules.list().mapCatching {
        if (it !is JsonArray) throw LinkException(LinkError.BadAnswer)
        SchedulesParser.list(it)
    }

    override suspend fun projects(): Result<List<String>> = api.projects.list().map { SchedulesParser.projectNames(it) }

    override suspend fun agents(): Result<List<AgentOption>> = coroutineScope {
        val state = async { api.app.state() }
        val catalog = api.models.catalog().getOrElse { return@coroutineScope Result.failure(it) }
        Result.success(NewChatParser.parse(catalog, state.await().getOrNull(), null).agents)
    }

    override suspend fun create(s: NewSchedule) = api.schedules.create(
        buildJsonObject {
            put("project", s.project)
            put("title", s.title)
            put("description", s.description)
            put("every", s.every)
            put("at_time", s.atTime)
            put("weekdays", JsonArray(s.weekdays.map { JsonPrimitive(it) }))
            put("hours", s.hours)
            put("readonly", s.readonly)
            put("same_chat", s.sameChat)
            put("agent", s.agent)
            s.model?.let { put("model", it) }
        },
    ).unit()

    override suspend fun update(id: Long, enabled: Boolean?, approve: Boolean, title: String?, description: String?) = api.schedules.update(
        buildJsonObject {
            put("id", id)
            if (enabled != null) put("enabled", enabled)
            if (approve) put("approve", true)
            if (title != null) put("title", title)
            if (description != null) put("description", description)
        },
    ).unit()

    override suspend fun run(id: Long) = api.schedules.run(buildJsonObject { put("id", id) }).unit()
}

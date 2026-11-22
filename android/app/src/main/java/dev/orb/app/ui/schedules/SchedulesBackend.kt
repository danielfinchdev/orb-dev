package dev.orb.app.ui.schedules

import dev.orb.app.LinkRuntime
import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.LinkException
import dev.orb.app.ui.chats.AgentOption
import dev.orb.app.ui.chats.NewChatParser
import dev.orb.app.ui.chats.long
import dev.orb.app.ui.chats.str
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** What the scheduled-tasks screen needs from the PC. Every action is a request; nothing runs on the phone. */
interface SchedulesBackend {
    val connection: StateFlow<ConnectionState>
    val events: SharedFlow<LinkEvent>

    /** Whether the linked PC can run [m]; what it cannot do is hidden. */
    fun available(m: ApiMethod): Boolean

    /** The list as last saved on the phone; shown first and while the PC cannot be reached. */
    fun saved(): kotlinx.coroutines.flow.Flow<List<ScheduleItem>> = kotlinx.coroutines.flow.emptyFlow()

    suspend fun list(): Result<List<ScheduleItem>>

    /** The project names a schedule can belong to. */
    suspend fun projects(): Result<List<String>>
    /** The agents the PC can run now, with their models, for the agent and model choice. */
    suspend fun agents(): Result<List<AgentOption>>
    suspend fun create(s: NewSchedule): Result<Unit>

    /** Only the fields of [patch] that are not null change. */
    suspend fun update(id: Long, patch: SchedulePatch): Result<Unit>
    /** [hash]: the fingerprint of an unapproved schedule, which the PC asks for before running it. */
    suspend fun run(id: Long, hash: String? = null): Result<Unit>

    /** How the task of each last run stands (task id to its status), for the «Última: ayer, bien» line; empty when unknown. */
    suspend fun outcomes(): Result<Map<Long, String>> = Result.success(emptyMap())
}

class RuntimeSchedulesBackend(private val runtime: LinkRuntime, private val container: dev.orb.app.AppContainer? = null) : SchedulesBackend {
    private val api get() = runtime.api
    override val connection get() = runtime.client.connection
    override val events get() = runtime.client.events

    override fun available(m: ApiMethod) = api.available(m)

    private fun Result<JsonElement>.unit(): Result<Unit> = map { }

    override fun saved(): kotlinx.coroutines.flow.Flow<List<ScheduleItem>> = kotlinx.coroutines.flow.flow {
        // The database opens in the background; until then there is nothing to show.
        val dao = container?.cacheDao() ?: return@flow
        emitAll(
            dao.observeSnapshot(SNAP_LIST).map { snap ->
                val rows = snap?.json?.let { runCatching { kotlinx.serialization.json.Json.parseToJsonElement(it) }.getOrNull() } as? JsonArray
                rows?.let(SchedulesParser::list).orEmpty()
            },
        )
    }

    override suspend fun list(): Result<List<ScheduleItem>> = api.schedules.list().mapCatching {
        if (it !is JsonArray) throw LinkException(LinkError.BadAnswer)
        container?.cacheSync()?.applySnapshot(SNAP_LIST, it)
        SchedulesParser.list(it)
    }

    private companion object {
        const val SNAP_LIST = "schedules.list"
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
            s.monthDay?.let { put("month_day", it) }
            s.tz?.let { put("tz", it) }
            s.notifyMobile?.let { put("notify_mobile", it) }
            s.autonomy?.let { put("autonomy", it) }
        },
    ).unit()

    override suspend fun update(id: Long, patch: SchedulePatch) = api.schedules.update(
        buildJsonObject {
            put("id", id)
            patch.enabled?.let { put("enabled", it) }
            if (patch.approve) { put("approve", true); patch.hash?.let { put("hash", it) } }
            patch.title?.let { put("title", it) }
            patch.description?.let { put("description", it) }
            patch.project?.let { put("project", it) }
            patch.agent?.let { put("agent", it) }
            // An empty text clears the model or the zone on the PC; a field left out stays as it is.
            patch.model?.let { put("model", it) }
            patch.readonly?.let { put("readonly", it) }
            patch.sameChat?.let { put("same_chat", it) }
            patch.every?.let { put("every", it) }
            patch.atTime?.let { put("at_time", it) }
            patch.hours?.let { put("hours", it) }
            patch.weekdays?.let { days -> put("weekdays", JsonArray(days.map { JsonPrimitive(it) })) }
            patch.monthDay?.let { put("month_day", it) }
            patch.tz?.let { put("tz", it) }
            patch.notifyMobile?.let { put("notify_mobile", it) }
            patch.autonomy?.let { put("autonomy", it) }
        },
    ).unit()

    // The board has no «what happened to this run» of its own; the task list says how each last task ended.
    override suspend fun outcomes(): Result<Map<Long, String>> {
        if (!api.available(ApiMethods.TASKS_LIST)) return Result.success(emptyMap())
        return api.tasks.list().mapCatching { el ->
            (el as? JsonArray).orEmpty().mapNotNull { x ->
                val o = x as? JsonObject ?: return@mapNotNull null
                val id = o.long("id") ?: return@mapNotNull null
                id to (o.str("status") ?: return@mapNotNull null)
            }.toMap()
        }
    }

    override suspend fun run(id: Long, hash: String?) = api.schedules.run(buildJsonObject { put("id", id); hash?.let { put("hash", it) } }).unit()
}

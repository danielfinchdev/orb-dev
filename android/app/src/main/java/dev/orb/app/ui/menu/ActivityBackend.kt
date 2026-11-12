package dev.orb.app.ui.menu

import dev.orb.app.LinkRuntime
import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** What the «Memorias y actividad» screen reads from the PC. Read-only. */
interface ActivityBackend {
    val connection: StateFlow<ConnectionState>
    fun available(m: ApiMethod): Boolean

    /** The events and logbooks as last saved on the phone; shown first and while the PC cannot be reached. */
    fun saved(): Flow<SavedActivity> = emptyFlow()

    /** `activity.list`: the latest events of the PC, newest first. */
    suspend fun events(limit: Int): Result<List<ActivityEvent>>

    /** `logs.list`: the logbooks (the general one and one per project). */
    suspend fun logs(): Result<List<LogInfo>>

    /** `logs.read`: the latest entries of one logbook as plain text. */
    suspend fun readLog(name: String): Result<String>
}

/** What the screen keeps from the last answers of the PC; a part never saved is null. */
data class SavedActivity(val events: List<ActivityEvent>?, val logs: List<LogInfo>?)

class RuntimeActivityBackend(private val runtime: LinkRuntime, private val container: dev.orb.app.AppContainer? = null) : ActivityBackend {
    private val api get() = runtime.api
    override val connection get() = runtime.client.connection

    override fun available(m: ApiMethod) = api.available(m)

    private fun bad() = LinkException(LinkError.BadAnswer)

    private companion object {
        const val SNAP_EVENTS = "activity.list"
        const val SNAP_LOGS = "logs.list"
    }

    override fun saved(): Flow<SavedActivity> = flow {
        // The database opens in the background; until then there is nothing to show.
        val dao = container?.cacheDao() ?: return@flow
        emitAll(
            combine(dao.observeSnapshot(SNAP_EVENTS), dao.observeSnapshot(SNAP_LOGS)) { events, logs ->
                fun parse(json: String?) = json?.let { runCatching { Json.parseToJsonElement(it) }.getOrNull() } as? JsonArray
                SavedActivity(parse(events?.json)?.let(ActivityParser::events), parse(logs?.json)?.let(ActivityParser::logs))
            },
        )
    }

    override suspend fun events(limit: Int) = api.activity.list(buildJsonObject { put("limit", limit) }).mapCatching {
        if (it !is JsonArray) throw bad()
        container?.cacheSync()?.applySnapshot(SNAP_EVENTS, it)
        ActivityParser.events(it)
    }

    override suspend fun logs() = api.logs.list().mapCatching {
        if (it !is JsonArray) throw bad()
        container?.cacheSync()?.applySnapshot(SNAP_LOGS, it)
        ActivityParser.logs(it)
    }

    override suspend fun readLog(name: String) = api.logs.read(buildJsonObject { put("project", name) }).mapCatching {
        (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content ?: throw bad()
    }
}

package dev.orb.app.ui.menu

import dev.orb.app.LinkRuntime
import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** What the «Memorias y actividad» screen reads from the PC. Read-only. */
interface ActivityBackend {
    val connection: StateFlow<ConnectionState>
    fun available(m: ApiMethod): Boolean

    /** `activity.list`: the latest events of the PC, newest first. */
    suspend fun events(limit: Int): Result<List<ActivityEvent>>

    /** `logs.list`: the logbooks (the general one and one per project). */
    suspend fun logs(): Result<List<LogInfo>>

    /** `logs.read`: the latest entries of one logbook as plain text. */
    suspend fun readLog(name: String): Result<String>
}

class RuntimeActivityBackend(private val runtime: LinkRuntime) : ActivityBackend {
    private val api get() = runtime.api
    override val connection get() = runtime.client.connection

    override fun available(m: ApiMethod) = api.available(m)

    private fun bad() = LinkException(LinkError.BadAnswer)

    override suspend fun events(limit: Int) = api.activity.list(buildJsonObject { put("limit", limit) }).mapCatching {
        if (it !is JsonArray) throw bad()
        ActivityParser.events(it)
    }

    override suspend fun logs() = api.logs.list().mapCatching {
        if (it !is JsonArray) throw bad()
        ActivityParser.logs(it)
    }

    override suspend fun readLog(name: String) = api.logs.read(buildJsonObject { put("project", name) }).mapCatching {
        (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content ?: throw bad()
    }
}

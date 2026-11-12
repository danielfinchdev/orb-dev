package dev.orb.app.ui.usage

import dev.orb.app.LinkRuntime
import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.LinkException
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** What the usage screen reads from the PC. Everything is read-only except asking the agents for their plan again. */
interface UsageBackend {
    val connection: StateFlow<ConnectionState>
    val events: SharedFlow<LinkEvent>

    /** Whether the linked PC can run [m]; what it cannot do is hidden. */
    fun available(m: ApiMethod): Boolean

    /** `usage.get`: every account with the limit windows its agent reported. */
    suspend fun accounts(): Result<List<UsageAccount>>

    /** `usage.refresh`: the open agents ask their plan now; read the accounts again afterwards. */
    suspend fun refresh(): Result<Unit>
    suspend fun history(days: Int): Result<UsageHistory>
    suspend fun agents(): Result<List<AgentInfo>>
    suspend fun guide(): Result<List<ModelGuideAgent>>
}

class RuntimeUsageBackend(private val runtime: LinkRuntime) : UsageBackend {
    private val api get() = runtime.api
    override val connection get() = runtime.client.connection
    override val events get() = runtime.client.events

    override fun available(m: ApiMethod) = api.available(m)

    private fun bad() = LinkException(LinkError.BadAnswer)

    override suspend fun accounts() = api.usage.get().mapCatching {
        if (it !is JsonArray) throw bad()
        UsageParser.accounts(it)
    }

    override suspend fun refresh() = api.usage.refresh().map { }

    override suspend fun history(days: Int) = api.usage.history(buildJsonObject { put("days", days) }).mapCatching { UsageParser.history(it, days) ?: throw bad() }

    override suspend fun agents() = api.agents.status().mapCatching {
        if (it !is JsonArray) throw bad()
        UsageParser.agents(it)
    }

    override suspend fun guide() = api.models.guide().mapCatching {
        if (it !is JsonArray) throw bad()
        UsageParser.guide(it)
    }
}

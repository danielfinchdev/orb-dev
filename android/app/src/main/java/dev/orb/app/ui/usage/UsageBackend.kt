package dev.orb.app.ui.usage

import dev.orb.app.LinkRuntime
import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.LinkException
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.emitAll
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

    /** The accounts and agents as last saved on the phone; shown first and while the PC cannot be reached. */
    fun saved(): kotlinx.coroutines.flow.Flow<SavedUsage> = kotlinx.coroutines.flow.emptyFlow()

    /** `usage.get`: every account with the limit windows its agent reported. */
    suspend fun accounts(): Result<List<UsageAccount>>

    /** `usage.refresh`: the open agents ask their plan now; read the accounts again afterwards. */
    suspend fun refresh(): Result<Unit>
    suspend fun history(days: Int): Result<UsageHistory>
    suspend fun agents(): Result<List<AgentInfo>>
    suspend fun guide(): Result<List<ModelGuideAgent>>
}

/** What the usage screen keeps from the last answer of the PC. */
data class SavedUsage(val accounts: List<UsageAccount>?, val agents: List<AgentInfo>?)

class RuntimeUsageBackend(private val runtime: LinkRuntime, private val container: dev.orb.app.AppContainer? = null) : UsageBackend {
    private val api get() = runtime.api
    override val connection get() = runtime.client.connection
    override val events get() = runtime.client.events

    override fun available(m: ApiMethod) = api.available(m)

    private fun bad() = LinkException(LinkError.BadAnswer)

    private companion object {
        const val SNAP_ACCOUNTS = "usage.get"
        const val SNAP_AGENTS = "agents.status"
    }

    override fun saved(): kotlinx.coroutines.flow.Flow<SavedUsage> = kotlinx.coroutines.flow.flow {
        // The database opens in the background; until then there is nothing to show.
        val dao = container?.cacheDao() ?: return@flow
        emitAll(
            kotlinx.coroutines.flow.combine(dao.observeSnapshot(SNAP_ACCOUNTS), dao.observeSnapshot(SNAP_AGENTS)) { accounts, agents ->
                fun parse(json: String?) = json?.let { runCatching { kotlinx.serialization.json.Json.parseToJsonElement(it) }.getOrNull() } as? JsonArray
                SavedUsage(parse(accounts?.json)?.let(UsageParser::accounts), parse(agents?.json)?.let(UsageParser::agents))
            },
        )
    }

    override suspend fun accounts() = api.usage.get().mapCatching {
        if (it !is JsonArray) throw bad()
        container?.cacheSync()?.applySnapshot(SNAP_ACCOUNTS, it)
        UsageParser.accounts(it)
    }

    override suspend fun refresh() = api.usage.refresh().map { }

    override suspend fun history(days: Int) = api.usage.history(buildJsonObject { put("days", days) }).mapCatching { UsageParser.history(it, days) ?: throw bad() }

    override suspend fun agents() = api.agents.status().mapCatching {
        if (it !is JsonArray) throw bad()
        container?.cacheSync()?.applySnapshot(SNAP_AGENTS, it)
        UsageParser.agents(it)
    }

    override suspend fun guide() = api.models.guide().mapCatching {
        if (it !is JsonArray) throw bad()
        UsageParser.guide(it)
    }
}

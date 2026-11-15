package dev.orb.app.ui

import dev.orb.app.AppContainer
import dev.orb.app.LinkRuntime
import dev.orb.app.data.OutboxEntity
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.PairOk
import dev.orb.app.link.net.PcInfo
import dev.orb.app.link.net.ResolvedLink
import dev.orb.app.link.payload.LinkPayload
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.JsonElement

/** What the Welcome screen needs from [dev.orb.app.link.net.Pairing]; an interface so a test can stand in for the PC. */
interface Linker {
    suspend fun resolve(payload: LinkPayload): Result<ResolvedLink>
    suspend fun link(link: ResolvedLink, password: String, deviceName: String): Result<PairOk>
}

/** What the connection-test screen needs from the link, the send queue and the cache. */
interface LinkTestBackend {
    val connection: StateFlow<ConnectionState>
    val events: SharedFlow<LinkEvent>
    val queue: Flow<List<OutboxEntity>>
    val conversationCount: Flow<Int>
    val messageCount: Flow<Int>
    val log: StateFlow<List<String>>

    suspend fun me(): Result<PcInfo>

    /** `app.state`; the answer is also stored in the cache so the counters and the offline viewer see it. */
    suspend fun appState(): Result<JsonElement>

    /** Queues [text] for a new conversation; the sender delivers it when the PC is reachable. */
    suspend fun enqueueNewChat(text: String)

    fun note(line: String)
}

class RuntimeBackend(private val container: AppContainer, private val runtime: LinkRuntime) : LinkTestBackend {
    override val connection get() = runtime.client.connection
    override val events get() = runtime.client.events
    override val log get() = container.log.lines

    // The database opens in the background; until then the screen shows empty counters and queue.
    override val queue: Flow<List<OutboxEntity>> = flow {
        val repo = container.outbox()
        if (repo != null) emitAll(repo.queued())
    }
    override val conversationCount: Flow<Int> = flow {
        val dao = container.cacheDao()
        if (dao != null) emitAll(dao.observeConversationCount())
    }
    override val messageCount: Flow<Int> = flow {
        val dao = container.cacheDao()
        if (dao != null) emitAll(dao.observeMessageCount())
    }

    override suspend fun me() = runtime.client.me()

    override suspend fun appState(): Result<JsonElement> {
        val result = runtime.api.app.state()
        result.getOrNull()?.let { container.cacheSync()?.applySnapshot("app.state", it) }
        return result
    }

    override suspend fun enqueueNewChat(text: String) {
        container.outbox()?.enqueueChat(null, text)
    }

    override fun note(line: String) = container.log.add(line)
}

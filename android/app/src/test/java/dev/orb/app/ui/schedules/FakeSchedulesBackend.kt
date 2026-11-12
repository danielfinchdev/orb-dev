package dev.orb.app.ui.schedules

import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.PcVersions
import dev.orb.app.ui.chats.AgentOption
import dev.orb.app.ui.chats.ModelOption
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull

fun schedule(id: Long, title: String = "Revisar dependencias", enabled: Boolean = true, approved: Boolean = true, readonly: Boolean = false) = ScheduleItem(
    id = id, project = "app-movil", title = title, description = "Mira las dependencias", agent = "any", readonly = readonly,
    every = "weekly", atTime = "09:00", weekdays = listOf(1), enabled = enabled, approved = approved,
    nextRun = "2026-11-16T08:00:00.000Z", lastRun = null, lastTask = null, sameChat = false, whenText = "Cada lunes a las 09:00",
)

class FakeSchedulesBackend(initial: List<ScheduleItem> = emptyList()) : SchedulesBackend {
    val connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Online("http://pc", "PC", PcVersions(1, 1, "3.8.4")))
    override val connection get() = connectionState
    override val events = MutableSharedFlow<LinkEvent>(extraBufferCapacity = 16, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    var items = initial
    var listResult: Result<List<ScheduleItem>>? = null
    var listCount = 0
    var projectNames = listOf("app-movil", "api-pagos")
    var unavailable: Set<String> = emptySet()
    var actionResult: Result<Unit> = Result.success(Unit)
    val calls = ArrayList<String>()

    override fun available(m: ApiMethod) = m.name !in unavailable
    val savedItems = MutableStateFlow<List<ScheduleItem>?>(null)
    override fun saved() = savedItems.filterNotNull()
    var listGate: kotlinx.coroutines.CompletableDeferred<Unit>? = null
    override suspend fun list(): Result<List<ScheduleItem>> { listGate?.await(); listCount++; return listResult ?: Result.success(items) }
    override suspend fun projects() = Result.success(projectNames)
    var agentList: Result<List<AgentOption>> = Result.success(
        listOf(
            AgentOption("claude", "Claude", null, listOf(ModelOption("opus", "Opus", true, emptyList()), ModelOption("sonnet", "Sonnet", false, emptyList()))),
            AgentOption("codex", "Codex", null, emptyList()),
        ),
    )
    override suspend fun agents() = agentList

    override suspend fun create(s: NewSchedule): Result<Unit> {
        calls += "create ${s.project}|${s.title}|${s.every}|${s.atTime}|${s.weekdays}|${s.hours}|${s.readonly}|${s.agent}|${s.model}"
        return actionResult
    }

    override suspend fun update(id: Long, enabled: Boolean?, approve: Boolean, title: String?, description: String?): Result<Unit> {
        calls += "update $id enabled=$enabled approve=$approve title=$title description=$description"
        return actionResult
    }

    override suspend fun run(id: Long): Result<Unit> { calls += "run $id"; return actionResult }
}

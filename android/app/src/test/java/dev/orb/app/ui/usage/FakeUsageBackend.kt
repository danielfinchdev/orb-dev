package dev.orb.app.ui.usage

import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.PcVersions
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow

fun account(id: String = "claude", utilization: Double = 0.4, resetAt: Long? = null) = UsageAccount(
    account = id, agent = "claude", label = "Claude", plan = "Max", windows = listOf(UsageWindow("five_hour", utilization, resetAt)),
    used = null, max = null, cooldownUntil = null, cooldownReason = null,
)

fun sampleHistory(days: Int = 30, usd: Double = 12.5) = UsageHistory(
    days = days, usd = usd, tokensIn = 2_500_000, tokensOut = 40_000, turns = 120,
    byDay = listOf(DaySpend("2026-11-10", 5.0, 1000), DaySpend("2026-11-11", 7.5, 2000)),
    byAgent = listOf(AgentSpend("claude", usd, 3000)),
)

class FakeUsageBackend : UsageBackend {
    val connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Online("http://pc", "PC", PcVersions(1, 1, "3.8.4")))
    override val connection get() = connectionState
    override val events = MutableSharedFlow<LinkEvent>(extraBufferCapacity = 16, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    var unavailable: Set<String> = emptySet()
    var accountList: Result<List<UsageAccount>> = Result.success(listOf(account()))
    var historyResult: (Int) -> Result<UsageHistory> = { Result.success(sampleHistory(it)) }
    var agentList: Result<List<AgentInfo>> = Result.success(
        listOf(AgentInfo("claude", "Claude Code", true, true, "2.1.0", "si"), AgentInfo("codex", "Codex", false, false, null, "no")),
    )
    var guideList: Result<List<ModelGuideAgent>> = Result.success(
        listOf(
            ModelGuideAgent(
                "claude", "Claude Code", listOf("light" to listOf("Haiku"), "heavy" to listOf("Opus")),
                listOf(ModelPick("simple", "Haiku", "low"), ModelPick("normal", "Sonnet", "medium"), ModelPick("complejo", "Opus", "high")),
            ),
        ),
    )
    var refreshResult: Result<Unit> = Result.success(Unit)
    val calls = ArrayList<String>()
    /** Per-range gates: a history read for that range waits until the gate opens. */
    val historyGates = HashMap<Int, kotlinx.coroutines.CompletableDeferred<Unit>>()

    override fun available(m: ApiMethod) = m.name !in unavailable
    override suspend fun accounts(): Result<List<UsageAccount>> { calls += "accounts"; return accountList }
    override suspend fun refresh(): Result<Unit> { calls += "refresh"; return refreshResult }
    override suspend fun history(days: Int): Result<UsageHistory> { calls += "history $days"; historyGates[days]?.await(); return historyResult(days) }
    override suspend fun agents() = agentList
    override suspend fun guide() = guideList
}

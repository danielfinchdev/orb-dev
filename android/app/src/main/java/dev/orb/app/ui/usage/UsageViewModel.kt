package dev.orb.app.ui.usage

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.linkErrorText
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** What one read gave: the last good answer stays on screen when a later one fails. */
@Immutable
data class Section<T>(val data: T? = null, val failed: Boolean = false, val answered: Boolean = false)

@Immutable
data class UsageState(
    val accounts: Section<List<UsageAccount>> = Section(),
    val history: Section<UsageHistory> = Section(),
    val agents: Section<List<AgentInfo>> = Section(),
    val guide: Section<List<ModelGuideAgent>> = Section(),
    val days: Int = 30,
    val online: Boolean = false,
    val refreshing: Boolean = false,
    /** «Actualizar» is under way: the agents are being asked for their plan. */
    val updating: Boolean = false,
    val canUsage: Boolean = false,
    val canHistory: Boolean = false,
    val canAgents: Boolean = false,
    val canGuide: Boolean = false,
) {
    val loaded get() = accounts.answered || history.answered || agents.answered || guide.answered
    val allFailed get() = !loaded && (accounts.failed || history.failed || agents.failed || guide.failed)
}

class UsageViewModel(private val backend: UsageBackend) : ViewModel() {
    private data class Ui(val days: Int = 30, val refreshing: Boolean = false, val updating: Boolean = false)

    private val accounts = MutableStateFlow(Section<List<UsageAccount>>())
    private val history = MutableStateFlow(Section<UsageHistory>())
    private val agents = MutableStateFlow(Section<List<AgentInfo>>())
    private val guide = MutableStateFlow(Section<List<ModelGuideAgent>>())
    private val ui = MutableStateFlow(Ui())
    private val _messages = Channel<String>(Channel.BUFFERED)
    val messages = _messages.receiveAsFlow()

    private data class Sections(
        val a: Section<List<UsageAccount>>, val h: Section<UsageHistory>, val g: Section<List<AgentInfo>>, val m: Section<List<ModelGuideAgent>>,
    )

    val state: StateFlow<UsageState> = combine(
        combine(accounts, history, agents, guide) { a, h, g, m -> Sections(a, h, g, m) }, ui, backend.connection,
    ) { s, u, c ->
        UsageState(
            accounts = s.a, history = s.h, agents = s.g, guide = s.m, days = u.days, online = c is ConnectionState.Online,
            refreshing = u.refreshing, updating = u.updating,
            canUsage = backend.available(ApiMethods.USAGE_GET), canHistory = backend.available(ApiMethods.USAGE_HISTORY),
            canAgents = backend.available(ApiMethods.AGENTS_STATUS), canGuide = backend.available(ApiMethods.MODELS_GUIDE),
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), UsageState())

    init {
        viewModelScope.launch {
            backend.connection.map { it is ConnectionState.Online }.distinctUntilChanged().filter { it }.collect { reload() }
        }
    }

    private var reading = false
    private var historyJob: Job? = null

    private fun <T> MutableStateFlow<Section<T>>.take(r: Result<T>) = update { old ->
        Section(r.getOrNull() ?: old.data, r.isFailure, old.answered || r.isSuccess)
    }

    private suspend fun readAccounts() { if (backend.available(ApiMethods.USAGE_GET)) accounts.take(backend.accounts()) }

    private suspend fun reload() {
        reading = true
        ui.update { it.copy(refreshing = true) }
        coroutineScope {
            launch { readAccounts() }
            launch { readHistory(ui.value.days) }
            launch { if (backend.available(ApiMethods.AGENTS_STATUS)) agents.take(backend.agents()) }
            launch { if (backend.available(ApiMethods.MODELS_GUIDE)) guide.take(backend.guide()) }
        }
        reading = false
        ui.update { it.copy(refreshing = false) }
    }

    /** An answer for a range the person has already left is dropped, so it never overwrites the current one. */
    private suspend fun readHistory(days: Int) {
        if (!backend.available(ApiMethods.USAGE_HISTORY)) return
        val r = backend.history(days)
        if (days == ui.value.days) history.take(r)
    }

    /** Pull to refresh and the first read; a read already under way is not repeated. */
    fun refresh() {
        if (reading) return
        reading = true
        viewModelScope.launch { reload() }
    }

    fun setDays(days: Int) {
        if (days == ui.value.days) return
        ui.update { it.copy(days = days) }
        historyJob?.cancel()
        historyJob = viewModelScope.launch { readHistory(days) }
    }

    /** «Actualizar»: the agents are asked for their plan again, then the accounts are read. */
    fun update() {
        if (ui.value.updating) return
        if (backend.connection.value !is ConnectionState.Online) {
            _messages.trySend(UsageTexts.ACTION_OFFLINE)
            return
        }
        if (!backend.available(ApiMethods.USAGE_REFRESH)) {
            refresh()
            return
        }
        ui.update { it.copy(updating = true) }
        viewModelScope.launch {
            val r = backend.refresh()
            readAccounts()
            ui.update { it.copy(updating = false) }
            _messages.trySend(if (r.isSuccess) UsageTexts.UPDATED else "${UsageTexts.ACTION_FAILED}. ${linkErrorText(r.exceptionOrNull()!!)}")
        }
    }
}

package dev.orb.app.ui.menu

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.linkErrorText
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class ActivityTab { Activity, Logs }

@Immutable
data class OpenLog(val name: String, val text: String? = null, val failed: String? = null)

@Immutable
data class ActivityState(
    val tab: ActivityTab = ActivityTab.Activity,
    val events: List<ActivityEvent>? = null,
    val logs: List<LogInfo>? = null,
    val eventsFailed: Boolean = false,
    val logsFailed: Boolean = false,
    val canActivity: Boolean = false,
    val canLogs: Boolean = false,
    val online: Boolean = false,
    val refreshing: Boolean = false,
    val log: OpenLog? = null,
)

/** Plain reading of the PC's activity and logbooks; nothing here changes anything on the PC. */
class ActivityViewModel(private val backend: ActivityBackend, private val limit: Int = 100) : ViewModel() {
    private data class Ui(
        val tab: ActivityTab = ActivityTab.Activity, val events: List<ActivityEvent>? = null, val logs: List<LogInfo>? = null,
        val eventsFailed: Boolean = false, val logsFailed: Boolean = false, val refreshing: Boolean = false, val log: OpenLog? = null,
    )

    private val ui = MutableStateFlow(Ui())

    val state: StateFlow<ActivityState> = combine(ui, backend.connection) { u, c ->
        val canA = backend.available(ApiMethods.ACTIVITY_LIST)
        val canL = backend.available(ApiMethods.LOGS_LIST) && backend.available(ApiMethods.LOGS_READ)
        // The tab that has nothing behind it falls back to the other one.
        val tab = if (u.tab == ActivityTab.Activity && !canA && canL) ActivityTab.Logs else u.tab
        ActivityState(tab, u.events, u.logs, u.eventsFailed, u.logsFailed, canA, canL, c is ConnectionState.Online, u.refreshing, u.log)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ActivityState())

    init {
        viewModelScope.launch {
            backend.connection.map { it is ConnectionState.Online }.distinctUntilChanged().filter { it }.collect { reload() }
        }
    }

    private var reading = false

    private suspend fun reload() {
        reading = true
        ui.update { it.copy(refreshing = true) }
        if (backend.available(ApiMethods.ACTIVITY_LIST)) {
            val r = backend.events(limit)
            ui.update { it.copy(events = r.getOrNull() ?: it.events, eventsFailed = r.isFailure) }
        }
        if (backend.available(ApiMethods.LOGS_LIST)) {
            val r = backend.logs()
            ui.update { it.copy(logs = r.getOrNull() ?: it.logs, logsFailed = r.isFailure) }
        }
        reading = false
        ui.update { it.copy(refreshing = false) }
    }

    fun refresh() {
        if (reading) return
        reading = true
        viewModelScope.launch { reload() }
    }

    fun setTab(t: ActivityTab) = ui.update { it.copy(tab = t, log = null) }

    fun openLog(l: LogInfo) {
        ui.update { it.copy(log = OpenLog(l.name)) }
        viewModelScope.launch {
            val r = backend.readLog(l.name)
            ui.update { u ->
                if (u.log?.name != l.name) u
                else u.copy(log = OpenLog(l.name, r.getOrNull(), r.exceptionOrNull()?.let(::linkErrorText)))
            }
        }
    }

    fun closeLog() = ui.update { it.copy(log = null) }
}

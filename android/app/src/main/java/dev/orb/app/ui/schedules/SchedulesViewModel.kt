package dev.orb.app.ui.schedules

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.chats.AgentOption
import dev.orb.app.ui.linkErrorText
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The create/edit dialog. [editing] is null for a new schedule. */
@Immutable
data class ScheduleForm(
    val editing: ScheduleItem? = null,
    val projects: List<String> = emptyList(),
    /** Empty while loading or when the PC did not answer: the form then offers only «any agent». */
    val agents: List<AgentOption> = emptyList(),
    val saving: Boolean = false,
    val error: String? = null,
)

@Immutable
data class SchedulesState(
    val items: List<ScheduleItem> = emptyList(),
    val online: Boolean = false,
    val loaded: Boolean = false,
    val refreshing: Boolean = false,
    val loadFailed: Boolean = false,
    val busy: Boolean = false,
    val canCreate: Boolean = false,
    val canUpdate: Boolean = false,
    val canRun: Boolean = false,
    val form: ScheduleForm? = null,
)

@OptIn(FlowPreview::class)
class SchedulesViewModel(
    private val backend: SchedulesBackend,
    private val reloadDebounceMs: Long = 300,
) : ViewModel() {
    private data class Ui(
        val refreshing: Boolean = false,
        val failed: Boolean = false,
        val answered: Boolean = false,
        val busy: Boolean = false,
        val form: ScheduleForm? = null,
    )

    private val items = MutableStateFlow<List<ScheduleItem>>(emptyList())
    private val ui = MutableStateFlow(Ui())
    private val reloads = Channel<Unit>(Channel.CONFLATED)
    private val _messages = Channel<String>(Channel.BUFFERED)
    val messages = _messages.receiveAsFlow()

    val state: StateFlow<SchedulesState> = combine(items, ui, backend.connection) { list, u, c ->
        SchedulesState(
            items = list, online = c is ConnectionState.Online, loaded = list.isNotEmpty() || u.answered,
            refreshing = u.refreshing, loadFailed = u.failed, busy = u.busy,
            canCreate = backend.available(ApiMethods.SCHEDULES_CREATE),
            canUpdate = backend.available(ApiMethods.SCHEDULES_UPDATE),
            canRun = backend.available(ApiMethods.SCHEDULES_RUN),
            form = u.form,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SchedulesState())

    init {
        // What was saved shows first; once the PC has answered, its answer is the truth.
        viewModelScope.launch { backend.saved().collect { saved -> if (!ui.value.answered) items.update { saved } } }
        viewModelScope.launch { reloads.receiveAsFlow().debounce(reloadDebounceMs).collect { reload() } }
        viewModelScope.launch { backend.events.collect { if (it.name in RELOAD_EVENTS) reloads.trySend(Unit) } }
        viewModelScope.launch {
            backend.connection.map { it is ConnectionState.Online }.distinctUntilChanged().filter { it }.collect { reload() }
        }
    }

    // Set when a read is asked for, before its coroutine starts, so two quick pulls make one read.
    private var reading = false

    private suspend fun reload() {
        reading = true
        ui.update { it.copy(refreshing = true) }
        val r = backend.list()
        reading = false
        r.getOrNull()?.let { fresh -> items.update { fresh } }
        ui.update { it.copy(refreshing = false, failed = r.isFailure, answered = it.answered || r.isSuccess) }
    }

    fun refresh() {
        if (reading) return
        reading = true
        viewModelScope.launch { reload() }
    }

    private fun offline() = backend.connection.value !is ConnectionState.Online

    private fun act(success: String, call: suspend () -> Result<Unit>) {
        if (ui.value.busy) return
        if (offline()) { _messages.trySend(SchedulesTexts.ACTION_OFFLINE); return }
        ui.update { it.copy(busy = true) }
        viewModelScope.launch {
            val r = call()
            ui.update { it.copy(busy = false) }
            if (r.isSuccess) {
                _messages.trySend(success)
                reload()
            } else _messages.trySend("${SchedulesTexts.ACTION_FAILED}. ${linkErrorText(r.exceptionOrNull()!!)}")
        }
    }

    /** The screen asks for the confirmation before turning a schedule off; turning on needs none. */
    fun setEnabled(s: ScheduleItem, enabled: Boolean) {
        if (!backend.available(ApiMethods.SCHEDULES_UPDATE)) return
        act(if (enabled) SchedulesTexts.TURNED_ON else SchedulesTexts.TURNED_OFF) { backend.update(s.id, enabled = enabled) }
    }

    fun approve(s: ScheduleItem) {
        if (!backend.available(ApiMethods.SCHEDULES_UPDATE)) return
        act(SchedulesTexts.APPROVED) { backend.update(s.id, approve = true) }
    }

    /** The screen asks for the confirmation first. */
    fun run(s: ScheduleItem) {
        if (!backend.available(ApiMethods.SCHEDULES_RUN)) return
        act(SchedulesTexts.RUN_DONE) { backend.run(s.id) }
    }

    fun openNew() {
        if (!backend.available(ApiMethods.SCHEDULES_CREATE)) return
        ui.update { it.copy(form = ScheduleForm()) }
        viewModelScope.launch {
            val names = backend.projects().getOrDefault(emptyList())
            ui.update { u -> u.copy(form = u.form?.takeIf { it.editing == null }?.copy(projects = names) ?: u.form) }
        }
        viewModelScope.launch {
            val agents = backend.agents().getOrDefault(emptyList())
            ui.update { u -> u.copy(form = u.form?.takeIf { it.editing == null }?.copy(agents = agents) ?: u.form) }
        }
    }

    fun openEdit(s: ScheduleItem) {
        if (backend.available(ApiMethods.SCHEDULES_UPDATE)) ui.update { it.copy(form = ScheduleForm(editing = s)) }
    }

    fun closeForm() = ui.update { it.copy(form = null) }

    fun create(s: NewSchedule) {
        val f = ui.value.form ?: return
        if (f.saving || s.title.isBlank() || s.description.isBlank() || s.project.isBlank()) return
        submit(f, SchedulesTexts.CREATED) { backend.create(s.copy(title = s.title.trim(), description = s.description.trim())) }
    }

    fun saveEdit(title: String, description: String) {
        val f = ui.value.form ?: return
        val s = f.editing ?: return
        if (f.saving || title.isBlank() || description.isBlank()) return
        submit(f, SchedulesTexts.SAVED) { backend.update(s.id, title = title.trim(), description = description.trim()) }
    }

    private fun submit(f: ScheduleForm, success: String, call: suspend () -> Result<Unit>) {
        if (offline()) {
            ui.update { it.copy(form = f.copy(error = SchedulesTexts.ACTION_OFFLINE)) }
            return
        }
        ui.update { it.copy(form = f.copy(saving = true, error = null)) }
        viewModelScope.launch {
            val r = call()
            if (r.isSuccess) {
                ui.update { it.copy(form = null) }
                _messages.trySend(success)
                reload()
            } else ui.update { u -> u.copy(form = u.form?.copy(saving = false, error = linkErrorText(r.exceptionOrNull()!!))) }
        }
    }

    private companion object {
        val RELOAD_EVENTS = setOf("board:changed", "config:changed")
    }
}

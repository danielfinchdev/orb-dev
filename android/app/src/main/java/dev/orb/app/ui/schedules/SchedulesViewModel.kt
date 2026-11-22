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

/** The create/edit sheet. [editing] is null for a new schedule. */
@Immutable
data class ScheduleForm(
    val editing: ScheduleItem? = null,
    val projects: List<String> = emptyList(),
    /** Empty while loading or when the PC did not answer: the form then offers only «any agent». */
    val agents: List<AgentOption> = emptyList(),
    val saving: Boolean = false,
    val error: String? = null,
)

/**
 * The approval dialog: what is about to be approved, as the PC has it now. [item] starts as the row the person tapped and
 * is replaced by the PC's own copy once it is read; nothing is approved while [loading] or after a read that [failed].
 */
@Immutable
data class ScheduleApproval(
    val item: ScheduleItem,
    val loading: Boolean = true,
    val failed: Boolean = false,
    /** The PC's copy differs from the row the person tapped. */
    val changed: Boolean = false,
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
    /** The PC takes the monthly day, the zone, the phone notice and the permission level of a schedule. */
    val pcFields: Boolean = false,
    /** Task id of a last run to its status on the PC. */
    val outcomes: Map<Long, String> = emptyMap(),
    val form: ScheduleForm? = null,
    val approval: ScheduleApproval? = null,
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
        val outcomes: Map<Long, String> = emptyMap(),
        val form: ScheduleForm? = null,
        val approval: ScheduleApproval? = null,
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
            // These fields came with the PC that lists «chat.editQueued»; an older one would drop them without a word.
            pcFields = backend.available(ApiMethods.CHAT_EDIT_QUEUED),
            outcomes = u.outcomes, form = u.form, approval = u.approval,
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
        val fresh = r.getOrNull() ?: return
        ui.update { it.copy(approval = it.approval?.let { a -> followApproval(a, fresh) }) }
        if (fresh.any { it.lastTask != null }) backend.outcomes().getOrNull()?.let { o -> ui.update { it.copy(outcomes = o) } }
    }

    // An approval dialog that is open follows the PC: a schedule that changed shows its new text, one that is gone or
    // already approved closes the dialog.
    private fun followApproval(a: ScheduleApproval, fresh: List<ScheduleItem>): ScheduleApproval? {
        if (a.loading) return a
        val now = fresh.firstOrNull { it.id == a.item.id }
        return when {
            now == null || now.approved -> null
            now != a.item -> a.copy(item = now, changed = true)
            else -> a
        }
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
        act(if (enabled) SchedulesTexts.TURNED_ON else SchedulesTexts.TURNED_OFF) { backend.update(s.id, SchedulePatch(enabled = enabled)) }
    }

    /**
     * Opens the approval dialog and reads the schedule again from the PC: what the person approves is what the PC has now,
     * not what the list showed some minutes ago. There is no way to approve without this dialog.
     */
    fun openApproval(s: ScheduleItem) {
        if (!backend.available(ApiMethods.SCHEDULES_UPDATE) || s.approved) return
        ui.update { it.copy(approval = ScheduleApproval(s)) }
        viewModelScope.launch {
            val r = backend.list()
            val open = ui.value.approval?.takeIf { it.item.id == s.id } ?: return@launch
            val fresh = r.getOrNull()
            if (fresh == null) {
                ui.update { it.copy(approval = open.copy(loading = false, failed = true)) }
                return@launch
            }
            items.update { fresh }
            val now = fresh.firstOrNull { it.id == s.id }
            when {
                now == null -> { ui.update { it.copy(approval = null) }; _messages.trySend(SchedulesTexts.APPROVE_GONE) }
                now.approved -> { ui.update { it.copy(approval = null) }; _messages.trySend(SchedulesTexts.APPROVE_ALREADY) }
                else -> ui.update { it.copy(approval = ScheduleApproval(now, loading = false, changed = now != s)) }
            }
        }
    }

    fun closeApproval() = ui.update { it.copy(approval = null) }

    /** Approves what the dialog shows; nothing happens while it is still reading or could not read. */
    fun confirmApproval() {
        val a = ui.value.approval ?: return
        if (a.loading || a.failed || !backend.available(ApiMethods.SCHEDULES_UPDATE)) return
        if (ui.value.busy) return
        ui.update { it.copy(approval = null) }
        act(SchedulesTexts.APPROVED) { backend.update(a.item.id, SchedulePatch(approve = true, hash = a.item.previewHash)) }
    }

    /** The screen asks for the confirmation first. */
    fun run(s: ScheduleItem) {
        if (!backend.available(ApiMethods.SCHEDULES_RUN)) return
        act(SchedulesTexts.RUN_DONE) { backend.run(s.id, if (s.approved) null else s.previewHash) }
    }

    fun openNew() {
        if (!backend.available(ApiMethods.SCHEDULES_CREATE)) return
        openForm(ScheduleForm())
    }

    fun openEdit(s: ScheduleItem) {
        if (backend.available(ApiMethods.SCHEDULES_UPDATE)) openForm(ScheduleForm(editing = s))
    }

    // The projects and the agents arrive after the sheet is open; the answer goes to the form that asked for it.
    private fun openForm(form: ScheduleForm) {
        ui.update { it.copy(form = form) }
        val key = form.editing?.id
        fun same(f: ScheduleForm?) = f != null && f.editing?.id == key
        viewModelScope.launch {
            val names = backend.projects().getOrDefault(emptyList())
            ui.update { u -> u.copy(form = u.form?.takeIf(::same)?.copy(projects = names) ?: u.form) }
        }
        viewModelScope.launch {
            val agents = backend.agents().getOrDefault(emptyList())
            ui.update { u -> u.copy(form = u.form?.takeIf(::same)?.copy(agents = agents) ?: u.form) }
        }
    }

    fun closeForm() = ui.update { it.copy(form = null) }

    fun create(s: NewSchedule) {
        val f = ui.value.form ?: return
        if (f.saving || s.title.isBlank() || s.description.isBlank() || s.project.isBlank()) return
        submit(f, SchedulesTexts.CREATED) { backend.create(s.copy(title = s.title.trim(), description = s.description.trim())) }
    }

    /** [patch] holds only what the person changed; with nothing changed the sheet just closes. */
    fun saveEdit(patch: SchedulePatch) {
        val f = ui.value.form ?: return
        val s = f.editing ?: return
        if (f.saving) return
        if (patch.title?.isBlank() == true || patch.description?.isBlank() == true) return
        if (patch.isEmpty) { closeForm(); return }
        submit(f, SchedulesTexts.SAVED) { backend.update(s.id, patch) }
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

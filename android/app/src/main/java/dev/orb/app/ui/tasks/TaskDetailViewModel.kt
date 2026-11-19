package dev.orb.app.ui.tasks

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.chats.ChatErrors
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

/** What the person can do with a task now; only what the PC lists and the task's state allow. */
enum class TaskAction { Approve, AcceptHeld, UndoHeld, LaunchAnyway, Reassign, Followup, Retry, Cancel, Review, SeeChanges }

@Immutable
data class TaskDetailState(
    val detail: TaskDetail? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val online: Boolean = false,
    /** A request is on its way to the PC: every action waits, so a second tap does nothing. */
    val busy: Boolean = false,
    val actions: Set<TaskAction> = emptySet(),
    val agents: List<AgentChoice>? = null,
    /** An event of the PC arrived and the task has not been read again yet: what the screen shows may be older than the PC's word. */
    val reloading: Boolean = false,
)

object TaskActions {
    private val CANCELLABLE = setOf("queued", "running", "awaiting_approval")
    private val RETRYABLE = setOf("failed", "blocked", "cancelled", "limited")
    private val REASSIGNABLE = setOf("queued", "awaiting_approval", "failed", "blocked", "cancelled", "limited")

    fun of(d: TaskDetail, can: (dev.orb.app.link.api.ApiMethod) -> Boolean): Set<TaskAction> {
        val r = d.row
        val out = LinkedHashSet<TaskAction>()
        val held = r.held != null
        if (r.status == "awaiting_approval" && !d.previewHash.isNullOrEmpty() && can(ApiMethods.TASKS_APPROVE)) out += TaskAction.Approve
        if (held && can(ApiMethods.TASKS_ACCEPT)) out += TaskAction.AcceptHeld
        if (held && d.hasCheckpoint && can(ApiMethods.TASKS_UNDO)) out += TaskAction.UndoHeld
        // «Iniciar de todos modos» cannot start one that waits for other tasks: the PC says which.
        if (r.status == "queued" && r.waiting != null && r.waiting.kind != "deps" && can(ApiMethods.TASKS_LAUNCH_ANYWAY)) out += TaskAction.LaunchAnyway
        if (r.status in REASSIGNABLE && can(ApiMethods.TASKS_REASSIGN)) out += TaskAction.Reassign
        if (r.status != "cancelled" && can(ApiMethods.TASKS_FOLLOWUP)) out += TaskAction.Followup
        if (!held && r.status in RETRYABLE && can(ApiMethods.TASKS_RETRY)) out += TaskAction.Retry
        if (r.status in CANCELLABLE && can(ApiMethods.TASKS_CANCEL)) out += TaskAction.Cancel
        if (r.status == "done" && can(ApiMethods.TASKS_REVIEW)) out += TaskAction.Review
        if (d.hasCheckpoint && !r.undone && (r.status == "done" || held) && can(ApiMethods.TASKS_DIFF)) out += TaskAction.SeeChanges
        return out
    }
}

/**
 * One task: why it waits, what it did and what the person can decide. Each action is a request to the PC; the screen
 * shows the PC's answer after reading the task again.
 */
@OptIn(FlowPreview::class)
class TaskDetailViewModel(
    private val backend: TasksBackend,
    val id: Long,
    private val reloadDebounceMs: Long = 300,
) : ViewModel() {
    private data class Ui(
        val detail: TaskDetail? = null, val loading: Boolean = true, val error: String? = null, val busy: Boolean = false,
        val agents: List<AgentChoice>? = null, val pending: Boolean = false,
    )

    private val ui = MutableStateFlow(Ui())
    private val reloads = Channel<Unit>(Channel.CONFLATED)
    private val _messages = Channel<String>(Channel.BUFFERED)
    private var eventStamp = 0

    val messages = _messages.receiveAsFlow()

    val state: StateFlow<TaskDetailState> = combine(ui, backend.connection) { u, c ->
        TaskDetailState(
            detail = u.detail, loading = u.loading, error = u.error, online = c is ConnectionState.Online, busy = u.busy,
            actions = u.detail?.let { TaskActions.of(it, backend::available) }.orEmpty(), agents = u.agents, reloading = u.pending,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), TaskDetailState())

    init {
        viewModelScope.launch { reloads.receiveAsFlow().debounce(reloadDebounceMs).collect { load() } }
        viewModelScope.launch {
            backend.events.collect {
                if (it.name in RELOAD_EVENTS) {
                    // The decisions go off at once, not after the wait: during it the screen still shows what the PC has left behind.
                    eventStamp++
                    ui.update { u -> u.copy(pending = true) }
                    reloads.trySend(Unit)
                }
            }
        }
        viewModelScope.launch {
            backend.connection.map { it is ConnectionState.Online }.distinctUntilChanged().filter { it }.collect { load() }
        }
    }

    private suspend fun load() {
        val stamp = eventStamp
        val r = backend.get(id)
        ui.update { u ->
            // An event that came while this read was under way asks for another one: until it is done this is not final.
            val pending = eventStamp != stamp
            r.fold(
                onSuccess = { Ui(it, loading = false, error = null, busy = u.busy, agents = u.agents, pending = pending) },
                // What was on screen stays: only a first read that fails shows the error.
                onFailure = { u.copy(loading = false, error = if (u.detail == null) linkErrorText(it) else null, pending = pending) },
            )
        }
    }

    fun refresh() {
        viewModelScope.launch { load() }
    }

    private fun act(done: String?, call: suspend () -> Result<*>) {
        if (ui.value.busy) return
        if (backend.connection.value !is ConnectionState.Online) {
            _messages.trySend(TaskTexts.ACTION_OFFLINE)
            return
        }
        ui.update { it.copy(busy = true) }
        viewModelScope.launch {
            val r = call()
            ui.update { it.copy(busy = false) }
            if (r.isSuccess) {
                done?.let { _messages.trySend(it) }
            } else {
                _messages.trySend(failureText(r.exceptionOrNull()!!))
            }
            // A refusal means the task is not what the screen showed: it is drawn again from the PC's answer.
            load()
        }
    }

    private fun allowed(a: TaskAction) = ui.value.detail?.let { a in TaskActions.of(it, backend::available) } == true

    /** The decisions that touch the person's work wait for the read an event of the PC asked for. */
    private fun settled() = !ui.value.pending

    /**
     * [shownHash] is the fingerprint of what the screen painted when the person tapped: the PC refuses the OK if the task
     * changed since. Without it, the one captured by [askReject] for a rejection, and last the current one.
     */
    fun approve(approve: Boolean, shownHash: String? = null) {
        val hash = shownHash ?: rejectHash?.takeIf { !approve } ?: ui.value.detail?.previewHash ?: return
        rejectHash = null
        if (!allowed(TaskAction.Approve) || !settled()) return
        act(if (approve) TaskTexts.APPROVED else TaskTexts.REJECTED) { backend.decide(id, approve, hash) }
    }

    private var rejectHash: String? = null

    /** The reject dialog opens on the fingerprint shown now; that one goes back with the yes. */
    fun askReject() {
        rejectHash = ui.value.detail?.previewHash
    }

    /**
     * «Aceptar» keeps the work of a task Orb held. What the screen shows may be older than the PC's last word on it, so the task is
     * read again first and nothing is accepted if the hold, the point of return or the state is not what the person was looking at.
     */
    fun accept() {
        if (!allowed(TaskAction.AcceptHeld) || !settled()) return
        val shown = ui.value.detail ?: return
        act(TaskTexts.ACCEPTED) {
            backend.get(id).fold(
                onSuccess = { fresh ->
                    val same = fresh.row.status == shown.row.status && fresh.row.held == shown.row.held && fresh.checkpointId == shown.checkpointId
                    if (!same || TaskAction.AcceptHeld !in TaskActions.of(fresh, backend::available)) Result.failure(Stale(TaskTexts.ACCEPT_CHANGED))
                    else backend.accept(id, shown.checkpointId)
                },
                onFailure = { Result.failure(it) },
            )
        }
    }

    private class Stale(message: String) : Exception(message)

    private fun failureText(e: Throwable): String =
        (e as? Stale)?.message ?: ChatErrors.pcText(e) ?: "${TaskTexts.ACTION_FAILED}. ${linkErrorText(e)}"

    private var undoAsked = false
    private var undoCheckpoint: String? = null

    /** The dialog opens on the point of return shown now; that one goes back with the yes. */
    fun askUndo() {
        undoAsked = true
        undoCheckpoint = ui.value.detail?.checkpointId
    }

    /** The screen asks first; this is only called after the person accepted the dialog. */
    fun undo() {
        if (!allowed(TaskAction.UndoHeld) || !settled()) return
        val checkpoint = if (undoAsked) undoCheckpoint else ui.value.detail?.checkpointId
        undoAsked = false
        act(TaskTexts.UNDO_DONE) { backend.undo(id, checkpoint) }
    }

    fun launchAnyway() {
        if (!allowed(TaskAction.LaunchAnyway)) return
        if (ui.value.busy) return
        if (backend.connection.value !is ConnectionState.Online) {
            _messages.trySend(TaskTexts.ACTION_OFFLINE)
            return
        }
        ui.update { it.copy(busy = true) }
        viewModelScope.launch {
            val r = backend.launchAnyway(id)
            ui.update { it.copy(busy = false) }
            r.fold(
                onSuccess = { stillPaused ->
                    _messages.trySend(if (stillPaused) TaskTexts.LAUNCH_PAUSED_NOTE else TaskTexts.LAUNCH_STARTED)
                    load()
                },
                onFailure = { _messages.trySend("${TaskTexts.ACTION_FAILED}. ${linkErrorText(it)}") },
            )
        }
    }

    fun retry() {
        if (!allowed(TaskAction.Retry)) return
        act(TaskTexts.RETRY_DONE) { backend.retry(id) }
    }

    /** The screen asks first; this is only called after the person accepted the dialog. */
    fun cancel() {
        if (!allowed(TaskAction.Cancel)) return
        act(TaskTexts.CANCELLED) { backend.cancel(id) }
    }

    fun review() {
        if (!allowed(TaskAction.Review)) return
        act(TaskTexts.REVIEW_DONE) { backend.review(id) }
    }

    fun followup(text: String) {
        val t = text.trim()
        if (t.isEmpty() || !allowed(TaskAction.Followup)) return
        act(TaskTexts.FOLLOWUP_SENT) { backend.followup(id, t) }
    }

    fun reassign(agent: String, reasoning: String) {
        if (!allowed(TaskAction.Reassign)) return
        act(TaskTexts.REASSIGNED) { backend.reassign(id, agent, reasoning) }
    }

    /** The agents the PC offers, read when the reassign dialog opens. */
    fun loadAgents() {
        if (ui.value.agents != null) return
        viewModelScope.launch {
            // A failed read is not stored, so opening the dialog again tries again.
            backend.agents().onSuccess { list -> ui.update { it.copy(agents = list) } }
        }
    }

    private companion object {
        val RELOAD_EVENTS = setOf("board:changed", "approval:changed")
    }
}

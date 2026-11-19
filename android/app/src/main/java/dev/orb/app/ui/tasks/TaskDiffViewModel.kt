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
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@Immutable
data class TaskDiffState(
    val id: Long,
    val title: String? = null,
    val diff: TaskDiff? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val online: Boolean = false,
    val busy: Boolean = false,
    val accepted: Boolean = false,
    val canAccept: Boolean = false,
    val canUndo: Boolean = false,
)

/**
 * What a task changed, file by file. The patches arrive with the list; only the file on screen is turned into lines.
 * «Aceptar» and «Deshacer» are requests to the PC; a second tap while one is on its way does nothing.
 */
@OptIn(FlowPreview::class)
class TaskDiffViewModel(
    private val backend: TasksBackend,
    val id: Long,
    private val reloadDebounceMs: Long = 300,
) : ViewModel() {
    /** [stale]: the last read failed, so what is on screen may be older than the PC's word: nothing can be decided from it. */
    private data class Ui(
        val detail: TaskDetail? = null, val diff: TaskDiff? = null, val loading: Boolean = true,
        val error: String? = null, val busy: Boolean = false, val stale: Boolean = false,
    )

    private val ui = MutableStateFlow(Ui())
    private val reloads = Channel<Unit>(Channel.CONFLATED)
    private var loadSeq = 0
    private val _messages = Channel<String>(Channel.BUFFERED)

    val messages = _messages.receiveAsFlow()

    private fun build(u: Ui, c: ConnectionState): TaskDiffState {
        val d = u.detail
        val held = d?.row?.held != null
        // Accepting or undoing is only offered on a diff that is up to date: while it is read again, or after a failed read,
        // the person could be deciding on a run nobody has seen.
        val fresh = !u.loading && !u.stale
        return TaskDiffState(
            id = id, title = d?.row?.title, diff = u.diff, loading = u.loading, error = u.error, online = c is ConnectionState.Online,
            busy = u.busy, accepted = d?.accepted == true,
            canAccept = fresh && d != null && !d.accepted && (held || d.row.status == "done") && backend.available(ApiMethods.TASKS_ACCEPT),
            canUndo = fresh && d != null && d.hasCheckpoint && !d.row.undone && (held || d.row.status == "done") && backend.available(ApiMethods.TASKS_UNDO),
        )
    }

    val state: StateFlow<TaskDiffState> = combine(ui, backend.connection, ::build)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), TaskDiffState(id))

    init {
        viewModelScope.launch { reloads.receiveAsFlow().debounce(reloadDebounceMs).collect { load() } }
        viewModelScope.launch { backend.events.collect { if (it.name in RELOAD_EVENTS) reloads.trySend(Unit) } }
        viewModelScope.launch {
            backend.connection.map { it is ConnectionState.Online }.distinctUntilChanged().filter { it }.collect { load() }
        }
    }

    private suspend fun load() {
        val seq = ++loadSeq
        ui.update { it.copy(loading = true) }
        // The task is read after its diff: its point of return (checkpointId) is then the one of the run that diff belongs to.
        val diff = backend.diff(id)
        val detail = backend.get(id)
        // A newer read was started meanwhile: only the last one is drawn.
        if (seq != loadSeq) return
        ui.update { u ->
            val failure = (diff.exceptionOrNull() ?: if (u.detail == null) detail.exceptionOrNull() else null)
            u.copy(
                detail = detail.getOrNull() ?: u.detail, diff = diff.getOrNull() ?: u.diff, loading = false,
                stale = diff.isFailure || detail.isFailure,
                error = if (diff.isFailure && u.diff == null) failure?.let(::linkErrorText) else null,
            )
        }
    }

    fun refresh() {
        viewModelScope.launch { load() }
    }

    private fun act(done: String, call: suspend () -> Result<*>) {
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
                _messages.trySend(done)
            } else {
                val e = r.exceptionOrNull()!!
                _messages.trySend(ChatErrors.pcText(e) ?: "${TaskTexts.ACTION_FAILED}. ${linkErrorText(e)}")
            }
            // A refusal means the task is not what the screen showed: it is drawn again from the PC's answer.
            load()
        }
    }

    fun accept() {
        if (!build(ui.value, backend.connection.value).canAccept) return
        // The run whose diff is on screen goes with the OK: the PC refuses it if the task ran again since.
        val checkpoint = ui.value.detail?.checkpointId
        act(TaskTexts.ACCEPTED) { backend.accept(id, checkpoint) }
    }

    private var undoAsked = false
    private var undoCheckpoint: String? = null

    /** The dialog opens on the point of return shown now; that one goes back with the yes. */
    fun askUndo() {
        undoAsked = true
        undoCheckpoint = ui.value.detail?.checkpointId
    }

    /** The screen asks first; this is only called after the person accepted the dialog. */
    fun undo() {
        if (!build(ui.value, backend.connection.value).canUndo) return
        val checkpoint = if (undoAsked) undoCheckpoint else ui.value.detail?.checkpointId
        undoAsked = false
        act(TaskTexts.UNDO_DONE) { backend.undo(id, checkpoint) }
    }

    companion object {
        val RELOAD_EVENTS = setOf("board:changed", "approval:changed")
    }
}

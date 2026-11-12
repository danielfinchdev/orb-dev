package dev.orb.app.ui.tasks

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.linkErrorText
import kotlinx.coroutines.async
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
 * «Aprobar» and «Rechazar» are requests to the PC; a second tap while one is on its way does nothing.
 */
class TaskDiffViewModel(private val backend: TasksBackend, val id: Long) : ViewModel() {
    private data class Ui(
        val detail: TaskDetail? = null, val diff: TaskDiff? = null, val loading: Boolean = true,
        val error: String? = null, val busy: Boolean = false,
    )

    private val ui = MutableStateFlow(Ui())
    private val _messages = Channel<String>(Channel.BUFFERED)

    val messages = _messages.receiveAsFlow()

    private fun build(u: Ui, c: ConnectionState): TaskDiffState {
        val d = u.detail
        val held = d?.row?.held != null
        return TaskDiffState(
            id = id, title = d?.row?.title, diff = u.diff, loading = u.loading, error = u.error, online = c is ConnectionState.Online,
            busy = u.busy, accepted = d?.accepted == true,
            canAccept = d != null && !d.accepted && (held || d.row.status == "done") && backend.available(ApiMethods.TASKS_ACCEPT),
            canUndo = d != null && d.hasCheckpoint && !d.row.undone && (held || d.row.status == "done") && backend.available(ApiMethods.TASKS_UNDO),
        )
    }

    val state: StateFlow<TaskDiffState> = combine(ui, backend.connection, ::build)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), TaskDiffState(id))

    init {
        viewModelScope.launch {
            backend.connection.map { it is ConnectionState.Online }.distinctUntilChanged().filter { it }.collect { load() }
        }
    }

    private suspend fun load() {
        // The flags come from the task itself; a diff the PC cannot make still leaves them usable.
        val (detail, diff) = coroutineScope {
            val d = async { backend.get(id) }
            val f = async { backend.diff(id) }
            d.await() to f.await()
        }
        ui.update { u ->
            val failure = (diff.exceptionOrNull() ?: if (u.detail == null) detail.exceptionOrNull() else null)
            u.copy(
                detail = detail.getOrNull() ?: u.detail, diff = diff.getOrNull() ?: u.diff, loading = false,
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
                load()
            } else {
                _messages.trySend("${TaskTexts.ACTION_FAILED}. ${linkErrorText(r.exceptionOrNull()!!)}")
            }
        }
    }

    fun accept() {
        if (!build(ui.value, backend.connection.value).canAccept) return
        act(TaskTexts.ACCEPTED) { backend.accept(id) }
    }

    /** The screen asks first; this is only called after the person accepted the dialog. */
    fun undo() {
        if (!build(ui.value, backend.connection.value).canUndo) return
        act(TaskTexts.UNDO_DONE) { backend.undo(id) }
    }
}

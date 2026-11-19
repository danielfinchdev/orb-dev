package dev.orb.app.ui.tasks

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.chats.ChatErrors
import dev.orb.app.ui.linkErrorText
import dev.orb.app.ui.projects.ProjectTexts
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
    val project: String? = null,
    val diff: TaskDiff? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val online: Boolean = false,
    val busy: Boolean = false,
    val accepted: Boolean = false,
    val canAccept: Boolean = false,
    val canUndo: Boolean = false,
    /**
     * The diff on hand is not of the run the task is at now (it ran again and the diff is still the earlier one), or the PC says
     * the last run has no photo yet: nothing is shown or decided from it until the next reading.
     */
    val notReady: Boolean = false,
    /** An event of the PC arrived and the screen has not read again yet: what it shows may be older than the PC's word. */
    val reloading: Boolean = false,
    /** The «⋯» menu: only what the PC lists, and only for a task that has a project to ask about. */
    val canReview: Boolean = false,
    val canSecurity: Boolean = false,
    val canBranch: Boolean = false,
    /** Who cross-reviewed this task before, when someone did. */
    val reviewedBy: String? = null,
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
    /**
     * [stale]: the last read failed, so what is on screen may be older than the PC's word: nothing can be decided from it.
     * [pending]: an event of the PC arrived and the next read has not finished.
     */
    private data class Ui(
        val detail: TaskDetail? = null, val diff: TaskDiff? = null, val loading: Boolean = true,
        val error: String? = null, val busy: Boolean = false, val stale: Boolean = false, val pending: Boolean = false,
    )

    private val ui = MutableStateFlow(Ui())
    private val reloads = Channel<Unit>(Channel.CONFLATED)
    private var loadSeq = 0
    private var eventStamp = 0
    private val _messages = Channel<String>(Channel.BUFFERED)
    private val _accepted = Channel<Unit>(Channel.BUFFERED)

    val messages = _messages.receiveAsFlow()

    /** The PC took an «Aceptar»: the screen offers to go back with «Deshacer» for as long as the snackbar lasts. */
    val accepted = _accepted.receiveAsFlow()

    private fun build(u: Ui, c: ConnectionState): TaskDiffState {
        val d = u.detail
        val held = d?.row?.held != null
        val diff = u.diff
        // The diff must be of the run the task is at now: a task that ran again leaves the earlier diff behind for a moment.
        val notReady = diff != null && (diff.reason == "notdone" || !diff.isOfRun(d?.checkpointId))
        // Accepting or undoing is only offered on a diff that is up to date: while it is read again, after an event of the PC or
        // after a failed read, the person could be deciding on a run nobody has seen.
        val fresh = !u.loading && !u.stale && !u.pending && !notReady
        return TaskDiffState(
            id = id, title = d?.row?.title, project = d?.row?.project?.takeIf { it.isNotBlank() }, diff = diff, loading = u.loading, error = u.error,
            online = c is ConnectionState.Online, busy = u.busy, accepted = d?.accepted == true,
            // A reason this app does not know offers nothing; with no final photo there is nothing seen to accept; a task joined by
            // hand on the PC is accepted from here (that touches no files) but only the PC can undo it.
            canAccept = fresh && d != null && !d.accepted && (held || d.row.status == "done") && backend.available(ApiMethods.TASKS_ACCEPT) &&
                diff?.unknownReason != true && diff?.noFinalPhoto != true,
            canUndo = fresh && d != null && d.hasCheckpoint && !d.row.undone && (held || d.row.status == "done") && backend.available(ApiMethods.TASKS_UNDO) &&
                diff?.unknownReason != true && diff?.joinedByHand != true,
            notReady = notReady, reloading = u.pending || u.loading,
            canReview = d != null && d.row.status == "done" && backend.available(ApiMethods.TASKS_REVIEW),
            canSecurity = d?.row?.project?.isNotBlank() == true && backend.available(ApiMethods.PROJECTS_SECURITY_REVIEW),
            canBranch = d?.row?.project?.isNotBlank() == true && backend.available(ApiMethods.PROJECTS_BRANCH),
            reviewedBy = d?.review?.agent?.takeIf { it.isNotBlank() },
        )
    }

    val state: StateFlow<TaskDiffState> = combine(ui, backend.connection, ::build)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), TaskDiffState(id))

    init {
        viewModelScope.launch { reloads.receiveAsFlow().debounce(reloadDebounceMs).collect { load() } }
        viewModelScope.launch {
            backend.events.collect {
                if (it.name in RELOAD_EVENTS) {
                    // The buttons go off at once, not after the wait: during it the screen still shows the old run.
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
        val seq = ++loadSeq
        val stamp = eventStamp
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
                // An event that came while this read was under way asks for another one: until it is done this is not final.
                pending = eventStamp != stamp,
                error = if (diff.isFailure && u.diff == null) failure?.let(::linkErrorText) else null,
            )
        }
    }

    fun refresh() {
        viewModelScope.launch { load() }
    }

    private fun act(done: String?, call: suspend () -> Result<*>, onDone: () -> Unit = {}) {
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
                onDone()
                done?.let { _messages.trySend(it) }
            } else {
                // The PC's own words, word for word: «los cambios de la última ejecución aún no están listos; …».
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
        act(null, { backend.accept(id, checkpoint) }, onDone = { _accepted.trySend(Unit) })
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
        act(TaskTexts.UNDO_DONE, { backend.undo(id, checkpoint) })
    }

    /** «Revisión cruzada»: another agent reviews the task's work (`tasks.review`), the same request as on the task's screen. */
    fun review() {
        if (!build(ui.value, backend.connection.value).canReview) return
        act(TaskTexts.REVIEW_DONE, { backend.review(id) })
    }

    /** «Revisión de seguridad»: a read-only review of the task's project (`projects.securityReview`). */
    fun securityReview() {
        val project = build(ui.value, backend.connection.value).takeIf { it.canSecurity }?.project ?: return
        act(null, { backend.securityReview(project).also { r -> r.onSuccess { _messages.trySend(ProjectTexts.securityStarted(it)) } } })
    }

    /** «Ver rama»: only reads and says which branch the project is on (`projects.branch`). */
    fun showBranch() {
        val project = build(ui.value, backend.connection.value).takeIf { it.canBranch }?.project ?: return
        if (backend.connection.value !is ConnectionState.Online) {
            _messages.trySend(TaskTexts.ACTION_OFFLINE)
            return
        }
        viewModelScope.launch {
            backend.branch(project).fold(
                onSuccess = { _messages.trySend(TaskTexts.branchIs(it)) },
                onFailure = { _messages.trySend(TaskTexts.BRANCH_ERROR) },
            )
        }
    }

    companion object {
        val RELOAD_EVENTS = setOf("board:changed", "approval:changed")
    }
}

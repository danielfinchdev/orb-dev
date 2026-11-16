package dev.orb.app.ui.tasks

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.ui.chats.SearchTask
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

enum class TaskFilter { All, Queued, Approve, Running, Problems, Done }

object TaskFiltering {
    fun matches(t: TaskRow, f: TaskFilter) = when (f) {
        TaskFilter.All -> true
        TaskFilter.Queued -> t.status == "queued"
        TaskFilter.Approve -> t.needsApproval
        TaskFilter.Running -> t.running
        TaskFilter.Problems -> t.problem
        TaskFilter.Done -> t.status == "done" || t.status == "cancelled"
    }

    /** What the search box matches on the rows already loaded (for when the PC cannot be asked). */
    fun local(rows: List<TaskRow>, q: String): List<SearchTask> {
        val needle = q.trim().lowercase()
        return rows.filter { r ->
            r.title.lowercase().contains(needle) || r.project?.lowercase()?.contains(needle) == true || r.result?.lowercase()?.contains(needle) == true
        }.map { SearchTask(it.id, it.title, it.status, it.project, null) }
    }
}

@Immutable
data class NewTaskState(
    val projects: List<String> = emptyList(),
    val loading: Boolean = true,
    val saving: Boolean = false,
    val error: String? = null,
)

@Immutable
data class TasksState(
    val tasks: List<TaskRow> = emptyList(),
    val filter: TaskFilter = TaskFilter.All,
    val queued: Int = 0,
    val approve: Int = 0,
    val running: Int = 0,
    val problems: Int = 0,
    val total: Int = 0,
    val paused: Boolean = false,
    /** Queued tasks that wait because the queue is paused. */
    val waitingPaused: Int = 0,
    val queueBusy: Boolean = false,
    val connection: ConnectionState = ConnectionState.Connecting,
    val online: Boolean = false,
    val loaded: Boolean = false,
    val refreshing: Boolean = false,
    val loadFailed: Boolean = false,
    val canCreate: Boolean = false,
    val canPause: Boolean = false,
    val searching: Boolean = false,
    val query: String = "",
    /** The matches of the search; null while there is nothing to look for yet. */
    val results: List<SearchTask>? = null,
    val newTask: NewTaskState? = null,
)

/**
 * The task board. The list is what the PC last said; events and a return to the screen read it again. Pausing and
 * resuming the queue show at once and go back if the PC refuses.
 */
@OptIn(FlowPreview::class)
class TasksViewModel(
    private val backend: TasksBackend,
    private val reloadDebounceMs: Long = 300,
    private val searchDebounceMs: Long = 300,
) : ViewModel() {
    private data class Ui(
        val filter: TaskFilter = TaskFilter.All,
        val refreshing: Boolean = false,
        val failed: Boolean = false,
        val answered: Boolean = false,
        val queueBusy: Boolean = false,
        val searching: Boolean = false,
        val query: String = "",
        val results: List<SearchTask>? = null,
        val newTask: NewTaskState? = null,
    )

    private val data = MutableStateFlow(TasksData.Empty)
    private val ui = MutableStateFlow(Ui())
    private val reloads = Channel<Unit>(Channel.CONFLATED)
    private val queries = MutableStateFlow("")
    private val _messages = Channel<String>(Channel.BUFFERED)

    /** Short messages for a snackbar. */
    val messages = _messages.receiveAsFlow()

    val state: StateFlow<TasksState> = combine(data, ui, backend.connection) { d, u, c ->
        val all = d.tasks
        TasksState(
            tasks = all.filter { TaskFiltering.matches(it, u.filter) }, filter = u.filter,
            queued = all.count { it.status == "queued" }, approve = all.count { it.needsApproval },
            running = all.count { it.running }, problems = all.count { it.problem }, total = all.size,
            paused = d.paused, waitingPaused = all.count { it.status == "queued" && it.waiting?.kind == "paused" },
            queueBusy = u.queueBusy, connection = c, online = c is ConnectionState.Online,
            loaded = all.isNotEmpty() || u.answered, refreshing = u.refreshing, loadFailed = u.failed,
            canCreate = backend.available(ApiMethods.TASKS_CREATE),
            canPause = backend.available(ApiMethods.CONTROL_PAUSE) && backend.available(ApiMethods.CONTROL_RESUME),
            searching = u.searching, query = u.query, results = u.results, newTask = u.newTask,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), TasksState())

    init {
        // What was saved shows first; once the PC has answered, its answer is the truth and the cache only follows it.
        viewModelScope.launch { backend.saved().collect { saved -> if (!ui.value.answered) data.update { saved } } }
        viewModelScope.launch { reloads.receiveAsFlow().debounce(reloadDebounceMs).collect { reload() } }
        viewModelScope.launch { backend.events.collect { if (it.name in RELOAD_EVENTS) reloads.trySend(Unit) } }
        // Whenever the PC becomes reachable the board is read again, which also covers the first open.
        viewModelScope.launch {
            backend.connection.map { it is ConnectionState.Online }.distinctUntilChanged().filter { it }.collect { reload() }
        }
        viewModelScope.launch { queries.debounce(searchDebounceMs).collect { runSearch(it) } }
    }

    // Set as soon as a read is asked for, before its coroutine starts, so two quick pulls make one read.
    private var reading = false

    private suspend fun reload() {
        reading = true
        ui.update { it.copy(refreshing = true) }
        val r = backend.list()
        reading = false
        r.getOrNull()?.let { fresh -> data.update { fresh } }
        ui.update { it.copy(refreshing = false, failed = r.isFailure, answered = it.answered || r.isSuccess) }
        // The matches shown may be stale now.
        ui.value.query.takeIf { it.trim().length >= MIN_QUERY }?.let { runSearch(it) }
    }

    /** Pull to refresh and the return to the screen; a read already under way is not repeated. */
    fun refresh() {
        if (reading) return
        reading = true
        viewModelScope.launch { reload() }
    }

    fun setFilter(f: TaskFilter) = ui.update { it.copy(filter = f) }

    fun openSearch() = ui.update { it.copy(searching = true) }

    fun closeSearch() {
        queries.value = ""
        ui.update { it.copy(searching = false, query = "", results = null) }
    }

    fun setQuery(q: String) {
        ui.update { it.copy(query = q, results = if (q.trim().length >= MIN_QUERY) it.results else null) }
        queries.value = q
    }

    private suspend fun runSearch(q: String) {
        val needle = q.trim()
        if (needle.length < MIN_QUERY || !ui.value.searching) return
        val local = TaskFiltering.local(data.value.tasks, needle)
        val found = if (backend.connection.value is ConnectionState.Online) backend.search(needle).getOrNull() else null
        // A newer search may have replaced this one while the PC answered.
        if (ui.value.query.trim() != needle) return
        ui.update { it.copy(results = found ?: local) }
    }

    /** Pause or resume the whole queue. */
    fun setPaused(paused: Boolean) {
        if (ui.value.queueBusy) return
        if (backend.connection.value !is ConnectionState.Online) {
            _messages.trySend(TaskTexts.ACTION_OFFLINE)
            return
        }
        val before = data.value.paused
        ui.update { it.copy(queueBusy = true) }
        data.update { it.copy(paused = paused) }
        viewModelScope.launch {
            val r = backend.setPaused(paused)
            ui.update { it.copy(queueBusy = false) }
            if (r.isSuccess) {
                _messages.trySend(if (paused) TaskTexts.QUEUE_PAUSED else TaskTexts.QUEUE_RESUMED)
                reload()
            } else {
                data.update { it.copy(paused = before) }
                _messages.trySend("${TaskTexts.ACTION_FAILED}. ${linkErrorText(r.exceptionOrNull()!!)}")
            }
        }
    }

    fun openNewTask() {
        if (!backend.available(ApiMethods.TASKS_CREATE)) return
        ui.update { it.copy(newTask = NewTaskState()) }
        viewModelScope.launch {
            val r = backend.projects()
            ui.update { u ->
                u.newTask?.let { n ->
                    u.copy(newTask = n.copy(loading = false, projects = r.getOrDefault(emptyList()), error = r.exceptionOrNull()?.let(::linkErrorText)))
                } ?: u
            }
        }
    }

    fun closeNewTask() = ui.update { it.copy(newTask = null) }

    fun createTask(project: String, title: String, description: String) {
        val n = ui.value.newTask ?: return
        if (n.saving) return
        val t = title.trim()
        val d = description.trim()
        if (project.isBlank() || t.isEmpty() || d.isEmpty()) return
        if (backend.connection.value !is ConnectionState.Online) {
            ui.update { it.copy(newTask = n.copy(error = TaskTexts.ACTION_OFFLINE)) }
            return
        }
        ui.update { it.copy(newTask = n.copy(saving = true, error = null)) }
        viewModelScope.launch {
            val r = backend.create(project, t, d)
            if (r.isSuccess) {
                ui.update { it.copy(newTask = null) }
                _messages.trySend(TaskTexts.TASK_CREATED)
                reload()
            } else {
                ui.update { u -> u.copy(newTask = u.newTask?.copy(saving = false, error = linkErrorText(r.exceptionOrNull()!!))) }
            }
        }
    }

    private companion object {
        const val MIN_QUERY = 2
        val RELOAD_EVENTS = setOf("board:changed", "approval:changed", "config:changed")
    }
}

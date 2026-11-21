package dev.orb.app.ui.projects

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.ui.chats.ChatRow
import dev.orb.app.ui.linkErrorText
import dev.orb.app.ui.tasks.NewTaskState
import dev.orb.app.ui.tasks.TaskRow
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

/** The logbook sheet: loading, the text, or the PC's error. */
@Immutable
data class LogState(val loading: Boolean = true, val text: String? = null, val error: String? = null)

@Immutable
data class ProjectDetailState(
    val name: String,
    val chats: List<ChatRow> = emptyList(),
    val tasks: List<TaskRow> = emptyList(),
    val git: ProjectGit? = null,
    val category: String? = null,
    /** The project is one of the finished ones; this is the key that reopens it. */
    val finishedKey: String? = null,
    val finishedAt: String? = null,
    val canNewTask: Boolean = false,
    val canReopen: Boolean = false,
    val newTask: NewTaskState? = null,
    val online: Boolean = false,
    val loaded: Boolean = false,
    val loadFailed: Boolean = false,
    val busy: Boolean = false,
    val canReview: Boolean = false,
    val canSecurityReview: Boolean = false,
    val canFinish: Boolean = false,
    val canLog: Boolean = false,
    val canPrs: Boolean = false,
    val canWhiteboard: Boolean = false,
    val log: LogState? = null,
    /** True once the PC finished the project: the screen leaves. */
    val finished: Boolean = false,
) {
    val archived get() = finishedKey != null

    /** Tasks that are queued, waiting for the OK or running. */
    val openTasks get() = tasks.count { it.status == "queued" || it.status == "pending" || it.status == "running" || it.needsApproval }

    /**
     * The finished tasks whose changes the person has neither accepted nor undone. A read-only task changes nothing, so it never
     * counts. This is not what git calls «sin confirmar», which is [ProjectGit.changes].
     */
    val unaccepted get() = tasks.filter { it.status == "done" && !it.accepted && !it.undone && !it.readonly }
}

/** The project's own page. Actions go to the PC one at a time ([ProjectDetailState.busy]) and are never repeated on their own. */
@OptIn(FlowPreview::class)
class ProjectDetailViewModel(
    private val backend: ProjectsBackend,
    val name: String,
    private val reloadDebounceMs: Long = 300,
) : ViewModel() {
    private data class Ui(
        val loaded: Boolean = false,
        val failed: Boolean = false,
        val busy: Boolean = false,
        val log: LogState? = null,
        val finished: Boolean = false,
        val newTask: NewTaskState? = null,
    )

    private val data = MutableStateFlow(ProjectDetailData(emptyList(), emptyList(), null))
    private val ui = MutableStateFlow(Ui())
    private val reloads = Channel<Unit>(Channel.CONFLATED)
    private val _messages = Channel<String>(Channel.BUFFERED)

    /** Short messages for a snackbar. */
    val messages = _messages.receiveAsFlow()

    val state: StateFlow<ProjectDetailState> = combine(data, ui, backend.connection) { d, u, c ->
        ProjectDetailState(
            name = name, chats = d.chats, tasks = d.tasks, git = d.git, category = d.category, finishedKey = d.finishedKey, finishedAt = d.finishedAt,
            canNewTask = backend.available(ApiMethods.TASKS_CREATE), canReopen = backend.available(ApiMethods.PROJECTS_REOPEN), newTask = u.newTask, online = c is ConnectionState.Online,
            loaded = u.loaded, loadFailed = u.failed, busy = u.busy,
            canReview = backend.available(ApiMethods.PROJECTS_REVIEW),
            canSecurityReview = backend.available(ApiMethods.PROJECTS_SECURITY_REVIEW),
            canFinish = backend.available(ApiMethods.PROJECTS_FINISH),
            canLog = backend.available(ApiMethods.LOGS_READ),
            canPrs = backend.available(ApiMethods.PROJECTS_PRS),
            canWhiteboard = backend.available(ApiMethods.WHITEBOARD_LOAD) && backend.available(ApiMethods.WHITEBOARD_SAVE),
            log = u.log, finished = u.finished,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ProjectDetailState(name))

    init {
        viewModelScope.launch { reloads.receiveAsFlow().debounce(reloadDebounceMs).collect { reload() } }
        viewModelScope.launch { backend.events.collect { e: LinkEvent -> if (e.name in RELOAD_EVENTS) reloads.trySend(Unit) } }
        viewModelScope.launch {
            backend.connection.map { it is ConnectionState.Online }.distinctUntilChanged().filter { it }.collect { reload() }
        }
    }

    private var reading = false

    private suspend fun reload() {
        reading = true
        val r = backend.detail(name)
        reading = false
        r.getOrNull()?.let { fresh -> data.update { fresh } }
        ui.update { it.copy(failed = r.isFailure, loaded = it.loaded || r.isSuccess) }
    }

    fun refresh() {
        if (reading) return
        reading = true
        viewModelScope.launch { reload() }
    }

    private fun act(call: suspend () -> Result<String>, onSuccess: () -> Unit = {}) {
        if (ui.value.busy) return
        if (backend.connection.value !is ConnectionState.Online) {
            _messages.trySend(ProjectTexts.ACTION_OFFLINE)
            return
        }
        ui.update { it.copy(busy = true) }
        viewModelScope.launch {
            val r = call()
            ui.update { it.copy(busy = false) }
            r.onSuccess { _messages.trySend(it); onSuccess() }
                .onFailure { _messages.trySend("${ProjectTexts.ACTION_FAILED}. ${linkErrorText(it)}") }
        }
    }

    fun review() {
        if (!backend.available(ApiMethods.PROJECTS_REVIEW)) return
        act({ backend.review(name).map { ProjectTexts.reviewStarted(it) } }, onSuccess = { viewModelScope.launch { reload() } })
    }

    fun securityReview() {
        if (!backend.available(ApiMethods.PROJECTS_SECURITY_REVIEW)) return
        act({ backend.securityReview(name).map { ProjectTexts.securityStarted(it) } }, onSuccess = { viewModelScope.launch { reload() } })
    }

    /** Only called after the person confirmed the dialog. */
    fun finish() {
        if (!backend.available(ApiMethods.PROJECTS_FINISH)) return
        act({ backend.finish(name).map { ProjectTexts.FINISHED } }, onSuccess = { ui.update { it.copy(finished = true) } })
    }

    fun openNewTask() {
        if (!backend.available(ApiMethods.TASKS_CREATE)) return
        // The project is fixed, so there is nothing to load.
        ui.update { it.copy(newTask = NewTaskState(projects = listOf(name), loading = false)) }
    }

    fun closeNewTask() = ui.update { it.copy(newTask = null) }

    fun createTask(project: String, title: String, description: String) {
        val n = ui.value.newTask ?: return
        val t = title.trim()
        val d = description.trim()
        if (n.saving || t.isEmpty() || d.isEmpty()) return
        if (backend.connection.value !is ConnectionState.Online) {
            ui.update { it.copy(newTask = n.copy(error = ProjectTexts.ACTION_OFFLINE)) }
            return
        }
        ui.update { it.copy(newTask = n.copy(saving = true, error = null)) }
        viewModelScope.launch {
            val r = backend.createTask(name, t, d)
            if (r.isSuccess) {
                ui.update { it.copy(newTask = null) }
                _messages.trySend(ProjectTexts.TASK_CREATED)
                reload()
            } else {
                ui.update { u -> u.copy(newTask = u.newTask?.copy(saving = false, error = linkErrorText(r.exceptionOrNull()!!))) }
            }
        }
    }

    /** Brings a finished project back to the list; the page then reads as an active one. */
    fun reopen() {
        val key = state.value.finishedKey ?: return
        if (!backend.available(ApiMethods.PROJECTS_REOPEN)) return
        act({ backend.reopen(key).map { ProjectTexts.REOPENED } }, onSuccess = { viewModelScope.launch { reload() } })
    }

    fun openLog() {
        if (!backend.available(ApiMethods.LOGS_READ)) return
        ui.update { it.copy(log = LogState()) }
        viewModelScope.launch {
            val r = backend.log(name)
            ui.update { u ->
                if (u.log == null) u else u.copy(log = LogState(loading = false, text = r.getOrNull(), error = r.exceptionOrNull()?.let(::linkErrorText)))
            }
        }
    }

    fun closeLog() = ui.update { it.copy(log = null) }

    private companion object {
        val RELOAD_EVENTS = setOf("board:changed", "approval:changed", "config:changed")
    }
}

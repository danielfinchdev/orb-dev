package dev.orb.app.ui.projects

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.ui.chats.ChatRow
import dev.orb.app.ui.linkErrorText
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
    val online: Boolean = false,
    val loaded: Boolean = false,
    val loadFailed: Boolean = false,
    val busy: Boolean = false,
    val canReview: Boolean = false,
    val canSecurityReview: Boolean = false,
    val canFinish: Boolean = false,
    val canLog: Boolean = false,
    val canPrs: Boolean = false,
    val log: LogState? = null,
    /** True once the PC finished the project: the screen leaves. */
    val finished: Boolean = false,
)

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
    )

    private val data = MutableStateFlow(ProjectDetailData(emptyList(), emptyList(), null))
    private val ui = MutableStateFlow(Ui())
    private val reloads = Channel<Unit>(Channel.CONFLATED)
    private val _messages = Channel<String>(Channel.BUFFERED)

    /** Short messages for a snackbar. */
    val messages = _messages.receiveAsFlow()

    val state: StateFlow<ProjectDetailState> = combine(data, ui, backend.connection) { d, u, c ->
        ProjectDetailState(
            name = name, chats = d.chats, tasks = d.tasks, git = d.git, online = c is ConnectionState.Online,
            loaded = u.loaded, loadFailed = u.failed, busy = u.busy,
            canReview = backend.available(ApiMethods.PROJECTS_REVIEW),
            canSecurityReview = backend.available(ApiMethods.PROJECTS_SECURITY_REVIEW),
            canFinish = backend.available(ApiMethods.PROJECTS_FINISH),
            canLog = backend.available(ApiMethods.LOGS_READ),
            canPrs = backend.available(ApiMethods.PROJECTS_PRS),
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

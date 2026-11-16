package dev.orb.app.ui.projects

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
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

sealed interface ProjectFilter {
    data object Active : ProjectFilter
    data class Category(val name: String) : ProjectFilter
    data object Finished : ProjectFilter
}

@Immutable
data class NewProjectState(val saving: Boolean = false, val error: String? = null)

@Immutable
data class ProjectsState(
    val projects: List<ProjectItem> = emptyList(),
    val finished: List<FinishedProject> = emptyList(),
    val filter: ProjectFilter = ProjectFilter.Active,
    /** The categories the listed projects belong to, in the order they first appear. */
    val categories: List<String> = emptyList(),
    val activeCount: Int = 0,
    val online: Boolean = false,
    val loaded: Boolean = false,
    val refreshing: Boolean = false,
    val loadFailed: Boolean = false,
    val busy: Boolean = false,
    val canCreate: Boolean = false,
    val canActivate: Boolean = false,
    val canSeeFinished: Boolean = false,
    val canReopen: Boolean = false,
    val newProject: NewProjectState? = null,
)

/**
 * The project grid. Everything is a request to the PC: nothing changes on screen until the PC has answered, and a single
 * [ProjectsState.busy] flag stops a second tap from repeating an action under way.
 */
@OptIn(FlowPreview::class)
class ProjectsViewModel(
    private val backend: ProjectsBackend,
    private val reloadDebounceMs: Long = 300,
) : ViewModel() {
    private data class Ui(
        val filter: ProjectFilter = ProjectFilter.Active,
        val refreshing: Boolean = false,
        val failed: Boolean = false,
        val answered: Boolean = false,
        val busy: Boolean = false,
        val newProject: NewProjectState? = null,
    )

    private val data = MutableStateFlow(ProjectsData.Empty)
    private val ui = MutableStateFlow(Ui())
    private val reloads = Channel<Unit>(Channel.CONFLATED)
    private val _messages = Channel<String>(Channel.BUFFERED)

    /** Short messages for a snackbar. */
    val messages = _messages.receiveAsFlow()

    val state: StateFlow<ProjectsState> = combine(data, ui, backend.connection) { d, u, c ->
        val canFinished = backend.available(ApiMethods.PROJECTS_FINISHED)
        // A filter that no longer has anything behind it falls back to the whole list.
        val filter = when (val f = u.filter) {
            is ProjectFilter.Category -> if (d.projects.any { it.category == f.name }) f else ProjectFilter.Active
            ProjectFilter.Finished -> if (canFinished) f else ProjectFilter.Active
            else -> f
        }
        ProjectsState(
            projects = when (filter) {
                is ProjectFilter.Category -> d.projects.filter { it.category == filter.name }
                else -> d.projects
            },
            finished = d.finished, filter = filter,
            categories = d.projects.mapNotNull { it.category }.distinct(),
            activeCount = d.projects.size, online = c is ConnectionState.Online,
            loaded = d.projects.isNotEmpty() || d.finished.isNotEmpty() || u.answered,
            refreshing = u.refreshing, loadFailed = u.failed, busy = u.busy,
            canCreate = backend.available(ApiMethods.PROJECTS_CREATE),
            canActivate = backend.available(ApiMethods.PROJECTS_SET_ACTIVE),
            canSeeFinished = canFinished,
            canReopen = backend.available(ApiMethods.PROJECTS_REOPEN),
            newProject = u.newProject,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ProjectsState())

    init {
        // What was saved shows first; once the PC has answered, its answer is the truth.
        viewModelScope.launch { backend.saved().collect { saved -> if (!ui.value.answered) data.update { saved } } }
        viewModelScope.launch { reloads.receiveAsFlow().debounce(reloadDebounceMs).collect { reload() } }
        viewModelScope.launch { backend.events.collect { if (it.name in RELOAD_EVENTS) reloads.trySend(Unit) } }
        viewModelScope.launch {
            backend.connection.map { it is ConnectionState.Online }.distinctUntilChanged().filter { it }.collect { reload() }
        }
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
    }

    /** Pull to refresh and the return to the screen; a read already under way is not repeated. */
    fun refresh() {
        if (reading) return
        reading = true
        viewModelScope.launch { reload() }
    }

    fun setFilter(f: ProjectFilter) = ui.update { it.copy(filter = f) }

    /** Runs one action on the PC; nothing starts while offline or while another action is under way. */
    private fun act(success: String, call: suspend () -> Result<Unit>) {
        if (ui.value.busy) return
        if (backend.connection.value !is ConnectionState.Online) {
            _messages.trySend(ProjectTexts.ACTION_OFFLINE)
            return
        }
        ui.update { it.copy(busy = true) }
        viewModelScope.launch {
            val r = call()
            ui.update { it.copy(busy = false) }
            if (r.isSuccess) {
                _messages.trySend(success)
                reload()
            } else _messages.trySend("${ProjectTexts.ACTION_FAILED}. ${linkErrorText(r.exceptionOrNull()!!)}")
        }
    }

    /** Makes [p] the active project, or clears it when it already is. */
    fun toggleActive(p: ProjectItem) {
        if (!backend.available(ApiMethods.PROJECTS_SET_ACTIVE)) return
        act(if (p.active) ProjectTexts.ACTIVE_CLEARED else ProjectTexts.ACTIVE_SET) { backend.setActive(if (p.active) null else p.name) }
    }

    fun reopen(f: FinishedProject) {
        if (!backend.available(ApiMethods.PROJECTS_REOPEN)) return
        act(ProjectTexts.REOPENED) { backend.reopen(f.key) }
    }

    fun openNewProject() {
        if (backend.available(ApiMethods.PROJECTS_CREATE)) ui.update { it.copy(newProject = NewProjectState()) }
    }

    fun closeNewProject() = ui.update { it.copy(newProject = null) }

    fun createProject(name: String, category: String?, notes: String) {
        val n = ui.value.newProject ?: return
        val clean = name.trim()
        if (n.saving || clean.isEmpty()) return
        if (backend.connection.value !is ConnectionState.Online) {
            ui.update { it.copy(newProject = n.copy(error = ProjectTexts.ACTION_OFFLINE)) }
            return
        }
        ui.update { it.copy(newProject = n.copy(saving = true, error = null)) }
        viewModelScope.launch {
            val r = backend.create(clean, category, notes.trim())
            if (r.isSuccess) {
                ui.update { it.copy(newProject = null) }
                _messages.trySend(ProjectTexts.CREATED)
                reload()
            } else {
                ui.update { u -> u.copy(newProject = u.newProject?.copy(saving = false, error = linkErrorText(r.exceptionOrNull()!!))) }
            }
        }
    }

    private companion object {
        val RELOAD_EVENTS = setOf("board:changed", "config:changed")
    }
}

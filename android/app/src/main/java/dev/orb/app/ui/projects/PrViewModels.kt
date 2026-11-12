package dev.orb.app.ui.projects

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.api.ConfirmAction
import dev.orb.app.link.api.Confirmed
import dev.orb.app.link.net.ConnectionState
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@Immutable
data class PrListState(
    val prs: List<PrRow> = emptyList(),
    val loading: Boolean = true,
    /** The PC's own message when it could not list them (no `gh`, not signed in...). */
    val error: String? = null,
)

/** The open pull requests of one project. Read on demand: it asks GitHub through the PC, so it is never polled. */
class PrListViewModel(private val backend: ProjectsBackend, val name: String) : ViewModel() {
    private val _state = MutableStateFlow(PrListState())
    val state: StateFlow<PrListState> = _state

    init { refresh() }

    fun refresh() {
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            val r = backend.prs(name)
            _state.update { PrListState(prs = r.getOrDefault(it.prs), loading = false, error = r.exceptionOrNull()?.let(ProjectTexts::pcError)) }
        }
    }
}

/** The merge methods GitHub offers, in the order the dialog lists them. */
val MergeMethods = listOf("merge", "squash", "rebase")

@Immutable
data class PrDetailState(
    val number: Int,
    val pr: PrDetail? = null,
    val loading: Boolean = true,
    val error: String? = null,
    /** A merge is under way: nothing else can start. */
    val merging: Boolean = false,
    /** The PC said the merge went through, whether or not the state could be read back yet. */
    val mergeSent: Boolean = false,
    val online: Boolean = true,
    val canMerge: Boolean = false,
)

/**
 * One pull request: its state, branch and checks as GitHub reports them through the PC.
 * Merging is the delicate part: it needs a [Confirmed] token the dialog made, runs once at a time, is never retried
 * on its own, and the pull request is read again afterwards so the screen shows what GitHub says.
 */
class PrDetailViewModel(private val backend: ProjectsBackend, val name: String, val number: Int) : ViewModel() {
    private val _state = MutableStateFlow(PrDetailState(number, online = backend.connection.value is ConnectionState.Online))
    val state: StateFlow<PrDetailState> = _state
    private val _messages = Channel<String>(Channel.BUFFERED)

    /** Short messages for a snackbar. */
    val messages = _messages.receiveAsFlow()

    // Set before the coroutine starts, so two quick taps cannot both reach the PC.
    private var merging = false

    init {
        refresh()
        viewModelScope.launch { backend.connection.collect { c -> _state.update { it.copy(online = c is ConnectionState.Online) } } }
    }

    fun refresh() {
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch { load() }
    }

    private suspend fun load(keepError: String? = null) {
        val r = backend.pr(name, number)
        _state.update { u ->
            val pr = r.getOrDefault(u.pr)
            u.copy(
                pr = pr, loading = false, error = keepError ?: r.exceptionOrNull()?.let(ProjectTexts::pcError),
                canMerge = pr != null && pr.open && !pr.draft && !u.mergeSent && backend.available(ApiMethods.PROJECTS_MERGE_PR),
            )
        }
    }

    /** [confirmed] is made by the dialog the person just accepted; one for another pull request is refused here. */
    fun merge(method: String, confirmed: Confirmed) {
        val pr = _state.value.pr ?: return
        if (merging || !_state.value.canMerge || !pr.open || pr.draft) return
        if (method !in MergeMethods) return
        if (confirmed.action != ConfirmAction.MergePr || confirmed.target != "$name#$number") return
        if (backend.connection.value !is ConnectionState.Online) {
            _messages.trySend(ProjectTexts.ACTION_OFFLINE)
            return
        }
        merging = true
        _state.update { it.copy(merging = true, error = null) }
        viewModelScope.launch {
            val r = backend.mergePr(name, number, method, confirmed)
            merging = false
            if (r.isSuccess) {
                _state.update { it.copy(merging = false, mergeSent = true, canMerge = false) }
                _messages.trySend(ProjectTexts.PR_MERGED_DONE)
                load()
            } else {
                // The PC's words, as they came. A timeout may still have merged, so the state is read again; the merge itself is not.
                _state.update { it.copy(merging = false) }
                load(keepError = ProjectTexts.pcError(r.exceptionOrNull()!!))
            }
        }
    }
}

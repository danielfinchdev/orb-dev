package dev.orb.app.ui.projects

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
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

@Immutable
data class PrDetailState(
    val number: Int,
    val pr: PrDetail? = null,
    val loading: Boolean = true,
    val error: String? = null,
)

/** One pull request: its state, branch and checks as GitHub reports them through the PC. */
class PrDetailViewModel(private val backend: ProjectsBackend, val name: String, val number: Int) : ViewModel() {
    private val _state = MutableStateFlow(PrDetailState(number))
    val state: StateFlow<PrDetailState> = _state

    init { refresh() }

    fun refresh() {
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch { load() }
    }

    private suspend fun load() {
        val r = backend.pr(name, number)
        _state.update { PrDetailState(number, pr = r.getOrDefault(it.pr), loading = false, error = r.exceptionOrNull()?.let(ProjectTexts::pcError)) }
    }
}

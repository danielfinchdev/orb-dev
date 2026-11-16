package dev.orb.app.ui.chats

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.net.ConnectionState
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class SearchScope { All, Chats, Messages, Tasks, Projects }

enum class SearchPhase { Idle, Searching, Done, Error, Offline }

@Immutable
data class SearchState(
    val query: String = "",
    val scope: SearchScope = SearchScope.All,
    val phase: SearchPhase = SearchPhase.Idle,
    val results: SearchResults = SearchResults.Empty,
) {
    fun count(s: SearchScope) = when (s) {
        SearchScope.All -> results.total
        SearchScope.Chats -> results.chats.size
        SearchScope.Messages -> results.messages.size
        SearchScope.Tasks -> results.tasks.size
        SearchScope.Projects -> results.projects.size
    }
}

/** Search asks the PC (from 2 letters, after a short pause, dropping the answer of an older text); offline it reads the saved chats. */
@OptIn(FlowPreview::class)
class SearchViewModel(private val backend: ChatsBackend, debounceMs: Long = 250) : ViewModel() {
    private val _state = MutableStateFlow(SearchState())
    val state: StateFlow<SearchState> = _state.asStateFlow()
    private val typed = MutableStateFlow("")

    init {
        viewModelScope.launch {
            typed.map { it.trim() }.debounce(debounceMs).distinctUntilChanged().collectLatest { q -> run(q) }
        }
    }

    fun setQuery(text: String) {
        _state.update {
            if (text.trim().length < MIN) it.copy(query = text, phase = SearchPhase.Idle, results = SearchResults.Empty) else it.copy(query = text)
        }
        typed.value = text
    }

    fun setScope(s: SearchScope) = _state.update { it.copy(scope = s) }

    private suspend fun run(q: String) {
        if (q.length < MIN) {
            _state.update { it.copy(phase = SearchPhase.Idle, results = SearchResults.Empty) }
            return
        }
        if (backend.connection.value !is ConnectionState.Online) {
            val saved = backend.searchSaved(q)
            _state.update { it.copy(phase = SearchPhase.Offline, results = saved) }
            return
        }
        _state.update { it.copy(phase = SearchPhase.Searching) }
        backend.search(q).fold(
            onSuccess = { r -> _state.update { it.copy(phase = SearchPhase.Done, results = r) } },
            onFailure = { _state.update { it.copy(phase = SearchPhase.Error, results = SearchResults.Empty) } },
        )
    }

    private companion object {
        const val MIN = 2
    }
}

package dev.orb.app.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.AppContainer
import dev.orb.app.link.net.ConnectionState
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class HomeUiState(
    val pcName: String? = null,
    val connection: ConnectionState = ConnectionState.Connecting,
    val unlinking: Boolean = false,
    val unlinked: Boolean = false,
)

@OptIn(ExperimentalCoroutinesApi::class)
class HomeViewModel(private val container: AppContainer) : ViewModel() {
    private val busy = MutableStateFlow(false)
    private val done = MutableStateFlow(false)

    private val link: StateFlow<Pair<String?, ConnectionState>?> = container.runtime
        .flatMapLatest { rt ->
            if (rt == null) flowOf(null)
            else rt.client.connection.map { c -> ((c as? ConnectionState.Online)?.pcName ?: rt.client.pcInfo.value?.name ?: rt.client.currentSession.name) to c }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val state: StateFlow<HomeUiState> = kotlinx.coroutines.flow.combine(link, busy, done) { l, b, d ->
        HomeUiState(pcName = l?.first, connection = l?.second ?: ConnectionState.Unlinked, unlinking = b, unlinked = d)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), HomeUiState())

    fun unlink() {
        if (busy.value) return
        busy.value = true
        viewModelScope.launch {
            container.unlink()
            done.value = true
            busy.value = false
        }
    }
}

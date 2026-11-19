package dev.orb.app.ui.notes

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.linkErrorText
import kotlinx.coroutines.channels.Channel
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
data class NotesState(
    val rows: List<NoticeRow> = emptyList(),
    val unread: Int = 0,
    val online: Boolean = false,
    val refreshing: Boolean = false,
    val markingAll: Boolean = false,
    /** The PC keeps the list of what it sent: an empty list then really means nothing happened. */
    val pcKeepsList: Boolean = false,
)

class NotesViewModel(private val backend: NotesBackend) : ViewModel() {
    private data class Ui(val refreshing: Boolean = false, val markingAll: Boolean = false)

    private val ui = MutableStateFlow(Ui())
    private val _messages = Channel<String>(Channel.BUFFERED)
    val messages = _messages.receiveAsFlow()
    private val _dismissed = Channel<String>(Channel.BUFFERED)

    /** A notice was swiped away: the screen offers «Deshacer» with its id. */
    val dismissOffers = _dismissed.receiveAsFlow()

    val state: StateFlow<NotesState> = combine(backend.notices, ui, backend.connection) { rows, u, c ->
        NotesState(rows, rows.count { it.unread }, c is ConnectionState.Online, u.refreshing, u.markingAll, backend.pcKeepsList)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), NotesState())

    init {
        viewModelScope.launch {
            backend.connection.map { it is ConnectionState.Online }.distinctUntilChanged().filter { it }.collect { refresh() }
        }
    }

    fun refresh() {
        if (ui.value.refreshing) return
        ui.update { it.copy(refreshing = true) }
        viewModelScope.launch {
            backend.refresh()
            ui.update { it.copy(refreshing = false) }
        }
    }

    /** Tapping a notice reads it on the phone; the PC's bell is only told by «Marcar todo leído». */
    fun open(n: Notice) = backend.markReadLocal(n.id)

    /** Swiping a notice away (or its accessibility action): it leaves the list on this phone and can be brought back. */
    fun dismiss(n: Notice): Boolean {
        if (!backend.dismiss(n.id)) return false
        _dismissed.trySend(n.id)
        return true
    }

    fun undoDismiss(id: String) = backend.undoDismiss(id)

    fun markAllRead() {
        if (ui.value.markingAll || state.value.unread == 0) return
        ui.update { it.copy(markingAll = true) }
        viewModelScope.launch {
            val r = backend.markRead(null)
            ui.update { it.copy(markingAll = false) }
            // The phone's list is already read; only the PC may have missed it.
            if (r.isFailure) _messages.trySend("${NotesTexts.PC_NOT_TOLD}. ${linkErrorText(r.exceptionOrNull()!!)}")
        }
    }
}

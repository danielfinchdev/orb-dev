package dev.orb.app.ui.shell

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.chats.ChatsBackend
import dev.orb.app.ui.theme.ThemePrefs
import dev.orb.app.ui.theme.pcSkinFrom
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** What lives as long as the tabs: the badge of the Chats tab, and the app wearing the PC's theme. */
class ShellViewModel(private val backend: ChatsBackend, private val themePrefs: ThemePrefs) : ViewModel() {
    /** Chats with something unread. */
    val unreadChats: StateFlow<Int> = backend.inbox().map { d -> d.rows.count { !it.done && !it.muted && it.snoozedUntil == null && it.unread > 0 } }
        .distinctUntilChanged().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)

    init {
        // The PC's theme is read when the link comes up and whenever its settings change.
        viewModelScope.launch {
            backend.connection.map { it is ConnectionState.Online }.distinctUntilChanged().filter { it }.collect { followPcTheme() }
        }
        viewModelScope.launch { backend.events.filter { it.name == "config:changed" }.collect { followPcTheme() } }
    }

    private suspend fun followPcTheme() {
        backend.appState().getOrNull()?.let { themePrefs.setPcTheme(pcSkinFrom(it)) }
    }
}

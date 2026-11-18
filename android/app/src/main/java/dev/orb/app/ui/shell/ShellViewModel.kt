package dev.orb.app.ui.shell

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.ui.chats.ChatsBackend
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/** What lives as long as the tabs: the badge of the Chats tab. */
class ShellViewModel(backend: ChatsBackend) : ViewModel() {
    /** Chats with something unread. */
    val unreadChats: StateFlow<Int> = backend.inbox().map { d -> d.rows.count { !it.done && !it.muted && it.snoozedUntil == null && it.unread > 0 } }
        .distinctUntilChanged().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)
}

package dev.orb.app.ui.shell

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.ui.chats.ChatsBackend
import dev.orb.app.ui.tasks.TasksBackend
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/** What lives as long as the tabs: the numbers of the Chats and Tareas tabs. */
class ShellViewModel(backend: ChatsBackend, tasks: TasksBackend? = null) : ViewModel() {
    /** Chats with something unread. */
    val unreadChats: StateFlow<Int> = backend.inbox().map { d -> d.rows.count { !it.done && !it.muted && it.snoozedUntil == null && it.unread > 0 } }
        .distinctUntilChanged().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)

    /** Tasks waiting for the person's OK, from the board the phone already keeps (no extra call to the PC). */
    val tasksToApprove: StateFlow<Int> = (tasks?.saved() ?: emptyFlow()).map { d -> d.tasks.count { it.needsApproval } }
        .distinctUntilChanged().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)
}

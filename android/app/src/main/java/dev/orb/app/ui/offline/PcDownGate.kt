package dev.orb.app.ui.offline

import dev.orb.app.link.net.ConnectionState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** Why the whole screen is taken over when the app opens without a working link. */
enum class DownKind { PcOff, UpdateApp, UpdatePc }

/** [full] is the screen that covers the app; [saved] is the read-only way into what the phone already holds. */
data class PcDownState(val full: DownKind? = null, val saved: Boolean = false, val unlinking: Boolean = false)

/**
 * Decides when the full-screen «No llego a tu PC» / «Actualiza» takes over. It does so only for a person who opens the app
 * and finds no link: once the PC answered, a later drop is the connection band's business, so a blip never swaps the screen.
 * Chosen «Ver chats guardados» keeps the app (read-only) until the link is up again, and then everything goes back to normal.
 */
class PcDownGate {
    private val _state = MutableStateFlow(PcDownState())
    val state: StateFlow<PcDownState> = _state.asStateFlow()

    private var settled = false
    private var lastDown: DownKind? = null

    // What the link said when the app was opened: that is the last session's news, not this one's.
    private var stale: ConnectionState? = null
    private var sawConnecting = true

    /** The app came back to the front: the next failure to reach the PC is news again. */
    fun reopened(current: ConnectionState) {
        settled = false
        lastDown = null
        stale = current
        sawConnecting = false
        // Still without a link on coming back: the cover stays (it is not emptied until a retry could fail again).
        if (current is ConnectionState.Offline) {
            lastDown = DownKind.PcOff
            _state.update { PcDownState(full = DownKind.PcOff, unlinking = it.unlinking) }
            return
        }
        _state.update { PcDownState(unlinking = it.unlinking) }
        if (current is ConnectionState.Online || current is ConnectionState.Unlinked) settled = true
    }

    /** «Vincular con otro PC» confirmed: a second tap while [block] runs does nothing, so the link is only dropped once. */
    fun unlink(scope: CoroutineScope, block: suspend () -> Unit) {
        val first = synchronized(this) { if (_state.value.unlinking) false else { _state.update { it.copy(unlinking = true) }; true } }
        if (!first) return
        scope.launch {
            try { block() } finally { _state.update { it.copy(unlinking = false) } }
        }
    }

    fun onConnection(c: ConnectionState) {
        if (c == ConnectionState.Connecting) sawConnecting = true
        if (!sawConnecting && c == stale) return
        when (c) {
            is ConnectionState.Online, ConnectionState.Unlinked, is ConnectionState.Attention -> {
                settled = true
                lastDown = null
                _state.update { PcDownState(unlinking = it.unlinking) }
            }
            ConnectionState.Connecting -> Unit
            is ConnectionState.Offline -> show(DownKind.PcOff)
            ConnectionState.UpdateApp -> show(DownKind.UpdateApp)
            ConnectionState.UpdatePc -> show(DownKind.UpdatePc)
        }
    }

    private fun show(kind: DownKind) {
        if (settled) return
        lastDown = kind
        _state.update { if (it.saved) it else PcDownState(full = kind, unlinking = it.unlinking) }
    }

    /** «Ver chats guardados». */
    fun openSaved() = _state.update { if (it.full != null) PcDownState(saved = true, unlinking = it.unlinking) else it }

    /** Back from the read-only app to the screen that explains why. */
    fun closeSaved() = _state.update { if (it.saved) PcDownState(full = lastDown ?: DownKind.PcOff, unlinking = it.unlinking) else it }
}

package dev.orb.app.ui.web

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.ui.linkErrorText
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

enum class SaveStatus { Saved, Saving, Unsaved }

sealed interface WhiteboardPhase {
    data object Loading : WhiteboardPhase

    /** The PC cannot be reached (or cannot serve the Pizarra): the drawing is never opened for editing. */
    data class NeedsPc(val unsupported: Boolean = false, val error: String? = null) : WhiteboardPhase

    data class Choose(val projects: List<String>) : WhiteboardPhase

    /** The drawing as the PC sent it (without the attachments panel's data), ready for the page. */
    data class Ready(val project: String, val scene: JsonObject) : WhiteboardPhase
}

@Immutable
data class WhiteboardState(
    val phase: WhiteboardPhase = WhiteboardPhase.Loading,
    val save: SaveStatus = SaveStatus.Saved,
    val projects: List<String> = emptyList(),
    /** True when leaving failed because the last changes are not on the PC: the screen asks what to do. */
    val confirmLeave: Boolean = false,
)

/**
 * The Pizarra of one project. The drawing is only ever opened with the PC reachable and is saved back to it; the phone
 * keeps no copy. Changes from the page are coalesced for [debounceMs] and sent in one `whiteboard.save`; when a save
 * fails they stay pending (nothing is marked as saved) and go again when the PC is back or the next change arrives.
 */
class WhiteboardViewModel(
    private val backend: WhiteboardBackend,
    private val initialProject: String? = null,
    private val debounceMs: Long = 2_000,
) : ViewModel() {
    private val _state = MutableStateFlow(WhiteboardState())
    val state: StateFlow<WhiteboardState> = _state.asStateFlow()

    private val _leave = Channel<Unit>(Channel.CONFLATED)

    /** Emits once when the screen may close: everything is on the PC (or the person chose to leave without saving). */
    val leave = _leave.receiveAsFlow()

    private val _messages = Channel<String>(Channel.BUFFERED)
    val messages = _messages.receiveAsFlow()

    private val lock = Mutex()
    private var pending: WhiteboardMessage.Save? = null
    private var debounce: Job? = null
    private var loading: Job? = null
    private var project: String? = null

    init {
        viewModelScope.launch {
            backend.connection.map { it is ConnectionState.Online }.distinctUntilChanged().collect { online ->
                val phase = _state.value.phase
                if (online) {
                    if (phase is WhiteboardPhase.Loading || (phase is WhiteboardPhase.NeedsPc && !phase.unsupported && phase.error == null)) load()
                    if (pending != null) flush()
                } else if (phase is WhiteboardPhase.Loading && backend.connection.value !is ConnectionState.Connecting) {
                    _state.update { it.copy(phase = WhiteboardPhase.NeedsPc()) }
                }
            }
        }
    }

    fun retry() {
        _state.update { it.copy(phase = WhiteboardPhase.Loading) }
        val c = backend.connection.value
        if (c is ConnectionState.Online) load()
        else if (c !is ConnectionState.Connecting) _state.update { it.copy(phase = WhiteboardPhase.NeedsPc()) }
    }

    private fun load(name: String? = project ?: initialProject) {
        loading?.cancel()
        loading = viewModelScope.launch {
            if (!RuntimeWhiteboardBackend.NEEDED.all { backend.available(it) }) {
                _state.update { it.copy(phase = WhiteboardPhase.NeedsPc(unsupported = true)) }
                return@launch
            }
            val list = backend.projects().getOrElse { return@launch failed(it) }
            _state.update { it.copy(projects = list.names) }
            val chosen = (name ?: list.active)?.takeIf { it in list.names }
            if (chosen == null) {
                _state.update { it.copy(phase = WhiteboardPhase.Choose(list.names)) }
                return@launch
            }
            val scene = backend.load(chosen).getOrElse { return@launch failed(it) }
            project = chosen
            if ((scene["damaged"] as? JsonPrimitive)?.booleanOrNull == true) _messages.trySend(WhiteboardTexts.DAMAGED)
            _state.update { it.copy(phase = WhiteboardPhase.Ready(chosen, forPage(scene)), save = SaveStatus.Saved) }
        }
    }

    private fun failed(e: Throwable) {
        val offline = (e as? LinkException)?.error.let { it == LinkError.Offline || it == LinkError.Timeout }
        _state.update { it.copy(phase = WhiteboardPhase.NeedsPc(error = if (offline) null else linkErrorText(e))) }
    }

    /** Only what the page draws with: the attachments of the desktop's side panel stay on the PC. */
    private fun forPage(scene: JsonObject) = JsonObject(scene.filterKeys { it in PAGE_KEYS })

    fun choose(name: String) {
        if (name == project) return
        viewModelScope.launch {
            // The drawing on screen holds the latest changes: they are on the PC before another one opens.
            debounce?.cancel()
            if (!flush()) { _messages.trySend(WhiteboardTexts.SWITCH_BLOCKED); return@launch }
            project = null
            _state.update { it.copy(phase = WhiteboardPhase.Loading) }
            load(name)
        }
    }

    /** From the page: the drawing as it is now. */
    fun onSave(s: WhiteboardMessage.Save) {
        pending = pending?.let { merge(it, s) } ?: s
        _state.update { it.copy(save = SaveStatus.Saving) }
        debounce?.cancel()
        debounce = viewModelScope.launch {
            if (!s.flush) delay(debounceMs)
            flush()
        }
    }

    /** The app goes to the background: whatever is pending is sent now. */
    fun flushNow() {
        if (pending == null) return
        debounce?.cancel()
        viewModelScope.launch { flush() }
    }

    /** The page asked to leave (or the back arrow did): leaves once everything is on the PC. */
    fun requestLeave() {
        debounce?.cancel()
        viewModelScope.launch {
            if (flush()) _leave.trySend(Unit) else _state.update { it.copy(confirmLeave = true) }
        }
    }

    fun keepEditing() = _state.update { it.copy(confirmLeave = false) }

    fun leaveWithoutSaving() {
        pending = null
        _leave.trySend(Unit)
    }

    /** Sends what is pending; true when nothing is left unsaved afterwards. */
    private suspend fun flush(): Boolean = lock.withLock {
        val p = pending ?: return@withLock true
        val name = project ?: return@withLock true
        pending = null
        // A newer change cancels the waiting job, never a save that is already on its way.
        val r = withContext(NonCancellable) { backend.save(name, p) }
        if (r.isSuccess) {
            if (pending == null) _state.update { it.copy(save = SaveStatus.Saved, confirmLeave = false) }
            true
        } else {
            // Nothing was saved: the changes (and the pictures that travelled with them) stay pending.
            pending = pending?.let { merge(p, it) } ?: p
            _state.update { it.copy(save = SaveStatus.Unsaved) }
            false
        }
    }

    private companion object {
        val PAGE_KEYS = setOf("elements", "appState", "files")

        /** [b] is the newer one: its drawing wins, the pictures of both are kept, and a picture is only replaced by a newer one. */
        fun merge(a: WhiteboardMessage.Save, b: WhiteboardMessage.Save) = WhiteboardMessage.Save(
            elements = b.elements, appState = b.appState,
            files = JsonObject(a.files + b.files), png = b.png ?: a.png, flush = a.flush || b.flush,
        )
    }
}

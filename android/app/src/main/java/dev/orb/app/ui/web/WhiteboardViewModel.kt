package dev.orb.app.ui.web

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.ui.linkErrorText
import kotlinx.coroutines.CompletableDeferred
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
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/** One file attached on the PC; [thumb] is a data URL, only for small pictures. */
@Immutable
data class WhiteboardAttachment(val name: String, val size: Long, val kind: String, val note: String, val addedAt: Long, val thumb: String?)

enum class SaveStatus { Saved, Saving, Unsaved }

/** What the app asks of the page it hosts. */
sealed interface PageCommand {
    /** Send everything now and answer with `flushed`. */
    data object Flush : PageCommand

    /** The PC has these pictures: the page need not send them again. */
    data class Saved(val files: Set<String>) : PageCommand

    /** The last messages did not arrive: pictures not yet confirmed must travel again. */
    data object Unsent : PageCommand
}

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
    val attachments: List<WhiteboardAttachment> = emptyList(),
    /** True when leaving failed because the last changes are not on the PC: the screen asks what to do. */
    val confirmLeave: Boolean = false,
)

/**
 * The Pizarra of one project. The drawing is only ever opened with the PC reachable and is saved back to it; the phone
 * keeps no copy. Changes from the page are coalesced for [debounceMs] and sent in one `whiteboard.save`; when a save
 * fails they stay pending (nothing is marked as saved) and go again when the PC is back or the next change arrives.
 *
 * Every save carries the project it was drawn in, so a late save of one project can never land in another. The VM also
 * remembers the latest drawing it was given, so a page that is recreated (rotation, theme, split screen) gets that one
 * and not the drawing the PC sent when the project was opened.
 */
class WhiteboardViewModel(
    private val backend: WhiteboardBackend,
    private val initialProject: String? = null,
    private val debounceMs: Long = 2_000,
    private val pageFlushTimeoutMs: Long = 3_000,
) : ViewModel() {
    private val _state = MutableStateFlow(WhiteboardState())
    val state: StateFlow<WhiteboardState> = _state.asStateFlow()

    private val _leave = Channel<Unit>(Channel.CONFLATED)

    /** Emits once when the screen may close: everything is on the PC (or the person chose to leave without saving). */
    val leave = _leave.receiveAsFlow()

    private val _messages = Channel<String>(Channel.BUFFERED)
    val messages = _messages.receiveAsFlow()

    private val _commands = Channel<PageCommand>(Channel.BUFFERED)
    val pageCommands = _commands.receiveAsFlow()

    private val lock = Mutex()
    private var pending: WhiteboardMessage.Save? = null
    private var debounce: Job? = null
    private var loading: Job? = null
    private var project: String? = null

    /** The drawing as the page last knew it: the PC's, plus every change the page reported since. */
    private var pageScene: JsonObject? = null

    /** True when a save from the page was refused: the PC is behind the screen and nothing is pending to retry. */
    private var unsynced = false
    private var warnedDropped = 0
    private var pageFlushed: CompletableDeferred<Unit>? = null

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

    /** The attachments panel needs a PC that knows `whiteboard.note`. */
    val canNote: Boolean get() = backend.available(dev.orb.app.link.api.ApiMethods.WHITEBOARD_NOTE)

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
            // A save received while no project was open belongs to none and is not kept.
            if (pending?.project == null) pending = null
            unsynced = false
            val page = forPage(scene)
            pageScene = page
            if ((scene["damaged"] as? JsonPrimitive)?.booleanOrNull == true) _messages.trySend(WhiteboardTexts.DAMAGED)
            _state.update { it.copy(phase = WhiteboardPhase.Ready(chosen, page), save = SaveStatus.Saved, attachments = parseAttachments(scene["attachments"])) }
        }
    }

    private fun failed(e: Throwable) {
        val offline = (e as? LinkException)?.error.let { it == LinkError.Offline || it == LinkError.Timeout }
        _state.update { it.copy(phase = WhiteboardPhase.NeedsPc(error = if (offline) null else linkErrorText(e))) }
    }

    /** Only what the page draws with: the attachments of the desktop's side panel stay on the PC. */
    private fun forPage(scene: JsonObject) = JsonObject(scene.filterKeys { it in PAGE_KEYS })

    /**
     * Saves the note of an attachment of [forProject] (the project the panel was opened with). The list changes only when
     * the PC confirms; the drawing and the save status are never touched. Returns true when the PC took the note.
     */
    suspend fun saveNote(forProject: String, file: String, note: String): Boolean {
        if (note.length > MAX_NOTE) { _messages.trySend(WhiteboardTexts.noteTooLong(MAX_NOTE)); return false }
        val r = backend.note(forProject, file, note)
        if (r.isFailure) { _messages.trySend(WhiteboardTexts.NOTE_FAILED); return false }
        // The person may have changed project while the PC answered: that list is not this note's.
        if (project == forProject) {
            _state.update { st -> st.copy(attachments = st.attachments.map { if (it.name == file) it.copy(note = note) else it }) }
        }
        return true
    }

    /** What a page that has just been (re)created is given: the latest drawing, not the one the project was opened with. */
    fun sceneForPage(): JsonObject? = pageScene

    fun choose(name: String) {
        if (name == project) return
        viewModelScope.launch {
            // The page holds the latest changes (up to its last throttle window): it hands them over, then they reach the PC.
            debounce?.cancel()
            if (_state.value.phase is WhiteboardPhase.Ready) requestPageFlush()
            if (!flush()) { _messages.trySend(WhiteboardTexts.SWITCH_BLOCKED); return@launch }
            project = null
            pageScene = null
            _state.update { it.copy(phase = WhiteboardPhase.Loading) }
            load(name)
        }
    }

    /** Asks the page for everything it has and waits (a little) for its answer. */
    private suspend fun requestPageFlush() {
        val answer = CompletableDeferred<Unit>()
        pageFlushed = answer
        _commands.trySend(PageCommand.Flush)
        withTimeoutOrNull(pageFlushTimeoutMs) { answer.await() }
        pageFlushed = null
    }

    /** From the page: it has sent everything it had. */
    fun onPageFlushed() { pageFlushed?.complete(Unit) }

    /** From the page: the drawing as it is now. */
    fun onSave(received: WhiteboardMessage.Save) {
        val s = received.copy(project = project)
        if (s.project != null) remember(s)
        unsynced = false
        // A save of another project than the pending one is never mixed into it.
        pending = pending?.takeIf { it.project == s.project }?.let { merge(it, s) } ?: s
        if (s.dropped != warnedDropped) {
            warnedDropped = s.dropped
            if (s.dropped > 0) _messages.trySend(WhiteboardTexts.dropped(s.dropped))
        }
        _state.update { it.copy(save = SaveStatus.Saving) }
        debounce?.cancel()
        debounce = viewModelScope.launch {
            if (!s.flush) delay(debounceMs)
            flush()
        }
    }

    /** From the page: a save was refused, so the PC is behind and the bar must not say «Guardado». */
    fun onRejected() {
        if (!unsynced) _messages.trySend(WhiteboardTexts.REJECTED)
        unsynced = true
        _commands.trySend(PageCommand.Unsent)
        _state.update { it.copy(save = SaveStatus.Unsaved) }
    }

    /** The page's renderer died: what the app still holds goes to the PC, and until it does the bar says so. */
    fun onPageGone() {
        if (pending == null) return
        _state.update { it.copy(save = SaveStatus.Unsaved) }
        flushNow()
    }

    private fun remember(s: WhiteboardMessage.Save) {
        val base = pageScene ?: return
        fun part(key: String) = base[key] as? JsonObject ?: JsonObject(emptyMap())
        pageScene = JsonObject(
            mapOf(
                "elements" to s.elements,
                "appState" to JsonObject(part("appState") + s.appState),
                "files" to JsonObject(part("files") + s.files),
            ),
        )
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
        val p = pending
        if (p != null) {
            // A save without a project cannot be sent anywhere; one of another project is stale.
            val name = p.project ?: return@withLock false
            if (name != project) { pending = null; return@withLock !unsynced }
            pending = null
            // A newer change cancels the waiting job, never a save that is already on its way.
            val r = withContext(NonCancellable) { backend.save(name, p) }
            if (r.isFailure) {
                // Nothing was saved: the changes (and the pictures that travelled with them) stay pending.
                pending = pending?.let { merge(p, it) } ?: p
                _state.update { it.copy(save = SaveStatus.Unsaved) }
                return@withLock false
            }
            if (p.offered.isNotEmpty()) _commands.trySend(PageCommand.Saved(p.offered))
        }
        val clean = pending == null && !unsynced
        if (clean) _state.update { it.copy(save = SaveStatus.Saved, confirmLeave = false) }
        clean
    }

    companion object {
        private val PAGE_KEYS = setOf("elements", "appState", "files")
        const val MAX_NOTE = 2000
        const val MAX_ATTACHMENTS = 200

        /** Tolerant: an entry with a missing or odd field is skipped, and a bad list is just empty; loading never fails here. */
        fun parseAttachments(el: kotlinx.serialization.json.JsonElement?): List<WhiteboardAttachment> {
            val arr = el as? kotlinx.serialization.json.JsonArray ?: return emptyList()
            fun str(o: JsonObject, k: String) = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
            fun num(o: JsonObject, k: String) = (o[k] as? JsonPrimitive)?.takeIf { !it.isString }?.content?.toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0 }?.toLong()
            val out = ArrayList<WhiteboardAttachment>()
            for (e in arr) {
                if (out.size >= MAX_ATTACHMENTS) break
                val o = e as? JsonObject ?: continue
                val name = str(o, "name")?.takeIf { it.isNotBlank() } ?: continue
                val size = num(o, "size") ?: continue
                val kind = str(o, "kind") ?: continue
                val note = str(o, "note") ?: continue
                val at = num(o, "addedAt") ?: continue
                val thumb = str(o, "thumb")?.takeIf { it.startsWith("data:image/") }
                out += WhiteboardAttachment(name, size, kind, note, at, thumb)
            }
            return out
        }

        /** [b] is the newer one: its drawing wins, the pictures of both are kept, and a picture is only replaced by a newer one. */
        private fun merge(a: WhiteboardMessage.Save, b: WhiteboardMessage.Save) = WhiteboardMessage.Save(
            elements = b.elements, appState = b.appState,
            files = JsonObject(a.files + b.files), png = b.png ?: a.png, flush = a.flush || b.flush,
            dropped = b.dropped, offered = a.offered + b.offered, project = b.project,
        )
    }
}

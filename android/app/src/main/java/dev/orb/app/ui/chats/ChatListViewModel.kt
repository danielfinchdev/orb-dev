package dev.orb.app.ui.chats

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.api.Confirmed
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.ui.linkErrorText
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class ChatFilter { All, Unread, Working, Direct }

/** «Recientes» (projects, most recent first) or «Prioridad» (what needs the person first, one flat list). */
enum class ChatOrder { Recent, Priority }

enum class SnoozeOption { OneHour, ThreeHours, Tomorrow, Clear }

sealed interface ListEntry {
    val key: String
    val contentType: String
}

@Immutable
data class HeaderEntry(val title: String, val pin: Boolean, override val key: String) : ListEntry {
    override val contentType get() = "header"
}

@Immutable
data class RowEntry(val row: ChatRow) : ListEntry {
    override val key get() = row.key
    override val contentType get() = "row"
}

@Immutable
data class ChatListState(
    val entries: List<ListEntry> = emptyList(),
    val sections: List<ChatSection> = emptyList(),
    val filter: ChatFilter = ChatFilter.All,
    val unreadChats: Int = 0,
    val workingChats: Int = 0,
    val total: Int = 0,
    val connection: ConnectionState = ConnectionState.Connecting,
    val online: Boolean = false,
    /** True once there is something to show: saved rows, or the first answer of the PC. */
    val loaded: Boolean = false,
    val refreshing: Boolean = false,
    /** The last attempt to read the list from the PC failed. */
    val loadFailed: Boolean = false,
    val order: ChatOrder = ChatOrder.Recent,
    /** The summary of the day, when the PC says this phone has not shown it today. */
    val digest: DayDigest? = null,
)

/** Groups what the list shows: pinned first, then the person's sections, then projects (most recent first). */
object ChatGrouping {
    fun matches(r: ChatRow, f: ChatFilter) = when (f) {
        ChatFilter.All -> true
        ChatFilter.Unread -> r.unread > 0
        ChatFilter.Working -> r.state == ChatState.Working
        ChatFilter.Direct -> r.direct
    }

    /**
     * The PC's `priorityRank`: 0 waits for the person (permission, question, task to approve or review), 1 finished with
     * something unseen, 2 working, 3 the rest (completed ones always last).
     */
    fun priorityRank(r: ChatRow) = when {
        r.done -> 3
        r.needsYou -> 0
        r.state == ChatState.Working -> 2
        r.unread > 0 && !r.muted -> 1
        else -> 3
    }

    private val byRankThenRecent = compareBy<ChatRow> { priorityRank(it) }
        .thenByDescending { it.at ?: "" }.thenBy { it.key }

    /** The keys in priority order: the snapshot the list takes when it opens (or when the person asks to reorder). */
    fun priorityKeys(rows: List<ChatRow>): List<String> = rows.filter { !it.done }.sortedWith(byRankThenRecent).map { it.key }

    /** [rows] in the order of a snapshot; a chat the snapshot did not know goes on top (by priority), none of the others moves. */
    fun inFrozenOrder(rows: List<ChatRow>, frozen: List<String>?): List<ChatRow> {
        val at = frozen?.withIndex()?.associate { it.value to it.index } ?: return rows.sortedWith(byRankThenRecent)
        val (known, fresh) = rows.partition { it.key in at }
        return fresh.sortedWith(byRankThenRecent) + known.sortedBy { at.getValue(it.key) }
    }

    fun build(
        rows: List<ChatRow>, sections: List<ChatSection>, filter: ChatFilter,
        order: ChatOrder = ChatOrder.Recent, frozen: List<String>? = null,
    ): List<ListEntry> {
        val visible = rows.filter { !it.done && matches(it, filter) }
        val recent = compareByDescending<ChatRow> { it.at ?: "" }.thenBy { it.key }
        val out = ArrayList<ListEntry>()
        val pinned = visible.filter { it.pinned }.sortedWith(compareBy<ChatRow> { it.pinOrder ?: Int.MAX_VALUE }.then(recent))
        if (pinned.isNotEmpty()) {
            out += HeaderEntry(ChatTexts.PINNED, true, "h:pinned")
            pinned.mapTo(out) { RowEntry(it) }
        }
        val rest = visible.filter { !it.pinned }
        if (order == ChatOrder.Priority) {
            // One flat group, like the PC: no project or section heads, the pinned ones stay on top.
            inFrozenOrder(rest, frozen).mapTo(out) { RowEntry(it) }
            return out
        }
        val known = sections.map { it.id }.toSet()
        for (s in sections) {
            val inSection = rest.filter { it.section == s.id }.sortedWith(recent)
            if (inSection.isEmpty()) continue
            out += HeaderEntry(s.name, false, "h:section:${s.id}")
            inSection.mapTo(out) { RowEntry(it) }
        }
        val byProject = rest.filter { it.section == null || it.section !in known }.groupBy { it.project }
        val order = byProject.entries.sortedWith(
            compareBy<Map.Entry<String?, List<ChatRow>>> { it.key == null }
                .thenByDescending { e -> e.value.maxOf { it.at ?: "" } }
                .thenBy { it.key ?: "" },
        )
        for ((project, list) in order) {
            out += HeaderEntry(project ?: ChatTexts.NO_PROJECT, false, "h:project:${project ?: ""}")
            list.sortedWith(recent).mapTo(out) { RowEntry(it) }
        }
        return out
    }
}

/**
 * The list of chats. The rows always come from the cache, so a list is there even without the PC; each answer of the
 * PC refreshes the cache and the list follows. Actions are requests to the PC: the row changes at once and goes back
 * if the PC refuses or cannot be reached.
 */
@OptIn(FlowPreview::class)
class ChatListViewModel(
    private val backend: ChatsBackend,
    private val clock: () -> Long = System::currentTimeMillis,
    private val reloadDebounceMs: Long = 300,
    dispatcher: CoroutineDispatcher = Dispatchers.Default,
) : ViewModel() {
    private class Patch(val id: Long, val apply: (ChatRow) -> ChatRow)

    private val patches = MutableStateFlow<Map<String, Patch>>(emptyMap())
    private var patchSeq = 0L
    private val filter = MutableStateFlow(ChatFilter.All)
    private val order = MutableStateFlow(ChatOrder.Recent)
    // The keys in the order the list had when it opened; rows do not move while the person attends them.
    private val frozen = MutableStateFlow<List<String>?>(null)
    private val digest = MutableStateFlow<DayDigest?>(null)
    private var digestAsked = false
    private val status = MutableStateFlow(Status())
    private val reloads = Channel<Unit>(Channel.CONFLATED)
    // Chats the person deleted: gone from the list at once, whatever the cache still says until the PC confirms.
    private val hidden = MutableStateFlow<Set<String>>(emptySet())
    private val _undo = Channel<ChatRef>(Channel.BUFFERED)
    private val _messages = Channel<String>(Channel.BUFFERED)

    private data class Status(val refreshing: Boolean = false, val failed: Boolean = false, val answered: Boolean = false)

    /** Short messages for a snackbar (an action the PC did not do). */
    val messages = _messages.receiveAsFlow()

    /** A chat was deleted on the PC and can still be brought back: the screen shows «Deshacer» for it. */
    val undoOffers = _undo.receiveAsFlow()

    private val data = combine(backend.inbox(), patches, hidden) { inbox, p, gone ->
        if (p.isEmpty() && gone.isEmpty()) inbox
        else inbox.copy(rows = inbox.rows.filter { it.key !in gone }.map { r -> p[r.key]?.apply?.invoke(r) ?: r })
    }

    private val view = combine(order, frozen, digest) { o, fr, d -> Triple(o, fr, d) }

    val state: StateFlow<ChatListState> = combine(data, filter, backend.connection, status, view) { inbox, f, c, st, v ->
        val rows = inbox.rows.filter { !it.done }
        ChatListState(
            entries = ChatGrouping.build(inbox.rows, inbox.sections, f, v.first, v.second), order = v.first, digest = v.third, sections = inbox.sections, filter = f,
            unreadChats = rows.count { it.unread > 0 }, workingChats = rows.count { it.state == ChatState.Working },
            total = rows.size, connection = c, online = c is ConnectionState.Online,
            loaded = rows.isNotEmpty() || st.answered, refreshing = st.refreshing, loadFailed = st.failed,
        )
    }.flowOn(dispatcher).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ChatListState())

    init {
        viewModelScope.launch { reloads.receiveAsFlow().debounce(reloadDebounceMs).collect { reload() } }
        viewModelScope.launch { backend.events.collect { onEvent(it) } }
        // The order is taken once the list is real (the PC answered, or there is no PC to wait for); then it is kept.
        viewModelScope.launch {
            combine(order, frozen, data, status, backend.connection) { o, fr, inbox, st, c ->
                if (o == ChatOrder.Priority && fr == null && inbox.rows.any { !it.done } && (st.answered || st.failed || c !is ConnectionState.Online)) {
                    frozen.value = ChatGrouping.priorityKeys(inbox.rows)
                }
            }.collect { }
        }
        // Whenever the PC becomes reachable the list is read again, which also covers the first open.
        viewModelScope.launch {
            backend.connection.map { it is ConnectionState.Online }.distinctUntilChanged().filter { it }.collect { reload(); loadDigest() }
        }
    }

    private fun onEvent(e: LinkEvent) {
        if (e.name in RELOAD_EVENTS) reloads.trySend(Unit)
    }

    private suspend fun reload() {
        status.update { it.copy(refreshing = true) }
        val r = backend.refreshInbox()
        status.update { Status(refreshing = false, failed = r.isFailure, answered = it.answered || r.isSuccess) }
    }

    /** Pull to refresh. */
    fun refresh() {
        viewModelScope.launch { reload() }
    }

    /** The morning card is asked once per run of the app; the PC decides if it is due (once per local day, per phone). */
    private suspend fun loadDigest() {
        if (digestAsked || !backend.available(ApiMethods.INBOX_DIGEST)) return
        backend.digest().onSuccess { digestAsked = true; digest.value = DayDigests.parse(it) }
    }

    /** Closing the card tells the PC it was shown, so it does not come back today. */
    fun closeDigest() {
        digest.value = null
        viewModelScope.launch { backend.digestSeen() }
    }

    fun setOrder(o: ChatOrder) {
        order.value = o
        frozen.value = null
    }

    /** «Reordenar por prioridad»: takes a new snapshot. */
    fun reorder() {
        frozen.value = null
    }

    fun setFilter(f: ChatFilter) {
        filter.value = f
    }

    fun canDelete(kind: ChatKind) = backend.available(if (kind == ChatKind.Orbe) ApiMethods.CONVERSATIONS_TRASH else ApiMethods.SESSIONS_TRASH)

    /** Deleting needs the PC to offer the trash; it is also the PC that can bring the chat back. */
    fun canUndoDelete(kind: ChatKind) = backend.available(if (kind == ChatKind.Orbe) ApiMethods.CONVERSATIONS_RESTORE else ApiMethods.SESSIONS_RESTORE)

    fun togglePin(row: ChatRow) = act(row.ref, { it.copy(pinned = !row.pinned, pinOrder = null) }) { backend.pin(row.ref, !row.pinned) }
    fun markRead(row: ChatRow) = act(row.ref, { it.copy(unread = 0) }) { backend.markRead(row.ref) }
    fun toggleMute(row: ChatRow) = act(row.ref, { it.copy(muted = !row.muted) }) { backend.mute(row.ref, !row.muted) }
    fun rename(row: ChatRow, title: String) {
        val t = title.trim()
        if (t.isEmpty() || t == row.title) return
        act(row.ref, { it.copy(title = t) }) { backend.rename(row.ref, t) }
    }

    fun archive(row: ChatRow) = act(row.ref, { it.copy(done = true) }) { backend.archive(row.ref) }

    fun snooze(row: ChatRow, option: SnoozeOption) {
        val now = clock()
        val until = when (option) {
            SnoozeOption.OneHour -> ChatTime.iso(now + 3_600_000L)
            SnoozeOption.ThreeHours -> ChatTime.iso(now + 3 * 3_600_000L)
            SnoozeOption.Tomorrow -> ChatTime.tomorrowMorning(now)
            SnoozeOption.Clear -> null
        }
        act(row.ref, { it.copy(snoozedUntil = until) }) { backend.snooze(row.ref, until) }
    }

    fun moveToSection(row: ChatRow, section: Long?) = act(row.ref, { it.copy(section = section) }) { backend.moveToSection(row.ref, section) }

    fun moveToNewSection(row: ChatRow, name: String) {
        val n = name.trim()
        if (n.isEmpty()) return
        act(row.ref, { it }) {
            backend.createSection(n).fold(onSuccess = { id -> backend.moveToSection(row.ref, id) }, onFailure = { Result.failure(it) })
        }
    }

    /**
     * [confirmed] comes from the dialog the person accepted. The row leaves the list at once; if the PC refuses or cannot
     * be reached it comes back.
     */
    fun delete(row: ChatRow, confirmed: Confirmed) {
        if (backend.connection.value !is ConnectionState.Online) {
            _messages.trySend(ChatTexts.ACTION_OFFLINE)
            return
        }
        hidden.update { it + row.key }
        viewModelScope.launch {
            backend.trash(row.ref, confirmed).fold(
                onSuccess = {
                    if (canUndoDelete(row.kind)) _undo.trySend(row.ref) else _messages.trySend(ChatTexts.DELETED_SNACK)
                    reload()
                    // Once the list no longer holds the chat there is nothing left to hide (a restore elsewhere shows it again).
                    val present = backend.inbox().first().rows.mapTo(HashSet()) { it.key }
                    hidden.update { gone -> gone.filterTo(HashSet()) { it in present } }
                },
                onFailure = {
                    hidden.update { it - row.key }
                    _messages.trySend("${ChatTexts.DELETE_FAILED}. ${linkErrorText(it)}")
                },
            )
        }
    }

    /** «Deshacer»: the PC brings the chat back and the list reads it again. */
    fun undoDelete(ref: ChatRef) {
        viewModelScope.launch {
            backend.restore(ref).fold(
                onSuccess = { hidden.update { it - ref.key }; reload() },
                onFailure = { _messages.trySend("${ChatTexts.RESTORE_FAILED}. ${linkErrorText(it)}") },
            )
        }
    }

    private fun act(ref: ChatRef, patch: (ChatRow) -> ChatRow, call: suspend () -> Result<Unit>) {
        if (backend.connection.value !is ConnectionState.Online) {
            _messages.trySend(ChatTexts.ACTION_OFFLINE)
            return
        }
        viewModelScope.launch {
            val id = ++patchSeq
            patches.update { it + (ref.key to Patch(id, patch)) }
            val r = call()
            if (r.isSuccess) reload()
            // Only the patch this action put there goes: a newer one on the same chat stays.
            patches.update { if (it[ref.key]?.id == id) it - ref.key else it }
            r.exceptionOrNull()?.let { _messages.trySend("${ChatTexts.ACTION_FAILED}. ${linkErrorText(it)}") }
        }
    }

    private companion object {
        val RELOAD_EVENTS = setOf("inbox:changed", "chat:new", "board:changed", "session:update", "session:removed", "approval:changed")
    }
}

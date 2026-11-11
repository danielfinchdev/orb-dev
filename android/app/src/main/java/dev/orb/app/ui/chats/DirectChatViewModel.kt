package dev.orb.app.ui.chats

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.ui.linkErrorText
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

@Immutable
data class DirectChatState(
    val title: String = ChatTexts.UNTITLED,
    val project: String? = null,
    val agent: String? = null,
    val model: String? = null,
    val permission: String? = null,
    val contextPercent: Int? = null,
    val items: List<DItem> = emptyList(),
    /** True once there is something to show: saved lines, or the first answer of the PC. */
    val loaded: Boolean = false,
    /** The PC says this conversation no longer exists (A28). */
    val deleted: Boolean = false,
    val online: Boolean = false,
    val connection: ConnectionState = ConnectionState.Connecting,
    val canLoadMore: Boolean = false,
    val loadingOlder: Boolean = false,
    val loadFailed: Boolean = false,
    /** The agent is running a turn on the PC. */
    val busy: Boolean = false,
    /** What the running turn is doing now (its latest unfinished step), or null while it only thinks. */
    val activity: String? = null,
    val stalled: Boolean = false,
    val limited: Boolean = false,
    val settled: Boolean = false,
    val canSteer: Boolean = false,
    val canCompact: Boolean = false,
    val queue: List<QueuedMsg> = emptyList(),
    /** Item ids of requests with an answer on its way to the PC. */
    val busyCards: Set<Long> = emptySet(),
) {
    val agentName get() = agentName(agent)
}

/** One-off things the screen does: open the copy a fork made, or leave a chat that is gone. */
sealed interface DirectEffect {
    data class Open(val id: String) : DirectEffect
    data object Leave : DirectEffect
}

/** How a message written while the agent works reaches it. */
enum class SendMode(val wire: String) { Steer("steer"), Queue("queue") }

/**
 * One direct conversation with an agent. Lines come from the cache first, then from the PC; the text being written
 * follows `session:delta` pieces and has its own state so only its bubble is drawn again. Everything the person does is
 * a request to the PC, shown at once and undone if the PC refuses.
 */
class DirectChatViewModel(
    private val backend: DirectChatBackend,
    private val session: String,
    private val clock: () -> Long = System::currentTimeMillis,
    dispatcher: CoroutineDispatcher = Dispatchers.Default,
) : ViewModel() {
    private val _state = MutableStateFlow(DirectChatState())
    val state: StateFlow<DirectChatState> = _state

    private val _liveText = MutableStateFlow(LiveText(""))
    val liveText: StateFlow<LiveText> = _liveText

    private val _messages = Channel<String>(Channel.BUFFERED)
    val messages = _messages.receiveAsFlow()

    private val _effects = Channel<DirectEffect>(Channel.BUFFERED)
    val effects = _effects.receiveAsFlow()

    private val info = MutableStateFlow<SessionInfo?>(null)
    private val queue = MutableStateFlow<List<QueuedMsg>>(emptyList())
    private val fresh = MutableStateFlow<Map<Long, RawItem>>(emptyMap())
    private val fromApprovals = MutableStateFlow<Map<Long, RawItem>>(emptyMap())
    private val decided = MutableStateFlow<Map<Long, String>>(emptyMap())
    private val busyCards = MutableStateFlow<Set<Long>>(emptySet())
    private val deleted = MutableStateFlow(false)
    private val loadFailed = MutableStateFlow(false)
    private val loadedOnce = MutableStateFlow(false)
    private val canLoadMore = MutableStateFlow(false)
    private val loadingOlder = MutableStateFlow(false)
    private val ghosts = MutableStateFlow<Map<String, Ghost>>(emptyMap())
    private val reloads = Channel<Unit>(Channel.CONFLATED)

    /** Ids the last reload returned: the events held for them are dropped once the cache shows them. */
    private val trimIds = MutableStateFlow<Set<Long>>(emptySet())
    private var seenPending = HashMap<String, PendingMessage>()
    private val modes = HashMap<String, SendMode>()
    private var markedAt = 0L
    private var maxId = 0L
    private var minId: Long? = null
    private var firstPage = true

    /** The id of the assistant line that replaces the streamed text: the text goes only once that line is drawn. */
    private var liveEndsAt: Long? = null

    private class Ghost(val pending: PendingMessage, val baseId: Long)

    private val parseCache = HashMap<String, RawItem?>()

    init {
        val saved = backend.cached(session).map { rows ->
            parseCache.keys.retainAll(rows.toHashSet())
            rows.mapNotNull { raw -> parseCache.getOrPut(raw) { DirectParser.parseRaw(raw) } }
        }.flowOn(dispatcher)

        val lines = combine(saved, fresh, fromApprovals, decided) { s, f, a, d -> Lines(s, f, a, d) }
        val pendingFlow = combine(backend.pending(session), ghosts) { q, g -> q to g }
        val statusFlow = combine(backend.connection, info, queue, busyCards) { c, i, q, b -> Status(c, i, q, b) }
        val flagsFlow = combine(deleted, loadFailed, loadedOnce, canLoadMore, loadingOlder) { d, f, l, c, o -> Flags(d, f, l, c, o) }

        combine(lines, pendingFlow, statusFlow, flagsFlow, backend.header(session)) { l, p, st, fl, header ->
            build(l, p.first, p.second, st, fl, header)
        }.onEach {
            _state.value = it
            clearLiveIfShown(it)
        }.launchIn(viewModelScope)

        // Events held for lines the cache now shows are dropped, so the cache is the only source from then on.
        saved.onEach { rows ->
            val ids = trimIds.value
            if (ids.isNotEmpty() && rows.map { it.id }.containsAll(ids)) {
                fresh.update { f -> f.filterKeys { it !in ids } }
                trimIds.value = emptySet()
            }
        }.launchIn(viewModelScope)

        // A message that left the send queue (the PC took it) waits as a ghost until its own line comes back.
        backend.pending(session).onEach { list ->
            val ids = list.map { it.clientId }.toSet()
            val gone = seenPending.filterKeys { it !in ids }
            if (gone.isNotEmpty()) {
                val base = maxId
                // A queued message shows in the tray, not as a line, so it leaves no ghost.
                val shown = gone.filterKeys { modes[it] != SendMode.Queue }
                if (shown.isNotEmpty()) ghosts.update { g -> g + shown.mapValues { Ghost(it.value, base) } }
                gone.keys.forEach { modes.remove(it) }
                reloads.trySend(Unit)
            }
            seenPending = HashMap(list.associateBy { it.clientId })
        }.launchIn(viewModelScope)

        backend.events.onEach(::onEvent).launchIn(viewModelScope)
        viewModelScope.launch { for (u in reloads) reload() }

        backend.connection.map { it is ConnectionState.Online }.distinctUntilChanged().onEach { online ->
            if (online) { reloads.trySend(Unit); refreshAside(); markRead() }
        }.launchIn(viewModelScope)
    }

    private data class Lines(val saved: List<RawItem>, val fresh: Map<Long, RawItem>, val approvals: Map<Long, RawItem>, val decided: Map<Long, String>)
    private data class Status(val c: ConnectionState, val info: SessionInfo?, val queue: List<QueuedMsg>, val busy: Set<Long>)
    private data class Flags(val deleted: Boolean, val failed: Boolean, val loaded: Boolean, val more: Boolean, val older: Boolean)

    private fun build(l: Lines, queued: List<PendingMessage>, ghost: Map<String, Ghost>, st: Status, fl: Flags, header: ChatRow?): DirectChatState {
        val byId = LinkedHashMap<Long, RawItem>()
        for (m in l.saved) byId[m.id] = m
        // A request that is pending on the PC shows even before the thread reloads; the saved copy wins once it has it.
        for ((id, m) in l.approvals) if (id !in byId) byId[id] = m
        for ((id, m) in l.fresh) byId[id] = m
        val ordered = byId.values.sortedBy { it.id }
        maxId = ordered.maxOfOrNull { it.id } ?: 0L
        minId = ordered.firstOrNull()?.id
        val shown = DirectParser.display(ordered, l.decided)
        val items = ArrayList<DItem>(shown.size + ghost.size + queued.size)
        items.addAll(shown)
        for (g in ghost.values) {
            val echoed = shown.any { it is DItem.User && it.id > g.baseId && it.text == g.pending.text }
            if (!echoed) items += DItem.Waiting(g.pending.copy(state = PendingState.Sending))
        }
        queued.mapTo(items) { DItem.Waiting(it) }
        val i = st.info
        val busy = i?.busy == true
        val agent = i?.agent ?: header?.agent
        val last = shown.lastOrNull() as? DItem.Activity
        return DirectChatState(
            title = i?.title ?: header?.title ?: ChatTexts.UNTITLED, project = i?.project ?: header?.project, agent = agent, model = i?.model,
            permission = i?.permission, contextPercent = i?.contextPercent, items = items,
            loaded = fl.loaded || ordered.isNotEmpty() || items.isNotEmpty(), deleted = fl.deleted, online = st.c is ConnectionState.Online,
            connection = st.c, canLoadMore = fl.more, loadingOlder = fl.older, loadFailed = fl.failed, busy = busy,
            activity = if (busy) last?.steps?.lastOrNull()?.takeIf { it.running }?.now else null,
            stalled = i?.stalled == true && !busy, limited = i?.limited == true, settled = i?.settled == true,
            canSteer = i?.canSteer ?: (agent == "claude" || agent == "codex"), canCompact = i?.canCompact ?: (agent == "claude" || agent == "codex"),
            queue = st.queue, busyCards = st.busy,
        )
    }

    /** The streamed text goes in the same frame the final line is drawn, so the bubble is replaced without a jump. */
    private fun clearLiveIfShown(s: DirectChatState) {
        val id = liveEndsAt ?: return
        if (s.items.any { it is DItem.Assistant && it.id == id }) { liveEndsAt = null; _liveText.value = LiveText("") }
    }

    private fun onEvent(ev: LinkEvent) {
        val o = ev.payload as? JsonObject ?: return
        when (ev.name) {
            "session:delta" -> if (o.str("id") == session) {
                val piece = o.str("text").orEmpty()
                // A piece, not the whole text: the PC sends what was written since its last event.
                if (piece.isNotEmpty()) _liveText.update { LiveText((it.text + piece).takeLast(MAX_LIVE)) }
            }
            "session:item" -> if (o.str("session_id") == session) DirectParser.item(o)?.let { m ->
                fresh.update { it + (m.id to m) }
                if (m.role == "assistant" && m.kind == "text") liveEndsAt = m.id
                markRead()
            }
            "session:update" -> if (o.str("id") == session) DirectParser.info(o)?.let(::onInfo)
            "session:queue" -> if (o.str("id") == session) queue.value = DirectParser.queue(o["queue"])
            "session:removed" -> if (o.str("id") == session) deleted.value = true
            "approval:changed" -> if (o.str("session") == session) {
                reloads.trySend(Unit)
                viewModelScope.launch { refreshApprovals() }
            }
        }
    }

    private fun onInfo(next: SessionInfo) {
        val before = info.value
        info.value = next
        // Not running: whatever was streamed is in the final lines (or was cut short), so no text stays hanging.
        if (!next.busy && liveEndsAt == null) _liveText.value = LiveText("")
        if (before?.busy == true && !next.busy) {
            reloads.trySend(Unit)
            viewModelScope.launch { refreshAside() }
            markRead()
        }
    }

    private suspend fun reload() {
        backend.load(session).fold(
            onSuccess = { ids ->
                loadFailed.value = false
                loadedOnce.value = true
                if (firstPage) { canLoadMore.value = ids.size >= PAGE; firstPage = false }
                ghosts.value = emptyMap()
                trimIds.value = ids.toSet()
            },
            onFailure = {
                if (ChatErrors.deleted(it)) deleted.value = true else loadFailed.value = true
                loadedOnce.value = true
            },
        )
    }

    /** What the thread does not carry: the row (agent, model, state), the requests that wait, the queue. */
    private suspend fun refreshAside() {
        backend.info(session).onSuccess { i -> if (i != null) onInfo(i) }
        refreshApprovals()
        backend.queue(session).onSuccess { queue.value = it }
    }

    private suspend fun refreshApprovals() {
        backend.approvals(session).onSuccess { rows ->
            fromApprovals.value = rows.mapNotNull { DirectParser.item(it) }.associateBy { it.id }
        }
    }

    fun loadOlder() {
        val before = minId?.takeIf { it > 0 } ?: return
        if (!canLoadMore.value || loadingOlder.value) return
        loadingOlder.value = true
        viewModelScope.launch {
            backend.load(session, before).fold(
                onSuccess = { ids -> canLoadMore.value = ids.size >= OLDER_PAGE },
                onFailure = { canLoadMore.value = false; say(it) },
            )
            loadingOlder.value = false
        }
    }

    fun retryLoad() { reloads.trySend(Unit); viewModelScope.launch { refreshAside() } }

    private fun markRead() {
        val now = clock()
        if (now - markedAt < 1000) return
        markedAt = now
        viewModelScope.launch { backend.markRead(session) }
    }

    // --- Sending ---

    /** While the agent works the message corrects it or waits in its queue; otherwise it starts a turn. */
    fun send(text: String, mode: SendMode? = null) {
        val t = text.trim()
        if (t.isEmpty()) return
        val s = _state.value
        val how = if (!s.busy) null else mode ?: if (s.canSteer) SendMode.Steer else SendMode.Queue
        viewModelScope.launch {
            backend.send(session, t, how?.wire).fold({ id -> if (how != null) modes[id] = how }, { say(it) })
        }
    }

    fun retrySend(clientId: String) { viewModelScope.launch { backend.retry(clientId) } }

    fun discard(clientId: String) {
        seenPending.remove(clientId)
        viewModelScope.launch { backend.discard(clientId) }
    }

    fun stop() { viewModelScope.launch { backend.stop(session).onFailure { say(it) } } }

    // --- Requests ---

    /** «Permitir» (`allow`), «Permitir siempre aquí» (`always`) or «Denegar» (`deny`) on an agent's request. */
    fun decide(item: DItem.Approval, decision: String) {
        if (item.id in busyCards.value || !item.pending) return
        busyCards.update { it + item.id }
        viewModelScope.launch {
            backend.decide(session, item.request, decision).fold(
                onSuccess = {
                    decided.update { it + (item.id to when (decision) { "deny" -> "denied"; "always" -> "always"; else -> "allowed" }) }
                },
                onFailure = {
                    if (ChatErrors.requestGone(it)) {
                        decided.update { d -> d + (item.id to "expired") }
                        _messages.trySend(ChatTexts.REQUEST_EXPIRED)
                        reloads.trySend(Unit)
                        refreshApprovals()
                    } else say(it)
                },
            )
            busyCards.update { it - item.id }
        }
    }

    // --- Queue ---

    fun editQueued(q: QueuedMsg, text: String) {
        val t = text.trim()
        if (t.isEmpty() || t == q.text) return
        queue.update { list -> list.map { if (it.id == q.id) it.copy(text = t) else it } }
        changeQueue(q) { backend.editQueued(session, q.id, text = t) }
    }

    fun removeQueued(q: QueuedMsg) {
        queue.update { list -> list.filter { it.id != q.id } }
        changeQueue(q) { backend.editQueued(session, q.id, remove = true) }
    }

    fun moveQueued(q: QueuedMsg, up: Boolean) {
        val list = queue.value
        val i = list.indexOfFirst { it.id == q.id }
        val j = if (up) i - 1 else i + 1
        if (i < 0 || j !in list.indices) return
        queue.value = list.toMutableList().also { it[i] = list[j]; it[j] = list[i] }
        changeQueue(q) { backend.editQueued(session, q.id, move = if (up) "up" else "down") }
    }

    // The PC answers with the queue it has; a refusal brings the real one back.
    private fun changeQueue(q: QueuedMsg, call: suspend () -> Result<Unit>) {
        viewModelScope.launch {
            call().onFailure { say(it) }
            backend.queue(session).onSuccess { queue.value = it }
        }
    }

    // --- Menu ---

    fun compact() { viewModelScope.launch { backend.compact(session).fold({ _messages.trySend(ChatTexts.COMPACT_ASKED) }, { say(it) }) } }
    fun resume() { viewModelScope.launch { backend.resume(session).fold({ _messages.trySend(ChatTexts.ASKED_RESUME) }, { say(it) }) } }

    fun fork() {
        viewModelScope.launch {
            backend.fork(session).fold({ _messages.trySend(ChatTexts.FORKED); _effects.trySend(DirectEffect.Open(it)) }, { say(it) })
        }
    }

    fun settle() {
        viewModelScope.launch {
            backend.settle(session).fold({ info.update { it?.copy(settled = true) }; _messages.trySend(ChatTexts.ASKED_SETTLE) }, { say(it) })
        }
    }

    fun archive() {
        viewModelScope.launch { backend.archive(session).fold({ _messages.trySend(ChatTexts.ASKED_ARCHIVE); _effects.trySend(DirectEffect.Leave) }, { say(it) }) }
    }

    fun rename(title: String) {
        val t = title.trim()
        if (t.isEmpty()) return
        val before = info.value
        info.update { it?.copy(title = t) }
        viewModelScope.launch {
            backend.rename(session, t).onFailure { info.value = before; say(it) }
        }
    }

    private fun say(e: Throwable) {
        if (ChatErrors.deleted(e)) { deleted.value = true; return }
        _messages.trySend(linkErrorText(e))
    }

    companion object {
        const val PAGE = 200
        const val OLDER_PAGE = 200
        private const val MAX_LIVE = 20_000
    }
}

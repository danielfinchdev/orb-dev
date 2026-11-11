package dev.orb.app.ui.chats

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.api.ApiMethods
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

/** One row of the list. Keys are stable (`m:<id>`, `q:<clientId>`) so the list moves instead of redrawing. */
@Immutable
sealed interface ChatItem {
    val key: String
    val contentType: String

    data class Msg(val message: ChatMessage, val provisional: Boolean = false) : ChatItem {
        override val key get() = if (message.id > 0) "m:${message.id}" else "n:${-message.id}"
        override val contentType get() = when (message.role) {
            MsgRole.User -> "user"
            MsgRole.Orbe -> if (message.card is MsgCard.None) "orbe" else "orbe-card"
            MsgRole.System -> if (message.card is MsgCard.None) "system" else "system-card"
        }
    }

    /** Written on the phone, not confirmed by the PC yet. */
    data class Waiting(val pending: PendingMessage) : ChatItem {
        override val key get() = "q:${pending.clientId}"
        override val contentType get() = "pending"
    }
}

/** A task the person is about to approve: the PC's own description, shown before the OK. */
@Immutable
data class ApprovalAsk(val detail: TaskDetail)

@Immutable
data class OrbeChatState(
    val title: String = ChatTexts.UNTITLED,
    val project: String? = null,
    val items: List<ChatItem> = emptyList(),
    /** True once there is something to show: saved lines, or the first answer of the PC. */
    val loaded: Boolean = false,
    /** The PC says this conversation no longer exists. */
    val deleted: Boolean = false,
    val online: Boolean = false,
    val connection: ConnectionState = ConnectionState.Connecting,
    val canLoadMore: Boolean = false,
    val loadingOlder: Boolean = false,
    val loadFailed: Boolean = false,
    /** `auto` / `preguntar`, or null when the PC did not say. */
    val mode: String? = null,
    val canSetMode: Boolean = false,
    val canCompact: Boolean = false,
    /** Ids of questions, reports and requests with an answer on its way to the PC. */
    val busyCards: Set<Long> = emptySet(),
    /** Status of the tasks behind `attention` cards (`awaiting_approval`, `running`…). */
    val taskStatus: Map<Long, String> = emptyMap(),
    val approval: ApprovalAsk? = null,
)

/** The streamed answer. Apart from the rest of the state so only its own bubble is drawn again on each piece. */
@Immutable
data class LiveText(val text: String)

/**
 * One Orbe conversation. Lines come from the cache first, then from the PC; the answer being written follows the
 * `chat:state` events. Everything the person does is a request to the PC, shown at once and undone if the PC refuses.
 */
class OrbeChatViewModel(
    private val backend: OrbeChatBackend,
    private val conversation: Long,
    private val clock: () -> Long = System::currentTimeMillis,
    dispatcher: CoroutineDispatcher = Dispatchers.Default,
) : ViewModel() {
    private val _state = MutableStateFlow(OrbeChatState())
    val state: StateFlow<OrbeChatState> = _state

    private val _liveInfo = MutableStateFlow<LiveInfo?>(null)

    /** What the assistant is doing now; null when it is idle and nothing waits. */
    val liveInfo: StateFlow<LiveInfo?> = _liveInfo

    private val _liveText = MutableStateFlow(LiveText(""))
    val liveText: StateFlow<LiveText> = _liveText

    private val _messages = Channel<String>(Channel.BUFFERED)

    /** Short messages for a snackbar. */
    val messages = _messages.receiveAsFlow()

    private val fresh = MutableStateFlow<Map<Long, ChatMessage>>(emptyMap())
    private val provisional = MutableStateFlow<List<ChatMessage>>(emptyList())
    private val overrides = MutableStateFlow<Map<Long, MsgCard>>(emptyMap())
    private val busyCards = MutableStateFlow<Set<Long>>(emptySet())
    private val mode = MutableStateFlow<String?>(null)
    private val deleted = MutableStateFlow(false)
    private val loadFailed = MutableStateFlow(false)
    private val loadedOnce = MutableStateFlow(false)
    private val canLoadMore = MutableStateFlow(false)
    private val loadingOlder = MutableStateFlow(false)
    private val taskStatus = MutableStateFlow<Map<Long, String>>(emptyMap())
    private val approval = MutableStateFlow<ApprovalAsk?>(null)
    private val ghosts = MutableStateFlow<Map<String, Ghost>>(emptyMap())
    private val reloads = Channel<Unit>(Channel.CONFLATED)
    private var seq = 0L
    private var seenPending = HashMap<String, PendingMessage>()
    private var asked = HashSet<Long>()
    private var markedAt = 0L
    private var maxId = 0L
    private var loadedOnceMore = false

    /** A message that left the queue (the PC took it) and waits for its own line to come back. */
    private class Ghost(val pending: PendingMessage, val baseId: Long)

    private val parseCache = HashMap<String, ChatMessage?>()

    init {
        // Lines: the cache, plus what arrived by event and is not saved yet.
        val saved = backend.cached(conversation).map { rows ->
            val keep = HashSet<String>(rows)
            parseCache.keys.retainAll(keep)
            rows.mapNotNull { raw -> parseCache.getOrPut(raw) { OrbeParser.parse(raw) } }
        }.flowOn(dispatcher)

        val listFlow = combine(saved, fresh, provisional, overrides) { s, f, p, o -> Lines(s, f, p, o) }
        val pendingFlow = combine(backend.pending(conversation), ghosts) { q, g -> q to g }
        val statusFlow = combine(backend.connection, mode, busyCards, taskStatus, approval) { c, m, b, t, a -> Status(c, m, b, t, a) }
        val flagsFlow = combine(deleted, loadFailed, loadedOnce, canLoadMore, loadingOlder) { d, f, l, c, o -> Flags(d, f, l, c, o) }

        combine(listFlow, pendingFlow, statusFlow, flagsFlow, backend.header(conversation)) { lines, pend, st, fl, header ->
            build(lines, pend.first, pend.second, st, fl, header)
        }.onEach { _state.value = it }.launchIn(viewModelScope)

        // Waiting messages that left the queue turn into ghosts until the PC's own line is here.
        backend.pending(conversation).onEach { list ->
            val ids = list.map { it.clientId }.toSet()
            val gone = seenPending.filterKeys { it !in ids }
            if (gone.isNotEmpty()) {
                val base = maxId
                ghosts.update { g -> g + gone.mapValues { Ghost(it.value, base) } }
                reloads.trySend(Unit)
            }
            seenPending = HashMap(list.associateBy { it.clientId })
        }.launchIn(viewModelScope)

        backend.events.onEach(::onEvent).launchIn(viewModelScope)

        viewModelScope.launch {
            for (u in reloads) reload()
        }

        // The first answer of the PC, and again whenever the link comes back.
        backend.connection.map { it is ConnectionState.Online }.distinctUntilChanged().onEach { online ->
            if (online) { reloads.trySend(Unit); loadSnapshot(); markRead() }
        }.launchIn(viewModelScope)
    }

    private data class Lines(val saved: List<ChatMessage>, val fresh: Map<Long, ChatMessage>, val provisional: List<ChatMessage>, val overrides: Map<Long, MsgCard>)
    private data class Status(val c: ConnectionState, val mode: String?, val busy: Set<Long>, val tasks: Map<Long, String>, val approval: ApprovalAsk?)
    private data class Flags(val deleted: Boolean, val failed: Boolean, val loaded: Boolean, val more: Boolean, val older: Boolean)


    private fun build(
        lines: Lines, queued: List<PendingMessage>, ghost: Map<String, Ghost>, st: Status, fl: Flags, header: ChatRow?,
    ): OrbeChatState {
        val byId = LinkedHashMap<Long, ChatMessage>()
        for (m in lines.saved) byId[m.id] = m
        // A line from an event is replaced by the saved one as soon as the cache has it.
        for ((id, m) in lines.fresh) if (id !in byId) byId[id] = m
        val real = byId.values.sortedBy { it.id }.map { m -> lines.overrides[m.id]?.let { m.copy(card = it) } ?: m }
        maxId = real.maxOfOrNull { it.id } ?: 0L
        val items = ArrayList<ChatItem>(real.size + lines.provisional.size + queued.size + ghost.size)
        real.mapTo(items) { ChatItem.Msg(it) }
        // A provisional line (a truncated `chat:new`) goes once its saved version is among the lines, so it does not show twice.
        val newReal = real.takeLast(6)
        lines.provisional.filterNot { p -> newReal.any { it.role == p.role && it.body.startsWith(p.body.trimEnd('…').take(80)) } }
            .mapTo(items) { ChatItem.Msg(it, provisional = true) }
        for (g in ghost.values) {
            val echoed = real.any { it.role == MsgRole.User && it.id > g.baseId && (it.clientId == g.pending.clientId || it.body == g.pending.text) }
            if (!echoed) items += ChatItem.Waiting(g.pending.copy(state = PendingState.Sending))
        }
        queued.mapTo(items) { ChatItem.Waiting(it) }
        val online = st.c is ConnectionState.Online
        return OrbeChatState(
            title = header?.title ?: ChatTexts.UNTITLED, project = header?.project, items = items,
            loaded = fl.loaded || real.isNotEmpty() || items.isNotEmpty(), deleted = fl.deleted, online = online, connection = st.c,
            canLoadMore = fl.more, loadingOlder = fl.older, loadFailed = fl.failed, mode = st.mode,
            canSetMode = backend.available(ApiMethods.PERMISSIONS_SET_MODE), canCompact = backend.available(ApiMethods.CHAT_COMPACT),
            busyCards = st.busy, taskStatus = st.tasks, approval = st.approval,
        )
    }


    private fun onEvent(ev: LinkEvent) {
        val o = ev.payload as? JsonObject
        when (ev.name) {
            "chat:state" -> if (o != null && OrbeParser.conversationOf(o) == conversation) onState(o)
            "chat:new" -> if (o != null && OrbeParser.conversationOf(o) == conversation) {
                // The event carries only the first 240 characters: show it now, the whole line replaces it after the reload.
                OrbeParser.message(JsonObject(o + ("id" to kotlinx.serialization.json.JsonPrimitive(-(++seq)))))?.let { m ->
                    provisional.update { it + m }
                }
                reloads.trySend(Unit)
            }
            LinkEvent.RELOAD -> if (o != null && OrbeParser.conversationOf(o) == conversation) { reloads.trySend(Unit); viewModelScope.launch { loadSnapshot() } }
            "config:changed" -> viewModelScope.launch { loadSnapshot() }
        }
    }

    private fun onState(o: JsonObject) {
        val info = OrbeParser.live(o)
        if (info.busy) {
            _liveInfo.value = info
            _liveText.value = LiveText(OrbeParser.partial(o))
            return
        }
        // The turn ended: the final line takes the place of the streamed bubble in the same step.
        OrbeParser.answer(o)?.let { m -> fresh.update { it + (m.id to m) } }
        _liveText.value = LiveText("")
        _liveInfo.value = if (info.waiting || info.queued > 0) info else null
        reloads.trySend(Unit)
        markRead()
    }

    private suspend fun reload() {
        backend.load(conversation).fold(
            onSuccess = { n ->
                loadFailed.value = false
                loadedOnce.value = true
                if (!loadedOnceMore) { canLoadMore.value = n >= PAGE; loadedOnceMore = true }
                provisional.value = emptyList()
                fresh.update { f -> f.filterKeys { it > maxId } }
                ghosts.value = emptyMap()
            },
            onFailure = {
                if (ChatErrors.deleted(it)) deleted.value = true else loadFailed.value = true
                loadedOnce.value = true
            },
        )
    }


    /** Earlier lines, when the person reaches the top. */
    fun loadOlder() {
        val before = _state.value.items.firstNotNullOfOrNull { (it as? ChatItem.Msg)?.message?.id?.takeIf { id -> id > 0 } } ?: return
        if (!canLoadMore.value || loadingOlder.value) return
        loadingOlder.value = true
        viewModelScope.launch {
            backend.load(conversation, before).fold(
                onSuccess = { n -> canLoadMore.value = n >= OLDER_PAGE },
                onFailure = { canLoadMore.value = false; say(it) },
            )
            loadingOlder.value = false
        }
    }

    fun retryLoad() { reloads.trySend(Unit); viewModelScope.launch { loadSnapshot() } }

    private suspend fun loadSnapshot() {
        backend.snapshot(conversation).onSuccess { s ->
            if (s.mode != null) mode.value = s.mode
            // Opened in the middle of a turn: there is no event to wait for, so the state is taken from here.
            s.chat?.let { c -> if (_liveInfo.value == null) onState(c) }
        }
    }

    private fun markRead() {
        val now = clock()
        if (now - markedAt < 1000) return
        markedAt = now
        viewModelScope.launch { backend.markRead(conversation) }
    }

    fun send(text: String) {
        val t = text.trim()
        if (t.isEmpty()) return
        viewModelScope.launch { backend.send(conversation, t).onFailure { say(it) } }
    }

    fun retrySend(clientId: String) { viewModelScope.launch { backend.retry(clientId) } }

    fun discard(clientId: String) {
        seenPending.remove(clientId)
        viewModelScope.launch { backend.discard(clientId) }
    }

    fun stop() { viewModelScope.launch { backend.stop(conversation).onFailure { say(it) } } }

    fun compact() {
        viewModelScope.launch {
            backend.compact(conversation).fold({ _messages.trySend(ChatTexts.COMPACT_ASKED) }, { say(it) })
        }
    }

    fun setMode(next: String) {
        val before = mode.value
        if (before == next) return
        mode.value = next
        viewModelScope.launch {
            backend.setMode(next).onFailure { mode.value = before; say(it) }
        }
    }

    // --- Cards ---

    fun answer(message: ChatMessage, choices: List<String>, other: String?, skip: Boolean) {
        val q = message.card as? MsgCard.Question ?: return
        if (message.id in busyCards.value) return
        busyCards.update { it + message.id }
        viewModelScope.launch {
            backend.answer(message.id, choices, other?.trim()?.ifBlank { null }, skip).fold(
                onSuccess = {
                    val said = if (skip) null else (choices.joinToString(", ").ifBlank { null } ?: other?.trim())
                    overrides.update { it + (message.id to q.copy(status = if (skip) "skipped" else "answered", answer = said)) }
                    reloads.trySend(Unit)
                },
                onFailure = {
                    when {
                        ChatErrors.questionGone(it) -> { _messages.trySend(ChatTexts.QUESTION_GONE); reloads.trySend(Unit) }
                        ChatErrors.deleted(it) -> deleted.value = true
                        else -> say(it)
                    }
                },
            )
            busyCards.update { it - message.id }
        }
    }

    fun accept(message: ChatMessage) {
        val r = message.card as? MsgCard.Report ?: return
        if (message.id in busyCards.value) return
        busyCards.update { it + message.id }
        viewModelScope.launch {
            backend.accept(message.id).fold(
                onSuccess = { overrides.update { it + (message.id to r.copy(accepted = true)) }; reloads.trySend(Unit) },
                onFailure = { say(it) },
            )
            busyCards.update { it - message.id }
        }
    }

    /** «Permitir una vez» (`allow`), «Siempre» (`always`) or «Denegar» (`deny`) on an agent's request. */
    fun decideRequest(message: ChatMessage, decision: String) {
        val p = message.card as? MsgCard.Permission ?: return
        val session = p.session ?: return
        val request = p.request ?: return
        if (message.id in busyCards.value) return
        busyCards.update { it + message.id }
        viewModelScope.launch {
            backend.decideRequest(session, request, decision).fold(
                onSuccess = {
                    val status = when (decision) { "deny" -> "denied"; "always" -> "always"; else -> "allowed" }
                    overrides.update { it + (message.id to p.copy(status = status)) }
                },
                onFailure = {
                    if (ChatErrors.requestGone(it)) { overrides.update { o -> o + (message.id to p.copy(status = "expired")) }; _messages.trySend(ChatTexts.REQUEST_GONE) }
                    else say(it)
                },
            )
            busyCards.update { it - message.id }
        }
    }

    /** Reads what the card's task is now; asked once per task while the chat is open. */
    fun watchTask(task: Long) {
        if (!asked.add(task)) return
        viewModelScope.launch { refreshTask(task) }
    }

    private suspend fun refreshTask(task: Long) {
        backend.taskDetail(task).onSuccess { d -> d.status?.let { s -> taskStatus.update { it + (task to s) } } }
    }

    /** «Aprobar»: first shows what the task is and where it runs, as the PC's own window does. */
    fun askApproval(task: Long) {
        viewModelScope.launch {
            backend.taskDetail(task).fold({ approval.value = ApprovalAsk(it) }, { say(it) })
        }
    }

    fun dismissApproval() { approval.value = null }

    fun confirmApproval() {
        val ask = approval.value ?: return
        approval.value = null
        decideTask(ask.detail.id, true, ask.detail.hash)
    }

    fun rejectTask(task: Long) {
        viewModelScope.launch {
            backend.taskDetail(task).fold({ decideTask(task, false, it.hash) }, { say(it) })
        }
    }

    private fun decideTask(task: Long, approve: Boolean, hash: String?) {
        viewModelScope.launch {
            backend.decideTask(task, approve, hash).fold(
                onSuccess = { taskStatus.update { it + (task to if (approve) "approved" else "cancelled") }; refreshTask(task); reloads.trySend(Unit) },
                onFailure = { say(it); refreshTask(task) },
            )
        }
    }

    private fun say(e: Throwable) {
        if (ChatErrors.deleted(e)) { deleted.value = true; return }
        _messages.trySend(linkErrorText(e))
    }

    companion object {
        const val PAGE = 150
        const val OLDER_PAGE = 100
    }
}

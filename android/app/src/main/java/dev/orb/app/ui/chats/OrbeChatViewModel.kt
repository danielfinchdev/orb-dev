package dev.orb.app.ui.chats

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.ui.linkErrorText
import dev.orb.app.ui.tasks.TaskAction
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

/**
 * «Deshacer esta tarea» waiting for the person's yes; [files] is how many files it changed, when the PC said. [checkpoint] is
 * the point of return the dialog was opened on: it goes back with the yes, so a task that ran again meanwhile is not undone.
 */
@Immutable
data class UndoAsk(val task: Long, val title: String, val files: Int?, val checkpoint: String? = null)

/**
 * The queued message being edited; [error] is what the PC answered to the last try, word for word. [session] tells one opening
 * of the editor from the next: an answer that comes back after the editor was closed or opened on another message is not for it.
 */
@Immutable
data class QueueEditor(val item: OrbeQueued, val busy: Boolean = false, val error: String? = null, val revision: Int = 0, val session: Long = 0)

@Immutable
data class OrbeChatState(
    val title: String = ChatTexts.UNTITLED,
    val project: String? = null,
    val items: List<ChatItem> = emptyList(),
    /** True once there is something to show: saved lines, or the first answer of the PC. */
    val loaded: Boolean = false,
    /** The PC says this conversation no longer exists. */
    val deleted: Boolean = false,
    /** The PC can bring a deleted chat back, so the deleted screen offers it. */
    val canRestore: Boolean = false,
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
    /** How this conversation thinks, as the PC says it (`chat.settings`); null when it does not say. */
    val brain: BrainInfo? = null,
    /** Tasks of this conversation that are running now, with what each is doing (`tasks.live`). */
    val liveTasks: List<LiveTask> = emptyList(),
    /** What the PC says about the tasks behind cards: title, agent and state. */
    val taskInfo: Map<Long, TaskDetail> = emptyMap(),
    /** File and line counts of finished tasks (`tasks.diff {stat}`); a task missing here shows no counts. */
    val taskStat: Map<Long, TaskStat> = emptyMap(),
    /** Tasks that have their own «espera tu OK» card in this thread, so their end does not draw a second one. */
    val attentionTasks: Set<Long> = emptySet(),
    /** The PC's queue behind the running turn, in order; empty with a PC that cannot list it. */
    val queue: List<OrbeQueued> = emptyList(),
    val canEditQueue: Boolean = false,
    val queueEditor: QueueEditor? = null,
    val undoAsk: UndoAsk? = null,
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
    /** The pictures and files of the message being written; null where the chat has no way to attach. */
    val attach: dev.orb.app.attach.AttachController? = null,
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
    private val brain = MutableStateFlow<BrainInfo?>(null)
    private val runningTasks = MutableStateFlow<List<LiveTask>>(emptyList())
    private val taskInfo = MutableStateFlow<Map<Long, TaskDetail>>(emptyMap())
    private val taskStat = MutableStateFlow<Map<Long, TaskStat>>(emptyMap())
    private val queueItems = MutableStateFlow<List<OrbeQueued>>(emptyList())
    private val queueEditor = MutableStateFlow<QueueEditor?>(null)
    private val undoAsk = MutableStateFlow<UndoAsk?>(null)
    private val queueRequests = Channel<Unit>(Channel.CONFLATED)
    private val taskRefreshes = Channel<Unit>(Channel.CONFLATED)
    private var lastQueued = 0

    private val _opens = Channel<Long>(Channel.BUFFERED)

    /** Tasks the person must see on their own screen (a card that cannot show what it asks to approve). */
    val openTask = _opens.receiveAsFlow()

    private val _undone = Channel<Long>(Channel.BUFFERED)

    /** Tasks just undone, for the «Deshecho · Ver» notice. */
    val undone = _undone.receiveAsFlow()
    private val liveRequests = Channel<Unit>(Channel.CONFLATED)
    private val ghosts = MutableStateFlow<Map<String, Ghost>>(emptyMap())
    private val reloads = Channel<Unit>(Channel.CONFLATED)
    private var seq = 0L
    private var seenPending = HashMap<String, PendingMessage>()
    private var asked = HashSet<Long>()
    private var markedAt = 0L
    private var maxId = 0L

    /** The id of the latest line of the thread that names each task: which cards are the newest. */
    @Volatile private var recency: Map<Long, Long> = emptyMap()
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

        val bitsFlow = combine(queueItems, queueEditor, undoAsk) { q, e, u -> Bits(q, e, u) }
        val extraFlow = combine(brain, runningTasks, taskInfo, taskStat, bitsFlow) { b, l, t, st, bits -> Extra(b, l, t, st, bits) }
        val headerFlow = combine(backend.header(conversation), extraFlow) { h, e -> h to e }

        combine(listFlow, pendingFlow, statusFlow, flagsFlow, headerFlow) { lines, pend, st, fl, head ->
            build(lines, pend.first, pend.second, st, fl, head.first, head.second)
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
        // At most one `tasks.live` call every 1.5 s however many events ask for it.
        viewModelScope.launch {
            for (u in liveRequests) {
                if (backend.connection.value is ConnectionState.Online) backend.liveTasks().onSuccess { runningTasks.value = it }
                kotlinx.coroutines.delay(LIVE_GAP_MS)
            }
        }

        // The PC's queue is asked again whenever it says it changed, at most once a second however many events say so.
        viewModelScope.launch {
            for (u in queueRequests) {
                if (backend.connection.value is ConnectionState.Online) refreshQueue()
                kotlinx.coroutines.delay(QUEUE_GAP_MS)
            }
        }
        // Cards of tasks that are not settled are read again when the board changes.
        viewModelScope.launch {
            for (u in taskRefreshes) {
                if (backend.connection.value is ConnectionState.Online) unsettledTasks().forEach { refreshTask(it) }
                kotlinx.coroutines.delay(LIVE_GAP_MS)
            }
        }

        // The first answer of the PC, and again whenever the link comes back.
        backend.connection.map { it is ConnectionState.Online }.distinctUntilChanged().onEach { online ->
            if (online) {
                reloads.trySend(Unit); loadSnapshot(); markRead(); liveRequests.trySend(Unit); if (canEditQueue()) queueRequests.trySend(Unit)
                // Whatever happened to the tasks while the link was down did not reach the cards.
                viewModelScope.launch { unsettledTasks().forEach { refreshTask(it) } }
            }
        }.launchIn(viewModelScope)
    }

    private data class Lines(val saved: List<ChatMessage>, val fresh: Map<Long, ChatMessage>, val provisional: List<ChatMessage>, val overrides: Map<Long, MsgCard>)
    private data class Bits(val queue: List<OrbeQueued>, val editor: QueueEditor?, val undo: UndoAsk?)
    private data class Extra(val brain: BrainInfo?, val running: List<LiveTask>, val info: Map<Long, TaskDetail>, val stat: Map<Long, TaskStat>, val bits: Bits)
    private data class Status(val c: ConnectionState, val mode: String?, val busy: Set<Long>, val tasks: Map<Long, String>, val approval: ApprovalAsk?)
    private data class Flags(val deleted: Boolean, val failed: Boolean, val loaded: Boolean, val more: Boolean, val older: Boolean)


    private fun build(
        lines: Lines, queued: List<PendingMessage>, ghost: Map<String, Ghost>, st: Status, fl: Flags, header: ChatRow?, extra: Extra,
    ): OrbeChatState {
        val byId = LinkedHashMap<Long, ChatMessage>()
        for (m in lines.saved) byId[m.id] = m
        // A line from an event is replaced by the saved one as soon as the cache has it.
        for ((id, m) in lines.fresh) if (id !in byId) byId[id] = m
        val real = byId.values.sortedBy { it.id }.map { m -> lines.overrides[m.id]?.let { m.copy(card = it) } ?: m }
        maxId = real.maxOfOrNull { it.id } ?: 0L
        recency = HashMap<Long, Long>().also { r -> for (m in real) tasksOf(m).forEach { t -> r[t] = m.id } }
        val items = ArrayList<ChatItem>(real.size + lines.provisional.size + queued.size + ghost.size)
        real.mapTo(items) { ChatItem.Msg(it) }
        // A provisional line (a truncated `chat:new`) goes once its saved version is among the lines, so it does not show twice.
        val newReal = real.takeLast(6)
        lines.provisional.filterNot { p -> newReal.any { it.role == p.role && it.body.startsWith(p.body.trimEnd('…').take(80)) } }
            .mapTo(items) { ChatItem.Msg(it, provisional = true) }
        for (g in ghost.values) {
            val echoed = real.any { it.role == MsgRole.User && it.id > g.baseId && (it.clientId == g.pending.clientId || it.body == g.pending.text) }
            if (!echoed) items += ChatItem.Waiting(g.pending.copy(state = PendingState.Arrived))
        }
        queued.mapTo(items) { ChatItem.Waiting(it) }
        val online = st.c is ConnectionState.Online
        return OrbeChatState(
            title = header?.title ?: ChatTexts.UNTITLED, project = header?.project, items = items,
            loaded = fl.loaded || real.isNotEmpty() || items.isNotEmpty(), deleted = fl.deleted, canRestore = backend.available(ApiMethods.CONVERSATIONS_RESTORE), online = online, connection = st.c,
            canLoadMore = fl.more, loadingOlder = fl.older, loadFailed = fl.failed, mode = st.mode,
            canSetMode = backend.available(ApiMethods.PERMISSIONS_SET_MODE), canCompact = backend.available(ApiMethods.CHAT_COMPACT),
            busyCards = st.busy, taskStatus = st.tasks, approval = st.approval, brain = extra.brain, taskInfo = extra.info,
            taskStat = extra.stat, attentionTasks = real.mapNotNull { (it.card as? MsgCard.TaskAttention)?.task }.toSet(),
            queue = extra.bits.queue, canEditQueue = canEditQueue(), queueEditor = extra.bits.editor, undoAsk = extra.bits.undo,
            liveTasks = referencedTasks(real).let { ids -> extra.running.filter { it.id in ids }.sortedBy { it.id } },
        )
    }


    /** The tasks the thread talks about: the ones its lines carry and the ones the recent lines name with «#42». */
    private fun referencedTasks(lines: List<ChatMessage>): Set<Long> {
        val ids = HashSet<Long>()
        for (m in lines) ids += tasksOf(m)
        for (m in lines.takeLast(MENTION_WINDOW)) if (m.role != MsgRole.User) MENTION.findAll(m.body).forEach { it.groupValues[1].toLongOrNull()?.let(ids::add) }
        return ids
    }

    private fun tasksOf(m: ChatMessage): List<Long> {
        val out = ArrayList<Long>(2)
        m.task?.let(out::add)
        when (val c = m.card) {
            is MsgCard.TaskAttention -> out += c.task
            is MsgCard.Permission -> c.task?.let(out::add)
            is MsgCard.Report -> out += c.tasks
            else -> {}
        }
        return out
    }

    /** Asks for the running tasks again; the screen calls it while something is running. */
    fun refreshLive() { liveRequests.trySend(Unit) }

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
            "board:changed" -> { liveRequests.trySend(Unit); taskRefreshes.trySend(Unit) }
            "approval:changed" -> taskRefreshes.trySend(Unit)
        }
    }

    private fun onState(o: JsonObject) {
        val info = OrbeParser.live(o)
        // `queued` counts turns, not messages: the list itself is only ever read from the PC.
        if (canEditQueue() && (info.queued > 0 || queueItems.value.isNotEmpty() || info.queued != lastQueued)) queueRequests.trySend(Unit)
        lastQueued = info.queued
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
        backend.brain(conversation).onSuccess { b -> if (b != null) brain.value = b }
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
        // The names are taken now: the next message starts with a clean strip.
        val images = attach?.remoteNames().orEmpty()
        attach?.discard()
        viewModelScope.launch { backend.send(conversation, t, images).onFailure { say(it) } }
    }

    override fun onCleared() {
        attach?.close()
    }

    fun retrySend(clientId: String) { viewModelScope.launch { backend.retry(clientId) } }

    fun discard(clientId: String) {
        seenPending.remove(clientId)
        viewModelScope.launch { backend.discard(clientId) }
    }

    /** Asks the PC to bring the chat back; the thread is read again once it does. */
    fun restore() {
        viewModelScope.launch {
            backend.restore(conversation).fold(
                onSuccess = { deleted.value = false; reloads.trySend(Unit) },
                onFailure = { _messages.trySend("${ChatTexts.RESTORE_FAILED}. ${linkErrorText(it)}") },
            )
        }
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

    /**
     * Read numbers: only the answer of the latest read of a task is applied. An answer that left the PC before the OK was given
     * and arrives after it would put the "Aprobar" button back on a task that was already decided.
     */
    private val readIssued = java.util.concurrent.ConcurrentHashMap<Long, Long>()
    private val readCounter = java.util.concurrent.atomic.AtomicLong()
    private fun issueRead(task: Long): Long = readCounter.incrementAndGet().also { readIssued[task] = it }
    private fun isLatest(task: Long, read: Long) = readIssued[task] == read

    private suspend fun refreshTask(task: Long) {
        val read = issueRead(task)
        backend.taskDetail(task).onSuccess { applyRead(task, read, it) }
    }

    /** Shows what one read of the task said, unless a later read (or a decision) was asked after it. */
    private suspend fun applyRead(task: Long, read: Long, d: TaskDetail) {
        if (!isLatest(task, read)) return
        d.status?.let { s -> taskStatus.update { it + (task to s) } }
        taskInfo.update { it + (task to d) }
        // The counts are only worth asking for while there are changes to look at.
        if (TaskAction.SeeChanges in d.actions) {
            backend.taskStat(task).onSuccess { st ->
                // The counts come from a second request: a newer read of the task may have been asked while it was on its way.
                if (isLatest(task, read)) taskStat.update { m -> if (st != null) m + (task to st) else m - task }
            }
        } else taskStat.update { it - task }
    }

    /**
     * The cards that can still change, the newest of the thread first: waiting, queued, running, done without an answer to
     * «Aceptar», or asked and never answered. Only [MAX_REFRESH] are read at a time, so the old ones are the ones left out.
     */
    private fun unsettledTasks(): List<Long> {
        val info = taskInfo.value
        val rank = recency
        val ids = LinkedHashSet<Long>(info.keys).apply { addAll(asked) }
        return ids.filter { t ->
            val d = info[t]
            d == null || d.status in UNSETTLED || (d.status == "done" && !d.accepted && !d.undone)
        }.sortedWith(compareByDescending<Long> { rank[it] ?: 0L }.thenByDescending { it }).take(MAX_REFRESH)
    }

    /**
     * The card's «Aprobar». The card showed the task as [shownHash] fingerprints it: only that is approved. If the card
     * cannot show what the OK is about, or what it showed is no longer what was read last, nothing is approved here.
     */
    fun approveFromCard(task: Long, shownHash: String?) {
        val key = taskKey(task)
        if (key in busyCards.value) return
        val info = taskInfo.value[task]
        when {
            // Nothing read yet: the PC's description is fetched and shown in the dialog (or the task's screen opens).
            info == null -> askApproval(task)
            // A description the card cut was not read whole: the task's own screen shows it.
            shownHash.isNullOrBlank() || !info.approvableFromCard || TaskAction.Approve !in info.actions -> _opens.trySend(task)
            // What was on screen is not the latest read: the new one is drawn first, the OK waits for a new tap.
            shownHash != info.hash -> _messages.trySend(ChatTexts.TASK_CHANGED)
            else -> {
                busyCards.update { it + key }
                viewModelScope.launch {
                    decideTask(task, true, shownHash)
                    busyCards.update { it - key }
                }
            }
        }
    }

    /** The PC's description in a dialog, read now; a task that is still not describable opens its own screen instead. */
    fun askApproval(task: Long) {
        val key = taskKey(task)
        if (key in busyCards.value) return
        busyCards.update { it + key }
        viewModelScope.launch {
            val read = issueRead(task)
            backend.taskDetail(task).fold(
                {
                    if (isLatest(task, read)) {
                        taskInfo.update { m -> m + (task to it) }
                        // The dialog shows the whole description (it scrolls), so a long one is still approved from it.
                        if (it.approvable && TaskAction.Approve in it.actions) approval.value = ApprovalAsk(it) else _opens.trySend(task)
                    }
                },
                { say(it) },
            )
            busyCards.update { it - key }
        }
    }

    /** Task cards share `busyCards` with message cards; the negative id keeps the two ranges apart. */
    private fun taskKey(task: Long) = -task

    fun dismissApproval() { approval.value = null }

    fun confirmApproval() {
        val ask = approval.value ?: return
        val key = taskKey(ask.detail.id)
        if (key in busyCards.value) return
        approval.value = null
        busyCards.update { it + key }
        viewModelScope.launch {
            decideTask(ask.detail.id, true, ask.detail.hash)
            busyCards.update { it - key }
        }
    }

    /** Called after the person confirmed the rejection. */
    fun rejectTask(task: Long) {
        val key = taskKey(task)
        if (key in busyCards.value) return
        busyCards.update { it + key }
        viewModelScope.launch {
            backend.taskDetail(task).fold({ decideTask(task, false, it.hash) }, { say(it) })
            busyCards.update { it - key }
        }
    }

    private suspend fun decideTask(task: Long, approve: Boolean, hash: String?) {
        backend.decideTask(task, approve, hash).fold(
            onSuccess = {
                // Reads still on their way were asked before this decision: whatever they say is old.
                issueRead(task)
                taskStatus.update { it + (task to if (approve) "queued" else "cancelled") }
                // The card folds at once; the PC's own answer replaces this right after.
                taskInfo.update { m ->
                    m[task]?.let { d -> m + (task to d.copy(status = if (approve) "queued" else "cancelled", decision = if (approve) "approved" else "rejected", actions = emptySet())) } ?: m
                }
                if (approve) _messages.trySend(ChatTexts.APPROVED_SNACK)
                refreshTask(task); reloads.trySend(Unit)
            },
            onFailure = { say(it); refreshTask(task) },
        )
    }

    /**
     * «Aceptar» on a finished task's card (`tasks.accept`), only where the PC allows it for that task. The card may be older than
     * the last thing the PC did with the task (the link was down, the app was away, the task was not among the ones read again),
     * and accepting a task Orb has held since would keep work nobody looked at: the PC is asked again first, and `unheld`
     * makes it refuse, changing nothing, if the task is held or no longer finished by the time the request arrives.
     */
    fun acceptTask(task: Long) {
        val key = taskKey(task)
        if (key in busyCards.value || TaskAction.AcceptHeld !in taskInfo.value[task]?.actions.orEmpty()) return
        busyCards.update { it + key }
        viewModelScope.launch {
            val read = issueRead(task)
            backend.taskDetail(task).fold(
                onSuccess = { fresh ->
                    applyRead(task, read, fresh)
                    if (fresh.status != "done" || fresh.held || TaskAction.AcceptHeld !in fresh.actions) _messages.trySend(ChatTexts.ACCEPT_UNAVAILABLE)
                    else backend.acceptTask(task, unheld = true).fold(
                        onSuccess = { _messages.trySend(ChatTexts.TASK_ACCEPTED); refreshTask(task) },
                        onFailure = { sayPc(it); refreshTask(task) },
                    )
                },
                onFailure = { say(it) },
            )
            busyCards.update { it - key }
        }
    }

    /** «Deshacer» only asks: the files of the PC are not touched until [confirmUndo]. */
    fun askUndo(task: Long) {
        val info = taskInfo.value[task] ?: return
        if (TaskAction.UndoHeld !in info.actions) return
        undoAsk.value = UndoAsk(task, info.title, taskStat.value[task]?.files, info.checkpointId)
    }

    fun dismissUndo() { undoAsk.value = null }

    fun confirmUndo() {
        val ask = undoAsk.value ?: return
        undoAsk.value = null
        val key = taskKey(ask.task)
        if (key in busyCards.value) return
        busyCards.update { it + key }
        viewModelScope.launch {
            // The copy in memory may be as old as the dialog: the PC is asked again, and files are only touched if it still
            // allows the undo (the task did not change, did not run again, still has its point of return).
            val read = issueRead(ask.task)
            backend.taskDetail(ask.task).fold(
                onSuccess = { fresh ->
                    applyRead(ask.task, read, fresh)
                    if (TaskAction.UndoHeld !in fresh.actions) _messages.trySend(ChatTexts.UNDO_UNAVAILABLE)
                    // The point of return is the one the dialog was opened on: the PC refuses if the task ran again since.
                    else backend.undoTask(ask.task, ask.checkpoint).fold(
                        onSuccess = { _undone.trySend(ask.task); refreshTask(ask.task) },
                        onFailure = { sayPc(it); refreshTask(ask.task) },
                    )
                },
                onFailure = { say(it) },
            )
            busyCards.update { it - key }
        }
    }

    // --- The PC's queue behind the running turn ---

    private fun canEditQueue() = backend.available(ApiMethods.CHAT_QUEUE) && backend.available(ApiMethods.CHAT_EDIT_QUEUED)

    private suspend fun refreshQueue() {
        backend.queue(conversation).onSuccess { list ->
            queueItems.value = list
            val editing = queueEditor.value
            // The message left the queue while it was being edited: the editor closes and says so.
            if (editing != null && list.none { it.id == editing.item.id }) {
                queueEditor.value = null
                _messages.trySend(ChatTexts.QUEUE_STARTED)
            }
        }
    }

    fun openQueued(id: String) {
        val item = queueItems.value.firstOrNull { it.id == id } ?: return
        queueEditor.value = QueueEditor(item, session = editorSessions.incrementAndGet())
    }

    fun closeQueued() { queueEditor.value = null }

    private val editorSessions = java.util.concurrent.atomic.AtomicLong()

    /** The editor the person is looking at is still the one a request was sent for. */
    private fun stillEditing(e: QueueEditor) = queueEditor.value?.let { it.item.id == e.item.id && it.session == e.session } == true

    fun saveQueued(text: String) {
        val editing = queueEditor.value ?: return
        if (editing.busy) return
        val t = text.trim()
        if (t.isEmpty()) { queueEditor.value = editing.copy(error = ChatTexts.QUEUE_EMPTY); return }
        if (t == editing.item.text) { queueEditor.value = null; return }
        queueEditor.value = editing.copy(busy = true, error = null)
        viewModelScope.launch {
            // The message may have been edited on the PC while this editor was open: saving would silently replace that text.
            val current = backend.queue(conversation).fold(
                { list -> queueItems.value = list; list.firstOrNull { it.id == editing.item.id } ?: GONE },
                { e -> queueFailure(editing.item.id, e, editing); return@launch },
            )
            when {
                current === GONE -> if (stillEditing(editing)) { queueEditor.value = null; _messages.trySend(ChatTexts.QUEUE_STARTED) }
                current.text != editing.item.text -> reloadEditor(editing, current)
                // `expect` makes the PC refuse if the text changed after the read above too.
                else -> backend.editQueued(conversation, editing.item.id, t, remove = false, expect = editing.item.text).fold(
                    onSuccess = { list -> queueItems.value = list; if (stillEditing(editing)) queueEditor.value = null },
                    onFailure = { queueFailure(editing.item.id, it, editing) },
                )
            }
        }
    }

    /** The PC has another text for the message: that one is loaded into the editor and the person decides again. */
    private fun reloadEditor(editing: QueueEditor, current: OrbeQueued) {
        if (stillEditing(editing)) queueEditor.value = QueueEditor(current, error = ChatTexts.QUEUE_CHANGED, revision = editing.revision + 1, session = editing.session)
    }

    /** Ids being removed: a second tap on the same "Quitar" must not ask the PC again and then say it already left. */
    private val removing = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

    fun removeQueued(id: String) {
        val shown = queueItems.value.firstOrNull { it.id == id } ?: return
        if (!removing.add(id)) return
        val editing = queueEditor.value?.takeIf { it.item.id == id }
        viewModelScope.launch {
            try {
                // The text the person saw: a message edited on the PC meanwhile is not thrown away unseen.
                backend.editQueued(conversation, id, null, remove = true, expect = (editing?.item ?: shown).text).fold(
                    onSuccess = { list -> queueItems.value = list; if (queueEditor.value?.item?.id == id) queueEditor.value = null },
                    onFailure = { queueFailure(id, it, editing) },
                )
            } finally { removing.remove(id) }
        }
    }

    /** [editing] is the editor the failed request was sent from, if any; its answer does not touch another editor. */
    private fun queueFailure(id: String, e: Throwable, editing: QueueEditor?) {
        if (ChatErrors.queuedGone(e)) {
            if (queueEditor.value?.item?.id == id && (editing == null || stillEditing(editing))) queueEditor.value = null
            _messages.trySend(ChatTexts.QUEUE_STARTED)
            queueRequests.trySend(Unit)
            return
        }
        if (ChatErrors.queuedChanged(e)) {
            // Load what the PC has now and let the person decide: nothing was changed.
            viewModelScope.launch {
                backend.queue(conversation).onSuccess { list ->
                    queueItems.value = list
                    val current = list.firstOrNull { it.id == id }
                    when {
                        current == null -> { if (editing != null && stillEditing(editing)) queueEditor.value = null; _messages.trySend(ChatTexts.QUEUE_STARTED) }
                        editing != null -> reloadEditor(editing, current)
                        else -> _messages.trySend(ChatTexts.QUEUE_CHANGED_REMOVE)
                    }
                }.onFailure { say(it) }
            }
            return
        }
        // The PC's own words, as it said them (a command cannot wait in the queue, the text is too long...).
        val said = ChatErrors.pcText(e) ?: linkErrorText(e)
        val open = queueEditor.value
        if (editing != null && open != null && stillEditing(editing)) queueEditor.value = open.copy(busy = false, error = said)
        else if (editing == null && open != null && open.item.id == id) queueEditor.value = open.copy(busy = false, error = said)
        else _messages.trySend(said)
    }

    private fun say(e: Throwable) {
        if (ChatErrors.deleted(e)) { deleted.value = true; return }
        _messages.trySend(linkErrorText(e))
    }

    /** The PC's own words when it refused, else the link's. */
    private fun sayPc(e: Throwable) {
        if (ChatErrors.deleted(e)) { deleted.value = true; return }
        _messages.trySend(ChatErrors.pcText(e) ?: linkErrorText(e))
    }

    companion object {
        const val PAGE = 150
        const val OLDER_PAGE = 100
        const val LIVE_GAP_MS = 1_500L
        const val QUEUE_GAP_MS = 1_000L
        private const val MAX_REFRESH = 12
        private val GONE = OrbeQueued("", "", 0L)
        private val UNSETTLED = setOf("awaiting_approval", "queued", "running")
        private const val MENTION_WINDOW = 20
        private val MENTION = Regex("""(?<![\w&])#(\d{1,7})\b""")
    }
}

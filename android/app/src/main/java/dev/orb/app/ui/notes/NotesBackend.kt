package dev.orb.app.ui.notes

import dev.orb.app.LinkRuntime
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonElement

/** What the notices center needs from the PC. The list itself lives on the phone ([NotesFeed]). */
interface NotesBackend {
    val connection: StateFlow<ConnectionState>
    val notices: StateFlow<List<NoticeRow>>

    /** Whether the PC keeps a list of what it sent (`notes.list`): the text of an empty list depends on it. */
    val pcKeepsList: Boolean

    /** Reads the permission requests that wait on the PC and the notices it sent while the phone was away. */
    suspend fun refresh(): Result<Unit>

    /** Marks notices read here and, when the PC can be told, its bell too. [ids] null means all of them. */
    suspend fun markRead(ids: List<String>?): Result<Unit>

    /** Marks one notice read on the phone only: the PC's ids are not the phone's. */
    fun markReadLocal(id: String)

    /** Marks read every notice of one chat (the `key` of the PC's note): the notification that covered it was read. */
    fun markReadChat(key: String)

    /** The chat no longer exists on the PC: its notices leave the list. */
    fun dismissChat(kind: String, id: String)

    /** Swipes a notice away on this phone only; false when it cannot be hidden (a permission request that still waits). */
    fun dismiss(id: String): Boolean

    fun undoDismiss(id: String)
}

class RuntimeNotesBackend(
    private val runtime: LinkRuntime,
    scope: CoroutineScope,
    private val nowMs: () -> Long = System::currentTimeMillis,
    store: NoticeStore? = null,
) : NotesBackend {
    private val api get() = runtime.api

    // Its own scope: closing the backend (the phone is unlinked) must stop every write at once.
    private val own = CoroutineScope(scope.coroutineContext + SupervisorJob(scope.coroutineContext[Job]))
    private val feed = NotesFeed(store, own, nowMs = nowMs)
    private val sync = NotesSync(feed, { since, limit -> api.notesList(since, limit) }, nowMs)
    override val connection get() = runtime.client.connection
    override val notices get() = feed.rows
    override val pcKeepsList get() = api.available(ApiMethods.NOTES_LIST)

    init {
        own.launch { feed.restore() }
        own.launch {
            runtime.client.events.collect { e ->
                if (e.name == "note") NotesParser.fromEvent(e.payload, nowMs())?.let(feed::add)
            }
        }
    }

    /** Stops listening and writing; the container calls it when the link goes away. */
    fun close() {
        own.cancel()
        feed.clear()
    }

    override suspend fun refresh(): Result<Unit> {
        val state = api.app.state().map { feed.setPending(NotesParser.approvals(it, nowMs())) }
        if (pcKeepsList) sync.run()
        return state
    }

    override suspend fun markRead(ids: List<String>?): Result<Unit> {
        feed.markRead(ids)
        // The phone's ids mean nothing to the PC: marking some notices there marks its whole bell, so only «all» is sent.
        if (ids != null || !api.available(ApiMethods.NOTES_MARK_READ)) return Result.success(Unit)
        return api.notesMarkRead().map { }
    }

    override fun markReadLocal(id: String) = feed.markRead(listOf(id))

    override fun markReadChat(key: String) = feed.markReadKey(key)

    override fun dismissChat(kind: String, id: String) = feed.dismissChat(kind, id)

    override fun dismiss(id: String) = feed.dismiss(id)

    override fun undoDismiss(id: String) = feed.undoDismiss(id)
}

/** Reads `notes.list` from the last notice the phone has and merges it; one run at a time, and a failure changes nothing. */
class NotesSync(
    private val feed: NotesFeed,
    private val fetch: suspend (since: Long?, limit: Int) -> Result<JsonElement>,
    private val nowMs: () -> Long = System::currentTimeMillis,
) {
    private val lock = Mutex()

    suspend fun run(): Boolean = lock.withLock {
        feed.restore()
        val since = feed.since()
        val got = fetch(since, NotesFeed.MAX).getOrNull() ?: return@withLock false
        val list = NotesParser.fromList(got, nowMs())
        feed.merge(list)
        list.maxOfOrNull { it.at }?.let { newest -> if (since == null || newest > since) feed.saveSince(newest) }
        true
    }
}

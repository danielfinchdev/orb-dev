package dev.orb.app.ui.notes

import dev.orb.app.LinkRuntime
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** What the notices center needs from the PC. The list itself lives on the phone ([NotesFeed]). */
interface NotesBackend {
    val connection: StateFlow<ConnectionState>
    val notices: StateFlow<List<NoticeRow>>

    /** Reads the permission requests that wait on the PC. */
    suspend fun refresh(): Result<Unit>

    /** Marks notices read here and, when the PC can be told, its bell too. [ids] null means all of them. */
    suspend fun markRead(ids: List<String>?): Result<Unit>

    /** Marks one notice read on the phone only: the PC's ids are not the phone's. */
    fun markReadLocal(id: String)
}

class RuntimeNotesBackend(private val runtime: LinkRuntime, scope: CoroutineScope, private val nowMs: () -> Long = System::currentTimeMillis) : NotesBackend {
    private val api get() = runtime.api
    private val feed = NotesFeed()
    override val connection get() = runtime.client.connection
    override val notices get() = feed.rows

    private val job: Job = scope.launch {
        runtime.client.events.collect { e ->
            if (e.name == "note") NotesParser.fromEvent(e.payload, nowMs())?.let(feed::add)
        }
    }

    /** Stops listening; the container calls it when the link goes away. */
    fun close() {
        job.cancel()
        feed.clear()
    }

    override suspend fun refresh(): Result<Unit> = api.app.state().map { feed.setPending(NotesParser.approvals(it, nowMs())) }

    override suspend fun markRead(ids: List<String>?): Result<Unit> {
        feed.markRead(ids)
        // The phone's ids mean nothing to the PC: marking some notices there marks its whole bell, so only «all» is sent.
        if (ids != null || !api.available(ApiMethods.NOTES_MARK_READ)) return Result.success(Unit)
        return api.notesMarkRead().map { }
    }

    override fun markReadLocal(id: String) = feed.markRead(listOf(id))
}

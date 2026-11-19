package dev.orb.app.notify

import dev.orb.app.ui.notes.NotesBackend
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.transformLatest

/**
 * The line of the fixed «Mantener conectado» notice. The PC cannot say it went away, so the phone says it: «Buscando…» as soon
 * as the link is not up, and «Sin conexión con tu PC» only once it has stayed that way for [marginMs], so a short cut (a
 * change of network, a restart of the PC's Orb) does not flip the text. The notice is silent and has no buttons.
 */
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
object LinkLine {
    const val MARGIN_MS = 45_000L

    /** [online] is whether the link is up; [pc] gives the PC's name when the text is built. */
    fun lines(online: Flow<Boolean>, pc: () -> String?, marginMs: Long = MARGIN_MS): Flow<String> =
        online.distinctUntilChanged().transformLatest { up ->
            if (up) {
                emit(NotifyTexts.connected(pc()))
            } else {
                // Offline and Connecting alternate on every retry, but both are «not up»: the margin runs from the first one.
                emit(NotifyTexts.searching(pc()))
                delay(marginMs)
                emit(NotifyTexts.OFFLINE_PC)
            }
        }
}

/**
 * Marks as read, on this phone, what a notification button or a tap covered. The notices list belongs to the link, which
 * may not exist yet when a button is used with the app closed: it waits for the start-up before looking for it.
 */
class NoteReader(
    private val ready: suspend () -> Unit,
    private val backend: () -> NotesBackend?,
) {
    /** [wholeChat]: «Marcar leído» reads every notice of the chat the notification covered, a tap only the one it showed. */
    suspend fun read(job: NoteJob, wholeChat: Boolean) {
        ready()
        val notes = backend() ?: return
        val chat = job.chat
        if (wholeChat && chat != null) notes.markReadChat(chat) else job.notice?.let(notes::markReadLocal)
    }
}

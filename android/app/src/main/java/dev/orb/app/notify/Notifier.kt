package dev.orb.app.notify

import dev.orb.app.link.net.LinkEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

/** Puts notifications on the system's tray; the Android implementation is [AndroidNotePoster]. */
interface NotePoster {
    fun show(plan: NotificationPlan)

    /** Says how a button ended, in place of the notification it was on. */
    fun say(job: NoteJob, text: String, goneAfterMs: Long?)

    /** Takes one notification away (its notice was read from a button). */
    fun cancel(id: Int)

    /** Removes every notice of the chats (the app is in front again and shows them itself). */
    fun clearNotes()
}

/**
 * Turns the PC's `note` events into system notifications while the app is not in front. The same event reaches the
 * notices list ([dev.orb.app.ui.notes.NotesBackend]) when the app is open; this one only cares about the tray.
 */
class Notifier(
    private val events: Flow<LinkEvent>,
    private val settings: () -> NotifySettings,
    private val isForeground: () -> Boolean,
    private val poster: NotePoster,
    // Only a word about what happened, never a title or a body.
    private val log: (String) -> Unit = {},
) {
    fun start(scope: CoroutineScope): Job = scope.launch {
        events.collect { if (it.name == "note") handle(it) }
    }

    internal fun handle(event: LinkEvent) {
        if (isForeground()) return
        val note = PcNotes.parse(event.payload) ?: return
        // The PC decides what stays silent (a muted chat, a schedule told not to notify) and sends nothing then; if a note
        // still says so, it is not shown.
        if (note.quiet) return
        poster.show(NotePlanner.plan(note, settings()))
        log("aviso ${note.kind}")
    }

    /** Back in front: the app lists the notices itself. */
    fun onForeground() = poster.clearNotes()
}

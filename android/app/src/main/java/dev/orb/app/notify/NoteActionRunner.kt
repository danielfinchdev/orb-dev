package dev.orb.app.notify

import dev.orb.app.link.api.PcCaller
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.link.net.pcMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** How a notification button ended; [text] is what the notification says afterwards. */
sealed class NoteOutcome(val text: String, val done: Boolean = false) {
    /** «Marcar leído» was used: nothing was sent anywhere. */
    class Read : NoteOutcome(NotifyTexts.READ, done = true)
    class Sent : NoteOutcome(NotifyTexts.SENT, done = true)
    class Allowed : NoteOutcome(NotifyTexts.ALLOWED, done = true)
    class Denied : NoteOutcome(NotifyTexts.DENIED, done = true)
    /** The phone is locked: nothing is done and the buttons stay for after unlocking. */
    class Locked : NoteOutcome(NotifyTexts.LOCKED)
    /** A reply with nothing typed. */
    class NothingTyped : NoteOutcome(NotifyTexts.NOTHING_TYPED)
    class Expired : NoteOutcome(NotifyTexts.EXPIRED)
    class Failed(why: String) : NoteOutcome(NotifyTexts.failed(why))
}

/**
 * Answers a notification button without opening the app (the receiver calls it): the call goes to the PC as any other
 * call of this phone. Typed text is only ever put in the call, never kept or logged.
 */
class NoteActionRunner(
    private val jobs: NoteJobs,
    private val caller: suspend () -> PcCaller?,
    private val isLocked: () -> Boolean,
    // A broadcast receiver is stopped by Android after about ten seconds.
    private val budgetMs: Long = 9_000,
    // Called once the button is accepted and before the PC is asked, so the notification can say it is working.
    private val onStart: (NoteJob) -> Unit = {},
) {
    /** The job's title with the outcome, or null when the token is unknown. */
    suspend fun run(token: String, typed: String?): Pair<NoteJob, NoteOutcome>? {
        val job = jobs.peek(token) ?: run { jobs.take(token); return null }
        if (!job.acts) return null
        if (job.local) {
            jobs.take(token) ?: return null
            return job to NoteOutcome.Read()
        }
        // Before Android 12 a button does not ask to unlock; the buttons stay for a tap after unlocking.
        if (isLocked()) return job to NoteOutcome.Locked()
        val text = job.textParam?.let { typed?.trim().orEmpty().ifEmpty { return job to NoteOutcome.NothingTyped() } }
        jobs.take(token) ?: return null
        onStart(job)
        return job to execute(job, text)
    }

    private suspend fun execute(job: NoteJob, text: String?): NoteOutcome {
        val pc = caller() ?: return NoteOutcome.Failed(NotifyTexts.NOT_LINKED)
        val result = try {
            withTimeout(budgetMs) {
                if (job.token != null) pc.noteAction(job.token).map { } else {
                    val params = buildJsonObject {
                        job.params?.forEach { (k, v) -> put(k, v) }
                        if (job.textParam != null && text != null) put(job.textParam, JsonPrimitive(text))
                    }
                    pc.call(job.method.orEmpty(), params).map { }
                }
            }
        } catch (e: TimeoutCancellationException) {
            Result.failure(LinkException(LinkError.Timeout))
        } catch (e: CancellationException) {
            throw e
        }
        return result.fold({ done(job) }, { NoteOutcome.Failed(reason(it)) })
    }

    private fun done(job: NoteJob): NoteOutcome = when (job.action) {
        "allow" -> NoteOutcome.Allowed()
        "deny" -> NoteOutcome.Denied()
        else -> NoteOutcome.Sent()
    }

    private fun reason(e: Throwable): String = when (val err = (e as? LinkException)?.error) {
        LinkError.Offline -> NotifyTexts.OFFLINE
        LinkError.Timeout -> NotifyTexts.TIMEOUT
        LinkError.NotLinked -> NotifyTexts.NOT_LINKED
        is LinkError.Refused -> pcMessage(err.error, "El PC lo rechazó (${err.status}).")
        LinkError.BadAnswer -> NotifyTexts.BAD_ANSWER
        else -> NotifyTexts.OFFLINE
    }
}

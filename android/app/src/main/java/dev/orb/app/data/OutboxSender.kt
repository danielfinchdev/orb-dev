package dev.orb.app.data

import dev.orb.app.link.api.OrbApi
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.link.net.pcMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.Json

/**
 * Sends the queued messages when the PC is reachable.
 *
 * - One message at a time per conversation, oldest first; different conversations go in parallel.
 * - The message is sealed by the link at the moment of sending (never when it was written).
 * - Every attempt carries the message's own clientId. A PC that dedupes by it never duplicates; an older PC without
 *   dedupe may show the message twice if a timeout hid that it had already arrived (the answer got lost, not the request).
 * - A failed message (the PC refused it, or the phone is no longer linked) stops its conversation's queue until the person
 *   retries or deletes it: sending later messages ahead of it would reorder the conversation.
 */
class OutboxSender(
    private val repo: OutboxRepository,
    private val api: OrbApi,
    private val connection: StateFlow<ConnectionState>,
    private val scope: CoroutineScope,
    private val clock: () -> Long = System::currentTimeMillis,
    private val backoff: (attempts: Int) -> Long = ::retryBackoffMs,
) {
    private val wake = Channel<Unit>(Channel.CONFLATED)

    /** Starts the sender. Anything left `sending` by a crash or a kill is queued again with the same clientId. */
    fun start(): Job = scope.launch {
        repo.resetSending()
        launch { repo.changes.collect { wake.trySend(Unit) } }
        launch {
            // A new connection is a reason to try now instead of waiting out a backoff.
            connection.map { it is ConnectionState.Online }.distinctUntilChanged().collect { online ->
                if (online) repo.releaseBackoff()
                wake.trySend(Unit)
            }
        }
        loop()
    }

    private suspend fun loop() {
        while (true) {
            repo.purgeSent(SENT_RETENTION_MS)
            if (connection.value !is ConnectionState.Online) {
                connection.first { it is ConnectionState.Online }
                continue
            }
            val now = clock()
            var nextDue: Long? = null
            val heads = repo.queuedNow().groupBy { it.groupKey }.values.map { it.first() }
            for (head in heads) {
                if (head.state != OutboxState.PENDING) continue
                if (head.nextAttemptAt > now) {
                    nextDue = minOf(nextDue ?: Long.MAX_VALUE, head.nextAttemptAt)
                    continue
                }
                if (!repo.markSending(head.clientId)) continue
                scope.launch { sendOne(head) }
            }
            if (nextDue == null) wake.receive() else withTimeoutOrNull((nextDue - now).coerceAtLeast(1)) { wake.receive() }
        }
    }

    private suspend fun sendOne(item: OutboxEntity) {
        // The PC remembers a message id for 10 minutes. A retry after a long gap (no network, PC restarted) could land as
        // a second copy of one that did arrive, so the person decides instead of the app guessing.
        if (item.attempts > 0 && clock() - (item.nextAttemptAt - backoff(item.attempts)) > DEDUPE_SAFE_MS) {
            return repo.markFailed(item.clientId, "not retried: too long since the last attempt, it may have arrived")
        }
        val result = try {
            when (item.target) {
                OutboxTarget.SESSION -> api.sessionsSend(paramsOf(item), item.clientId)
                else -> api.chatSend(paramsOf(item), item.clientId)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e)
        }
        val error = result.exceptionOrNull()
        if (error == null) return repo.markSent(item.clientId)
        val link = (error as? LinkException)?.error
        val attempts = item.attempts + 1
        when (link) {
            // No connection is not an attempt: the message waits for the connection and goes as soon as it is back.
            LinkError.Offline -> repo.markPending(item.clientId, item.attempts, "offline", clock() + backoff(1))
            LinkError.Timeout -> repo.markPending(item.clientId, attempts, "timeout", clock() + backoff(attempts))
            is LinkError.Refused, LinkError.NotLinked, LinkError.BadAnswer, is LinkError.Unsupported -> repo.markFailed(item.clientId, describe(link))
            // The PC needs attention, a version must update, or something unexpected: it may pass, so keep trying slowly.
            else -> repo.markPending(item.clientId, attempts, describe(link), clock() + backoff(attempts))
        }
    }

    /** Never the message text: only what kind of failure it was and what the PC said about it. */
    private fun describe(error: LinkError?): String = when (error) {
        is LinkError.Refused -> "refused ${error.status}: ${error.reason ?: pcMessage(error.error, "")}"
        LinkError.NotLinked -> "not linked"
        LinkError.BadAnswer -> "bad answer"
        is LinkError.Unsupported -> "unsupported ${error.method}"
        is LinkError.Attention -> "attention ${error.code}"
        is LinkError.Update -> "update ${error.side}"
        null -> "error"
        else -> error.toString()
    }

    private fun paramsOf(item: OutboxEntity): JsonObject {
        val out = LinkedHashMap<String, JsonElement>()
        (runCatching { Json.parseToJsonElement(item.extra) }.getOrNull() as? JsonObject)?.let { out.putAll(it) }
        out["text"] = JsonPrimitive(item.text)
        val files = runCatching { Json.parseToJsonElement(item.attachments) }.getOrNull() as? JsonArray
        if (files != null && files.isNotEmpty()) out["images"] = files
        if (item.target == OutboxTarget.SESSION) out["id"] = JsonPrimitive(item.sessionId)
        else item.conversationId?.let { out["conversation"] = it.toLongOrNull()?.let(::JsonPrimitive) ?: JsonPrimitive(it) }
        return JsonObject(out)
    }

    companion object {
        /** Under the PC's 10 minute memory of message ids, with room for the clock and the backoff. */
        const val DEDUPE_SAFE_MS = 9L * 60 * 1000
        const val SENT_RETENTION_MS = 24L * 60 * 60 * 1000
    }
}

/** 3 s, 6 s, 12 s, 24 s, then 30 s. */
fun retryBackoffMs(attempts: Int): Long = minOf(30_000L, 3_000L shl (attempts - 1).coerceIn(0, 4))

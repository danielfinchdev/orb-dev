package dev.orb.app.link.net

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** Wall-clock source, injectable so tests control time (the sealed requests are stamped with it). */
fun interface Clock {
    fun nowMs(): Long

    companion object {
        val System = Clock { java.lang.System.currentTimeMillis() }
    }
}

/**
 * How long each kind of request may take before the next address is tried (ms), as `TIMEOUTS` in the phone client's
 * net.js. A call may do real work on the PC (git, GitHub), so it gets more room than the quick checks.
 * [eventsIdle]: a live stream with no bytes at all (not even the PC's ping every 25 s) is taken for dead.
 */
data class Timeouts(
    val call: Long = 45_000,
    val me: Long = 8_000,
    val hello: Long = 6_000,
    val pair: Long = 20_000,
    val upload: Long = 60_000,
    val events: Long = 10_000,
    val eventsIdle: Long = 60_000,
    // A connection that never opens fails fast whatever the request's own limit is.
    val connect: Long = 4_000,
)

/** The pause before trying again while the PC cannot be reached: 3 s, 6 s, 12 s... up to 30 s. */
fun retryDelay(attempt: Int): Long = minOf(30_000L, 3_000L * (1L shl attempt.coerceIn(0, 20)))

/** What a [LinkClient] request can fail with. The PC's own words ([Refused.error]) are shown as they come. */
sealed class LinkError {
    /** The PC could not be reached (network down, PC off, Orb closed). */
    data object Offline : LinkError()

    /** No answer in time. The PC may have done it, so a request that changes something is not sent again. */
    data object Timeout : LinkError()

    /** The PC does not know this phone (401): the link is gone. */
    data object NotLinked : LinkError()

    /** The PC answered no. [status] is 0 when it gave none; [reason] is its machine-readable word, if any. */
    data class Refused(val status: Int, val error: String, val reason: String? = null) : LinkError()

    /** The PC is there but needs attention on its side (503 `{attention}`), never to be shown as «offline». */
    data class Attention(val code: String) : LinkError()

    /** One side must update first (426, or `min` above this client's protocol). */
    data class Update(val side: UpdateSide) : LinkError()

    /** The answer did not open with this phone's key, or did not echo the request. Never accepted. */
    data object BadAnswer : LinkError()

    /** The method needs a newer PC than the one linked (its `me.methods` does not list it). */
    data class Unsupported(val method: String) : LinkError()
}

enum class UpdateSide { App, Pc }

class LinkException(val error: LinkError) : Exception(error.toString())

/** The two protocols and the Orb's version the PC reported in `me`. */
data class PcVersions(val v: Int?, val min: Int?, val version: String?)

sealed class ConnectionState {
    data object Connecting : ConnectionState()
    data class Online(val base: String, val pcName: String?, val versions: PcVersions) : ConnectionState()
    data class Offline(val nextRetryAt: Long?, val lastSeen: Long?) : ConnectionState()
    data object UpdateApp : ConnectionState()
    data object UpdatePc : ConnectionState()
    data object Unlinked : ConnectionState()
    data class Attention(val code: String) : ConnectionState()
}

/** One live event of the PC: `{e, p}` opened from the stream. */
data class LinkEvent(val name: String, val payload: JsonElement) {
    companion object {
        /** Synthetic: a streamed answer lost its place; the conversation (payload `{conversation}`) must be read again. */
        const val RELOAD = "orb:reload"
    }
}

/** What `me` says about the linked PC. */
data class PcInfo(val device: String?, val name: String?, val pc: String?, val versions: PcVersions, val methods: Set<String>?, val raw: JsonObject)

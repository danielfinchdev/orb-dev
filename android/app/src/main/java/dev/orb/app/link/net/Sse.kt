package dev.orb.app.link.net

import okio.BufferedSource
import java.io.IOException

/**
 * A tiny server-sent-events reader over the raw response body. okhttp-sse is not used: it hides comment lines, and the
 * silence watchdog has to count the PC's `: ping` comments (every 15 s) as proof of life.
 */
sealed class SseLine {
    /** `: ping`, `: hola`: nothing to deliver, but bytes arrived. */
    data object Comment : SseLine()

    /**
     * The joined `data:` lines of one event, delivered at its blank line. [id] is the event's `id:` (the PC numbers them so
     * a reconnection can resume); [event] its `event:` name. [text] is empty for an id alone or an event with no data.
     */
    data class Data(val text: String, val id: String? = null, val event: String? = null) : SseLine()
}

/** [maxBytes] caps one line and one event: the stream is authenticated only after it is opened, so it is bounded anyway. */
class SseReader(private val source: BufferedSource, private val maxBytes: Long = 8L * 1024 * 1024) {
    private val data = StringBuilder()
    private var id: String? = null
    private var event: String? = null

    /** The next thing on the wire, or null at the end of the stream. Blocks. */
    @Throws(IOException::class)
    fun next(): SseLine? {
        while (true) {
            if (source.exhausted()) return null
            // Throws EOFException when the line is longer than the cap (or the stream ends mid-line).
            val line = source.readUtf8LineStrict(maxBytes)
            when {
                line.isEmpty() -> {
                    if (data.isNotEmpty() || id != null || event != null) {
                        val out = SseLine.Data(data.toString(), id, event)
                        data.setLength(0)
                        id = null
                        event = null
                        return out
                    }
                    // A blank line with nothing pending is still a sign of life.
                    return SseLine.Comment
                }
                line.startsWith(":") -> return SseLine.Comment
                line.startsWith("data:") -> {
                    // One optional space after the colon, like the phone client's `l.slice(6)` on «data: ».
                    data.append(if (line.startsWith("data: ")) line.substring(6) else line.substring(5))
                    if (data.length > maxBytes) throw IOException("event too large")
                }
                line.startsWith("id:") -> {
                    // The spec ignores an id with a NUL; an over-long one is not an id this PC would send.
                    val v = line.substring(3).removePrefix(" ")
                    if ('\u0000' !in v && v.length <= MAX_ID) id = v
                }
                line.startsWith("event:") -> event = line.substring(6).removePrefix(" ").take(MAX_ID)
                // retry: is not used by the PC.
            }
        }
    }

    private companion object {
        const val MAX_ID = 128
    }
}

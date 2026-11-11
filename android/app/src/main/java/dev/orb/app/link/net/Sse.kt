package dev.orb.app.link.net

import okio.BufferedSource
import java.io.IOException

/**
 * A tiny server-sent-events reader over the raw response body. okhttp-sse is not used: it hides comment lines, and the
 * silence watchdog has to count the PC's `: ping` comments (every 25 s) as proof of life.
 */
sealed class SseLine {
    /** `: ping`, `: hola`: nothing to deliver, but bytes arrived. */
    data object Comment : SseLine()

    /** The joined `data:` lines of one event, delivered at its blank line. */
    data class Data(val text: String) : SseLine()
}

/** [maxBytes] caps one line and one event: the stream is authenticated only after it is opened, so it is bounded anyway. */
class SseReader(private val source: BufferedSource, private val maxBytes: Long = 8L * 1024 * 1024) {
    private val data = StringBuilder()

    /** The next thing on the wire, or null at the end of the stream. Blocks. */
    @Throws(IOException::class)
    fun next(): SseLine? {
        while (true) {
            if (source.exhausted()) return null
            // Throws EOFException when the line is longer than the cap (or the stream ends mid-line).
            val line = source.readUtf8LineStrict(maxBytes)
            when {
                line.isEmpty() -> {
                    if (data.isNotEmpty()) {
                        val out = data.toString()
                        data.setLength(0)
                        return SseLine.Data(out)
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
                // event:, id:, retry: are not used by the PC.
            }
        }
    }
}

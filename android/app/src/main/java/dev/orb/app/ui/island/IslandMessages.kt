package dev.orb.app.ui.island

import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put

/** What a block drawn by the island is. */
enum class IslandKind(val wire: String) { Mermaid("mermaid"), Math("math") }

/** What the island page may tell the app. Anything else it sends is dropped before it gets here. */
sealed interface IslandMessage {
    data object Ready : IslandMessage
    data class Size(val seq: Int, val height: Int) : IslandMessage
    data class Failed(val seq: Int) : IslandMessage
}

/** The page is not trusted: every field is validated here before the app acts on it. */
object IslandMessages {
    const val MAX_MESSAGE_CHARS = 2_000
    const val MIN_HEIGHT = 1
    const val MAX_HEIGHT = 8_000
    const val MAX_SOURCE_CHARS = 20_000

    fun parse(raw: String?): IslandMessage? {
        if (raw == null || raw.length > MAX_MESSAGE_CHARS) return null
        val o = try { Json.parseToJsonElement(raw) as? JsonObject } catch (_: Exception) { null } ?: return null
        return when ((o["type"] as? JsonPrimitive)?.takeIf { it.isString }?.content) {
            "ready" -> IslandMessage.Ready
            "failed" -> seq(o)?.let { IslandMessage.Failed(it) }
            "size" -> {
                val s = seq(o) ?: return null
                val h = number(o["height"]) ?: return null
                IslandMessage.Size(s, h.coerceIn(MIN_HEIGHT.toDouble(), MAX_HEIGHT.toDouble()).toInt())
            }
            else -> null
        }
    }

    private fun number(e: kotlinx.serialization.json.JsonElement?): Double? =
        (e as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull?.takeIf { it.isFinite() }

    private fun seq(o: JsonObject): Int? {
        val d = number(o["seq"]) ?: return null
        return if (d >= 0 && d <= Int.MAX_VALUE && d == Math.floor(d)) d.toInt() else null
    }

    /** The `render` order for the page; JSON text is also a valid JavaScript expression. */
    fun renderJson(kind: IslandKind, source: String, display: Boolean, seq: Int): String = buildJsonObject {
        put("type", "render")
        put("kind", kind.wire)
        put("source", source)
        put("display", display)
        put("seq", seq)
    }.toString()
}

/** The island page's only door to the app, exposed as `OrbHost`: one method taking a JSON message, nothing else. */
class IslandBridge(private val onMessage: (IslandMessage) -> Unit) {
    @JavascriptInterface
    fun post(raw: String?) {
        val message = IslandMessages.parse(raw) ?: return
        // Bridge calls arrive on a WebView thread; the UI is touched on the main one.
        Handler(Looper.getMainLooper()).post { onMessage(message) }
    }
}

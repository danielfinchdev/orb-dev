package dev.orb.app.ui.web

import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put

/** What the Pizarra page may tell the app. Anything else it sends is dropped before it gets here. */
sealed interface WhiteboardMessage {
    /** The page is ready and wants the drawing. */
    data object Load : WhiteboardMessage

    /**
     * The drawing as it is now; [files] holds only the pictures not sent yet, [png] is the picture for the assistant
     * ("" = nothing drawn, null = unchanged). [dropped] counts the elements and pictures removed because the phone's
     * page does not take them, [offered] the ids of every picture the page handed over (so it can mark them as sent
     * once the save is confirmed) and [project] is stamped by the app when it receives the message.
     */
    data class Save(
        val elements: JsonArray,
        val appState: JsonObject,
        val files: JsonObject,
        val png: String?,
        val flush: Boolean,
        val dropped: Int = 0,
        val offered: Set<String> = emptySet(),
        val project: String? = null,
    ) : WhiteboardMessage

    /** The page answered a flush request: everything it had was sent before this message. */
    data object Flushed : WhiteboardMessage

    /** A save that could not be taken at all (too big or not a drawing): nothing of it reached the PC. */
    data object Rejected : WhiteboardMessage

    /** The page has saved everything it had and asks to leave. */
    data object Close : WhiteboardMessage
}

/** The checks on what comes from the page: it is not trusted, so every field is validated here, before the PC sees it. */
object WhiteboardMessages {
    /** Characters in one message; the PC takes 40 MB of drawing and picture, the phone half of that. */
    const val MAX_MESSAGE_CHARS = 24_000_000
    const val MAX_ELEMENTS = 20_000
    const val MAX_FILES = 50
    const val MAX_FILE_CHARS = 8_000_000
    const val MAX_PNG_CHARS = 12_000_000

    private val FILE_ID = Regex("^[A-Za-z0-9_-]{1,100}$")
    private val IMAGE_PREFIXES = listOf("png", "jpeg", "gif", "webp", "bmp", "svg+xml").map { "data:image/$it;base64," }
    private const val PNG_PREFIX = "data:image/png;base64,"

    // Embeddable and iframe elements would load web pages; the phone's page has none.
    private val ELEMENT_TYPES = setOf("rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "image", "frame", "magicframe")

    fun parse(raw: String?): WhiteboardMessage? {
        if (raw == null) return null
        if (raw.length > MAX_MESSAGE_CHARS) return WhiteboardMessage.Rejected
        val o = try { Json.parseToJsonElement(raw) as? JsonObject } catch (_: Exception) { null } ?: return null
        return when ((o["type"] as? JsonPrimitive)?.takeIf { it.isString }?.content) {
            "load" -> WhiteboardMessage.Load
            "close" -> WhiteboardMessage.Close
            "flushed" -> WhiteboardMessage.Flushed
            "save" -> save(o) ?: WhiteboardMessage.Rejected
            else -> null
        }
    }

    // What the phone's page cannot take is removed and counted; only a message that cannot be trusted as a whole is refused.
    private fun save(o: JsonObject): WhiteboardMessage.Save? {
        val elements = o["elements"] as? JsonArray ?: return null
        if (elements.size > MAX_ELEMENTS) return null
        val files = files(o["files"]) ?: return null
        // An image whose picture was refused here would stay as a broken box (and be saved so); one whose picture simply
        // is not in this message is left alone, because the PC already has it.
        val orphanFiles = HashSet<String>()
        val kept = elements.filter(::element).filter { e ->
            val obj = e as JsonObject
            val fileId = if ((obj["type"] as? JsonPrimitive)?.content == "image") (obj["fileId"] as? JsonPrimitive)?.takeIf { it.isString }?.content else null
            (fileId == null || fileId !in files.rejected).also { if (!it) orphanFiles += fileId!! }
        }
        val png = when (val p = o["png"]) {
            is JsonPrimitive -> p.takeIf { it.isString }?.content?.takeIf { it.isEmpty() || (it.length <= MAX_PNG_CHARS && it.startsWith(PNG_PREFIX)) }
            else -> null
        }
        val flush = (o["flush"] as? JsonPrimitive)?.booleanOrNull == true
        return WhiteboardMessage.Save(
            JsonArray(kept), appState(o["appState"] as? JsonObject), files.accepted, png, flush,
            // A refused picture whose element was removed too is one loss, not two.
            dropped = elements.size - kept.size + files.dropped - orphanFiles.size, offered = files.offered,
        )
    }

    private fun element(e: JsonElement): Boolean {
        val o = e as? JsonObject ?: return false
        val id = (o["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        val type = (o["type"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        return !id.isNullOrEmpty() && type in ELEMENT_TYPES
    }

    private class Files(val accepted: JsonObject, val offered: Set<String>, val dropped: Int, val rejected: Set<String> = emptySet())

    private fun files(el: JsonElement?): Files? {
        if (el == null) return Files(JsonObject(emptyMap()), emptySet(), 0)
        val map = el as? JsonObject ?: return null
        if (map.size > MAX_FILES) return null
        val offered = LinkedHashSet<String>()
        var dropped = 0
        val rejected = HashSet<String>()
        val accepted = buildJsonObject {
            for ((id, f) in map) {
                if (!FILE_ID.matches(id)) { dropped++; rejected += id; continue }
                offered += id
                val data = ((f as? JsonObject)?.get("dataURL") as? JsonPrimitive)?.takeIf { it.isString }?.content
                val prefix = data?.let { d -> IMAGE_PREFIXES.firstOrNull { d.startsWith(it) } }
                if (data == null || prefix == null || data.length > MAX_FILE_CHARS) { dropped++; rejected += id; continue }
                put(id, buildJsonObject { put("mimeType", prefix.removePrefix("data:").substringBefore(';')); put("dataURL", data) })
            }
        }
        return Files(accepted, offered, dropped, rejected)
    }

    // Only the three settings the PC keeps; the page's other state never travels.
    private fun appState(s: JsonObject?): JsonObject = buildJsonObject {
        (s?.get("viewBackgroundColor") as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.length <= 40 }?.let { put("viewBackgroundColor", it) }
        (s?.get("gridSize") as? JsonPrimitive)?.doubleOrNull?.takeIf { it in 1.0..1000.0 }?.let { put("gridSize", it) }
        (s?.get("gridModeEnabled") as? JsonPrimitive)?.booleanOrNull?.let { put("gridModeEnabled", it) }
    }
}

/** The Pizarra page's only door to the app, exposed as `OrbHost`: one method taking a JSON message, nothing else. */
class WhiteboardBridge(private val onMessage: (WhiteboardMessage) -> Unit) {
    @JavascriptInterface
    fun post(raw: String?) {
        val message = WhiteboardMessages.parse(raw) ?: return
        // Bridge calls arrive on a WebView thread; the app's UI is touched on the main one.
        Handler(Looper.getMainLooper()).post { onMessage(message) }
    }
}

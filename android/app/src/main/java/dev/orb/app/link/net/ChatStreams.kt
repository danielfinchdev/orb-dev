package dev.orb.app.link.net

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.concurrent.ConcurrentHashMap

/**
 * The receiver's side of src/shared/chat-stream.mjs. While the assistant writes, a `chat:state` carries either the whole
 * `partial` text or only `{append, base}`: the text from position `base` on. Indices are UTF-16 code units on both
 * sides (JS strings and Kotlin `String`), so slicing matches the sender.
 */
fun streamText(holding: String?, state: JsonObject): String? {
    val append = state["append"]
    if (append == null || append is kotlinx.serialization.json.JsonNull) {
        val partial = state["partial"]
        return if (partial is JsonPrimitive && partial.isString) partial.content else ""
    }
    val baseText = (state["base"] as? JsonPrimitive)?.content
    val base = baseText?.toDoubleOrNull()
    if (holding == null || base == null || base % 1.0 != 0.0 || base < 0 || base > holding.length) return null
    val text = (append as? JsonPrimitive)?.content ?: append.toString()
    return holding.substring(0, base.toInt()) + text
}

/** Per conversation, the streamed text this phone holds; made whole from each delta. */
class ChatStreams {
    private val held = ConcurrentHashMap<String, String>()
    private val _reload = MutableSharedFlow<String>(extraBufferCapacity = 64, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    /** A conversation whose stream lost its place: read its state again whole. */
    val reload: SharedFlow<String> = _reload.asSharedFlow()

    /**
     * Applies one `chat:state` payload. → the payload with the whole text in `partial` (append/base removed), or null
     * when the state does not follow what is held (it is then also announced on [reload]).
     */
    fun apply(state: JsonObject): JsonObject? {
        val key = (state["conversation"] as? JsonPrimitive)?.takeIf { it.content != "null" }?.content ?: return state
        val text = streamText(held[key], state)
        if (text == null) {
            held.remove(key)
            _reload.tryEmit(key)
            return null
        }
        val busy = (state["busy"] as? JsonPrimitive)?.content == "true"
        if (busy) held[key] = text else held.remove(key)
        if (state["append"] == null || state["append"] is kotlinx.serialization.json.JsonNull) return state
        return JsonObject(state.filterKeys { it != "append" && it != "base" } + ("partial" to JsonPrimitive(text)))
    }

    /** The held text of a conversation, if it is streaming. */
    fun held(conversation: String): String? = held[conversation]

    /** A new stream starts from nothing: the PC's feed holds nothing for it either. */
    fun clear() = held.clear()

    companion object {
        fun reloadEvent(conversation: String) = LinkEvent(LinkEvent.RELOAD, buildJsonObject { put("conversation", conversation) })
    }
}

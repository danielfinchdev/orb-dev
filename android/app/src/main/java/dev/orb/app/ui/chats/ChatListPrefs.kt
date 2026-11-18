package dev.orb.app.ui.chats

import dev.orb.app.ui.theme.KeyValueStore
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** What the chat list remembers on this phone: the headings the person folded. Not a secret, so plain preferences. */
class ChatListPrefs(private val store: KeyValueStore) {
    /** The folded headings, or null when the person never folded or unfolded one (the list then uses its defaults). */
    fun collapsed(): Set<String>? {
        val raw = store.getString(KEY) ?: return null
        val arr = runCatching { Json.parseToJsonElement(raw) as? JsonArray }.getOrNull() ?: return null
        return arr.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.toSet()
    }

    fun setCollapsed(keys: Set<String>) {
        store.edit { putString(KEY, JsonArray(keys.sorted().map(::JsonPrimitive)).toString()) }
    }

    fun clear() {
        store.edit { putString(KEY, null) }
    }

    private companion object {
        const val KEY = "collapsed"
    }
}

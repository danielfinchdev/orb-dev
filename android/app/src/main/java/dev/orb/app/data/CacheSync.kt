package dev.orb.app.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

/**
 * Fills the cache from the JSON results of the PC's methods. Shapes are read leniently (a missing field is null, an
 * unknown one is kept in `raw`) so a newer PC never breaks the phone. Nothing here is ever logged: it holds message text.
 */
class CacheSync(
    private val cache: CacheDao,
    private val outbox: OutboxDao,
    private val clock: () -> Long = System::currentTimeMillis,
    private val maxConversations: Int = OrbCacheDatabase.MAX_CONVERSATIONS,
    private val maxMessages: Int = OrbCacheDatabase.MAX_MESSAGES_PER_THREAD,
    private val maxTasks: Int = OrbCacheDatabase.MAX_TASKS,
) {
    /** `inbox.list` → `{ items, sections, projects, unread, … }`. The items replace the zone's rows; the rest is a snapshot. */
    suspend fun applyInbox(result: JsonElement, zone: String = DEFAULT_ZONE) {
        val obj = result as? JsonObject ?: return
        val items = (obj["items"] as? JsonArray) ?: return
        val rows = items.mapIndexedNotNull { i, el -> (el as? JsonObject)?.let { conversationOf(it, zone, i) } }
        cache.replaceConversations(zone, rows, maxConversations)
        cache.putSnapshot(SnapshotEntity("inbox.meta:$zone", JsonObject(obj - "items").toString(), clock()))
        mark("inbox:$zone")
    }

    /** `chat.list` → the lines of a conversation (null: the assistant's general conversation). */
    suspend fun applyChat(conversation: Long?, result: JsonElement) = applyMessages(ThreadId.chat(conversation), result)

    /** `sessions.items` → the items of a direct conversation with an agent. */
    suspend fun applySessionItems(sessionId: String, result: JsonElement) = applyMessages(ThreadId.session(sessionId), result)

    /** `tasks.list` → the PC's whole current list: tasks it no longer lists are dropped. */
    suspend fun applyTasks(result: JsonElement) {
        val list = result.asRows() ?: return
        val rows = list.mapIndexedNotNull { i, el ->
            val o = el as? JsonObject ?: return@mapIndexedNotNull null
            val id = o["id"].long() ?: return@mapIndexedNotNull null
            TaskEntity(id, o["status"].text(), (o["updated_at"] ?: o["updatedAt"] ?: o["created_at"]).text(), i, o.toString())
        }
        cache.replaceTasks(rows, maxTasks)
        mark("tasks")
    }

    /** Any small result worth showing before the PC answers: `app.state`, `projects.list`, `usage`… */
    suspend fun applySnapshot(key: String, result: JsonElement) {
        cache.putSnapshot(SnapshotEntity(key, result.toString(), clock()))
        mark("snapshot:$key")
    }

    private suspend fun applyMessages(threadId: String, result: JsonElement) {
        val list = result.asRows() ?: return
        val rows = ArrayList<MessageEntity>(list.size)
        for (el in list) {
            val o = el as? JsonObject ?: continue
            val id = o["id"].long() ?: continue
            rows += MessageEntity(threadId, id, o["at"].text(), o["role"].text(), o.toString())
            // The PC echoing the id of a message we sent means it arrived: the queued copy is no longer needed.
            echoedClientId(o)?.let { outbox.deleteSent(it) }
        }
        cache.upsertMessages(threadId, rows, maxMessages)
        mark("thread:$threadId")
    }

    private suspend fun mark(scope: String) = cache.putMark(SyncMarkEntity(scope, clock()))

    private fun conversationOf(o: JsonObject, zone: String, position: Int): ConversationEntity? {
        val key = o["key"].text() ?: return null
        val kind = o["kind"].text()
        val id = o["id"].text()
        val thread = when {
            kind == "session" && id != null -> ThreadId.session(id)
            else -> ThreadId.chat((o["conversation"].long()) ?: id?.toLongOrNull())
        }
        return ConversationEntity(
            key = key, zone = zone, threadId = thread, project = o["project"].text(), title = o["title"].text(),
            updatedAt = o["at"].text(), unread = o["unread"].int() ?: 0, position = position, raw = o.toString(),
        )
    }

    private fun echoedClientId(o: JsonObject): String? =
        o["clientId"].text() ?: (o["meta"] as? JsonObject)?.get("clientId").text()

    private fun JsonElement.asRows(): List<JsonElement>? = when (this) {
        is JsonArray -> this
        is JsonObject -> this["items"] as? JsonArray
        else -> null
    }

    private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.takeUnless { it is JsonNull }?.contentOrNull
    private fun JsonElement?.long(): Long? = (this as? JsonPrimitive)?.longOrNull
    private fun JsonElement?.int(): Int? = (this as? JsonPrimitive)?.intOrNull

    companion object {
        const val DEFAULT_ZONE = "orb"
    }
}

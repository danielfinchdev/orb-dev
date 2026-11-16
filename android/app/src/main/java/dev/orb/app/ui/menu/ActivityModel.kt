package dev.orb.app.ui.menu

import androidx.compose.runtime.Immutable
import dev.orb.app.ui.chats.int
import dev.orb.app.ui.chats.long
import dev.orb.app.ui.chats.str
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

@Immutable
data class ActivityEvent(val id: Long, val kind: String, val actor: String, val detail: String, val at: String?, val taskId: Long?, val taskTitle: String?)

@Immutable
data class LogInfo(val name: String, val size: Long)

object ActivityParser {
    fun events(el: JsonElement?): List<ActivityEvent> = (el as? JsonArray).orEmpty().mapNotNull { x ->
        val o = x as? JsonObject ?: return@mapNotNull null
        ActivityEvent(
            id = o.long("id") ?: return@mapNotNull null, kind = o.str("kind").orEmpty(), actor = o.str("actor").orEmpty(),
            detail = o.str("detail").orEmpty(), at = o.str("at"), taskId = o.long("task_id"), taskTitle = o.str("title"),
        )
    }

    fun logs(el: JsonElement?): List<LogInfo> = (el as? JsonArray).orEmpty().mapNotNull { x ->
        val o = x as? JsonObject ?: return@mapNotNull null
        LogInfo(o.str("name") ?: return@mapNotNull null, o.long("size") ?: o.int("size")?.toLong() ?: 0L)
    }
}

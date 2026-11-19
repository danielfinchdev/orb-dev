package dev.orb.app.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * What a thread (a conversation's messages) is called in the cache. A chat with the assistant and a direct session with an
 * agent have separate id spaces on the PC, so the kind is part of the name.
 */
object ThreadId {
    /** The assistant's general conversation (`chat.list` without a conversation). */
    const val ORB = "c:orb"
    fun chat(conversation: Long?): String = if (conversation == null) ORB else "c:$conversation"
    fun session(id: String): String = "s:$id"
}

/** One row of `inbox.list`. [raw] is the PC's item as received: its shape evolves, the columns are only for ordering. */
@Entity(tableName = "conversations", indices = [Index("zone", "position")])
data class ConversationEntity(
    @PrimaryKey val key: String,
    val zone: String,
    /** Where this item's messages are cached (see [ThreadId]). */
    val threadId: String,
    val project: String?,
    val title: String?,
    val updatedAt: String?,
    val unread: Int,
    /** Position in the PC's own order (pinned first, then sections, then recent). */
    val position: Int,
    val raw: String,
)

/** One line of a conversation, with its text and markdown exactly as the PC sent it so formulas and diagrams render offline. */
@Entity(tableName = "messages", primaryKeys = ["threadId", "msgId"])
data class MessageEntity(
    val threadId: String,
    val msgId: Long,
    val at: String?,
    val role: String?,
    val raw: String,
)

@Entity(tableName = "tasks")
data class TaskEntity(
    @PrimaryKey val id: Long,
    val status: String?,
    val updatedAt: String?,
    val position: Int,
    val raw: String,
)

/** Small JSON documents (`app.state`, `projects.list`, `usage`, the inbox's sections) shown before the PC answers. */
@Entity(tableName = "snapshots")
data class SnapshotEntity(
    @PrimaryKey val key: String,
    val json: String,
    val savedAt: Long,
)

/** When each part of the cache was last filled from the PC. */
@Entity(tableName = "sync_marks")
data class SyncMarkEntity(
    @PrimaryKey val scope: String,
    val at: Long,
)

object OutboxTarget {
    const val CHAT = "chat"
    const val SESSION = "session"
}

object OutboxState {
    const val PENDING = "pending"
    const val SENDING = "sending"
    const val SENT = "sent"
    const val FAILED = "failed"
}

/**
 * A message written offline. The text lives only inside the encrypted database and is sealed by the link when it is sent,
 * never when it is written: the PC refuses stale timestamps and replays.
 */
@Entity(tableName = "outbox", indices = [Index("groupKey", "createdAt"), Index("state")])
data class OutboxEntity(
    /** One id for the message's whole life: every retry carries it so a PC that dedupes does not duplicate. */
    @PrimaryKey val clientId: String,
    /** [OutboxTarget]. */
    val target: String,
    /** The chat's conversation; null starts a new conversation. */
    val conversationId: String?,
    val sessionId: String?,
    val text: String,
    /** JSON array of names the files were uploaded under. */
    val attachments: String,
    /** JSON object with extra params for the PC call (project and brain of a new chat, send mode of a session). */
    val extra: String,
    /** Messages of one group are sent one at a time, in order. */
    val groupKey: String,
    val createdAt: Long,
    /** [OutboxState]. */
    val state: String,
    val attempts: Int,
    val lastError: String?,
    val nextAttemptAt: Long,
    val sentAt: Long?,
)

/**
 * One notice of the notices center (a chat line, a permission request, a task or a PC event), kept so the list survives
 * the app closing. The destination is stored flat: [targetType] (`conversation`, `session`, `task`, `taskChanges`, `version`,
 * `account`, `chats`) and the [targetId] it needs. A notice swiped away stays as a tombstone ([dismissed]) so a later
 * `notes.list` does not bring it back.
 */
@Entity(tableName = "notices", indices = [Index("at")])
data class NoticeEntity(
    @PrimaryKey val id: String,
    val kind: String,
    val title: String,
    val body: String,
    val hidden: Boolean,
    val at: Long,
    val targetType: String?,
    val targetId: String?,
    val read: Boolean,
    val dismissed: Boolean,
)

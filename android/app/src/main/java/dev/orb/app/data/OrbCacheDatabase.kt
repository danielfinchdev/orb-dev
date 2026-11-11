package dev.orb.app.data

import androidx.room.Database
import androidx.room.RoomDatabase

/** The phone's only database: an encrypted cache of the PC's data plus the queue of messages waiting to be sent. */
@Database(
    entities = [ConversationEntity::class, MessageEntity::class, TaskEntity::class, SnapshotEntity::class, SyncMarkEntity::class, OutboxEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class OrbCacheDatabase : RoomDatabase() {
    abstract fun cache(): CacheDao
    abstract fun outbox(): OutboxDao

    companion object {
        const val FILE_NAME = "orb-cache.db"
        const val MAX_CONVERSATIONS = 50
        const val MAX_MESSAGES_PER_THREAD = 300
        const val MAX_TASKS = 200
    }
}

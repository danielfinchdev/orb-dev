package dev.orb.app.data

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.execSQL

/** The phone's only database: an encrypted cache of the PC's data plus the queue of messages waiting to be sent and the notices list. */
@Database(
    entities = [
        ConversationEntity::class, MessageEntity::class, TaskEntity::class, SnapshotEntity::class, SyncMarkEntity::class, OutboxEntity::class,
        NoticeEntity::class,
    ],
    version = 2,
    exportSchema = true,
)
abstract class OrbCacheDatabase : RoomDatabase() {
    abstract fun cache(): CacheDao
    abstract fun outbox(): OutboxDao
    abstract fun notices(): NoticeDao

    companion object {
        const val FILE_NAME = "orb-cache.db"
        const val MAX_CONVERSATIONS = 50
        const val MAX_MESSAGES_PER_THREAD = 300
        const val MAX_TASKS = 200

        /** The queue of unsent messages lives here too, so a new table must never cost the old ones: this adds the notices. */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(connection: SQLiteConnection) {
                connection.execSQL(
                    "CREATE TABLE IF NOT EXISTS `notices` (`id` TEXT NOT NULL, `kind` TEXT NOT NULL, `title` TEXT NOT NULL, `body` TEXT NOT NULL, " +
                        "`hidden` INTEGER NOT NULL, `at` INTEGER NOT NULL, `targetType` TEXT, `targetId` TEXT, `read` INTEGER NOT NULL, " +
                        "`dismissed` INTEGER NOT NULL, PRIMARY KEY(`id`))",
                )
                connection.execSQL("CREATE INDEX IF NOT EXISTS `index_notices_at` ON `notices` (`at`)")
            }
        }
    }
}

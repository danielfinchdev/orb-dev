package dev.orb.app.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

@Dao
abstract class CacheDao {
    @Query("SELECT * FROM conversations WHERE zone = :zone ORDER BY position")
    abstract fun observeConversations(zone: String): Flow<List<ConversationEntity>>

    @Query("SELECT * FROM messages WHERE threadId = :threadId ORDER BY msgId")
    abstract fun observeMessages(threadId: String): Flow<List<MessageEntity>>

    @Query("SELECT * FROM tasks ORDER BY position")
    abstract fun observeTasks(): Flow<List<TaskEntity>>

    @Query("SELECT * FROM snapshots WHERE key = :key")
    abstract fun observeSnapshot(key: String): Flow<SnapshotEntity?>

    @Query("SELECT COUNT(*) FROM conversations")
    abstract fun observeConversationCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM messages")
    abstract fun observeMessageCount(): Flow<Int>

    @Query("SELECT MAX(at) FROM sync_marks")
    abstract fun observeLastSyncedAt(): Flow<Long?>

    @Insert(onConflict = OnConflictStrategy.REPLACE) abstract suspend fun putConversations(rows: List<ConversationEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) abstract suspend fun putMessages(rows: List<MessageEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) abstract suspend fun putTasks(rows: List<TaskEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) abstract suspend fun putSnapshot(row: SnapshotEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) abstract suspend fun putMark(row: SyncMarkEntity)

    @Query("DELETE FROM conversations WHERE zone = :zone AND key NOT IN (:keep)")
    abstract suspend fun dropConversationsExcept(zone: String, keep: List<String>)

    @Query("DELETE FROM conversations WHERE zone = :zone")
    abstract suspend fun dropZone(zone: String)

    // The general conversation has no inbox row, so it is never evicted with them.
    @Query("DELETE FROM messages WHERE threadId <> 'c:orb' AND threadId NOT IN (SELECT threadId FROM conversations)")
    abstract suspend fun dropOrphanThreads()

    @Query("DELETE FROM messages WHERE threadId = :threadId AND msgId NOT IN (SELECT msgId FROM messages WHERE threadId = :threadId ORDER BY msgId DESC LIMIT :keep)")
    abstract suspend fun trimThread(threadId: String, keep: Int)

    @Query("DELETE FROM tasks WHERE id NOT IN (:keep)")
    abstract suspend fun dropTasksExcept(keep: List<Long>)

    @Query("DELETE FROM tasks")
    abstract suspend fun dropTasks()

    /** Replaces the zone's list with the PC's newest [keep] items, and forgets the messages of the ones that fell out. */
    @Transaction
    open suspend fun replaceConversations(zone: String, rows: List<ConversationEntity>, keep: Int) {
        val kept = rows.sortedByDescending { it.updatedAt ?: "" }.take(keep).sortedBy { it.position }
        if (kept.isEmpty()) dropZone(zone) else {
            putConversations(kept)
            dropConversationsExcept(zone, kept.map { it.key })
        }
        dropOrphanThreads()
    }

    @Transaction
    open suspend fun upsertMessages(threadId: String, rows: List<MessageEntity>, keep: Int) {
        putMessages(rows)
        trimThread(threadId, keep)
    }

    @Transaction
    open suspend fun replaceTasks(rows: List<TaskEntity>, keep: Int) {
        val kept = rows.sortedByDescending { it.updatedAt ?: "" }.take(keep).sortedBy { it.position }
        if (kept.isEmpty()) dropTasks() else {
            putTasks(kept)
            dropTasksExcept(kept.map { it.id })
        }
    }
}

@Dao
abstract class OutboxDao {
    @Insert(onConflict = OnConflictStrategy.ABORT) abstract suspend fun insert(row: OutboxEntity)

    /** What waits for the PC in one conversation, oldest first («en espera»). */
    @Query("SELECT * FROM outbox WHERE groupKey = :groupKey AND state <> 'sent' ORDER BY createdAt, rowid")
    abstract fun observeGroup(groupKey: String): Flow<List<OutboxEntity>>

    @Query("SELECT * FROM outbox WHERE state <> 'sent' ORDER BY createdAt, rowid")
    abstract fun observeQueued(): Flow<List<OutboxEntity>>

    @Query("SELECT * FROM outbox WHERE state <> 'sent' ORDER BY createdAt, rowid")
    abstract suspend fun queued(): List<OutboxEntity>

    @Query("SELECT * FROM outbox WHERE clientId = :id")
    abstract suspend fun get(id: String): OutboxEntity?

    @Query("UPDATE outbox SET state = 'sending' WHERE clientId = :id AND state = 'pending'")
    abstract suspend fun markSending(id: String): Int

    @Query("UPDATE outbox SET state = 'pending', attempts = :attempts, lastError = :error, nextAttemptAt = :nextAt WHERE clientId = :id AND state = 'sending'")
    abstract suspend fun markPending(id: String, attempts: Int, error: String?, nextAt: Long)

    @Query("UPDATE outbox SET state = 'sent', sentAt = :now, lastError = NULL WHERE clientId = :id AND state = 'sending'")
    abstract suspend fun markSent(id: String, now: Long)

    @Query("UPDATE outbox SET state = 'failed', attempts = attempts + 1, lastError = :error WHERE clientId = :id AND state = 'sending'")
    abstract suspend fun markFailed(id: String, error: String)

    /** The user's «reintentar»: a failed message goes back to the queue. */
    @Query("UPDATE outbox SET state = 'pending', attempts = 0, lastError = NULL, nextAttemptAt = :now WHERE clientId = :id AND state = 'failed'")
    abstract suspend fun retry(id: String, now: Long): Int

    @Query("UPDATE outbox SET state = 'pending' WHERE state = 'sending'")
    abstract suspend fun resetSending(): Int

    /** A fresh connection is a reason to try again without waiting out a backoff. */
    @Query("UPDATE outbox SET nextAttemptAt = :now WHERE state = 'pending' AND nextAttemptAt > :now")
    abstract suspend fun releaseBackoff(now: Long)

    // A message being sent cannot be deleted: its answer would find nothing to update, and the PC may already have it.
    @Query("DELETE FROM outbox WHERE clientId = :id AND state <> 'sending'")
    abstract suspend fun delete(id: String): Int

    @Query("DELETE FROM outbox WHERE clientId = :id AND state = 'sent'")
    abstract suspend fun deleteSent(id: String): Int

    @Query("DELETE FROM outbox WHERE state = 'sent' AND sentAt < :before")
    abstract suspend fun purgeSent(before: Long): Int
}

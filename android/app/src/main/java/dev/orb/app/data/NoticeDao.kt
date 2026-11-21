package dev.orb.app.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

@Dao
abstract class NoticeDao {
    @Query("SELECT * FROM notices ORDER BY at DESC")
    abstract suspend fun all(): List<NoticeEntity>

    @Query("SELECT * FROM notices WHERE id = :id")
    abstract suspend fun find(id: String): NoticeEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun put(row: NoticeEntity)

    @Query("UPDATE notices SET read = 1 WHERE id IN (:ids)")
    abstract suspend fun markRead(ids: List<String>)

    @Query("UPDATE notices SET read = 1")
    abstract suspend fun markAllRead()

    @Query("UPDATE notices SET dismissed = :dismissed WHERE id = :id")
    abstract suspend fun setDismissed(id: String, dismissed: Boolean)

    @Query("DELETE FROM notices WHERE at < :cutoff")
    abstract suspend fun dropOlderThan(cutoff: Long)

    @Query("DELETE FROM notices WHERE id NOT IN (SELECT id FROM notices ORDER BY at DESC LIMIT :keep)")
    abstract suspend fun trimTo(keep: Int)

    @Query("DELETE FROM notices WHERE id IN (:ids)")
    abstract suspend fun delete(ids: List<String>)

    @Query("DELETE FROM notices")
    abstract suspend fun clear()

    /** Where the last sync with `notes.list` got to: the PC's own time of the newest notice it handed over. */
    @Query("SELECT at FROM sync_marks WHERE scope = :scope")
    abstract suspend fun mark(scope: String): Long?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun putMark(row: SyncMarkEntity)

    /**
     * Saves a notice the phone may already have: the text and the time follow the newest copy, while what the person did
     * with it (read, swiped away) is never undone by a sync.
     */
    @Transaction
    open suspend fun merge(row: NoticeEntity) {
        val old = find(row.id)
        put(if (old == null) row else row.copy(read = old.read || row.read, dismissed = old.dismissed, at = maxOf(old.at, row.at)))
    }

    @Transaction
    open suspend fun prune(cutoff: Long, keep: Int) {
        dropOlderThan(cutoff)
        trimTo(keep)
    }
}

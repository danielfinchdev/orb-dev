package dev.orb.app.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** What the screens read: always the cache, so they open at once and keep working without the PC. */
class CacheRepository(private val dao: CacheDao) {
    fun conversations(zone: String = CacheSync.DEFAULT_ZONE): Flow<List<ConversationEntity>> = dao.observeConversations(zone)
    fun messages(threadId: String): Flow<List<MessageEntity>> = dao.observeMessages(threadId)
    fun tasks(): Flow<List<TaskEntity>> = dao.observeTasks()

    /** A snapshot's JSON as the PC sent it (`app.state`, `projects.list`, `usage`), or null before the first sync. */
    fun snapshot(key: String): Flow<String?> = dao.observeSnapshot(key).map { it?.json }

    /** Null while nothing was ever fetched. */
    fun lastSyncedAt(): Flow<Long?> = dao.observeLastSyncedAt()
}

package dev.orb.app.ui.notes

import dev.orb.app.data.NoticeDao
import dev.orb.app.data.NoticeEntity
import dev.orb.app.data.OrbCacheDatabase
import dev.orb.app.data.SyncMarkEntity

/** The notices list in the encrypted database. [dao] is asked for on each call: the database can be closed and opened again. */
class RoomNoticeStore(private val dao: suspend () -> NoticeDao?) : NoticeStore {
    override suspend fun load(): List<StoredNotice>? = dao()?.all()?.map { it.toStored() }

    override suspend fun merge(list: List<Notice>) {
        val d = dao() ?: return
        for (n in list) d.merge(n.toEntity())
    }

    override suspend fun markRead(ids: Collection<String>?) {
        val d = dao() ?: return
        if (ids == null) d.markAllRead() else if (ids.isNotEmpty()) d.markRead(ids.toList())
    }

    override suspend fun setDismissed(id: String, dismissed: Boolean) {
        dao()?.setDismissed(id, dismissed)
    }

    override suspend fun prune(cutoff: Long, keep: Int) {
        dao()?.prune(cutoff, keep)
    }

    override suspend fun since(): Long? = dao()?.mark(SINCE)

    override suspend fun setSince(at: Long) {
        dao()?.putMark(SyncMarkEntity(SINCE, at))
    }

    companion object {
        const val SINCE = "notices.since"

        fun of(db: OrbCacheDatabase?): NoticeDao? = db?.notices()

        fun Notice.toEntity(): NoticeEntity {
            val (type, id) = flat(target)
            return NoticeEntity(id = this.id, kind = kind, title = title, body = body, hidden = hidden, at = at, targetType = type, targetId = id, read = false, dismissed = false)
        }

        fun NoticeEntity.toStored() = StoredNotice(Notice(id, title, body, kind, at, target(targetType, targetId), hidden), read, dismissed)

        private fun flat(t: NoticeTarget?): Pair<String?, String?> = when (t) {
            is NoticeTarget.Chat -> t.kind to t.id
            is NoticeTarget.Task -> "task" to t.id.toString()
            is NoticeTarget.TaskChanges -> "taskChanges" to t.id.toString()
            is NoticeTarget.Version -> "version" to t.id
            is NoticeTarget.Account -> "account" to t.id
            NoticeTarget.ChatsTab -> "chats" to null
            null -> null to null
        }

        private fun target(type: String?, id: String?): NoticeTarget? = when (type) {
            "conversation", "session" -> id?.let { NoticeTarget.Chat(type, it) }
            "task" -> id?.toLongOrNull()?.let { NoticeTarget.Task(it) }
            "taskChanges" -> id?.toLongOrNull()?.let { NoticeTarget.TaskChanges(it) }
            "version" -> id?.let { NoticeTarget.Version(it) }
            "account" -> id?.let { NoticeTarget.Account(it) }
            "chats" -> NoticeTarget.ChatsTab
            else -> null
        }
    }
}

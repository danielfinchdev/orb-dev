package dev.orb.app.notify

import android.content.SharedPreferences
import kotlinx.serialization.json.Json
import java.util.UUID

/** The few calls of a string map that [NoteJobs] needs, so it runs without Android in tests. */
interface JobStorage {
    fun all(): Map<String, String>
    fun put(key: String, value: String)
    fun remove(keys: Collection<String>)
    fun clear()
}

class SharedPrefsJobStorage(private val prefs: SharedPreferences) : JobStorage {
    override fun all(): Map<String, String> = prefs.all.mapNotNull { (k, v) -> (v as? String)?.let { k to it } }.toMap()
    override fun put(key: String, value: String) { prefs.edit().putString(key, value).apply() }
    override fun remove(keys: Collection<String>) { prefs.edit().apply { keys.forEach(::remove) }.apply() }
    override fun clear() { prefs.edit().clear().commit() }
}

class MemoryJobStorage : JobStorage {
    private val map = LinkedHashMap<String, String>()
    @Synchronized override fun all(): Map<String, String> = LinkedHashMap(map)
    @Synchronized override fun put(key: String, value: String) { map[key] = value }
    @Synchronized override fun remove(keys: Collection<String>) { keys.forEach(map::remove) }
    @Synchronized override fun clear() = map.clear()
}

/**
 * The jobs behind the buttons of the notifications, each under a one-use token. A job is used once (and its sibling
 * buttons go with it), is refused after a day, and all of them go when the notifications are cleared or the phone is
 * unlinked, so nothing can reach a PC the phone no longer belongs to.
 */
class NoteJobs(
    private val storage: JobStorage,
    private val nowMs: () -> Long = System::currentTimeMillis,
    private val newToken: () -> String = { UUID.randomUUID().toString() },
) {
    private val json = Json { ignoreUnknownKeys = true }

    @Synchronized
    fun keep(job: NoteJob): String {
        val token = newToken()
        storage.put(token, json.encodeToString(NoteJob.serializer(), job.copy(at = nowMs())))
        val all = storage.all()
        if (all.size > MAX_PENDING) {
            val oldest = all.entries.sortedBy { decode(it.value)?.at ?: 0L }.take(all.size - MAX_PENDING).map { it.key }
            storage.remove(oldest)
        }
        return token
    }

    /** The job behind a token without using it; null when unknown, already used or too old. */
    @Synchronized
    fun peek(token: String?): NoteJob? {
        val job = token?.let { storage.all()[it] }?.let(::decode) ?: return null
        return job.takeIf { nowMs() - it.at <= MAX_AGE_MS }
    }

    /** Uses the job: it, and the other buttons of its notification, are gone afterwards. */
    @Synchronized
    fun take(token: String?): NoteJob? {
        val job = peek(token)
        if (token == null) return null
        val all = storage.all()
        if (!all.containsKey(token)) return null
        val gone = if (job == null) listOf(token) else all.filter { decode(it.value)?.group == job.group }.keys + token
        storage.remove(gone)
        return job
    }

    /** The jobs of one notification go (a newer note replaces it). */
    @Synchronized
    fun drop(group: Int) {
        storage.remove(storage.all().filter { decode(it.value)?.group == group }.keys)
    }

    @Synchronized
    fun forgetAll() = storage.clear()

    /**
     * Forgets the buttons that act on the PC but keeps the ones that only open the app: a tap on a notification can
     * reach the activity after the app already cleared the tray, and those jobs expire by themselves.
     */
    @Synchronized
    fun forgetActing() {
        storage.remove(storage.all().filter { decode(it.value)?.acts != false }.keys)
    }

    private fun decode(raw: String): NoteJob? = try { json.decodeFromString(NoteJob.serializer(), raw) } catch (e: Exception) { null }

    private companion object {
        const val MAX_PENDING = 200
        const val MAX_AGE_MS = 24L * 60 * 60 * 1000
    }
}

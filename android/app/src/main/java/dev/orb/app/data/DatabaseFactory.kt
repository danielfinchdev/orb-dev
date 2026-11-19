package dev.orb.app.data

import android.content.Context
import androidx.room.Room
import java.io.File

/**
 * Opens the encrypted cache. It is only a cache, so anything that stops it opening (no passphrase, a lost Keystore key,
 * a file that does not decrypt) ends with the file deleted and an empty database, never with a crash. The one exception is a
 * Keystore that is merely busy: nothing is deleted (the queue of unsent messages lives here too) and the cache is
 * unavailable until the next try.
 *
 * [opener] builds the database for a file and passphrase and must fail if the passphrase is wrong; it is injected so tests
 * on the JVM (which cannot load SQLCipher) use another driver.
 */
class DatabaseFactory(
    private val file: File,
    private val keys: CacheKeyProvider,
    private val opener: (File, ByteArray) -> OrbCacheDatabase,
) {
    private var current: OrbCacheDatabase? = null

    /** The open database, or null when the cache cannot be used right now. */
    @Synchronized
    fun open(): OrbCacheDatabase? {
        current?.takeIf { it.isOpen }?.let { return it }
        val passphrase = when (val state = keys.load()) {
            is CacheKeyState.Ready -> state.passphrase
            CacheKeyState.Busy -> return null
            // Without its passphrase the file is unreadable noise.
            CacheKeyState.Missing, CacheKeyState.Lost -> return startOver()
        }
        val opened = tryOpen(passphrase)
        if (opened != null) return opened
        // Only a file this key cannot read is dropped. Any other failure (disk busy, storage full, I/O error) may pass:
        // the cache holds the messages not sent yet, so it stays as it is and the next call tries again.
        return if (unreadable) startOver() else null
    }

    @Synchronized
    fun close() {
        current?.close()
        current = null
    }

    /** Deletes the database files (not the key). */
    @Synchronized
    fun deleteFiles() {
        close()
        listOf("", "-wal", "-shm", "-journal").forEach { File(file.path + it).delete() }
    }

    private fun startOver(): OrbCacheDatabase? {
        deleteFiles()
        return tryOpen(keys.create()).also { if (it == null) runCatching { deleteFiles() } }
    }

    /** Whether the last failed [tryOpen] was a file the key cannot read (wrong passphrase, not a database, corrupt). */
    private var unreadable = false

    private fun tryOpen(passphrase: ByteArray): OrbCacheDatabase? = try {
        unreadable = false
        // SQLCipher clears the array it is given once it has opened the file; the factory hands it a copy.
        opener(file, passphrase.copyOf()).also { current = it }
    } catch (e: Exception) {
        val text = generateSequence<Throwable>(e) { it.cause }.mapNotNull { it.message }.joinToString(" ").lowercase()
        unreadable = UNREADABLE.any { it in text }
        null
    }

    companion object {
        private val UNREADABLE = listOf("not a database", "encrypted", "corrupt", "malformed")

        /** The real opener: Room over SQLCipher, forced to open now so a wrong passphrase fails here and not in a query. */
        fun sqlcipher(context: Context): (File, ByteArray) -> OrbCacheDatabase = { file, passphrase ->
            System.loadLibrary("sqlcipher")
            val db = Room.databaseBuilder(context.applicationContext, OrbCacheDatabase::class.java, file.absolutePath)
                .openHelperFactory(net.zetetic.database.sqlcipher.SupportOpenHelperFactory(passphrase))
                .addMigrations(OrbCacheDatabase.MIGRATION_1_2)
                // The cache can always be fetched again: a schema change without a migration starts it empty.
                .fallbackToDestructiveMigration(dropAllTables = true)
                .build()
            try {
                db.openHelper.writableDatabase
            } catch (e: Exception) {
                db.close()
                throw e
            }
            db
        }

        fun create(context: Context): DatabaseFactory =
            DatabaseFactory(context.applicationContext.getDatabasePath(OrbCacheDatabase.FILE_NAME), KeystoreCacheKey(context), sqlcipher(context))
    }
}

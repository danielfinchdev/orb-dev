package dev.orb.app.data

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/** A key store in memory; [state] can be forced to any answer. */
class FakeKeys(var state: CacheKeyState? = null) : CacheKeyProvider {
    var stored: ByteArray? = null
    var created = 0
    var cleared = false
    override fun load(): CacheKeyState = state ?: stored?.let { CacheKeyState.Ready(it.copyOf()) } ?: CacheKeyState.Missing
    override fun create(): ByteArray {
        created++
        state = null
        return ByteArray(32) { (created * 7 + it).toByte() }.also { stored = it }
    }
    override fun clear() { stored = null; state = null; cleared = true }
}

class DatabaseFactoryTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var file: java.io.File
    private val keys = FakeKeys()
    private val opened = ArrayList<ByteArray>()

    // Plain SQLite cannot check a passphrase, so this opener fails when it differs from the one that made the file.
    private val opener: (java.io.File, ByteArray) -> OrbCacheDatabase = { f, pass ->
        opened += pass.copyOf()
        val marker = java.io.File(f.path + ".key")
        if (f.exists() && marker.exists() && !marker.readBytes().contentEquals(pass)) throw IllegalStateException("file is not a database")
        marker.writeBytes(pass)
        fileDb(f)
    }
    private lateinit var factory: DatabaseFactory

    @Before fun setUp() {
        file = tmp.newFolder().resolve("orb-cache.db")
        factory = DatabaseFactory(file, keys, opener)
    }

    @After fun tearDown() = factory.close()

    private fun DatabaseFactory.deleteAll() {
        deleteFiles()
        java.io.File(file.path + ".key").delete()
    }

    private suspend fun put(db: OrbCacheDatabase) = db.cache().putSnapshot(SnapshotEntity("k", "{}", 1))

    @Test fun firstOpenMakesAKeyAndAWorkingDatabase() = runTest {
        val db = factory.open()!!
        put(db)
        assertEquals(1, keys.created)
        assertEquals(32, keys.stored!!.size)
        assertTrue(file.exists())
    }

    @Test fun reopeningWithTheSameKeyKeepsTheData() = runTest {
        put(factory.open()!!)
        factory.close()
        val again = factory.open()!!
        assertEquals(1, keys.created)
        assertEquals(1, queryCount(again))
    }

    private suspend fun queryCount(db: OrbCacheDatabase): Int = if (db.cache().observeSnapshot("k").first() != null) 1 else 0

    @Test fun aLostKeyDeletesTheDatabaseAndStartsEmptyWithoutCrashing() = runTest {
        put(factory.open()!!)
        factory.close()
        keys.state = CacheKeyState.Lost
        val db = factory.open()
        assertNotNull(db)
        assertEquals(0, queryCount(db!!))
        assertEquals(2, keys.created)
    }

    @Test fun aMissingKeyWithAnExistingFileStartsOver() = runTest {
        put(factory.open()!!)
        factory.close()
        keys.stored = null
        val db = factory.open()!!
        assertEquals(0, queryCount(db))
        assertEquals(2, keys.created)
    }

    @Test fun aFileThatDoesNotDecryptWithTheKeyIsDroppedAndRecreated() = runTest {
        put(factory.open()!!)
        factory.close()
        // The key store now holds another passphrase than the one that made the file (restore, partial wipe).
        keys.stored = ByteArray(32) { 99 }
        val db = factory.open()
        assertNotNull(db)
        assertEquals(0, queryCount(db!!))
        assertEquals(2, keys.created)
    }

    @Test fun aBusyKeystoreDeletesNothing() = runTest {
        put(factory.open()!!)
        factory.close()
        keys.state = CacheKeyState.Busy
        assertNull(factory.open())
        assertTrue(file.exists())
        assertEquals(1, keys.created)
    }

    @Test fun aTransientOpenFailureKeepsTheFileAndTheKey() = runTest {
        put(factory.open()!!)
        factory.close()
        val flaky = DatabaseFactory(file, keys) { _, _ -> throw java.io.IOException("disk I/O error") }
        assertNull(flaky.open())
        assertTrue(file.exists())
        assertEquals(1, keys.created)
        // and the next attempt with a working opener finds the data again
        assertEquals(1, queryCount(factory.open()!!))
    }

    @Test fun wipeDeletesTheDatabaseAndTheKey() = runTest {
        put(factory.open()!!)
        CacheWipe(factory, keys).wipe()
        assertFalse(file.exists())
        assertTrue(keys.cleared)
        assertNull(keys.stored)
        // Linking again starts from nothing.
        val db = factory.open()!!
        assertEquals(0, queryCount(db))
    }

    @Test fun theOpenerGetsACopyOfThePassphrase() = runTest {
        factory.open()
        assertArrayEquals(keys.stored, opened.last())
        assertTrue(opened.last() !== keys.stored)
    }

    @Test fun vaultRoundTripsAndRejectsAnotherKey() {
        fun aes(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val k1 = aes()
        val vault = PassphraseVault({ k1 })
        val pass = vault.newPassphrase()
        val sealed = vault.seal(pass)
        assertTrue(sealed.startsWith("v1:"))
        assertArrayEquals(pass, vault.open(sealed))
        assertNull(PassphraseVault({ aes() }).open(sealed))
        assertNull(vault.open("garbage"))
        assertNull(vault.open("v1:zz"))
    }
}

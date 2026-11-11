package dev.orb.app.data

/**
 * Everything the phone keeps of the PC's data, gone: the database (cache and unsent messages) and its passphrase. Called
 * when the phone is unlinked. The link keys of [dev.orb.app.SecureStore] are not touched here.
 */
class CacheWipe(private val factory: DatabaseFactory, private val keys: CacheKeyProvider) {
    fun wipe() {
        factory.deleteFiles()
        keys.clear()
    }
}

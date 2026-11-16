package dev.orb.app.ui.island

/** A bounded memory of which blocks the user has opened, least recently used first out. Not thread-safe by itself. */
class ShownSet(private val capacity: Int) {
    private val keys = LinkedHashSet<String>()

    fun mark(key: String) { keys.remove(key); keys.add(key); while (keys.size > capacity) keys.remove(keys.first()) }

    fun remove(key: String) { keys.remove(key) }

    /** True when [key] was opened before; asking counts as a use. */
    fun contains(key: String): Boolean = keys.contains(key).also { if (it) mark(key) }

    val size get() = keys.size
}

/** At most [max] islands (WebViews) are alive at once; the others show their card. */
class IslandSlots(private val max: Int) {
    private val holders = LinkedHashSet<Any>()

    @Synchronized fun tryAcquire(token: Any): Boolean = token in holders || (holders.size < max && holders.add(token))
    @Synchronized fun release(token: Any) { holders.remove(token) }
    @Synchronized fun inUse() = holders.size
}

/** In-memory (not persistent) record of the opened blocks, so scrolling back remounts them by themselves. */
object IslandShown {
    const val CAPACITY = 24
    const val MAX_MOUNTED = 3
    private val shown = ShownSet(CAPACITY)
    val slots = IslandSlots(MAX_MOUNTED)

    fun key(kind: IslandKind, source: String) = "${kind.wire}:${source.hashCode()}:${source.length}"
    @Synchronized fun mark(key: String) = shown.mark(key)
    @Synchronized fun forget(key: String) = shown.remove(key)
    @Synchronized fun wasShown(key: String) = shown.contains(key)
}

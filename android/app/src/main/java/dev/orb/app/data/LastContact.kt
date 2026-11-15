package dev.orb.app.data

import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.theme.KeyValueStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * When the PC last answered, kept in plain preferences so «Última conexión hace…» survives a restart. Not a secret:
 * it says nothing about the PC, only when the phone last reached it.
 */
class LastContact(private val store: KeyValueStore) {
    private val _at = MutableStateFlow(store.getString(KEY)?.toLongOrNull())
    val at: StateFlow<Long?> = _at.asStateFlow()

    fun record(ms: Long) {
        // The clock can go backwards (a manual change); the newest moment seen is the one that counts.
        if (ms <= (_at.value ?: Long.MIN_VALUE)) return
        store.edit { putString(KEY, ms.toString()) }
        _at.value = ms
    }

    /** A different PC (or none) is linked next: the old moment says nothing about it. */
    fun clear() {
        store.edit { putString(KEY, null) }
        _at.value = null
    }

    /** Records the moment of each connection and, when it drops, the last answer of the PC. */
    suspend fun track(connection: Flow<ConnectionState>, now: () -> Long) {
        connection.collect { c ->
            when (c) {
                is ConnectionState.Online -> record(now())
                is ConnectionState.Offline -> c.lastSeen?.let(::record)
                else -> Unit
            }
        }
    }

    private companion object {
        const val KEY = "last.contact"
    }
}

package dev.orb.app.notify

import dev.orb.app.ui.theme.KeyValueStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class NotifySettings(
    /** Keeps the link to the PC open with the app closed (the «Mantener conectado» service). On after linking. */
    val keepConnected: Boolean = true,
    /** Shows the text of a notice on the lock screen; off hides it behind a generic line. */
    val lockScreenPublic: Boolean = false,
)

/** What the phone remembers about its notices. Not secrets, so plain preferences. */
class NotifyPrefs(private val store: KeyValueStore) {
    private val _settings = MutableStateFlow(
        NotifySettings(store.getBoolean(KEEP, true), store.getBoolean(PUBLIC, false)),
    )
    val settings: StateFlow<NotifySettings> = _settings.asStateFlow()

    fun setKeepConnected(on: Boolean) {
        store.edit { putBoolean(KEEP, on) }
        _settings.value = _settings.value.copy(keepConnected = on)
    }

    fun setLockScreenPublic(on: Boolean) {
        store.edit { putBoolean(PUBLIC, on) }
        _settings.value = _settings.value.copy(lockScreenPublic = on)
    }

    /** Whether a PC is linked, mirrored here so the boot receiver can decide without opening the Keystore. */
    var linked: Boolean
        get() = store.getBoolean(LINKED, false)
        set(v) = store.edit { putBoolean(LINKED, v) }

    /** The permission dialog is shown once on its own; after that it is the person's choice in «Este móvil». */
    var permissionAsked: Boolean
        get() = store.getBoolean(ASKED, false)
        set(v) = store.edit { putBoolean(ASKED, v) }

    private companion object {
        const val KEEP = "keep.connected"
        const val PUBLIC = "lock.public"
        const val LINKED = "linked"
        const val ASKED = "permission.asked"
    }
}

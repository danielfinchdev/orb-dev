package dev.orb.app.notify

import dev.orb.app.ui.theme.KeyValueStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** What a notice shows while the phone is locked. */
enum class LockScreenNotice(val key: String) {
    /** The chat's name and the text. */
    Full("full"),

    /** The notice is there, with only «Orb» and a generic line. */
    Generic("generic"),

    /** The notice does not appear on the lock screen at all. */
    Hidden("hidden");

    companion object {
        fun fromKey(key: String?) = entries.firstOrNull { it.key == key }
    }
}

data class NotifySettings(
    /** Keeps the link to the PC open with the app closed (the «Mantener conectado» service). On after linking. */
    val keepConnected: Boolean = true,
    val lockScreen: LockScreenNotice = LockScreenNotice.Generic,
    /** The app lock is on: notices never carry their content, because they can sit in the shade after the app locks. */
    val appLock: Boolean = false,
)

/** What the phone remembers about its notices. Not secrets, so plain preferences. */
class NotifyPrefs(private val store: KeyValueStore) {
    private val _settings = MutableStateFlow(
        // The first versions kept a yes/no («show the text»); whoever said yes keeps the full notice, the rest the generic one.
        NotifySettings(
            store.getBoolean(KEEP, true),
            LockScreenNotice.fromKey(store.getString(SCREEN)) ?: if (store.getBoolean(PUBLIC, false)) LockScreenNotice.Full else LockScreenNotice.Generic,
        ),
    )
    val settings: StateFlow<NotifySettings> = _settings.asStateFlow()

    fun setKeepConnected(on: Boolean) {
        store.edit { putBoolean(KEEP, on) }
        _settings.value = _settings.value.copy(keepConnected = on)
    }

    fun setLockScreen(mode: LockScreenNotice) {
        store.edit { putString(SCREEN, mode.key) }
        _settings.value = _settings.value.copy(lockScreen = mode)
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
        const val SCREEN = "lock.screen"
        const val LINKED = "linked"
        const val ASKED = "permission.asked"
    }
}

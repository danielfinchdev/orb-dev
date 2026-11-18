package dev.orb.app.ui.theme

import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class DarkMode(val key: String) {
    System("sistema"), Light("claro"), Dark("oscuro");

    companion object {
        fun fromKey(key: String?) = entries.firstOrNull { it.key == key } ?: System
    }
}

/** The one theme has a palette and a mode; the palette defaults to Grafito. */
data class ThemeSettings(
    val palette: OrbPaletteChoice = OrbPaletteChoice.Grafito,
    val dark: DarkMode = DarkMode.System,
)

/** The few calls of SharedPreferences that are used, so the preferences can be tested without Android. */
interface KeyValueStore {
    fun getString(key: String): String?
    fun getBoolean(key: String, default: Boolean): Boolean
    fun edit(block: Editor.() -> Unit)

    interface Editor {
        fun putString(key: String, value: String?)
        fun putBoolean(key: String, value: Boolean)
    }
}

class SharedPrefsStore(private val prefs: SharedPreferences) : KeyValueStore {
    override fun getString(key: String): String? = prefs.getString(key, null)
    override fun getBoolean(key: String, default: Boolean) = prefs.getBoolean(key, default)
    override fun edit(block: KeyValueStore.Editor.() -> Unit) {
        val e = prefs.edit()
        object : KeyValueStore.Editor {
            override fun putString(key: String, value: String?) { if (value == null) e.remove(key) else e.putString(key, value) }
            override fun putBoolean(key: String, value: Boolean) { e.putBoolean(key, value) }
        }.block()
        e.apply()
    }
}

/** Not a secret, so plain preferences: how the app looks is kept on the phone and never sent anywhere. */
class ThemePrefs(private val store: KeyValueStore) {
    private val _settings: MutableStateFlow<ThemeSettings>

    init {
        // The old theme keys mean nothing now: whoever had any old theme lands on Grafito and keeps the light/dark choice.
        store.edit { for (key in OLD_KEYS) putString(key, null) }
        _settings = MutableStateFlow(
            ThemeSettings(
                palette = OrbPaletteChoice.fromKey(store.getString(PALETTE)) ?: OrbPaletteChoice.Grafito,
                dark = DarkMode.fromKey(store.getString(DARK)),
            ),
        )
    }

    val settings: StateFlow<ThemeSettings> = _settings.asStateFlow()

    fun setPalette(palette: OrbPaletteChoice) {
        store.edit { putString(PALETTE, palette.key) }
        _settings.value = _settings.value.copy(palette = palette)
    }

    fun setDark(dark: DarkMode) {
        store.edit { putString(DARK, dark.key) }
        _settings.value = _settings.value.copy(dark = dark)
    }

    private companion object {
        const val PALETTE = "theme.palette"
        const val DARK = "theme.dark"
        val OLD_KEYS = listOf("theme.choice", "theme.dynamic", "theme.pc")
    }
}

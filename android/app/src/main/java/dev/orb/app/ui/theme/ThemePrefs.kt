package dev.orb.app.ui.theme

import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class ThemeChoice(val key: String) {
    Orbita("orbita"), Cristal("cristal");

    companion object {
        fun fromKey(key: String?) = entries.firstOrNull { it.key == key }
    }
}

enum class DarkMode(val key: String) {
    System("sistema"), Light("claro"), Dark("oscuro");

    companion object {
        fun fromKey(key: String?) = entries.firstOrNull { it.key == key } ?: System
    }
}

/**
 * The theme the phone wears when it follows the PC: «cristal» is the only PC theme with a glass counterpart, every
 * other one (orb, profesional, nube, vaporwave, retro…) is Órbita, and so is "unknown".
 */
fun phoneThemeFor(pcTheme: String?): ThemeChoice = if (pcTheme == "cristal") ThemeChoice.Cristal else ThemeChoice.Orbita

/**
 * [choice] null = follow the PC. [pcTheme] is the PC's `ui.skin`, remembered so a cold start without a connection
 * still looks like the PC.
 */
data class ThemeSettings(
    val choice: ThemeChoice? = null,
    val dark: DarkMode = DarkMode.System,
    val dynamic: Boolean = false,
    val pcTheme: String? = null,
) {
    val effective: ThemeChoice get() = choice ?: phoneThemeFor(pcTheme)
}

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
    private val _settings = MutableStateFlow(
        ThemeSettings(
            choice = ThemeChoice.fromKey(store.getString(CHOICE)),
            dark = DarkMode.fromKey(store.getString(DARK)),
            dynamic = store.getBoolean(DYNAMIC, false),
            pcTheme = store.getString(PC_THEME),
        ),
    )
    val settings: StateFlow<ThemeSettings> = _settings.asStateFlow()

    fun setChoice(choice: ThemeChoice?) {
        store.edit { putString(CHOICE, choice?.key) }
        _settings.value = _settings.value.copy(choice = choice)
    }

    fun setDark(dark: DarkMode) {
        store.edit { putString(DARK, dark.key) }
        _settings.value = _settings.value.copy(dark = dark)
    }

    fun setDynamic(dynamic: Boolean) {
        store.edit { putBoolean(DYNAMIC, dynamic) }
        _settings.value = _settings.value.copy(dynamic = dynamic)
    }

    /** Called with the `ui.skin` the PC reports in `app.state`. */
    fun setPcTheme(skin: String?) {
        if (skin == _settings.value.pcTheme) return
        store.edit { putString(PC_THEME, skin) }
        _settings.value = _settings.value.copy(pcTheme = skin)
    }

    private companion object {
        const val CHOICE = "theme.choice"
        const val DARK = "theme.dark"
        const val DYNAMIC = "theme.dynamic"
        const val PC_THEME = "theme.pc"
    }
}

/** The PC's `ui.skin` out of an `app.state` answer (config.ui.skin); null when it is not there. */
fun pcSkinFrom(appState: kotlinx.serialization.json.JsonElement?): String? =
    ((((appState as? kotlinx.serialization.json.JsonObject)?.get("config") as? kotlinx.serialization.json.JsonObject)
        ?.get("ui") as? kotlinx.serialization.json.JsonObject)?.get("skin") as? kotlinx.serialization.json.JsonPrimitive)
        ?.takeIf { it.isString }?.content

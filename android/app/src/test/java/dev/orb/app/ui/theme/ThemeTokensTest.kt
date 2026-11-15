package dev.orb.app.ui.theme

import kotlinx.serialization.json.Json
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ThemeTokensTest {
    private fun near(expected: IntArray, actual: IntArray) {
        for (i in 0..2) assertTrue("channel $i: ${expected[i]} vs ${actual[i]}", Math.abs(expected[i] - actual[i]) <= 1)
    }

    @Test fun whiteAndBlackConvertExactly() {
        assertArrayEquals(intArrayOf(255, 255, 255), oklchToSrgb(1.0, 0.0, 0.0))
        assertArrayEquals(intArrayOf(0, 0, 0), oklchToSrgb(0.0, 0.0, 0.0))
        assertArrayEquals(intArrayOf(255, 255, 255), OrbitaLightPalette.surface.rgb())
    }

    @Test fun primaryMatchesTheReferenceConversion() {
        // oklch(0.53 0.19 264) is #3061D8 in a reference conversion.
        near(intArrayOf(0x30, 0x61, 0xD8), oklchToSrgb(0.53, 0.19, 264.0))
        near(oklchToSrgb(0.53, 0.19, 264.0), OrbitaLightPalette.primary.rgb())
        near(oklchToSrgb(0.72, 0.14, 264.0), OrbitaDarkPalette.primary.rgb())
        near(oklchToSrgb(0.51, 0.2, 258.0), CristalLightPalette.primary.rgb())
        near(oklchToSrgb(0.915, 0.035, 258.0), CristalLightPalette.bg.rgb())
    }

    @Test fun alphaIsKept() {
        assertEquals(0.36f, CristalLightPalette.scLow.alpha, 0.01f)
        assertEquals(0.4f, OrbitaLightPalette.scrim.alpha, 0.01f)
    }

    @Test fun pcThemeMapsToThePhoneTheme() {
        assertEquals(ThemeChoice.Cristal, phoneThemeFor("cristal"))
        for (s in listOf("orb", "profesional", "nube", "vaporwave", "retro", "algo-nuevo", "", null)) assertEquals(ThemeChoice.Orbita, phoneThemeFor(s))
    }

    @Test fun pcSkinIsReadFromAppState() {
        val state = Json.parseToJsonElement("""{"config":{"ui":{"skin":"cristal","theme":"oscuro"}}}""")
        assertEquals("cristal", pcSkinFrom(state))
        assertNull(pcSkinFrom(Json.parseToJsonElement("""{"config":{}}""")))
        assertNull(pcSkinFrom(null))
    }

    @Test fun textsAreReadableOnSurfaceAndBackground() {
        val palettes = mapOf(
            "orbita-light" to OrbitaLightPalette, "orbita-dark" to OrbitaDarkPalette,
            "cristal-light" to CristalLightPalette, "cristal-dark" to CristalDarkPalette,
        )
        for ((name, p) in palettes) for ((tn, text) in listOf("text" to p.text, "text2" to p.text2, "text3" to p.text3))
            for ((bn, bg) in listOf("surface" to p.surface, "bg" to p.bg)) {
                val ratio = contrast(text, bg)
                assertTrue("$name $tn on $bn = $ratio", ratio >= 4.5)
            }
    }

    @Test fun prefsDefaultToSystemFollowPcNoDynamic() {
        val s = ThemePrefs(MemoryStore()).settings.value
        assertNull(s.choice)
        assertEquals(DarkMode.System, s.dark)
        assertFalse(s.dynamic)
        assertEquals(ThemeChoice.Orbita, s.effective)
    }

    @Test fun prefsPersistAndFollowThePc() {
        val store = MemoryStore()
        val prefs = ThemePrefs(store)
        prefs.setPcTheme("cristal")
        assertEquals(ThemeChoice.Cristal, prefs.settings.value.effective)
        prefs.setChoice(ThemeChoice.Orbita)
        prefs.setDark(DarkMode.Dark)
        prefs.setDynamic(true)
        assertEquals(ThemeChoice.Orbita, prefs.settings.value.effective)
        assertEquals(ThemeSettings(ThemeChoice.Orbita, DarkMode.Dark, true, "cristal"), ThemePrefs(store).settings.value)
        prefs.setChoice(null)
        assertNull(ThemePrefs(store).settings.value.choice)
    }
}

class MemoryStore : KeyValueStore {
    private val m = HashMap<String, Any>()
    override fun getString(key: String) = m[key] as? String
    override fun getBoolean(key: String, default: Boolean) = m[key] as? Boolean ?: default
    override fun edit(block: KeyValueStore.Editor.() -> Unit) {
        object : KeyValueStore.Editor {
            override fun putString(key: String, value: String?) { if (value == null) m.remove(key) else m[key] = value }
            override fun putBoolean(key: String, value: Boolean) { m[key] = value }
        }.block()
    }
}

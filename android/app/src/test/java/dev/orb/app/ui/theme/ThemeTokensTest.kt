package dev.orb.app.ui.theme

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ThemeTokensTest {
    private fun near(what: String, expected: IntArray, actual: IntArray) {
        for (i in 0..2) assertTrue("$what channel $i: ${expected[i]} vs ${actual[i]}", Math.abs(expected[i] - actual[i]) <= 1)
    }

    /** "l c h" as written in the CSS, converted with the reference maths. */
    private fun ok(spec: String): IntArray {
        val (l, c, h) = spec.split(" ").map { it.toDouble() }
        return oklchToSrgb(l, c, h)
    }

    private val fields: Map<String, (OrbPalette) -> Color> = mapOf(
        "bg" to { p -> p.bg }, "surface" to { p -> p.surface }, "scLow" to { p -> p.scLow }, "sc" to { p -> p.sc },
        "scHigh" to { p -> p.scHigh }, "line" to { p -> p.line }, "outline" to { p -> p.outline },
        "text" to { p -> p.text }, "text2" to { p -> p.text2 }, "text3" to { p -> p.text3 },
        "primary" to { p -> p.primary }, "onPrimary" to { p -> p.onPrimary },
        "primarySoft" to { p -> p.primarySoft }, "primaryText" to { p -> p.primaryText },
        "ok" to { p -> p.ok }, "okSoft" to { p -> p.okSoft }, "warn" to { p -> p.warn }, "warnSoft" to { p -> p.warnSoft },
        "err" to { p -> p.err },
    )

    // orb-ui.css: --background, --card, --sidebar, --bubble, --accent, --border, --input, --foreground, --muted-foreground,
    // --faint-foreground, --primary, --primary-foreground, --primary-soft, --primary-text, --success(-soft),
    // --warning(-soft), --destructive.
    private val grafitoLight = mapOf(
        "bg" to "0.991 0 0", "surface" to "1 0 0", "scLow" to "0.978 0 0", "sc" to "0.958 0 0", "scHigh" to "0.958 0 0",
        "line" to "0.93 0 0", "outline" to "0.62 0 0", "text" to "0.269 0 0", "text2" to "0.5 0 0", "text3" to "0.56 0 0",
        "primary" to "0.205 0 0", "onPrimary" to "0.985 0 0", "primarySoft" to "0.962 0.025 40", "primaryText" to "0.52 0.17 40",
        "ok" to "0.5 0.13 160", "okSoft" to "0.962 0.03 160", "warn" to "0.52 0.12 70", "warnSoft" to "0.967 0.04 85",
        "err" to "0.55 0.21 27",
    )
    private val grafitoDark = mapOf(
        "bg" to "0.164 0 0", "surface" to "0.178 0 0", "scLow" to "0.145 0 0", "sc" to "0.225 0 0", "scHigh" to "0.225 0 0",
        "line" to "0.235 0 0", "outline" to "0.5 0 0", "text" to "0.97 0 0", "text2" to "0.72 0 0", "text3" to "0.64 0 0",
        "primary" to "0.97 0 0", "onPrimary" to "0.205 0 0", "primarySoft" to "0.27 0.05 40", "primaryText" to "0.74 0.15 45",
        "ok" to "0.75 0.15 155", "okSoft" to "0.25 0.035 155", "warn" to "0.82 0.13 80", "warnSoft" to "0.26 0.04 70",
        "err" to "0.7 0.19 25",
    )

    // temas.css: what each palette overrides on top of Grafito, light then dark.
    private val overrides: Map<OrbPaletteChoice, Pair<Map<String, String>, Map<String, String>>> = mapOf(
        OrbPaletteChoice.Oceano to (
            mapOf("primarySoft" to "0.955 0.03 245", "primaryText" to "0.5 0.16 252", "bg" to "0.99 0.003 250", "scLow" to "0.975 0.006 250", "sc" to "0.955 0.008 250") to
                mapOf("primarySoft" to "0.28 0.05 250", "primaryText" to "0.75 0.12 245", "bg" to "0.165 0.008 255", "scLow" to "0.145 0.01 255", "sc" to "0.225 0.012 255", "surface" to "0.18 0.008 255")),
        OrbPaletteChoice.Bosque to (
            mapOf("primarySoft" to "0.958 0.03 155", "primaryText" to "0.5 0.12 155", "bg" to "0.99 0.003 150", "scLow" to "0.975 0.006 150", "sc" to "0.955 0.008 150") to
                mapOf("primarySoft" to "0.27 0.04 155", "primaryText" to "0.78 0.13 155", "bg" to "0.165 0.008 160", "scLow" to "0.145 0.01 160", "sc" to "0.225 0.012 160", "surface" to "0.18 0.008 160")),
        OrbPaletteChoice.Uva to (
            mapOf("primarySoft" to "0.958 0.03 300", "primaryText" to "0.52 0.18 300", "bg" to "0.99 0.003 300", "scLow" to "0.975 0.007 300", "sc" to "0.955 0.009 300") to
                mapOf("primarySoft" to "0.28 0.06 300", "primaryText" to "0.76 0.13 300", "bg" to "0.165 0.01 300", "scLow" to "0.145 0.012 300", "sc" to "0.225 0.014 300", "surface" to "0.18 0.01 300")),
        OrbPaletteChoice.Rubi to (
            mapOf("primarySoft" to "0.958 0.025 10", "primaryText" to "0.53 0.19 15", "bg" to "0.99 0.003 10", "scLow" to "0.975 0.006 10", "sc" to "0.955 0.008 10") to
                mapOf("primarySoft" to "0.28 0.06 15", "primaryText" to "0.76 0.14 12", "bg" to "0.165 0.008 15", "scLow" to "0.145 0.01 15", "sc" to "0.225 0.012 15", "surface" to "0.18 0.008 15")),
        OrbPaletteChoice.Arena to (
            mapOf("primarySoft" to "0.958 0.03 75", "primaryText" to "0.5 0.11 60", "bg" to "0.988 0.006 85", "scLow" to "0.97 0.012 85", "sc" to "0.95 0.014 85", "line" to "0.92 0.01 85") to
                mapOf("primarySoft" to "0.28 0.04 70", "primaryText" to "0.8 0.11 75", "bg" to "0.17 0.008 70", "scLow" to "0.15 0.01 70", "sc" to "0.23 0.012 70", "surface" to "0.185 0.008 70")),
    )

    private fun expected(choice: OrbPaletteChoice, dark: Boolean): Map<String, String> {
        val base = if (dark) grafitoDark else grafitoLight
        val over = overrides[choice]?.let { if (dark) it.second else it.first } ?: emptyMap()
        return base + over
    }

    @Test fun whiteAndBlackConvertExactly() {
        assertArrayEquals(intArrayOf(255, 255, 255), oklchToSrgb(1.0, 0.0, 0.0))
        assertArrayEquals(intArrayOf(0, 0, 0), oklchToSrgb(0.0, 0.0, 0.0))
        assertArrayEquals(intArrayOf(255, 255, 255), GrafitoLightPalette.surface.rgb())
    }

    @Test fun allTwelvePalettesMatchTheMockupTokens() {
        for (choice in OrbPaletteChoice.entries) for (dark in listOf(false, true)) {
            val p = paletteFor(choice, dark)
            for ((name, spec) in expected(choice, dark)) {
                near("${choice.key}-${if (dark) "dark" else "light"} $name", ok(spec), fields.getValue(name)(p).rgb())
            }
        }
    }

    @Test fun thePaletteChoicesAreSixWithStableKeys() {
        assertEquals(listOf("grafito", "oceano", "bosque", "uva", "rubi", "arena"), OrbPaletteChoice.entries.map { it.key })
        assertEquals(listOf("Grafito", "Océano", "Bosque", "Uva", "Rubí", "Arena"), OrbPaletteChoice.entries.map { it.label })
        assertEquals(OrbPaletteChoice.Rubi, OrbPaletteChoice.fromKey("rubi"))
        assertNull(OrbPaletteChoice.fromKey("orbita"))
    }

    @Test fun primaryButtonsStayNeutralInEveryPalette() {
        for (choice in OrbPaletteChoice.entries) {
            assertEquals(GrafitoLightPalette.primary, paletteFor(choice, false).primary)
            assertEquals(GrafitoDarkPalette.primary, paletteFor(choice, true).primary)
        }
    }

    @Test fun outlinesReachThreeToOneOnTheField() {
        for (choice in OrbPaletteChoice.entries) for (dark in listOf(false, true)) {
            val p = paletteFor(choice, dark)
            assertTrue("${choice.key} outline on bg", contrast(p.outline, p.bg) >= 3.0)
        }
    }

    @Test fun textsAreReadableOnSurfaceAndBackground() {
        for (choice in OrbPaletteChoice.entries) for (dark in listOf(false, true)) {
            val p = paletteFor(choice, dark)
            val name = "${choice.key}-${if (dark) "dark" else "light"}"
            for ((tn, text) in listOf("text" to p.text, "text2" to p.text2, "text3" to p.text3, "primaryText" to p.primaryText)) {
                for ((bn, field) in listOf("surface" to p.surface, "bg" to p.bg)) {
                    val ratio = contrast(text, field)
                    assertTrue("$name $tn on $bn = $ratio", ratio >= 4.5)
                }
            }
            val soft = contrast(p.primaryText, p.primarySoft)
            assertTrue("$name primaryText on primarySoft = $soft", soft >= 4.5)
        }
    }

    @Test fun prefsDefaultToGrafitoAndSystemMode() {
        val s = ThemePrefs(MemoryStore()).settings.value
        assertEquals(OrbPaletteChoice.Grafito, s.palette)
        assertEquals(DarkMode.System, s.dark)
    }

    @Test fun prefsPersist() {
        val store = MemoryStore()
        val prefs = ThemePrefs(store)
        prefs.setPalette(OrbPaletteChoice.Uva)
        prefs.setDark(DarkMode.Dark)
        assertEquals(ThemeSettings(OrbPaletteChoice.Uva, DarkMode.Dark), ThemePrefs(store).settings.value)
    }

    @Test fun oldThemeKeysAreDroppedAndTheModeIsKept() {
        for (old in listOf("orbita", "cristal", "grafito", null)) {
            val store = MemoryStore()
            store.edit {
                if (old != null) putString("theme.choice", old)
                putBoolean("theme.dynamic", true)
                putString("theme.pc", "cristal")
                putString("theme.dark", "oscuro")
            }
            val s = ThemePrefs(store).settings.value
            assertEquals("old=$old", ThemeSettings(OrbPaletteChoice.Grafito, DarkMode.Dark), s)
            assertNull(store.getString("theme.choice"))
            assertNull(store.getString("theme.pc"))
            assertEquals(false, store.getBoolean("theme.dynamic", false))
        }
    }

    @Test fun anUnknownSavedPaletteFallsBackToGrafito() {
        val store = MemoryStore().also { s -> s.edit { putString("theme.palette", "cristal") } }
        assertEquals(OrbPaletteChoice.Grafito, ThemePrefs(store).settings.value.palette)
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

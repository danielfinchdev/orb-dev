package dev.orb.app.ui.theme

import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.ui.settings.AppearanceSheet
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AppearanceSheetTest {
    @get:Rule val rule = createComposeRule()

    private fun paints(palette: OrbPaletteChoice, dark: Boolean) {
        val prefs = ThemePrefs(MemoryStore())
        rule.setContent { OrbTheme(palette, dark) { AppearanceSheet(prefs) {} } }
        rule.waitForIdle()
        rule.onNodeWithText("Apariencia").assertExists()
        rule.onNodeWithText("Modo").assertExists()
        rule.onNodeWithText("Paleta").assertExists()
        rule.onNodeWithText("Según el sistema").assertIsSelected()
        rule.onNodeWithContentDescription("Paleta Grafito").assertIsSelected()
        for (p in OrbPaletteChoice.entries) rule.onNodeWithContentDescription("Paleta ${p.label}").assertExists()
    }

    @Test fun paintsGrafitoLight() = paints(OrbPaletteChoice.Grafito, false)
    @Test fun paintsGrafitoDark() = paints(OrbPaletteChoice.Grafito, true)
    @Test fun paintsAnotherPaletteDark() = paints(OrbPaletteChoice.Rubi, true)

    @Test fun theRemovedChoicesAreGone() {
        val prefs = ThemePrefs(MemoryStore())
        rule.setContent { OrbTheme(prefs.settings.value) { AppearanceSheet(prefs) {} } }
        rule.waitForIdle()
        for (gone in listOf("Órbita", "Órbita – Cristal", "Igual que el PC", "Colores del fondo"))
            assertEquals(gone, 0, rule.onAllNodesWithText(gone).fetchSemanticsNodes().size)
    }

    @Test fun choosingAPaletteSavesIt() {
        val prefs = ThemePrefs(MemoryStore())
        rule.setContent { OrbTheme(prefs.settings.value) { AppearanceSheet(prefs) {} } }
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Paleta Océano").performClick()
        rule.waitForIdle()
        assertEquals(OrbPaletteChoice.Oceano, prefs.settings.value.palette)
        rule.onNodeWithContentDescription("Paleta Océano").assertIsSelected()
    }

    @Test fun choosingAModeSavesIt() {
        val prefs = ThemePrefs(MemoryStore())
        rule.setContent { OrbTheme(prefs.settings.value) { AppearanceSheet(prefs) {} } }
        rule.waitForIdle()
        rule.onNodeWithText("Oscuro").performClick()
        assertEquals(DarkMode.Dark, prefs.settings.value.dark)
        rule.onNodeWithText("Claro").performClick()
        assertEquals(DarkMode.Light, prefs.settings.value.dark)
    }
}

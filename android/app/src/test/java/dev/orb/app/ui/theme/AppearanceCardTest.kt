package dev.orb.app.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.ui.settings.AppearanceCard
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AppearanceCardTest {
    @get:Rule val rule = createComposeRule()

    private fun show(prefs: ThemePrefs, palette: OrbPaletteChoice = OrbPaletteChoice.Grafito, dark: Boolean = false) {
        rule.setContent { OrbTheme(palette, dark) { AppearanceCard(prefs.settings.value, prefs::setPalette, prefs::setDark) } }
        rule.waitForIdle()
    }

    private fun paints(palette: OrbPaletteChoice, dark: Boolean) {
        show(ThemePrefs(MemoryStore()), palette, dark)
        rule.onNodeWithText("Modo").assertExists()
        rule.onNodeWithText("Paleta").assertExists()
        rule.onNodeWithText("Según el sistema").assertIsSelected()
        rule.onNodeWithContentDescription("Paleta Grafito").assertIsSelected()
        for (p in OrbPaletteChoice.entries) rule.onNodeWithContentDescription("Paleta ${p.label}").assertExists()
    }

    @Test fun paintsGrafitoLight() = paints(OrbPaletteChoice.Grafito, false)
    @Test fun paintsGrafitoDark() = paints(OrbPaletteChoice.Grafito, true)
    @Test fun paintsAnotherPaletteDark() = paints(OrbPaletteChoice.Rubi, true)

    @Test fun theSampleDotsAreTheMockupsFixedColours() {
        assertEquals(Color(0xFFD44F13), OrbPaletteChoice.Grafito.sample)
        assertEquals(Color(0xFF1881E1), OrbPaletteChoice.Oceano.sample)
        assertEquals(Color(0xFF2C965D), OrbPaletteChoice.Bosque.sample)
        assertEquals(Color(0xFF9260DA), OrbPaletteChoice.Uva.sample)
        assertEquals(Color(0xFFD93F5A), OrbPaletteChoice.Rubi.sample)
        assertEquals(Color(0xFFB7752B), OrbPaletteChoice.Arena.sample)
    }

    @Test fun theRemovedChoicesAreGone() {
        show(ThemePrefs(MemoryStore()))
        for (gone in listOf("Órbita", "Órbita – Cristal", "Igual que el PC", "Colores del fondo"))
            assertEquals(gone, 0, rule.onAllNodesWithText(gone).fetchSemanticsNodes().size)
    }

    @Test fun choosingAPaletteSavesIt() {
        val prefs = ThemePrefs(MemoryStore())
        show(prefs)
        rule.onNodeWithContentDescription("Paleta Océano").performClick()
        rule.waitForIdle()
        assertEquals(OrbPaletteChoice.Oceano, prefs.settings.value.palette)
    }

    @Test fun choosingAModeSavesIt() {
        val prefs = ThemePrefs(MemoryStore())
        show(prefs)
        rule.onNodeWithText("Oscuro").performClick()
        assertEquals(DarkMode.Dark, prefs.settings.value.dark)
        rule.onNodeWithText("Claro").performClick()
        assertEquals(DarkMode.Light, prefs.settings.value.dark)
        rule.onNodeWithText("Según el sistema").performClick()
        assertEquals(DarkMode.System, prefs.settings.value.dark)
    }
}

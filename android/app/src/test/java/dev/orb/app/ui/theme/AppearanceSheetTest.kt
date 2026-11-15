package dev.orb.app.ui.theme

import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
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

    private fun paints(choice: ThemeChoice, dark: Boolean) {
        val prefs = ThemePrefs(MemoryStore())
        rule.setContent { OrbTheme(choice, dark, dynamic = false) { AppearanceSheet(prefs) {} } }
        rule.waitForIdle()
        rule.onNodeWithText("Apariencia").assertExists()
        rule.onNodeWithText("Órbita – Cristal").assertExists()
        rule.onNodeWithText("Sistema").assertIsSelected()
    }

    @Test fun paintsOrbitaLight() = paints(ThemeChoice.Orbita, false)
    @Test fun paintsOrbitaDark() = paints(ThemeChoice.Orbita, true)
    @Test fun paintsCristalLight() = paints(ThemeChoice.Cristal, false)
    @Test fun paintsCristalDark() = paints(ThemeChoice.Cristal, true)

    @Test fun tappingCristalChangesThePreference() {
        val prefs = ThemePrefs(MemoryStore())
        rule.setContent { OrbTheme(prefs.settings.value) { AppearanceSheet(prefs) {} } }
        rule.waitForIdle()
        rule.onNodeWithText("Órbita – Cristal").performClick()
        rule.waitForIdle()
        assertEquals(ThemeChoice.Cristal, prefs.settings.value.choice)
        rule.onNodeWithText("Oscuro").performClick()
        assertEquals(DarkMode.Dark, prefs.settings.value.dark)
    }
}

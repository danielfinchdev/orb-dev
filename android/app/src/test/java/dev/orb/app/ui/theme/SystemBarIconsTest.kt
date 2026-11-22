package dev.orb.app.ui.theme

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.core.view.WindowCompat
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SystemBarIconsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private fun lightIcons(): Pair<Boolean, Boolean> {
        val window = rule.activity.window
        val c = WindowCompat.getInsetsController(window, window.decorView)
        return c.isAppearanceLightStatusBars to c.isAppearanceLightNavigationBars
    }

    @Test fun iconsAreDarkOnTheLightThemeAndWhiteOnTheDarkOneWhateverThePhoneUses() {
        var dark by mutableStateOf(false)
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark) {} }
        rule.waitForIdle()
        assertTrue(lightIcons().first); assertTrue(lightIcons().second)
        dark = true
        rule.waitForIdle()
        assertFalse(lightIcons().first); assertFalse(lightIcons().second)
        dark = false
        rule.waitForIdle()
        assertTrue(lightIcons().first)
    }
}

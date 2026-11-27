package dev.orb.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember

@Composable
fun OrbTheme(palette: OrbPaletteChoice, dark: Boolean, content: @Composable () -> Unit) {
    val p = remember(palette, dark) { paletteFor(palette, dark) }
    val scheme = remember(p, dark) { colorSchemeFor(p, dark) }
    val orb = remember(p) { orbColorsFor(p) }
    // Colours switch at once: Grafito has no decorative motion, so there is no cross-fade between palettes.
    SystemBarIcons(dark)
    CompositionLocalProvider(LocalOrbColors provides orb) {
        MaterialTheme(colorScheme = scheme, typography = orbTypography(), shapes = orbShapes(), content = content)
    }
}

/** Resolves "follow the system" against the phone's dark mode. */
@Composable
fun OrbTheme(settings: ThemeSettings, content: @Composable () -> Unit) {
    val dark = when (settings.dark) {
        DarkMode.System -> isSystemInDarkTheme()
        DarkMode.Light -> false
        DarkMode.Dark -> true
    }
    OrbTheme(settings.palette, dark, content)
}

package dev.orb.app.ui.shots

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme

/**
 * The app's theme plus the full-screen background and text colour the real app gets from its root Surface, which
 * single screens do not have.
 */
@Composable
fun ShotFrame(palette: OrbPaletteChoice, dark: Boolean, content: @Composable () -> Unit) {
    OrbTheme(palette, dark) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background, content = content)
    }
}

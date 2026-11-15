package dev.orb.app.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/** What Material 3 has no slot for: the secondary texts, the state colours and the Cristal glass and field colours. */
class OrbColors(
    val isGlass: Boolean,
    val text2: Color, val text3: Color,
    val ok: Color, val okSoft: Color, val warn: Color, val warnSoft: Color, val errSoft: Color,
    val barTop: Color, val barBottom: Color, val chipFill: Color, val rimTop: Color, val rimEdge: Color,
    val fieldBase: Color, val field1: Color, val field2: Color, val field3: Color, val field4: Color,
)

internal val LocalOrbColors = staticCompositionLocalOf<OrbColors> { error("OrbTheme is missing") }

object OrbTheme {
    val colors: OrbColors
        @Composable @ReadOnlyComposable get() = LocalOrbColors.current
}


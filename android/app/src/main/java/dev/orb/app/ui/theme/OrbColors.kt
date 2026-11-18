package dev.orb.app.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/** What Material 3 has no slot for: the secondary texts and the state colours. */
class OrbColors(
    val text2: Color, val text3: Color,
    val ok: Color, val okSoft: Color, val warn: Color, val warnSoft: Color, val errSoft: Color, val info: Color,
    val popover: Color, val secondary: Color, val muted: Color, val accent: Color, val warnInk: Color,
)

internal val LocalOrbColors = staticCompositionLocalOf<OrbColors> { error("OrbTheme is missing") }

object OrbTheme {
    val colors: OrbColors
        @Composable @ReadOnlyComposable get() = LocalOrbColors.current
}

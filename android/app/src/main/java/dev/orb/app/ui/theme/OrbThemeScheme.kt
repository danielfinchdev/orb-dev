package dev.orb.app.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

fun colorSchemeFor(p: OrbPalette, dark: Boolean): ColorScheme {
    val onError = if (dark) Color(0xFF2A0D0C) else Color.White
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = p.primary, onPrimary = p.onPrimary,
        primaryContainer = p.primarySoft, onPrimaryContainer = p.primaryText,
        inversePrimary = p.primaryText, surfaceTint = p.primary,
        secondary = p.primaryText, onSecondary = p.surface,
        // Selected chips and tabs of Material pieces are neutral like the mockups' pressed chip; the accent stays on primaryContainer.
        secondaryContainer = p.primary, onSecondaryContainer = p.onPrimary,
        tertiary = p.ok, onTertiary = p.surface, tertiaryContainer = p.okSoft, onTertiaryContainer = p.ok,
        background = p.bg, onBackground = p.text,
        surface = p.surface, onSurface = p.text, surfaceVariant = p.scHighest, onSurfaceVariant = p.text2,
        surfaceDim = p.bg, surfaceBright = p.surface, surfaceContainerLowest = p.surface,
        surfaceContainerLow = p.scLow, surfaceContainer = p.sc,
        surfaceContainerHigh = p.scHigh, surfaceContainerHighest = p.scHighest,
        inverseSurface = p.text, inverseOnSurface = p.surface,
        outline = p.outline, outlineVariant = p.line,
        error = p.err, onError = onError, errorContainer = p.errSoft, onErrorContainer = p.err,
        scrim = p.scrim,
    )
}

fun orbColorsFor(p: OrbPalette) = OrbColors(
    text2 = p.text2, text3 = p.text3, ok = p.ok, okSoft = p.okSoft, warn = p.warn, warnSoft = p.warnSoft, errSoft = p.errSoft, info = p.info,
    popover = p.popover, secondary = p.secondary, muted = p.muted, accent = p.accent, warnInk = p.warnInk,
)

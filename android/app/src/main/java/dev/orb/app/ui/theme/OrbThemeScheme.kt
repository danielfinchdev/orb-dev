package dev.orb.app.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.lerp

fun paletteFor(choice: ThemeChoice, dark: Boolean): OrbPalette = when (choice) {
    ThemeChoice.Orbita -> if (dark) OrbitaDarkPalette else OrbitaLightPalette
    ThemeChoice.Cristal -> if (dark) CristalDarkPalette else CristalLightPalette
    ThemeChoice.Grafito -> if (dark) GrafitoDarkPalette else GrafitoLightPalette
}

/**
 * Cristal's surfaces are translucent in the mockup, but Material components (sheets, dialogs, menus) sit over a scrim
 * and would show the content under them, so the scheme gets them flattened over the field colour. The glass look comes
 * from [OrbColors] and GlassSurface instead.
 */
fun colorSchemeFor(p: OrbPalette, dark: Boolean): ColorScheme {
    fun flat(c: Color) = c.compositeOver(p.bg)
    val onError = if (dark) Color(0xFF2A0D0C) else Color.White
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = p.primary, onPrimary = p.onPrimary,
        primaryContainer = flat(p.primarySoft), onPrimaryContainer = p.primaryText,
        inversePrimary = p.primaryText, surfaceTint = p.primary,
        secondary = p.primaryText, onSecondary = p.surface,
        secondaryContainer = flat(p.primarySoft), onSecondaryContainer = p.primaryText,
        tertiary = p.ok, onTertiary = p.surface, tertiaryContainer = p.okSoft, onTertiaryContainer = p.ok,
        background = p.bg, onBackground = p.text,
        surface = p.surface, onSurface = p.text, surfaceVariant = flat(p.scHighest), onSurfaceVariant = p.text2,
        surfaceDim = p.bg, surfaceBright = p.surface, surfaceContainerLowest = p.surface,
        surfaceContainerLow = flat(p.scLow), surfaceContainer = flat(p.sc),
        surfaceContainerHigh = flat(p.scHigh), surfaceContainerHighest = flat(p.scHighest),
        inverseSurface = p.text, inverseOnSurface = p.surface,
        outline = p.outline, outlineVariant = flat(p.line),
        error = p.err, onError = onError, errorContainer = p.errSoft, onErrorContainer = p.err,
        scrim = p.scrim,
    )
}

fun orbColorsFor(p: OrbPalette, glass: Boolean) = OrbColors(
    isGlass = glass, text2 = p.text2, text3 = p.text3,
    ok = p.ok, okSoft = p.okSoft, warn = p.warn, warnSoft = p.warnSoft, errSoft = p.errSoft,
    barTop = p.barTop, barBottom = p.barBottom, chipFill = p.chipFill, rimTop = p.rimTop, rimEdge = p.rimEdge,
    fieldBase = p.bg, field1 = p.field1, field2 = p.field2, field3 = p.field3, field4 = p.field4,
)

/**
 * Material You: the system colours replace the brand ones in both themes. Cristal keeps its shape and takes its
 * colour field from the system containers, so it still reads as glass over a calm field.
 */
fun dynamicOrbColors(dyn: ColorScheme, palette: OrbPalette, glass: Boolean, dark: Boolean): OrbColors {
    val k = if (dark) 0.35f else 0.55f
    fun tint(c: Color) = lerp(dyn.surface, c, k)
    val f1 = tint(dyn.primaryContainer)
    val f2 = tint(dyn.tertiaryContainer)
    return orbColorsFor(palette, glass).withDynamic(
        text2 = dyn.onSurfaceVariant, text3 = dyn.onSurfaceVariant,
        fieldBase = lerp(dyn.surface, f1, 0.5f),
        field1 = f1, field2 = f2, field3 = tint(dyn.secondaryContainer), field4 = lerp(f1, f2, 0.5f),
    )
}

private fun OrbColors.withDynamic(
    text2: Color, text3: Color, fieldBase: Color, field1: Color, field2: Color, field3: Color, field4: Color,
) = OrbColors(
    isGlass, text2, text3, ok, okSoft, warn, warnSoft, errSoft, barTop, barBottom, chipFill, rimTop, rimEdge,
    fieldBase, field1, field2, field3, field4,
)

internal fun lerpOrbColors(a: OrbColors, b: OrbColors, t: Float): OrbColors {
    if (t >= 1f) return b
    fun l(x: Color, y: Color) = lerp(x, y, t)
    return OrbColors(
        b.isGlass, l(a.text2, b.text2), l(a.text3, b.text3), l(a.ok, b.ok), l(a.okSoft, b.okSoft), l(a.warn, b.warn),
        l(a.warnSoft, b.warnSoft), l(a.errSoft, b.errSoft), l(a.barTop, b.barTop), l(a.barBottom, b.barBottom),
        l(a.chipFill, b.chipFill), l(a.rimTop, b.rimTop), l(a.rimEdge, b.rimEdge), l(a.fieldBase, b.fieldBase),
        l(a.field1, b.field1), l(a.field2, b.field2), l(a.field3, b.field3), l(a.field4, b.field4),
    )
}

internal fun lerpScheme(a: ColorScheme, b: ColorScheme, t: Float): ColorScheme {
    if (t >= 1f) return b
    fun l(x: Color, y: Color) = lerp(x, y, t)
    return b.copy(
        primary = l(a.primary, b.primary), onPrimary = l(a.onPrimary, b.onPrimary),
        primaryContainer = l(a.primaryContainer, b.primaryContainer), onPrimaryContainer = l(a.onPrimaryContainer, b.onPrimaryContainer),
        inversePrimary = l(a.inversePrimary, b.inversePrimary),
        secondary = l(a.secondary, b.secondary), onSecondary = l(a.onSecondary, b.onSecondary),
        secondaryContainer = l(a.secondaryContainer, b.secondaryContainer), onSecondaryContainer = l(a.onSecondaryContainer, b.onSecondaryContainer),
        tertiary = l(a.tertiary, b.tertiary), onTertiary = l(a.onTertiary, b.onTertiary),
        tertiaryContainer = l(a.tertiaryContainer, b.tertiaryContainer), onTertiaryContainer = l(a.onTertiaryContainer, b.onTertiaryContainer),
        background = l(a.background, b.background), onBackground = l(a.onBackground, b.onBackground),
        surface = l(a.surface, b.surface), onSurface = l(a.onSurface, b.onSurface),
        surfaceVariant = l(a.surfaceVariant, b.surfaceVariant), onSurfaceVariant = l(a.onSurfaceVariant, b.onSurfaceVariant),
        surfaceTint = l(a.surfaceTint, b.surfaceTint), inverseSurface = l(a.inverseSurface, b.inverseSurface),
        inverseOnSurface = l(a.inverseOnSurface, b.inverseOnSurface),
        error = l(a.error, b.error), onError = l(a.onError, b.onError),
        errorContainer = l(a.errorContainer, b.errorContainer), onErrorContainer = l(a.onErrorContainer, b.onErrorContainer),
        outline = l(a.outline, b.outline), outlineVariant = l(a.outlineVariant, b.outlineVariant), scrim = l(a.scrim, b.scrim),
        surfaceBright = l(a.surfaceBright, b.surfaceBright), surfaceDim = l(a.surfaceDim, b.surfaceDim),
        surfaceContainer = l(a.surfaceContainer, b.surfaceContainer), surfaceContainerHigh = l(a.surfaceContainerHigh, b.surfaceContainerHigh),
        surfaceContainerHighest = l(a.surfaceContainerHighest, b.surfaceContainerHighest),
        surfaceContainerLow = l(a.surfaceContainerLow, b.surfaceContainerLow), surfaceContainerLowest = l(a.surfaceContainerLowest, b.surfaceContainerLowest),
    )
}

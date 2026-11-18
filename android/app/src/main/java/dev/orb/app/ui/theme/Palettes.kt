package dev.orb.app.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * The tokens of one palette in one mode, converted from OKLCH to sRGB once (clipped to the sRGB gamut) so nothing is
 * converted at run time. Source of truth: the design mockups (orb-ui.css for Grafito, temas.css for the others);
 * ThemeTokensTest re-checks the conversion.
 */
data class OrbPalette(
    val bg: Color, val surface: Color, val scLow: Color, val sc: Color, val scHigh: Color, val scHighest: Color,
    val line: Color, val outline: Color,
    val text: Color, val text2: Color, val text3: Color,
    val primary: Color, val onPrimary: Color, val primarySoft: Color, val primaryText: Color,
    val ok: Color, val okSoft: Color, val warn: Color, val warnSoft: Color, val err: Color, val errSoft: Color,
    val scrim: Color,
    /** `--info`: links and the Orbe mark; it has no Material slot. */
    val info: Color,
)

/** The six palettes of the single theme; [key] is what is saved, [label] what the user reads. */
enum class OrbPaletteChoice(val key: String, val label: String) {
    Grafito("grafito", "Grafito"), Oceano("oceano", "Océano"), Bosque("bosque", "Bosque"),
    Uva("uva", "Uva"), Rubi("rubi", "Rubí"), Arena("arena", "Arena");

    companion object {
        fun fromKey(key: String?) = entries.firstOrNull { it.key == key }
    }
}

/**
 * Grafito: neutral greys with a single orange accent (orb-ui.css, light and dark blocks). The text tokens were checked
 * for WCAG AA against the field and the soft fills; the control outline (`--input`) for 3:1. Primary is neutral
 * (near-black by day, near-white at night): the accent is only for text on [OrbPalette.primarySoft].
 */
val GrafitoLightPalette = OrbPalette(
    bg = Color(0xFFFCFCFC), surface = Color(0xFFFFFFFF), scLow = Color(0xFFF8F8F8),
    sc = Color(0xFFF1F1F1), scHigh = Color(0xFFF1F1F1), scHighest = Color(0xFFE8E8E8),
    line = Color(0xFFE8E8E8), outline = Color(0xFF868686), text = Color(0xFF262626),
    text2 = Color(0xFF636363), text3 = Color(0xFF747474), primary = Color(0xFF171717),
    onPrimary = Color(0xFFFAFAFA), primarySoft = Color(0xFFFFEDE6), primaryText = Color(0xFFB53900),
    ok = Color(0xFF007948), okSoft = Color(0xFFE2F9EC), warn = Color(0xFF945A00),
    warnSoft = Color(0xFFFFF3D6), err = Color(0xFFD01D21), errSoft = Color(0xFFFFEFED),
    scrim = Color(0x6612161F), info = oklch(0.53, 0.17, 254.0),
)

val GrafitoDarkPalette = OrbPalette(
    bg = Color(0xFF0E0E0E), surface = Color(0xFF111111), scLow = Color(0xFF0A0A0A),
    sc = Color(0xFF1C1C1C), scHigh = Color(0xFF1C1C1C), scHighest = Color(0xFF262626),
    line = Color(0xFF1E1E1E), outline = Color(0xFF636363), text = Color(0xFFF5F5F5),
    text2 = Color(0xFFA4A4A4), text3 = Color(0xFF8C8C8C), primary = Color(0xFFF5F5F5),
    onPrimary = Color(0xFF171717), primarySoft = Color(0xFF3B1D13), primaryText = Color(0xFFF78955),
    ok = Color(0xFF4EC983), okSoft = Color(0xFF13271A), warn = Color(0xFFF0BA59),
    warnSoft = Color(0xFF30200D), err = Color(0xFFFF645F), errSoft = Color(0xFF391919),
    scrim = Color(0x8C000000), info = oklch(0.68, 0.17, 250.0),
)

// Every other palette is Grafito plus what its line of temas.css overrides: accent, field, sidebar, bubble, card, border.
private val OceanoLight = GrafitoLightPalette.copy(
    primarySoft = Color(0xFFE0F3FF), primaryText = Color(0xFF0063BA), bg = Color(0xFFFAFCFE),
    scLow = Color(0xFFF4F7FB), sc = Color(0xFFECF1F5),
)
private val OceanoDark = GrafitoDarkPalette.copy(
    primarySoft = Color(0xFF142A41), primaryText = Color(0xFF68B5F5), bg = Color(0xFF0C0F12),
    scLow = Color(0xFF080A0E), sc = Color(0xFF181C21), surface = Color(0xFF0F1215),
)
private val BosqueLight = GrafitoLightPalette.copy(
    primarySoft = Color(0xFFE2F8E8), primaryText = Color(0xFF0B7643), bg = Color(0xFFFAFCFB),
    scLow = Color(0xFFF4F8F5), sc = Color(0xFFEDF2ED),
)
private val BosqueDark = GrafitoDarkPalette.copy(
    primarySoft = Color(0xFF152C1E), primaryText = Color(0xFF6CD092), bg = Color(0xFF0B0F0D),
    scLow = Color(0xFF070B09), sc = Color(0xFF171E1A), surface = Color(0xFF0F1310),
)
private val UvaLight = GrafitoLightPalette.copy(
    primarySoft = Color(0xFFF4EDFF), primaryText = Color(0xFF7B47BF), bg = Color(0xFFFCFBFD),
    scLow = Color(0xFFF7F6FB), sc = Color(0xFFF1EFF5),
)
private val UvaDark = GrafitoDarkPalette.copy(
    primarySoft = Color(0xFF2E2142), primaryText = Color(0xFFBE9DF7), bg = Color(0xFF0F0D12),
    scLow = Color(0xFF0B090E), sc = Color(0xFF1D1A21), surface = Color(0xFF121115),
)
private val RubiLight = GrafitoLightPalette.copy(
    primarySoft = Color(0xFFFFEBED), primaryText = Color(0xFFC02447), bg = Color(0xFFFEFBFB),
    scLow = Color(0xFFFBF5F6), sc = Color(0xFFF5EEEF),
)
private val RubiDark = GrafitoDarkPalette.copy(
    primarySoft = Color(0xFF421B1F), primaryText = Color(0xFFFC8999), bg = Color(0xFF120D0D),
    scLow = Color(0xFF0E0909), sc = Color(0xFF211A1A), surface = Color(0xFF151010),
)
private val ArenaLight = GrafitoLightPalette.copy(
    primarySoft = Color(0xFFFDEFDC), primaryText = Color(0xFF905211), bg = Color(0xFFFDFBF7),
    scLow = Color(0xFFF9F5EC), sc = Color(0xFFF3EEE4), line = Color(0xFFE8E4DD),
)
private val ArenaDark = GrafitoDarkPalette.copy(
    primarySoft = Color(0xFF362512), primaryText = Color(0xFFE7B369), bg = Color(0xFF120F0C),
    scLow = Color(0xFF0E0A07), sc = Color(0xFF211C17), surface = Color(0xFF15120F),
)

fun paletteFor(choice: OrbPaletteChoice, dark: Boolean): OrbPalette = when (choice) {
    OrbPaletteChoice.Grafito -> if (dark) GrafitoDarkPalette else GrafitoLightPalette
    OrbPaletteChoice.Oceano -> if (dark) OceanoDark else OceanoLight
    OrbPaletteChoice.Bosque -> if (dark) BosqueDark else BosqueLight
    OrbPaletteChoice.Uva -> if (dark) UvaDark else UvaLight
    OrbPaletteChoice.Rubi -> if (dark) RubiDark else RubiLight
    OrbPaletteChoice.Arena -> if (dark) ArenaDark else ArenaLight
}

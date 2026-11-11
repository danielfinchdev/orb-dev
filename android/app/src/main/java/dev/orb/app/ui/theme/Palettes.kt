package dev.orb.app.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * The Órbita and Órbita – Cristal tokens, converted from OKLCH to sRGB once (clipped to the sRGB gamut) so nothing is
 * converted at run time. Source of truth: the design mockups (orb.css, th-cristal.css); [OklchConversionTest] re-checks
 * the conversion. The glass-only fields stay transparent in the two Órbita palettes.
 */
class OrbPalette(
    val bg: Color, val surface: Color, val scLow: Color, val sc: Color, val scHigh: Color, val scHighest: Color,
    val line: Color, val outline: Color,
    val text: Color, val text2: Color, val text3: Color,
    val primary: Color, val onPrimary: Color, val primarySoft: Color, val primaryText: Color,
    val ok: Color, val okSoft: Color, val warn: Color, val warnSoft: Color, val err: Color, val errSoft: Color,
    val scrim: Color,
    // Cristal only: the colour field behind everything, and the glass fills of bars, chips and their light rim.
    val field1: Color = Color.Transparent, val field2: Color = Color.Transparent,
    val field3: Color = Color.Transparent, val field4: Color = Color.Transparent,
    val barTop: Color = Color.Transparent, val barBottom: Color = Color.Transparent,
    val chipFill: Color = Color.Transparent, val rimTop: Color = Color.Transparent, val rimEdge: Color = Color.Transparent,
)

val OrbitaLightPalette = OrbPalette(
    bg = Color(0xFFF8F9FC), surface = Color(0xFFFFFFFF), scLow = Color(0xFFF4F6F9),
    sc = Color(0xFFEFF1F6), scHigh = Color(0xFFE8EBF1), scHighest = Color(0xFFE0E3EA),
    line = Color(0xFFDFE2E7), outline = Color(0xFF818693), text = Color(0xFF171A24),
    text2 = Color(0xFF4E525E), text3 = Color(0xFF646975), primary = Color(0xFF3061D8),
    onPrimary = Color(0xFFFFFFFF), primarySoft = Color(0xFFE6F0FF), primaryText = Color(0xFF214DBA),
    ok = Color(0xFF007840), okSoft = Color(0xFFDFF8E6), warn = Color(0xFF975800),
    warnSoft = Color(0xFFFFF1D1), err = Color(0xFFC2272D), errSoft = Color(0xFFFFEBE8),
    scrim = Color(0x6612161F),
)

val OrbitaDarkPalette = OrbPalette(
    bg = Color(0xFF0C0E13), surface = Color(0xFF121419), scLow = Color(0xFF0F1015),
    sc = Color(0xFF191C22), scHigh = Color(0xFF21242C), scHighest = Color(0xFF2A2E36),
    line = Color(0xFF25282E), outline = Color(0xFF6A6F7B), text = Color(0xFFEFF0F4),
    text2 = Color(0xFFBABEC6), text3 = Color(0xFF9A9EA8), primary = Color(0xFF77A2FC),
    onPrimary = Color(0xFF081431), primarySoft = Color(0xFF1C2A49), primaryText = Color(0xFFA3C4FF),
    ok = Color(0xFF63D18F), okSoft = Color(0xFF143320), warn = Color(0xFFF7C15F),
    warnSoft = Color(0xFF432A08), err = Color(0xFFFF7D7C), errSoft = Color(0xFF4B1D1D),
    scrim = Color(0x8C000000),
)

val CristalLightPalette = OrbPalette(
    bg = Color(0xFFD5E4FB), surface = Color(0xFFFFFFFF), scLow = Color(0x5CF7FAFE),
    sc = Color(0xB8EDF0F6), scHigh = Color(0xE6E4E8EF), scHighest = Color(0xFFD6DBE3),
    line = Color(0x1F282E38), outline = Color(0xFF6B727E), text = Color(0xFF14161B),
    text2 = Color(0xFF333840), text3 = Color(0xFF454B54), primary = Color(0xFF005ED5),
    onPrimary = Color(0xFFFFFFFF), primarySoft = Color(0xEBD3E8FF), primaryText = Color(0xFF004FBF),
    ok = Color(0xFF006E30), okSoft = Color(0xFFD8F9DD), warn = Color(0xFF904C00),
    warnSoft = Color(0xFFFFF1D2), err = Color(0xFFC21725), errSoft = Color(0xFFFFEAE9),
    scrim = Color(0x6612161F), field1 = Color(0xFF5AACFF), field2 = Color(0xFFF293D0),
    field3 = Color(0xFF46D6D1), field4 = Color(0xFFFFC88C), barTop = Color(0xC7FFFFFF),
    barBottom = Color(0x99FFFFFF), chipFill = Color(0x99FFFFFF), rimTop = Color(0xF2FFFFFF),
    rimEdge = Color(0x1A262E3D),
)

val CristalDarkPalette = OrbPalette(
    bg = Color(0xFF0A0F1D), surface = Color(0xFF1C1E22), scLow = Color(0x9912161E),
    sc = Color(0xB82B2E34), scHigh = Color(0xE035383E), scHighest = Color(0xFF44484E),
    line = Color(0x1AFFFFFF), outline = Color(0xFF828690), text = Color(0xFFF4F5F6),
    text2 = Color(0xFFCBCED3), text3 = Color(0xFFB4B7BE), primary = Color(0xFF0062D8),
    onPrimary = Color(0xFFFFFFFF), primarySoft = Color(0xE6153765), primaryText = Color(0xFF95CDFF),
    ok = Color(0xFF6ED889), okSoft = Color(0xFF17391F), warn = Color(0xFFFAC463),
    warnSoft = Color(0xFF462D0B), err = Color(0xFFFF8A88), errSoft = Color(0xFF541F20),
    scrim = Color(0x8C000000), field1 = Color(0xFF0B3A7A), field2 = Color(0xFF4D1951),
    field3 = Color(0xFF004747), field4 = Color(0xFF472400), barTop = Color(0xC72F333B),
    barBottom = Color(0xB823262E), chipFill = Color(0x14FFFFFF), rimTop = Color(0x38FFFFFF),
    rimEdge = Color(0x14FFFFFF),
)


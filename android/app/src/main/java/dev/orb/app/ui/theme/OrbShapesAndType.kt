package dev.orb.app.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

// Radii are the --r-* tokens of each theme: Cristal rounds a bit more so inner and outer corners nest.
fun orbShapes(glass: Boolean): Shapes =
    if (glass) Shapes(
        extraSmall = RoundedCornerShape(6.dp), small = RoundedCornerShape(10.dp), medium = RoundedCornerShape(16.dp),
        large = RoundedCornerShape(22.dp), extraLarge = RoundedCornerShape(28.dp),
    ) else Shapes(
        extraSmall = RoundedCornerShape(4.dp), small = RoundedCornerShape(8.dp), medium = RoundedCornerShape(12.dp),
        large = RoundedCornerShape(16.dp), extraLarge = RoundedCornerShape(28.dp),
    )

// System font on purpose (no font files shipped); sizes follow section 5 of the design (app bar 22/28, rows 16/24 + 14/20).
fun orbTypography(glass: Boolean): Typography {
    val tracking = if (glass) (-0.008).em else 0.em
    fun s(size: Int, line: Int, weight: FontWeight) =
        TextStyle(fontSize = size.sp, lineHeight = line.sp, fontWeight = weight, letterSpacing = tracking)
    return Typography(
        displayLarge = s(57, 64, FontWeight.Normal), displayMedium = s(45, 52, FontWeight.Normal), displaySmall = s(36, 44, FontWeight.Normal),
        headlineLarge = s(32, 40, FontWeight.SemiBold), headlineMedium = s(28, 36, FontWeight.SemiBold), headlineSmall = s(24, 32, FontWeight.SemiBold),
        titleLarge = s(22, 28, FontWeight.Medium), titleMedium = s(16, 24, FontWeight.Medium), titleSmall = s(14, 20, FontWeight.SemiBold),
        bodyLarge = s(16, 24, FontWeight.Normal), bodyMedium = s(14, 20, FontWeight.Normal), bodySmall = s(12, 16, FontWeight.Normal),
        labelLarge = s(14, 20, FontWeight.SemiBold), labelMedium = s(12, 16, FontWeight.Medium), labelSmall = s(11, 16, FontWeight.Medium),
    )
}

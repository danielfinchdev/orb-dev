package dev.orb.app.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Radii follow the --r-* tokens: controls 8, cards 12, sheets and dialogs 18.
fun orbShapes(): Shapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp), small = RoundedCornerShape(8.dp), medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(18.dp), extraLarge = RoundedCornerShape(18.dp),
)

// System font on purpose (no font files shipped); sober titles: the app bar is 20 sp SemiBold, rows 16/24 + 14/20.
fun orbTypography(): Typography {
    fun s(size: Int, line: Int, weight: FontWeight) = TextStyle(fontSize = size.sp, lineHeight = line.sp, fontWeight = weight)
    return Typography(
        displayLarge = s(57, 64, FontWeight.Normal), displayMedium = s(45, 52, FontWeight.Normal), displaySmall = s(36, 44, FontWeight.Normal),
        headlineLarge = s(32, 40, FontWeight.SemiBold), headlineMedium = s(28, 36, FontWeight.SemiBold), headlineSmall = s(24, 32, FontWeight.SemiBold),
        titleLarge = s(20, 26, FontWeight.SemiBold), titleMedium = s(16, 24, FontWeight.Medium), titleSmall = s(14, 20, FontWeight.SemiBold),
        bodyLarge = s(16, 24, FontWeight.Normal), bodyMedium = s(14, 20, FontWeight.Normal), bodySmall = s(12, 16, FontWeight.Normal),
        labelLarge = s(14, 20, FontWeight.SemiBold), labelMedium = s(12, 16, FontWeight.Medium), labelSmall = s(11, 16, FontWeight.Medium),
    )
}

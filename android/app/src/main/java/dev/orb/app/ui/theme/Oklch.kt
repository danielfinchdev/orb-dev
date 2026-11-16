package dev.orb.app.ui.theme

import androidx.compose.ui.graphics.Color
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin

/**
 * OKLCH to sRGB for colours that are only known at run time (a project's avatar hue); the fixed tokens are converted
 * once in [Palettes.kt]. Out-of-gamut values are clipped.
 */
fun oklch(l: Double, c: Double, hDeg: Double): Color {
    val a = c * cos(Math.toRadians(hDeg))
    val b = c * sin(Math.toRadians(hDeg))
    val l3 = (l + 0.3963377774 * a + 0.2158037573 * b).pow(3)
    val m3 = (l - 0.1055613458 * a - 0.0638541728 * b).pow(3)
    val s3 = (l - 0.0894841775 * a - 1.2914855480 * b).pow(3)
    val lin = doubleArrayOf(
        4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
        -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
        -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3,
    )
    fun gamma(v: Double) = (if (v <= 0.0031308) 12.92 * v else 1.055 * v.pow(1 / 2.4) - 0.055).coerceIn(0.0, 1.0).toFloat()
    return Color(gamma(lin[0]), gamma(lin[1]), gamma(lin[2]))
}

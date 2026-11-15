package dev.orb.app.ui.theme

import androidx.compose.ui.graphics.Color
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin

/** Reference OKLCH to sRGB conversion, clipped to the gamut; the palettes were generated with the same maths. */
fun oklchToSrgb(l: Double, c: Double, hDeg: Double): IntArray {
    val a = c * cos(Math.toRadians(hDeg))
    val b = c * sin(Math.toRadians(hDeg))
    val l_ = (l + 0.3963377774 * a + 0.2158037573 * b).pow(3)
    val m_ = (l - 0.1055613458 * a - 0.0638541728 * b).pow(3)
    val s_ = (l - 0.0894841775 * a - 1.2914855480 * b).pow(3)
    val lin = doubleArrayOf(
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_,
    )
    return IntArray(3) {
        val v = if (lin[it] <= 0.0031308) 12.92 * lin[it] else 1.055 * lin[it].pow(1 / 2.4) - 0.055
        Math.round(v.coerceIn(0.0, 1.0) * 255).toInt()
    }
}

fun Color.rgb() = intArrayOf((red * 255 + 0.5f).toInt(), (green * 255 + 0.5f).toInt(), (blue * 255 + 0.5f).toInt())

/** WCAG relative luminance of an opaque colour. */
fun luminance(c: Color): Double {
    fun ch(v: Float) = if (v <= 0.03928f) v / 12.92 else ((v + 0.055) / 1.055).pow(2.4)
    return 0.2126 * ch(c.red) + 0.7152 * ch(c.green) + 0.0722 * ch(c.blue)
}

fun contrast(a: Color, b: Color): Double {
    val x = luminance(a)
    val y = luminance(b)
    return (maxOf(x, y) + 0.05) / (minOf(x, y) + 0.05)
}

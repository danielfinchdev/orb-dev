package dev.orb.app.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.tween

/** The motion tokens (dur-1..4, ease-*) so every screen moves the same way. */
object OrbMotion {
    const val Fast = 100
    const val Short = 167
    const val Medium = 250
    const val Long = 333

    val EaseOut = CubicBezierEasing(0f, 0f, 0f, 1f)
    val EaseIn = CubicBezierEasing(1f, 0f, 1f, 1f)
    val EaseStd = CubicBezierEasing(0.2f, 0f, 0f, 1f)

    fun <T> standard(durationMs: Int = Medium): FiniteAnimationSpec<T> = tween(durationMs, easing = EaseStd)
}

package dev.orb.app.ui.kit

import android.provider.Settings
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.snap
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import dev.orb.app.ui.theme.OrbMotion
import dev.orb.app.ui.theme.OrbTheme

/**
 * The design tokens of Orb UI 2.0 by the names the mockups use (`--card`, `--muted-foreground`...), resolved from the
 * theme so every palette and the dark mode work without a single colour written by hand in a piece.
 */
object OrbKit {
    val background: Color @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.background
    val foreground: Color @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.onBackground
    val card: Color @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.surface
    /** `--popover`: sheets and dialogs. Neutral grey in every palette (it is not the tinted `--card`). */
    val popover: Color @Composable @ReadOnlyComposable get() = OrbTheme.colors.popover

    /** `--secondary`: the search field, the segmented track, a neutral badge. Same grey in every palette. */
    val secondary: Color @Composable @ReadOnlyComposable get() = OrbTheme.colors.secondary

    /** `--muted`: the track of a progress bar and a swipe's background. */
    val muted: Color @Composable @ReadOnlyComposable get() = OrbTheme.colors.muted

    /** `--accent`: a pressed or selected row, a hovered button, the bottom bar's pill. */
    val accent: Color @Composable @ReadOnlyComposable get() = OrbTheme.colors.accent
    val sidebar: Color @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.surfaceContainerLow
    /** `--bubble`: the person's own message. */
    val bubble: Color @Composable @ReadOnlyComposable get() = OrbTheme.colors.bubble
    val mutedForeground: Color @Composable @ReadOnlyComposable get() = OrbTheme.colors.text2
    val faintForeground: Color @Composable @ReadOnlyComposable get() = OrbTheme.colors.text3
    val border: Color @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.outlineVariant

    /** Neutral primary: near-black by day, near-white at night, the same in every palette. */
    val primary: Color @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.primary
    val primaryForeground: Color @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.onPrimary

    /** The accent: only for what the mockups paint with it (`--primary-soft`, `--primary-text`). */
    val primarySoft: Color @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.primaryContainer
    val primaryText: Color @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.onPrimaryContainer
    val destructive: Color @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.error
    val onDestructive: Color @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.onError
    val success: Color @Composable @ReadOnlyComposable get() = OrbTheme.colors.ok
    val successSoft: Color @Composable @ReadOnlyComposable get() = OrbTheme.colors.okSoft
    val warning: Color @Composable @ReadOnlyComposable get() = OrbTheme.colors.warn
    val warningSoft: Color @Composable @ReadOnlyComposable get() = OrbTheme.colors.warnSoft

    /** `--warning-ink`: the text of a warning (`.warn-t`, `.banner.warn`). */
    val warningInk: Color @Composable @ReadOnlyComposable get() = OrbTheme.colors.warnInk
    val info: Color @Composable @ReadOnlyComposable get() = OrbTheme.colors.info
}

/** Whether the person turned animations off in the system settings; the pieces then jump instead of moving. */
@Composable
internal fun reducedMotion(): Boolean {
    val resolver = LocalContext.current.contentResolver
    return remember(resolver) {
        runCatching { Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)
    }
}

/** The tween the pieces share, or a jump when motion is reduced. */
@Composable
internal fun <T> kitTween(durationMs: Int = OrbMotion.Medium): FiniteAnimationSpec<T> =
    if (reducedMotion()) snap() else OrbMotion.standard(durationMs)

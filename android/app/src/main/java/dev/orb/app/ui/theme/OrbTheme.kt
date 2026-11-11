package dev.orb.app.ui.theme

import android.os.Build
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext

/** Material You needs Android 12; below that the switch is disabled and the brand colours stay. */
val dynamicColorsSupported: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

private class Look(val key: Any, val scheme: ColorScheme, val orb: OrbColors)

@Composable
fun OrbTheme(
    choice: ThemeChoice,
    dark: Boolean,
    dynamic: Boolean,
    content: @Composable () -> Unit,
) {
    val glass = choice == ThemeChoice.Cristal
    val useDynamic = dynamic && dynamicColorsSupported
    val context = LocalContext.current
    val target = remember(choice, dark, useDynamic) {
        val palette = paletteFor(choice, dark)
        if (useDynamic) {
            val dyn = if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
            Look(Triple(choice, dark, true), dyn, dynamicOrbColors(dyn, palette, glass, dark))
        } else {
            Look(Triple(choice, dark, false), colorSchemeFor(palette, dark), orbColorsFor(palette, glass))
        }
    }

    // Colours cross-fade between two looks with one progress value, so a theme change never flashes.
    val progress = remember { Animatable(1f) }
    var from by remember { mutableStateOf(target) }
    var to by remember { mutableStateOf(target) }
    var pending by remember { mutableStateOf(false) }
    if (to.key != target.key) {
        pending = true
        // Start from what is on screen right now, in case the user switches again mid-fade.
        from = Look(to.key, lerpScheme(from.scheme, to.scheme, progress.value), lerpOrbColors(from.orb, to.orb, progress.value))
        to = target
    }
    LaunchedEffect(to.key) {
        progress.snapTo(0f)
        pending = false
        progress.animateTo(1f, OrbMotion.standard(OrbMotion.Medium))
    }
    // Until the effect restarts the fade, the frame must still show the starting colours, not the new ones.
    val t = if (pending) 0f else progress.value
    val scheme = lerpScheme(from.scheme, to.scheme, t)
    val orb = lerpOrbColors(from.orb, to.orb, t)

    CompositionLocalProvider(LocalOrbColors provides orb) {
        MaterialTheme(colorScheme = scheme, typography = orbTypography(glass), shapes = orbShapes(glass), content = content)
    }
}

/** Resolves "follow the system" against the phone's dark mode. */
@Composable
fun OrbTheme(settings: ThemeSettings, content: @Composable () -> Unit) {
    val dark = when (settings.dark) {
        DarkMode.System -> isSystemInDarkTheme()
        DarkMode.Light -> false
        DarkMode.Dark -> true
    }
    OrbTheme(settings.effective, dark, settings.dynamic, content)
}

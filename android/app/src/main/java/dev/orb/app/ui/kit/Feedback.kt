package dev.orb.app.ui.kit

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.ui.theme.OrbMotion

/** `.snack`: the inverted message at the bottom, with an optional bold action such as «Deshacer». */
@Composable
fun OrbSnackbar(message: String, modifier: Modifier = Modifier, actionLabel: String? = null, onAction: () -> Unit = {}) {
    val reduced = reducedMotion()
    val rise = with(LocalDensity.current) { 24.dp.toPx() }
    val shown = remember { Animatable(if (reduced) 1f else 0f) }
    // Enters from below while fading in; only layer properties change, so nothing is measured again.
    LaunchedEffect(Unit) { if (!reduced) shown.animateTo(1f, tween(OrbMotion.Medium, easing = OrbMotion.EaseOut)) }
    Row(
        modifier.fillMaxWidth().graphicsLayer { alpha = shown.value; translationY = (1f - shown.value) * rise }
            .semantics { liveRegion = LiveRegionMode.Polite }
            .defaultMinSize(minHeight = 48.dp).clip(RadiusCard).background(OrbKit.foreground).padding(start = 16.dp, end = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(message, Modifier.weight(1f).padding(vertical = 12.dp), color = OrbKit.background, fontSize = 14.5.sp, lineHeight = 20.sp)
        if (actionLabel != null) {
            Box(
                Modifier.clickable(role = Role.Button, onClick = onAction).minimumInteractiveComponentSize(), contentAlignment = Alignment.Center,
            ) {
                Box(Modifier.height(36.dp).padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
                    Text(actionLabel, color = OrbKit.background, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

/** The host for a [SnackbarHostState]: shows each message as an [OrbSnackbar]. */
@Composable
fun OrbSnackbarHost(state: SnackbarHostState, modifier: Modifier = Modifier) {
    SnackbarHost(state, modifier) { data ->
        OrbSnackbar(data.visuals.message, actionLabel = data.visuals.actionLabel, onAction = { data.performAction() })
    }
}

/**
 * `.fab`: the neutral floating button, 48 dp with an icon and a word. [lifted] moves it up by an [OrbSnackbar]'s
 * height so the two never overlap.
 */
@Composable
fun OrbFab(text: String, icon: ImageVector, onClick: () -> Unit, modifier: Modifier = Modifier, lifted: Boolean = false) {
    val lift by animateDpAsState(if (lifted) 64.dp else 0.dp, kitTween(OrbMotion.Medium), label = "fabLift")
    val liftPx = with(LocalDensity.current) { lift.toPx() }
    Row(
        modifier.graphicsLayer { translationY = -liftPx }.shadow(8.dp, RadiusBig).clip(RadiusBig).background(OrbKit.primary)
            .clickable(role = Role.Button, onClick = onClick).height(48.dp).padding(start = 16.dp, end = 18.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(icon, null, Modifier.size(20.dp), tint = OrbKit.primaryForeground)
        Text(text, color = OrbKit.primaryForeground, fontSize = 14.5.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium, maxLines = 1)
    }
}

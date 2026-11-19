package dev.orb.app.ui.scan

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbBanner
import dev.orb.app.ui.kit.OrbBannerKind
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbTopBar
import dev.orb.app.ui.kit.RadiusBig
import dev.orb.app.ui.kit.RadiusCtl
import dev.orb.app.ui.theme.OrbFonts
import kotlinx.coroutines.delay

/** What the scanner screen calls; a picture of a state passes empty ones. */
class ScanActions(
    val back: () -> Unit = {},
    val toggleTorch: () -> Unit = {},
    val paste: () -> Unit = {},
    val give: () -> Unit = {},
    val settings: () -> Unit = {},
)

private const val HINT_MILLIS = 3500L

/**
 * 02 · Escáner QR. [onScanned] gets the text of a valid Orb link (once), [onPaste] leaves for the short-code sheet.
 * [viewfinder] is the live camera; a test or a picture passes a plain one.
 */
@Composable
fun ScanScreen(
    vm: ScanViewModel,
    onBack: () -> Unit,
    onScanned: (String) -> Unit,
    onPaste: () -> Unit,
    modifier: Modifier = Modifier,
    viewfinder: @Composable BoxScope.(ScanUiState) -> Unit = { s ->
        CameraViewfinder(s.torch, vm::flashFound, vm::onText, Modifier.matchParentSize())
    },
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val haptic = LocalHapticFeedback.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { vm.permissionResult(it) }
    // Asked here and only here, once per opening; a refusal is never followed by another dialog on its own.
    LaunchedEffect(Unit) { if (vm.takeRequest()) { vm.asking(); launcher.launch(Manifest.permission.CAMERA) } }
    LifecycleResumeEffect(Unit) {
        vm.resumed()
        onPauseOrDispose { vm.paused() }
    }
    LaunchedEffect(state.hint) {
        if (state.hint != null) {
            delay(HINT_MILLIS)
            vm.clearHint()
        }
    }
    LaunchedEffect(state.found) {
        val found = state.found ?: return@LaunchedEffect
        // The view's own haptic response: no VIBRATE permission.
        haptic.performHapticFeedback(HapticFeedbackType.Confirm)
        onScanned(found)
    }
    val actions = ScanActions(
        back = onBack, toggleTorch = vm::toggleTorch, paste = onPaste,
        give = { if (vm.canAskAgain()) { vm.asking(); launcher.launch(Manifest.permission.CAMERA) } else vm.openSettings() },
        settings = vm::openSettings,
    )
    ScanContent(state, actions, modifier, viewfinder)
}

@Composable
fun ScanContent(
    state: ScanUiState,
    a: ScanActions,
    modifier: Modifier = Modifier,
    viewfinder: @Composable BoxScope.(ScanUiState) -> Unit = {},
) {
    val live = state.permission == ScanPermission.Granted
    val read = state.found != null
    Column(modifier.fillMaxSize().background(OrbKit.background)) {
        OrbTopBar(
            ScanTexts.TITLE, sideWidth = 56.dp,
            leading = { OrbIconButton(OrbIcons.ArrowLeft, ScanTexts.BACK, a.back) },
            actions = {
                if (live && state.hasFlash && !read) {
                    Box(Modifier.clip(RadiusCtl).then(if (state.torch) Modifier.background(OrbKit.accent) else Modifier)) {
                        OrbIconButton(if (state.torch) OrbIcons.FlashlightOff else OrbIcons.Flashlight, ScanTexts.TORCH, a.toggleTorch)
                    }
                }
            },
        )
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
            val (title, note) = when {
                read -> ScanTexts.READ_TITLE to ScanTexts.READ_NOTE
                live -> ScanTexts.HEADING to (if (state.torch) ScanTexts.TORCH_ON else "") + ScanTexts.EXPIRES
                else -> ScanTexts.NEED_TITLE to ScanTexts.NEED_NOTE
            }
            Column(Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = 20.dp, bottom = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    title, Modifier.semantics { heading() }, color = OrbKit.foreground, fontSize = 24.sp, lineHeight = 30.sp,
                    fontFamily = OrbFonts.title, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
                )
                Text(note, color = OrbKit.mutedForeground, fontSize = 14.5.sp, lineHeight = 21.sp, textAlign = TextAlign.Center)
            }
            Box(Modifier.padding(top = 8.dp).size(272.dp).clip(RadiusBig).background(OrbKit.muted), contentAlignment = Alignment.Center) {
                if (live) {
                    viewfinder(state)
                    Corners(if (read) OrbKit.success else OrbKit.foreground)
                    if (!read) Sweep()
                } else {
                    Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(if (state.permission == ScanPermission.Asking) OrbIcons.Camera else OrbIcons.CameraOff, null, Modifier.size(24.dp), tint = OrbKit.mutedForeground)
                        Text(
                            if (state.permission == ScanPermission.Asking) ScanTexts.WAITING else ScanTexts.DENIED,
                            color = OrbKit.mutedForeground, fontSize = 14.5.sp, lineHeight = 21.sp, textAlign = TextAlign.Center,
                        )
                    }
                }
            }
            if (read) {
                Row(Modifier.padding(top = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(OrbIcons.Check, null, Modifier.size(16.dp), tint = OrbKit.success)
                    Text(ScanTexts.VALID, color = OrbKit.success, fontSize = 14.5.sp)
                }
            }
            state.hint?.let { OrbBanner(it, OrbIcons.CircleAlert, Modifier.padding(horizontal = 16.dp, vertical = 12.dp), kind = OrbBannerKind.Warning) }
        }
        if (!read) {
            Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OrbButton(ScanTexts.PASTE, a.paste, kind = OrbButtonKind.Secondary, block = true, icon = OrbIcons.Link, big = true)
                when (state.permission) {
                    ScanPermission.Denied -> OrbButton(ScanTexts.GIVE, a.give, kind = OrbButtonKind.Primary, block = true, big = true)
                    ScanPermission.Blocked -> OrbButton(ScanTexts.SETTINGS, a.settings, kind = OrbButtonKind.Primary, block = true, big = true)
                    else -> {}
                }
                if (state.permission == ScanPermission.Denied || state.permission == ScanPermission.Blocked) {
                    OrbButton(ScanTexts.TYPE_CODE, a.paste, kind = OrbButtonKind.Ghost, block = true, icon = OrbIcons.Keyboard)
                }
            }
        }
    }
}

/** The four corners of the viewfinder; they turn green once a link was read. */
@Composable
private fun Corners(color: Color) {
    Canvas(Modifier.fillMaxSize().padding(14.dp)) {
        val len = 32.dp.toPx()
        val radius = 12.dp.toPx()
        val width = 3.dp.toPx()
        val half = width / 2
        fun corner(x: Float, y: Float, dx: Float, dy: Float) {
            val path = Path().apply {
                moveTo(x, y + dy * len)
                lineTo(x, y + dy * radius)
                quadraticTo(x, y, x + dx * radius, y)
                lineTo(x + dx * len, y)
            }
            drawPath(path, color, style = Stroke(width, cap = StrokeCap.Butt))
        }
        corner(half, half, 1f, 1f)
        corner(size.width - half, half, -1f, 1f)
        corner(half, size.height - half, 1f, -1f)
        corner(size.width - half, size.height - half, -1f, -1f)
    }
}

/** The scanning line that moves up and down while the camera looks for a code. */
@Composable
private fun Sweep() {
    val t = rememberInfiniteTransition(label = "sweep")
    val f by t.animateFloat(0.18f, 0.82f, infiniteRepeatable(tween(1800, easing = LinearEasing), RepeatMode.Reverse), label = "line")
    val color = OrbKit.primaryText
    Canvas(Modifier.fillMaxSize()) {
        val inset = 20.dp.toPx()
        val h = 2.dp.toPx()
        drawRoundRect(color, Offset(inset, size.height * f), Size(size.width - 2 * inset, h), CornerRadius(h / 2))
    }
}

package dev.orb.app.ui.kit

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.ui.theme.OrbMotion
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * What a swipe does. [onTrigger] returns true when the request went out; with [leaves] the row then slides away (the
 * list is expected to drop it), otherwise it springs back at once. A swipe is always reversible, and every swipe is also
 * offered to screen readers as a custom action under the same [label].
 */
class OrbSwipeAction(
    val label: String,
    val icon: ImageVector,
    val onTrigger: () -> Boolean,
    val leaves: Boolean = false,
    val container: @Composable () -> Color = { OrbKit.primarySoft },
    val content: @Composable () -> Color = { OrbKit.primaryText },
)

/**
 * A row you can swipe: to the right ([start]) or to the left ([end]). The row moves as a layer (nothing is measured or
 * composed while the finger drags) and the action shows behind it, fading in as it goes.
 */
@Composable
fun OrbSwipeRow(
    modifier: Modifier = Modifier,
    start: OrbSwipeAction? = null,
    end: OrbSwipeAction? = null,
    content: @Composable () -> Unit,
) {
    val offset = remember { Animatable(0f) }
    // The gesture lives as long as the row; the actions it runs are always the latest ones.
    val startNow by rememberUpdatedState(start)
    val endNow by rememberUpdatedState(end)
    val scope = rememberCoroutineScope()
    var width by remember { mutableIntStateOf(0) }
    val spec = kitTween<Float>(OrbMotion.Short)
    // After a row slid out, a request the PC refused leaves it in the list: it comes back instead of staying hidden.
    var leftAt by remember { mutableIntStateOf(0) }
    LaunchedEffect(leftAt) {
        if (leftAt != 0) { delay(LEAVE_GRACE_MS); offset.animateTo(0f, spec) }
    }

    fun trigger(action: OrbSwipeAction, towards: Float) {
        scope.launch {
            val sent = action.onTrigger()
            if (sent && action.leaves) {
                offset.animateTo(towards * width, spec)
                leftAt++
            } else {
                offset.animateTo(0f, spec)
            }
        }
    }

    val actions = listOfNotNull(
        start?.let { a -> CustomAccessibilityAction(a.label) { a.onTrigger(); true } },
        end?.let { a -> CustomAccessibilityAction(a.label) { a.onTrigger(); true } },
    )
    Box(modifier.onSizeChanged { width = it.width }.semantics { customActions = actions }) {
        if (start != null) SwipeBackground(start, Alignment.CenterStart) { (offset.value / width.coerceAtLeast(1)).coerceIn(0f, 1f) }
        if (end != null) SwipeBackground(end, Alignment.CenterEnd) { (-offset.value / width.coerceAtLeast(1)).coerceIn(0f, 1f) }
        Box(
            Modifier.graphicsLayer { translationX = offset.value }.background(OrbKit.background)
                .pointerInput(start != null, end != null) {
                    detectHorizontalDragGestures(
                        onDragStart = { leftAt = 0 },
                        onDragEnd = {
                            val reach = width * TRIGGER_AT
                            val s = startNow
                            val e = endNow
                            when {
                                s != null && offset.value > reach -> trigger(s, 1f)
                                e != null && offset.value < -reach -> trigger(e, -1f)
                                else -> scope.launch { offset.animateTo(0f, spec) }
                            }
                        },
                        onDragCancel = { scope.launch { offset.animateTo(0f, spec) } },
                    ) { change, dx ->
                        change.consume()
                        val lo = if (end != null) -width.toFloat() else 0f
                        val hi = if (start != null) width.toFloat() else 0f
                        scope.launch { offset.snapTo((offset.value + dx).coerceIn(lo, hi)) }
                    }
                },
        ) { content() }
    }
}

@Composable
private fun androidx.compose.foundation.layout.BoxScope.SwipeBackground(action: OrbSwipeAction, side: Alignment, reveal: () -> Float) {
    val fg = action.content()
    Box(
        Modifier.matchParentSize().background(action.container()).graphicsLayer { alpha = reveal() }.clearAndSetSemantics {},
        contentAlignment = side,
    ) {
        Row(Modifier.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(action.icon, null, Modifier.size(20.dp), tint = fg)
            Text(action.label, color = fg, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium, maxLines = 1)
        }
    }
}

private const val TRIGGER_AT = 0.35f
private const val LEAVE_GRACE_MS = 1_800L

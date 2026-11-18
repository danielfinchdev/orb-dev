package dev.orb.app.ui.kit

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.ui.theme.OrbMotion

/**
 * The header of every screen (`.abar`): 56 dp, three zones. The left one (96 dp) holds the menu or back arrow, the
 * centre the name (or [center], e.g. the wordmark) and an optional useful line, the right one (96 dp) the actions.
 * [sideWidth] narrows both sides when a screen has one button each, so a long line fits in the centre.
 */
@Composable
fun OrbTopBar(
    title: String,
    modifier: Modifier = Modifier,
    sub: String? = null,
    center: (@Composable () -> Unit)? = null,
    line: Boolean = false,
    sideWidth: Dp = 96.dp,
    leading: @Composable RowScope.() -> Unit = {},
    actions: @Composable RowScope.() -> Unit = {},
) {
    Column(modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.width(sideWidth), verticalAlignment = Alignment.CenterVertically, content = leading)
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                if (center != null) center() else Text(
                    title, Modifier.semantics { heading() }, color = OrbKit.foreground, fontSize = 16.sp, lineHeight = 22.sp,
                    fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
                )
                if (sub != null) {
                    Text(sub, color = OrbKit.mutedForeground, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            // A text action (not just icons) may need more than 96 dp; the title then gives way.
            Row(Modifier.widthIn(min = sideWidth), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.End, content = actions)
        }
        if (line) Box(Modifier.fillMaxWidth().height(1.dp).background(OrbKit.border))
    }
}

/** The ORB·E mark: spaced letters and a dot in the theme's accent. */
@Composable
fun OrbWordmark(modifier: Modifier = Modifier, fontSize: TextUnit = 17.sp) {
    val em = fontSize.value
    val dot = OrbKit.primaryText
    Row(modifier.clearAndSetSemantics { contentDescription = "Orbe" }, verticalAlignment = Alignment.CenterVertically) {
        Text("ORB", color = OrbKit.foreground, fontSize = fontSize, fontWeight = FontWeight.SemiBold, letterSpacing = (em * 0.16f).sp, lineHeight = fontSize)
        Spacer(Modifier.width((em * 0.06f).dp))
        Box(Modifier.size(5.44.dp).clip(CircleShape).background(dot))
        Spacer(Modifier.width((em * 0.22f).dp))
        Text("E", color = OrbKit.foreground, fontSize = fontSize, fontWeight = FontWeight.SemiBold, lineHeight = fontSize)
    }
}

/** A round 40 dp button with a 20 dp icon inside a 48 dp touch zone; [badge] draws the red count (`.dot-badge`). */
@Composable
fun OrbIconButton(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    badge: String? = null,
    enabled: Boolean = true,
    tint: Color = OrbKit.mutedForeground,
) {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    Box(
        modifier.size(48.dp).clickable(source, null, enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label; if (badge != null) stateDescription = badge },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(40.dp).clip(CircleShape).background(if (pressed) OrbKit.secondary else Color.Transparent), contentAlignment = Alignment.Center) {
            Icon(icon, null, Modifier.size(20.dp), tint = if (enabled) tint else tint.copy(alpha = 0.45f))
            if (badge != null) OrbCountBadge(badge, Modifier.align(Alignment.TopEnd).padding(top = 2.dp, end = 0.dp))
        }
    }
}

/** The red count over an icon. */
@Composable
internal fun OrbCountBadge(text: String, modifier: Modifier = Modifier) {
    Box(
        modifier.defaultMinSize(minWidth = 16.dp, minHeight = 16.dp).clip(CircleShape).background(OrbKit.destructive).padding(horizontal = 4.dp)
            .clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) { Text(text, color = OrbKit.onDestructive, fontSize = 11.sp, lineHeight = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1) }
}

/** One tab of the bottom bar; [count] 0 draws no number. */
class OrbTab(val key: String, val label: String, val icon: ImageVector, val count: Int = 0)

/** The bottom navigation (`.bnav`): 68 dp, a 56×30 pill under the active tab and a number on each tab that has one. */
@Composable
fun OrbBottomBar(tabs: List<OrbTab>, selected: String, onSelect: (OrbTab) -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().background(OrbKit.sidebar).navigationBarsPadding()) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(OrbKit.border))
        Row(Modifier.fillMaxWidth().height(68.dp)) {
            for (tab in tabs) {
                val active = tab.key == selected
                val pill by animateFloatAsState(if (active) 1f else 0f, kitTween(OrbMotion.Short), label = "pill")
                Column(
                    Modifier.weight(1f).height(68.dp).selectable(selected = active, role = Role.Tab, onClick = { onSelect(tab) }),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterVertically),
                ) {
                    Box(Modifier.size(56.dp, 30.dp), contentAlignment = Alignment.Center) {
                        // The pill grows from the middle and fades in; both run in the compositor layer.
                        Box(
                            Modifier.matchParentSizeCompat().graphicsLayer { alpha = pill; scaleX = 0.6f + 0.4f * pill }
                                .clip(CircleShape).background(OrbKit.secondary),
                        )
                        Icon(tab.icon, null, Modifier.size(20.dp), tint = if (active) OrbKit.foreground else OrbKit.mutedForeground)
                        if (tab.count > 0) {
                            Box(
                                Modifier.align(Alignment.TopEnd).padding(top = 0.dp, end = 6.dp).defaultMinSize(minWidth = 16.dp, minHeight = 16.dp)
                                    .clip(CircleShape).background(OrbKit.primary).padding(horizontal = 4.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    if (tab.count > 99) "99+" else tab.count.toString(), color = OrbKit.primaryForeground, fontSize = 11.sp,
                                    lineHeight = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
                                )
                            }
                        }
                    }
                    Text(
                        tab.label, color = if (active) OrbKit.foreground else OrbKit.mutedForeground, fontSize = 12.sp, lineHeight = 16.sp,
                        fontWeight = if (active) FontWeight.Medium else FontWeight.Normal,
                    )
                }
            }
        }
    }
}

private fun Modifier.matchParentSizeCompat(): Modifier = this.then(Modifier.size(56.dp, 30.dp))

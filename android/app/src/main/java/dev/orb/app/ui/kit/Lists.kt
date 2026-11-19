package dev.orb.app.ui.kit

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.graphicsLayer
import dev.orb.app.ui.theme.OrbFonts
import dev.orb.app.ui.theme.OrbMotion
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.ui.icons.OrbIcons

/**
 * `.mrow`: a mark on the left (20 dp wide), two lines and a trailing time and badge; at least 64 dp tall.
 * [subtitle] is a slot for the second line (13 sp, muted); [actions] go under it; [titleStyled] replaces [title] when
 * part of it is marked (a search match).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun OrbRow(
    title: String,
    modifier: Modifier = Modifier,
    lead: (@Composable () -> Unit)? = null,
    subtitle: (@Composable RowScope.() -> Unit)? = null,
    time: String? = null,
    badge: (@Composable () -> Unit)? = null,
    actions: (@Composable RowScope.() -> Unit)? = null,
    unread: Boolean = false,
    titleStyled: AnnotatedString? = null,
    onClick: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
) {
    val click = if (onClick != null) Modifier.combinedClickable(role = Role.Button, onLongClick = onLongClick, onClick = onClick) else Modifier
    Row(
        modifier.fillMaxWidth().then(click).defaultMinSize(minHeight = 64.dp).padding(horizontal = 16.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.width(20.dp).padding(top = 3.dp), contentAlignment = Alignment.TopCenter) { lead?.invoke() }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                titleStyled ?: AnnotatedString(title), color = OrbKit.foreground, fontSize = 15.sp, lineHeight = 22.sp,
                fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            if (subtitle != null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp), content = subtitle)
            }
            if (actions != null) Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), content = actions)
        }
        if (time != null || badge != null) {
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (time != null) Text(time, color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp)
                badge?.invoke()
            }
        }
    }
}

/** The text of a row's second line: 13 sp, muted, one line. */
@Composable
fun RowScope.OrbSubtitle(text: String, modifier: Modifier = Modifier, color: Color = OrbKit.mutedForeground) {
    Text(text, modifier.weight(1f, fill = false), color = color, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

/** The same line with part of it marked (a search match). */
@Composable
fun RowScope.OrbSubtitle(text: AnnotatedString, modifier: Modifier = Modifier, color: Color = OrbKit.mutedForeground) {
    Text(text, modifier.weight(1f, fill = false), color = color, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

/**
 * `.mgrp`: a group heading in a list. [project] draws the project's dot ([noProject] the hollow ring), [count] the number
 * on the right and [collapsed] the fold arrow (null: the group does not fold); [chevronAtEnd] puts the arrow after the text.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun OrbGroupHeader(
    title: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    project: String? = null,
    noProject: Boolean = false,
    count: Int? = null,
    collapsed: Boolean? = null,
    chevronAtEnd: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    val click = if (onClick != null) Modifier.combinedClickable(role = Role.Button, onClick = onClick) else Modifier
    // The arrow turns instead of swapping, as a layer property so the row is not measured again.
    val turn by animateFloatAsState(if (collapsed == true) -90f else 0f, kitTween(OrbMotion.Short), label = "groupArrow")
    val chevron: @Composable () -> Unit = {
        Icon(OrbIcons.ChevronDown, null, Modifier.size(14.dp).graphicsLayer { rotationZ = turn }, tint = OrbKit.mutedForeground)
    }
    Row(
        // A header that folds is a 48 dp touch zone; its text sits where the 40 dp drawing had it, give or take a dp.
        modifier.fillMaxWidth().then(click).then(
            if (onClick != null) Modifier.defaultMinSize(minHeight = 48.dp).padding(horizontal = 16.dp)
            else Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 6.dp),
        ),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (collapsed != null && !chevronAtEnd) chevron()
        if (icon != null) Icon(icon, null, Modifier.size(14.dp), tint = OrbKit.mutedForeground)
        if (project != null || noProject) ProjectDot(if (noProject) null else project)
        Text(
            title, Modifier.weight(1f).semantics { heading() },
            color = OrbKit.foreground, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        if (count != null) Text(count.toString(), color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp)
        if (collapsed != null && chevronAtEnd) chevron()
    }
}

/** `.unread`: the count bubble; [soft] is the quiet one (accent text on the accent tint). */
@Composable
fun OrbUnread(count: Int, modifier: Modifier = Modifier, soft: Boolean = false) {
    Box(
        modifier.defaultMinSize(minWidth = 20.dp, minHeight = 20.dp).clip(CircleShape)
            .background(if (soft) OrbKit.primarySoft else OrbKit.primary).padding(horizontal = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            if (count > 99) "99+" else count.toString(), color = if (soft) OrbKit.primaryText else OrbKit.primaryForeground,
            fontSize = 11.sp, lineHeight = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
        )
    }
}

enum class OrbBadgeKind { Neutral, Ok, Warn, Err, Info, Acc }

/** `.badge`: a 20 dp pill with a short status. */
@Composable
fun OrbBadge(text: String, modifier: Modifier = Modifier, kind: OrbBadgeKind = OrbBadgeKind.Neutral, icon: ImageVector? = null) {
    val (bg, fg) = when (kind) {
        OrbBadgeKind.Neutral -> OrbKit.secondary to OrbKit.mutedForeground
        OrbBadgeKind.Ok -> OrbKit.successSoft to OrbKit.success
        OrbBadgeKind.Warn -> OrbKit.warningSoft to OrbKit.warningInk
        OrbBadgeKind.Err -> OrbKit.destructive.copy(alpha = 0.14f) to OrbKit.destructive
        OrbBadgeKind.Info -> OrbKit.info.copy(alpha = 0.14f) to OrbKit.info
        OrbBadgeKind.Acc -> OrbKit.primarySoft to OrbKit.primaryText
    }
    Row(
        modifier.height(20.dp).clip(CircleShape).background(bg).padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (icon != null) Icon(icon, null, Modifier.size(14.dp), tint = fg)
        Text(text, color = fg, fontSize = 11.sp, lineHeight = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

/** `.lcard`: a bordered card of rows. */
@Composable
fun OrbCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().clip(RadiusCard).background(OrbKit.card).border(1.dp, OrbKit.border, RadiusCard), content = content)
}

/** `.setting`: a title with a help line and a control on the right, at least 56 dp; [divider] draws the line above it. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun OrbSettingRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    divider: Boolean = true,
    onClick: (() -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    val click = if (onClick != null) Modifier.combinedClickable(role = Role.Button, onClick = onClick) else Modifier
    Column(modifier.fillMaxWidth().then(click)) {
        if (divider) Box(Modifier.fillMaxWidth().height(1.dp).background(OrbKit.border))
        Row(
            Modifier.fillMaxWidth().defaultMinSize(minHeight = 56.dp).padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, color = OrbKit.foreground, fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium)
                if (subtitle != null) Text(subtitle, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp)
            }
            trailing?.invoke()
        }
    }
}

/** `.progress`: a 6 dp bar; [fraction] is 0..1. */
@Composable
fun OrbProgress(fraction: Float, modifier: Modifier = Modifier) {
    val f = fraction.coerceIn(0f, 1f)
    Box(
        modifier.fillMaxWidth().height(6.dp).clip(CircleShape).background(OrbKit.muted)
            .semantics { progressBarRangeInfo = ProgressBarRangeInfo(f, 0f..1f) },
    ) {
        Box(Modifier.fillMaxWidth(f).height(6.dp).clip(CircleShape).background(OrbKit.primaryText))
    }
}

/** `.empty`: an icon, a title, a line and optional actions, centred. */
@Composable
fun OrbEmpty(
    title: String,
    modifier: Modifier = Modifier,
    text: String? = null,
    icon: ImageVector? = null,
    actions: (@Composable RowScope.() -> Unit)? = null,
) {
    Column(
        modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (icon != null) Icon(icon, null, Modifier.size(24.dp), tint = OrbKit.faintForeground)
        Text(title, color = OrbKit.foreground, fontSize = 15.sp, lineHeight = 22.sp, fontFamily = OrbFonts.title, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        if (text != null) Text(text, color = OrbKit.mutedForeground, fontSize = 14.5.sp, lineHeight = 21.sp, textAlign = TextAlign.Center)
        if (actions != null) Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), content = actions)
    }
}

/** `.note-s`: the 12 sp quiet footnote. */
@Composable
fun OrbNote(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier, color = OrbKit.faintForeground, style = TextStyle(fontSize = 12.sp, lineHeight = 17.sp))
}

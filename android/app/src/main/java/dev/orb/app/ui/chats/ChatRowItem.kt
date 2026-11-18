package dev.orb.app.ui.chats

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.AgentMark
import dev.orb.app.ui.kit.ProjectDot
import dev.orb.app.ui.kit.ProjectDotSize
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.oklch

/** The letter badge of an agent, still used by the direct-chat bubbles until they are redone. */
@Immutable
class AgentLetter(val letter: String, val color: Color)

object AgentLetters {
    private val claude = AgentLetter("C", oklch(0.62, 0.14, 45.0))
    private val codex = AgentLetter("X", oklch(0.35, 0.02, 268.0))
    private val cursor = AgentLetter("Cu", oklch(0.45, 0.03, 268.0))
    private val gemini = AgentLetter("G", oklch(0.58, 0.15, 250.0))
    private val acp = AgentLetter("A", oklch(0.55, 0.10, 180.0))

    fun of(agent: String?): AgentLetter? = when (agent) {
        null, "" -> null
        "claude" -> claude
        "codex" -> codex
        "cursor" -> cursor
        "gemini" -> gemini
        else -> acp
    }
}

/** The mark of a chat: its agent for a direct chat, Orbe otherwise, with the project's dot at the corner. */
@Composable
fun ChatAvatar(row: ChatRow, modifier: Modifier = Modifier) {
    Box(modifier.size(24.dp), contentAlignment = Alignment.TopCenter) {
        AgentMark(if (row.direct) row.agent ?: "acp" else "orbe", Modifier.align(Alignment.Center), size = 20.dp)
        if (row.project != null) {
            ProjectDot(row.project, Modifier.align(Alignment.BottomEnd), ProjectDotSize.Small)
        }
    }
}

// Orbe has no picture in the app: a soft orb in the primary colour.
@Composable
internal fun OrbeCircle() {
    val primary = MaterialTheme.colorScheme.primary
    val soft = MaterialTheme.colorScheme.primaryContainer
    Box(
        Modifier.size(40.dp).clip(CircleShape).background(soft).drawBehind {
            drawCircle(
                Brush.radialGradient(listOf(primary.copy(alpha = 0.95f), primary.copy(alpha = 0.55f)), center = Offset(size.width * 0.38f, size.height * 0.34f), radius = size.width * 0.5f),
                radius = size.minDimension * 0.30f,
            )
        },
    )
}

@Composable
private fun StatusTag(text: String, icon: ImageVector, warn: Boolean, spin: Boolean) {
    val colors = OrbTheme.colors
    val bg = if (warn) colors.warnSoft else MaterialTheme.colorScheme.primaryContainer
    val fg = if (warn) colors.warn else MaterialTheme.colorScheme.onPrimaryContainer
    val angle = if (spin) {
        val t = rememberInfiniteTransition(label = "spin")
        t.animateFloat(0f, 360f, infiniteRepeatable(tween(1400, easing = LinearEasing), RepeatMode.Restart), label = "angle")
    } else null
    Row(
        Modifier.clip(RoundedCornerShape(8.dp)).background(bg).padding(horizontal = 8.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(
            icon, null, tint = fg,
            modifier = Modifier.size(12.dp).then(if (angle != null) Modifier.graphicsLayer { rotationZ = angle.value } else Modifier),
        )
        Text(text, color = fg, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

private fun subtitle(row: ChatRow): String {
    val text = row.lastText
    if (text == null) return if (row.direct) "${ChatTexts.DIRECT_WITH} ${agentName(row.agent) ?: "un agente"}" else ""
    val who = when (row.lastFrom) {
        Speaker.User -> ChatTexts.YOU
        Speaker.Orbe -> row.lastFromName ?: ChatTexts.ORBE
        Speaker.Agent -> row.lastFromName ?: agentName(row.agent)
        Speaker.System, null -> if (row.direct) agentName(row.agent) else null
    }
    return if (who == null) text else "$who: $text"
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ChatRowItem(row: ChatRow, whenText: String, onClick: () -> Unit, onLongClick: () -> Unit, modifier: Modifier = Modifier) {
    val unread = row.unread > 0
    val colors = OrbTheme.colors
    val subtitle = remember(row.lastText, row.lastFrom, row.lastFromName, row.agent, row.kind) { subtitle(row) }
    Row(
        modifier.fillMaxWidth().defaultMinSize(minHeight = 72.dp)
            .combinedClickable(onClickLabel = null, onLongClickLabel = ChatTexts.ACTIONS_FOR, onClick = onClick, onLongClick = onLongClick)
            .padding(start = 16.dp, end = 24.dp, top = 8.dp, bottom = 8.dp)
            .semantics(mergeDescendants = true) { if (unread) contentDescription = "${row.title}, ${ChatTexts.unread(row.unread)}" },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        ChatAvatar(row)
        Column(Modifier.weight(1f)) {
            Text(row.title, style = MaterialTheme.typography.titleMedium, fontWeight = if (unread) FontWeight.Bold else FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle.isNotEmpty()) {
                Text(
                    subtitle, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    color = if (unread) MaterialTheme.colorScheme.onSurface else colors.text2,
                )
            }
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (row.muted) Icon(OrbIcons.BellOff, ChatTexts.MUTED, Modifier.size(14.dp), tint = colors.text3)
                if (row.snoozedUntil != null) Icon(OrbIcons.Clock, ChatTexts.SNOOZED, Modifier.size(14.dp), tint = colors.text3)
                Text(
                    whenText, fontSize = 12.sp, lineHeight = 16.sp,
                    color = colors.text3,
                    fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal,
                )
            }
            when {
                row.waitingPermission -> StatusTag(ChatTexts.WAITING_PERMISSION, OrbIcons.Shield, warn = true, spin = false)
                row.asking -> StatusTag(ChatTexts.ASKING, OrbIcons.Shield, warn = true, spin = false)
                row.needsReview -> StatusTag(remember { InboxTexts.current() }.needsReview, OrbIcons.Shield, warn = true, spin = false)
                row.state == ChatState.Working -> StatusTag(ChatTexts.WORKING, OrbIcons.Loader, warn = false, spin = true)
                unread -> UnreadCount(row.unread, row.muted)
            }
        }
    }
}

@Composable
private fun UnreadCount(n: Int, muted: Boolean) {
    val bg = if (muted) OrbTheme.colors.text3 else MaterialTheme.colorScheme.primary
    Box(
        Modifier.defaultMinSize(minWidth = 20.dp, minHeight = 20.dp).clip(CircleShape).background(bg).padding(horizontal = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(if (n > 99) "99+" else n.toString(), color = MaterialTheme.colorScheme.onPrimary, fontSize = 11.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

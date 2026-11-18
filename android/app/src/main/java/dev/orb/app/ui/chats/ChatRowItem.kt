package dev.orb.app.ui.chats

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.AgentMark
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbRow
import dev.orb.app.ui.kit.OrbSpinner
import dev.orb.app.ui.kit.OrbSubtitle
import dev.orb.app.ui.kit.OrbSwipeAction
import dev.orb.app.ui.kit.OrbSwipeRow
import dev.orb.app.ui.kit.OrbUnread
import dev.orb.app.ui.kit.ProjectDot
import dev.orb.app.ui.kit.ProjectDotSize

/** The mark of a chat: its agent for a direct chat, Orbe otherwise, with the project's dot at the corner (used by the sheets). */
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

/** What the second line of a row says, decided from what the PC reported; nothing is made up. */
internal sealed interface RowLine {
    /** [text] is what waits for the person. */
    data class Waiting(val text: String) : RowLine
    /** [activity] is what it does now («Editando styles.css»), when the PC says. */
    data class Working(val activity: String?) : RowLine
    data class Branch(val text: String) : RowLine
    data class Message(val text: String) : RowLine
}

internal fun rowLine(row: ChatRow, texts: InboxTexts): RowLine {
    val text = row.lastText
    return when {
        row.waitingPermission -> RowLine.Waiting(ChatTexts.WAITING_PERMISSION)
        row.needsReview -> RowLine.Waiting(ChatTexts.WAITING_PERMISSION)
        row.asking -> RowLine.Waiting(ChatTexts.ASKING)
        row.state == ChatState.Working -> RowLine.Working(row.activity)
        row.branch != null -> RowLine.Branch(
            // «Hecha»: settled, or the PC counted the files it changed (a count only exists for finished work).
            listOfNotNull(
                row.branch, row.prNumber?.let { "PR #$it" }, if (row.done || row.changedFiles != null) ChatTexts.DONE_LABEL else null,
                row.changedFiles?.let(ChatTexts::files),
            ).joinToString(" · "),
        )
        else -> RowLine.Message(messageLine(row, text))
    }
}

private fun messageLine(row: ChatRow, text: String?): String {
    if (text == null) return if (row.direct) "${ChatTexts.DIRECT_WITH} ${agentName(row.agent) ?: "un agente"}" else ""
    val who = when (row.lastFrom) {
        Speaker.User -> ChatTexts.YOU
        Speaker.Orbe -> row.lastFromName ?: ChatTexts.ORBE
        Speaker.Agent -> row.lastFromName ?: agentName(row.agent)
        Speaker.System, null -> if (row.direct) agentName(row.agent) else null
    }
    return if (who == null) text else "$who: $text"
}

@Composable
private fun RowScope.RowSubtitle(line: RowLine) {
    when (line) {
        is RowLine.Waiting -> {
            Icon(OrbIcons.Hand, null, Modifier.size(14.dp), tint = OrbKit.warning)
            OrbSubtitle(line.text, color = OrbKit.warning)
        }
        is RowLine.Working -> {
            OrbSpinner(tint = OrbKit.primaryText)
            Text(ChatTexts.WORKING, color = OrbKit.primaryText, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1)
            if (line.activity != null) OrbSubtitle("· ${line.activity}")
        }
        is RowLine.Branch -> {
            Icon(OrbIcons.GitBranch, null, Modifier.size(14.dp), tint = OrbKit.mutedForeground)
            OrbSubtitle(line.text)
        }
        is RowLine.Message -> if (line.text.isNotEmpty()) OrbSubtitle(line.text)
    }
}

/**
 * One chat in the list (`.mrow`): the agent's mark, the title, a second line for what is happening and, on the right,
 * the time and the unread count. Swipe right to mark it read, left to archive it; both also reach screen readers as
 * custom actions, and a long press still opens the chat's actions. [onMarkRead], [onArchive] and [onRestore] (for a chat that
 * is already done) return false when the request could not go out (no PC), so the row springs back.
 */
@Composable
fun ChatRowItem(
    row: ChatRow, whenText: String, onClick: () -> Unit, onLongClick: () -> Unit, modifier: Modifier = Modifier,
    onMarkRead: (() -> Boolean)? = null, onArchive: (() -> Boolean)? = null, onRestore: (() -> Boolean)? = null,
    /** The chat whose actions are open: its row stays marked under the sheet (.mrow.on). */
    selected: Boolean = false,
) {
    val unread = row.unread > 0
    val texts = remember { InboxTexts.current() }
    val line = remember(row.lastText, row.lastFrom, row.lastFromName, row.agent, row.kind, row.state, row.waitingPermission, row.asking, row.needsReview, row.branch, row.prNumber, row.done, row.activity, row.changedFiles) {
        rowLine(row, texts)
    }
    val status = when (line) {
        is RowLine.Waiting -> line.text
        is RowLine.Working -> listOfNotNull(ChatTexts.WORKING, line.activity).joinToString(" · ")
        is RowLine.Branch -> line.text
        is RowLine.Message -> line.text
    }
    val description = listOfNotNull(row.title, status.takeIf { it.isNotEmpty() }, if (unread) ChatTexts.unread(row.unread) else null, whenText).joinToString(", ")
    OrbSwipeRow(
        modifier,
        start = onMarkRead?.takeIf { unread }?.let { OrbSwipeAction(ChatTexts.MARK_READ_SWIPE, OrbIcons.CheckCheck, it) },
        end = onArchive?.let { OrbSwipeAction(ChatTexts.ARCHIVE, OrbIcons.Archive, it, leaves = true, container = { OrbKit.muted }, content = { OrbKit.foreground }) }
            ?: onRestore?.let { OrbSwipeAction(ChatTexts.RESTORE_CHAT, OrbIcons.ArrowUp, it, leaves = true, container = { OrbKit.muted }, content = { OrbKit.foreground }) },
    ) {
        OrbRow(
            row.title,
            Modifier.then(if (selected) Modifier.background(OrbKit.secondary) else Modifier).semantics(mergeDescendants = true) { contentDescription = description },
            lead = { AgentMark(if (row.direct) row.agent ?: "acp" else "orbe") },
            subtitle = { RowSubtitle(line) },
            time = whenText,
            badge = if (unread || row.muted || row.snoozedUntil != null) ({
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (row.muted) Icon(OrbIcons.BellOff, ChatTexts.MUTED, Modifier.size(14.dp), tint = OrbKit.faintForeground)
                    if (row.snoozedUntil != null) Icon(OrbIcons.Clock, ChatTexts.SNOOZED, Modifier.size(14.dp), tint = OrbKit.faintForeground)
                    if (unread) OrbUnread(row.unread, soft = row.muted)
                }
            }) else null,
            unread = unread,
            onClick = onClick, onLongClick = onLongClick,
        )
    }
}

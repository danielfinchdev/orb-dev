package dev.orb.app.ui.tasks

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.AgentMark
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbProgress
import dev.orb.app.ui.kit.OrbRow
import dev.orb.app.ui.kit.OrbSpinner

internal fun TaskSection.title() = when (this) {
    TaskSection.Approve -> TaskTexts.SECTION_APPROVE
    TaskSection.Running -> TaskTexts.SECTION_RUNNING
    TaskSection.Queued -> TaskTexts.SECTION_QUEUED
    TaskSection.Problems -> TaskTexts.SECTION_PROBLEMS
    TaskSection.Done -> TaskTexts.SECTION_DONE
}

private fun LineMark.icon(): ImageVector? = when (this) {
    LineMark.None -> null
    LineMark.Hand -> OrbIcons.Hand
    LineMark.Clock -> OrbIcons.Clock
    LineMark.Gauge -> OrbIcons.Gauge
    LineMark.Folder -> OrbIcons.FolderLock
    LineMark.Alert -> OrbIcons.CircleAlert
    LineMark.Check -> OrbIcons.CircleCheck
}

@Composable
private fun LineTone.color(): Color = when (this) {
    LineTone.Muted -> OrbKit.mutedForeground
    LineTone.Warn -> OrbKit.warningInk
    LineTone.Error -> OrbKit.destructive
    LineTone.Ok -> OrbKit.success
}

/** The second line of a row (`.s`): a 14 dp mark and the reason, in the tone of what it says. */
@Composable
private fun StatusLine(line: TaskLine) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        line.mark.icon()?.let { Icon(it, null, Modifier.size(14.dp), tint = line.tone.color()) }
        Text(line.text, color = line.tone.color(), fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun SectionMark(section: TaskSection, agent: String?) {
    when (section) {
        TaskSection.Running -> AgentMark(agent, size = 16.dp)
        TaskSection.Approve -> Icon(OrbIcons.Hand, null, Modifier.size(16.dp), tint = OrbKit.mutedForeground)
        TaskSection.Queued -> Icon(OrbIcons.Clock, null, Modifier.size(16.dp), tint = OrbKit.mutedForeground)
        TaskSection.Problems -> Icon(OrbIcons.CircleAlert, null, Modifier.size(16.dp), tint = OrbKit.destructive)
        TaskSection.Done -> Icon(OrbIcons.CircleCheck, null, Modifier.size(16.dp), tint = OrbKit.mutedForeground)
    }
}

/**
 * One task of the board. A task that waits for the OK carries two buttons: «Rechazar» (the safe side, behind its own
 * confirmation) and «Ver y aprobar», which only opens the task. The OK is never given from a row, because a row does not
 * show everything the OK covers.
 */
@Composable
internal fun TaskRowItem(
    t: TaskRow, queuePaused: Boolean, canReject: Boolean, online: Boolean, rejecting: Boolean,
    onOpen: () -> Unit, onReject: () -> Unit, modifier: Modifier = Modifier,
) {
    val section = TaskBoard.sectionOf(t)
    val line = TaskLines.status(t, queuePaused)
    val percent = t.percent
    OrbRow(
        t.title, modifier, onClick = onOpen,
        lead = { SectionMark(section, t.agent) },
        subtitle = {
            Column {
                Text(if (section == TaskSection.Running) TaskLines.workers(t) else TaskLines.identity(t), color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                // A running task without a percentage has no bar to draw: its activity (or a quiet spinner) says it is alive.
                if (section == TaskSection.Running && percent == null && line == null) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        OrbSpinner(size = 14.dp)
                        Text(TaskTexts.status("running"), color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1)
                    }
                }
                if (line != null) StatusLine(line)
            }
        },
        actions = when {
            section == TaskSection.Approve -> ({
                if (t.status == "awaiting_approval" && canReject) {
                    OrbButton(TaskTexts.REJECT, onReject, small = true, enabled = online && !rejecting)
                }
                OrbButton(if (t.held != null) TaskTexts.SEE_AND_REVIEW else TaskTexts.SEE_AND_APPROVE, onOpen, small = true, kind = OrbButtonKind.Primary)
            })
            section == TaskSection.Running && percent != null -> ({ OrbProgress(percent.coerceIn(0, 100) / 100f, Modifier.weight(1f)) })
            else -> null
        },
    )
}

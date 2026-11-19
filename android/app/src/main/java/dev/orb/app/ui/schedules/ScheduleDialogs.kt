package dev.orb.app.ui.schedules

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.background
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbSheetDivider
import dev.orb.app.ui.kit.OrbSheetItem
import dev.orb.app.ui.kit.OrbSheetLabel
import dev.orb.app.ui.kit.OrbSpinner
import java.util.TimeZone

/**
 * The sheet a long press (or the «⋯» of a row) opens: the mockup's «Ejecutar ahora / Editar / Desactivar», plus the way
 * to approve a schedule an assistant made. Deleting is not offered: the phone cannot, and the mockup says so.
 */
@Composable
fun ScheduleActionsSheet(
    s: ScheduleItem, canRun: Boolean, canUpdate: Boolean, enabled: Boolean,
    onRun: () -> Unit, onEdit: () -> Unit, onToggle: () -> Unit, onApprove: () -> Unit, onDismiss: () -> Unit,
) {
    val needsApproval = !s.approved
    OrbSheet(onDismiss = onDismiss, title = s.title) {
        if (canRun) OrbSheetItem(
            SchedulesTexts.RUN_NOW, onClick = onRun, icon = OrbIcons.Play, enabled = enabled && !needsApproval,
            meta = SchedulesTexts.FIRST_APPROVE.takeIf { needsApproval },
        )
        if (canUpdate) OrbSheetItem(SchedulesTexts.EDIT, onClick = onEdit, icon = OrbIcons.Pencil, enabled = enabled)
        if (canUpdate && needsApproval) OrbSheetItem(SchedulesTexts.REVIEW_APPROVE, onClick = onApprove, icon = OrbIcons.ShieldCheck, enabled = enabled)
        if (canUpdate && !needsApproval) OrbSheetItem(
            if (s.enabled) SchedulesTexts.DISABLE else SchedulesTexts.ENABLE, onClick = onToggle,
            icon = if (s.enabled) OrbIcons.Pause else OrbIcons.Play, enabled = enabled,
        )
        OrbSheetDivider()
        OrbSheetLabel(SchedulesTexts.DELETE_AT_PC)
    }
}

/**
 * Shows the whole of a schedule an assistant made before it is approved: once approved it runs on its own, with
 * exactly this name, text, frequency, project, agent and permissions. The button stays off while the PC is being read.
 */
@Composable
fun ScheduleApprovalDialog(
    a: ScheduleApproval, enabled: Boolean, phone: TimeZone, onApprove: () -> Unit, onDismiss: () -> Unit,
) {
    val s = a.item
    val maxBody = (LocalConfiguration.current.screenHeightDp * 0.55f).dp
    OrbDialog(
        onDismiss = onDismiss, title = SchedulesTexts.APPROVE_TITLE,
        confirm = OrbDialogAction(SchedulesTexts.APPROVE, onApprove, enabled = enabled && !a.loading && !a.failed),
        dismiss = OrbDialogAction(SchedulesTexts.CANCEL, onDismiss),
    ) {
        Column(Modifier.heightIn(max = maxBody).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            when {
                a.loading -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OrbSpinner()
                    Text(SchedulesTexts.APPROVE_READING, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp)
                }
                a.failed -> Notice(SchedulesTexts.APPROVE_FAILED, error = true)
                a.changed -> Notice(SchedulesTexts.APPROVE_CHANGED, error = false)
            }
            Fact(SchedulesTexts.LABEL_NAME, s.title)
            Fact(SchedulesTexts.LABEL_WHAT, s.description)
            Fact(SchedulesTexts.LABEL_WHEN, SchedulesTexts.whenLine(s))
            Fact(SchedulesTexts.LABEL_CLOCK, ScheduleStamps.clockLine(s, phone))
            Fact(SchedulesTexts.LABEL_PROJECT, s.project)
            Fact(SchedulesTexts.LABEL_BRAIN, "${SchedulesTexts.agentName(s.agent)} · ${s.model ?: SchedulesTexts.MODEL_DEFAULT}")
            Fact(SchedulesTexts.LABEL_READONLY, if (s.readonly) SchedulesTexts.YES else SchedulesTexts.NO)
            Fact(SchedulesTexts.LABEL_PERMISSIONS, if (s.autonomy == "preguntar") SchedulesTexts.PERMISSIONS_ASK else SchedulesTexts.PERMISSIONS_PC)
            Fact(SchedulesTexts.LABEL_CHAT, if (s.sameChat) SchedulesTexts.CHAT_SAME else SchedulesTexts.CHAT_EACH)
            s.notifyMobile?.let { Fact(SchedulesTexts.LABEL_NOTIFY, if (it) SchedulesTexts.YES else SchedulesTexts.NO) }
            Text(SchedulesTexts.APPROVE_WARN, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp)
        }
    }
}

@Composable
private fun Fact(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp)
        Text(value.ifBlank { "—" }, color = OrbKit.foreground, fontSize = 14.5.sp, lineHeight = 21.sp)
    }
}

@Composable
private fun Notice(text: String, error: Boolean) {
    val fg = if (error) OrbKit.destructive else OrbKit.warningInk
    val bg = if (error) OrbKit.destructive.copy(alpha = 0.12f) else OrbKit.warningSoft
    Text(
        text, Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(bg).padding(horizontal = 14.dp, vertical = 10.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        color = fg, fontSize = 13.sp, lineHeight = 18.sp,
    )
}

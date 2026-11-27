package dev.orb.app.ui.approve

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.approve.ApproveTexts
import dev.orb.app.approve.ApproveUi
import dev.orb.app.approve.Approver
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbKit

/** The approval the PC asked for, over whatever the app shows. It paints only what [Approver] checked against the signed bytes. */
@Composable
fun ApproveHost(approver: Approver) {
    val ui by approver.ui.collectAsStateWithLifecycle()
    ui?.let { ApproveDialog(it, onConfirm = approver::confirm, onDismiss = approver::dismiss) }
}

@Composable
fun ApproveDialog(ui: ApproveUi, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    val actionable = ui.request != null
    OrbDialog(
        onDismiss = onDismiss,
        title = ui.title,
        text = ui.body,
        confirm = if (actionable) OrbDialogAction(ApproveTexts.APPROVE, onConfirm, enabled = !ui.busy) else OrbDialogAction(ApproveTexts.CLOSE, onDismiss),
        dismiss = if (actionable) OrbDialogAction(ApproveTexts.REJECT, onDismiss, enabled = !ui.busy) else null,
        content = ui.summary?.let { summary -> { Summary(summary) } },
    )
}

/** The parameters, as the PC canonicalised them: the text whose hash was signed. */
@Composable
private fun Summary(text: String) {
    Column(Modifier.padding(top = 2.dp)) {
        Text(text, color = OrbKit.foreground, fontFamily = FontFamily.Monospace, fontSize = 12.5.sp, lineHeight = 18.sp)
    }
}

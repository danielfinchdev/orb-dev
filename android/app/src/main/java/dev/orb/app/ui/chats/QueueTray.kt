package dev.orb.app.ui.chats

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.theme.OrbMotion
import dev.orb.app.ui.theme.OrbTheme

/**
 * «En cola (n)»: what was written while the agent works and still waits on the PC. Folded by default so it does not
 * take the screen; each message can be edited, moved or removed, and the PC keeps the real order.
 */
@Composable
fun QueueTray(
    queue: List<QueuedMsg>, online: Boolean,
    onEdit: (QueuedMsg, String) -> Unit, onRemove: (QueuedMsg) -> Unit, onMove: (QueuedMsg, Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    var editing by remember { mutableStateOf<QueuedMsg?>(null) }
    AnimatedVisibility(
        queue.isNotEmpty(), modifier,
        enter = fadeIn(tween(OrbMotion.Short)) + expandVertically(OrbMotion.standard(OrbMotion.Short)),
        exit = fadeOut(tween(OrbMotion.Fast)) + shrinkVertically(OrbMotion.standard(OrbMotion.Fast)),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp).clip(RoundedCornerShape(14.dp))
                .background(MaterialTheme.colorScheme.surfaceContainerLow).animateContentSize(OrbMotion.standard()),
        ) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable { open = !open }.padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(OrbIcons.ListOrdered, null, Modifier.size(16.dp), tint = OrbTheme.colors.text2)
                Text(ChatTexts.queueTitle(queue.size), Modifier.weight(1f), style = MaterialTheme.typography.labelLarge, fontWeight = androidx.compose.ui.text.font.FontWeight.Medium)
                Icon(if (open) OrbIcons.ChevronDown else OrbIcons.ChevronUp, null, Modifier.size(16.dp), tint = OrbTheme.colors.text3)
            }
            if (open) {
                Text(ChatTexts.QUEUE_NOTE, Modifier.padding(horizontal = 14.dp), color = OrbTheme.colors.text3, style = MaterialTheme.typography.bodySmall)
                queue.forEachIndexed { i, q ->
                    Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("${i + 1}.", color = OrbTheme.colors.text3, style = MaterialTheme.typography.bodyMedium)
                        Text(q.text, Modifier.weight(1f).padding(horizontal = 8.dp), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                        TrayButton(OrbIcons.ArrowUp, ChatTexts.QUEUE_UP, online && i > 0) { onMove(q, true) }
                        TrayButton(OrbIcons.ArrowDown, ChatTexts.QUEUE_DOWN, online && i < queue.lastIndex) { onMove(q, false) }
                        TrayButton(OrbIcons.Pencil, ChatTexts.QUEUE_EDIT, online) { editing = q }
                        TrayButton(OrbIcons.Close, ChatTexts.REMOVE, online) { onRemove(q) }
                    }
                }
                Text("", Modifier.padding(bottom = 6.dp))
            }
        }
    }
    editing?.let { q ->
        var text by remember(q.id) { mutableStateOf(q.text) }
        AlertDialog(
            onDismissRequest = { editing = null },
            title = { Text(ChatTexts.QUEUE_EDIT_TITLE) },
            text = { OutlinedTextField(text, { text = it }, maxLines = 6) },
            confirmButton = { TextButton(onClick = { onEdit(q, text); editing = null }, enabled = text.isNotBlank()) { Text(ChatTexts.SAVE) } },
            dismissButton = { TextButton(onClick = { editing = null }) { Text(ChatTexts.CANCEL) } },
        )
    }
}

@Composable
private fun TrayButton(icon: androidx.compose.ui.graphics.vector.ImageVector, description: String, enabled: Boolean, onClick: () -> Unit) {
    IconButton(onClick, Modifier.size(44.dp), enabled = enabled) {
        Icon(icon, description, Modifier.size(18.dp), tint = if (enabled) OrbTheme.colors.text2 else OrbTheme.colors.text3.copy(alpha = 0.4f))
    }
}

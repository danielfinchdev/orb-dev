package dev.orb.app.ui.chats

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbCard
import dev.orb.app.ui.kit.OrbGroupHeader
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbSheetItem
import dev.orb.app.ui.theme.OrbMotion

/**
 * «En cola · n» (`.lcard`): what was written while the agent works and still waits on the PC, in the thread under what the
 * agent is doing. Each message can be edited (in the writing box, see [editingId]), removed, or moved up or down from its «⋯».
 * While one is being edited the others have no buttons, so only one change is in flight.
 */
@Composable
fun QueueCard(
    queue: List<QueuedMsg>, online: Boolean, editingId: Long?,
    onEdit: (QueuedMsg) -> Unit, onRemove: (QueuedMsg) -> Unit, onMove: (QueuedMsg, Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    var menuFor by remember { mutableStateOf<QueuedMsg?>(null) }
    AnimatedVisibility(
        queue.isNotEmpty(), modifier,
        enter = fadeIn(tween(OrbMotion.Short)) + expandVertically(OrbMotion.standard(OrbMotion.Short)),
        exit = fadeOut(tween(OrbMotion.Fast)) + shrinkVertically(OrbMotion.standard(OrbMotion.Fast)),
    ) {
        OrbCard(Modifier.animateContentSize(OrbMotion.standard())) {
            OrbGroupHeader(DirectTexts.queueCount(queue.size), icon = OrbIcons.ListEnd)
            queue.forEachIndexed { i, q ->
                val editing = q.id == editingId
                Row(
                    Modifier.fillMaxWidth().defaultMinSize(minHeight = 56.dp).padding(start = 16.dp, end = 4.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Box(Modifier.width(20.dp), contentAlignment = Alignment.Center) {
                        Icon(if (editing) OrbIcons.Pencil else OrbIcons.Clock, null, Modifier.size(20.dp), tint = OrbKit.mutedForeground)
                    }
                    Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
                        Text(q.text, color = OrbKit.foreground, fontSize = 14.5.sp, lineHeight = 20.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        if (editing) Text(DirectTexts.QUEUE_EDITING_ROW, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp)
                    }
                    if (editingId == null) {
                        OrbIconButton(OrbIcons.Pencil, ChatTexts.QUEUE_EDIT, { onEdit(q) }, enabled = online)
                        OrbIconButton(OrbIcons.Close, DirectTexts.QUEUE_REMOVE, { onRemove(q) }, enabled = online)
                        if (queue.size > 1) OrbIconButton(OrbIcons.MoreVertical, DirectTexts.QUEUE_MORE, { menuFor = q }, enabled = online)
                    }
                }
            }
        }
    }
    menuFor?.let { q ->
        val i = queue.indexOfFirst { it.id == q.id }
        if (i < 0) menuFor = null
        else OrbSheet(onDismiss = { menuFor = null }, title = DirectTexts.QUEUE_ITEM_SHEET) {
            OrbSheetItem(ChatTexts.QUEUE_UP, { menuFor = null; onMove(q, true) }, icon = OrbIcons.ArrowUp, enabled = i > 0)
            OrbSheetItem(ChatTexts.QUEUE_DOWN, { menuFor = null; onMove(q, false) }, icon = OrbIcons.ArrowDown, enabled = i < queue.lastIndex)
        }
    }
}

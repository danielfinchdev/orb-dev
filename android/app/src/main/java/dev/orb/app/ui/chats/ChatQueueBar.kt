package dev.orb.app.ui.chats

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbQueueBar
import dev.orb.app.ui.kit.OrbTextField
import dev.orb.app.ui.theme.OrbMotion

/** What the bar over the writing box does with the PC's queue; null parts hide what the PC cannot do. */
class QueueActions(
    val items: List<OrbeQueued>,
    val editor: QueueEditor?,
    val onOpen: (OrbeQueued) -> Unit,
    val onClose: () -> Unit,
    val onSave: (String) -> Unit,
    val onRemove: (OrbeQueued) -> Unit,
)

/**
 * «N en cola» over the writing box: what was sent while the assistant is still answering. [count] is what the PC says
 * about turns; with [queue] (a PC that lists the messages) the bar quotes the first one and «Editar» opens it: one message
 * goes straight to the editor, several to a list where each can be edited or removed.
 */
@Composable
fun ChatQueueBar(count: Int, modifier: Modifier = Modifier, queue: QueueActions? = null) {
    val items = queue?.items.orEmpty()
    val n = maxOf(count, items.size)
    var listing by rememberSaveable { mutableStateOf(false) }
    val editable = queue != null && items.isNotEmpty()
    AnimatedVisibility(
        n > 0, modifier,
        enter = fadeIn(tween(OrbMotion.Short)) + expandVertically(OrbMotion.standard(OrbMotion.Short)),
        exit = fadeOut(tween(OrbMotion.Fast)) + shrinkVertically(OrbMotion.standard(OrbMotion.Fast)),
    ) {
        OrbQueueBar(
            ChatTexts.queuedLine(n, items.firstOrNull()?.text),
            onEdit = if (editable) ({ if (items.size == 1) queue!!.onOpen(items.first()) else listing = true }) else null, editLabel = ChatTexts.TASK_EDIT,
        )
    }
    if (queue != null && listing && items.isNotEmpty() && queue.editor == null) {
        OrbDialog(
            onDismiss = { listing = false }, title = ChatTexts.QUEUE_LIST_TITLE,
            confirm = OrbDialogAction(ChatTexts.QUEUE_CLOSE, { listing = false }),
        ) {
            for (q in items) {
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(q.text, Modifier.weight(1f), color = OrbKit.foreground, fontSize = 14.5.sp, lineHeight = 20.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    OrbIconButton(OrbIcons.Pencil, ChatTexts.QUEUE_EDIT, { queue.onOpen(q) })
                    OrbIconButton(OrbIcons.Close, ChatTexts.QUEUED_REMOVE, { queue.onRemove(q) })
                }
            }
        }
    }
    val editing = queue?.editor
    if (queue != null && editing != null) {
        var text by rememberSaveable(editing.item.id) { mutableStateOf(editing.item.text) }
        OrbDialog(
            onDismiss = queue.onClose, title = ChatTexts.TASK_EDIT_QUEUED,
            confirm = OrbDialogAction(ChatTexts.QUEUED_SAVE, { queue.onSave(text) }, enabled = text.isNotBlank() && !editing.busy),
            dismiss = OrbDialogAction(ChatTexts.QUEUED_REMOVE, { queue.onRemove(editing.item) }, danger = true, enabled = !editing.busy),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OrbTextField(text, { text = it }, label = ChatTexts.TASK_EDIT_QUEUED, onDone = { if (text.isNotBlank() && !editing.busy) queue.onSave(text) })
                // The PC's refusal, word for word, read out as soon as it appears.
                if (editing.error != null) Text(
                    editing.error, Modifier.semantics { liveRegion = LiveRegionMode.Polite }, color = OrbKit.destructive, fontSize = 12.sp, lineHeight = 16.sp,
                )
            }
        }
    }
}

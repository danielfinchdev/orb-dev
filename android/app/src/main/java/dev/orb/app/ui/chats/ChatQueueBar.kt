package dev.orb.app.ui.chats

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbQueueBar
import dev.orb.app.ui.kit.OrbTextField
import dev.orb.app.ui.theme.OrbMotion

/**
 * «N en cola» over the writing box: what was sent while the assistant is still answering. [count] is what the PC says
 * about the queue; [items] and [onEdit] are for a PC that also lists the queued messages (none does for Orbe yet):
 * with them the bar quotes the first one and «Editar» opens the dialog to change or remove it.
 */
@Composable
fun ChatQueueBar(
    count: Int, modifier: Modifier = Modifier, items: List<QueuedMsg> = emptyList(),
    onEdit: ((QueuedMsg, String) -> Unit)? = null, onRemove: ((QueuedMsg) -> Unit)? = null,
) {
    var editing by remember { mutableStateOf<QueuedMsg?>(null) }
    val n = maxOf(count, items.size)
    val editable = onEdit != null && items.isNotEmpty()
    AnimatedVisibility(
        n > 0, modifier,
        enter = fadeIn(tween(OrbMotion.Short)) + expandVertically(OrbMotion.standard(OrbMotion.Short)),
        exit = fadeOut(tween(OrbMotion.Fast)) + shrinkVertically(OrbMotion.standard(OrbMotion.Fast)),
    ) {
        OrbQueueBar(
            ChatTexts.queuedLine(n, items.firstOrNull()?.text),
            onEdit = if (editable) ({ editing = items.first() }) else null, editLabel = ChatTexts.TASK_EDIT,
        )
    }
    editing?.let { q ->
        var text by remember(q.id) { mutableStateOf(q.text) }
        OrbDialog(
            onDismiss = { editing = null }, title = ChatTexts.TASK_EDIT_QUEUED,
            confirm = OrbDialogAction(ChatTexts.QUEUED_SAVE, { onEdit?.invoke(q, text.trim()); editing = null }, enabled = text.isNotBlank()),
            dismiss = if (onRemove != null) OrbDialogAction(ChatTexts.QUEUED_REMOVE, { onRemove(q); editing = null }, danger = true) else null,
        ) { OrbTextField(text, { text = it }, label = ChatTexts.TASK_EDIT_QUEUED) }
    }
}

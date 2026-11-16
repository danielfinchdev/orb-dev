package dev.orb.app.ui.chats

import androidx.compose.animation.Crossfade
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.theme.OrbMotion
import dev.orb.app.ui.theme.OrbTheme

/** What the sheet asks of the list; each one becomes a request to the PC. */
class ChatActions(
    val onPin: (ChatRow) -> Unit,
    val onMarkRead: (ChatRow) -> Unit,
    val onMute: (ChatRow) -> Unit,
    val onSnooze: (ChatRow, SnoozeOption) -> Unit,
    val onMove: (ChatRow, Long?) -> Unit,
    val onMoveToNew: (ChatRow, String) -> Unit,
    val onRename: (ChatRow, String) -> Unit,
    val onArchive: (ChatRow) -> Unit,
    /** Null: the PC cannot trash chats, so the action is not shown. */
    val onDelete: ((ChatRow) -> Unit)?,
)

private enum class SheetMode { Main, Snooze, Section }
private enum class SheetDialog { None, Rename, NewSection }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatActionsSheet(row: ChatRow, sections: List<ChatSection>, online: Boolean, actions: ChatActions, onDismiss: () -> Unit) {
    var mode by rememberSaveable { mutableStateOf(SheetMode.Main) }
    var dialog by rememberSaveable { mutableStateOf(SheetDialog.None) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 16.dp)) {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                ChatAvatar(row)
                Column {
                    Text(row.title, style = MaterialTheme.typography.titleMedium, maxLines = 1)
                    Text(
                        if (row.direct) ChatTexts.withAgent(row.project, agentName(row.agent)) else ChatTexts.withOrbe(row.project),
                        style = MaterialTheme.typography.bodyMedium, color = OrbTheme.colors.text2, maxLines = 1,
                    )
                }
            }
            if (!online) {
                Text(ChatTexts.NEEDS_PC, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.titleSmall, color = OrbTheme.colors.warn)
                Text(ChatTexts.NEEDS_PC_HINT, Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodyMedium, color = OrbTheme.colors.text2)
            }
            Crossfade(mode, animationSpec = OrbMotion.standard(OrbMotion.Short), label = "sheetMode") { m ->
                Column {
                    when (m) {
                        SheetMode.Main -> MainActions(row, online, actions, onDismiss, toSnooze = { mode = SheetMode.Snooze }, toSection = { mode = SheetMode.Section }, rename = { dialog = SheetDialog.Rename })
                        SheetMode.Snooze -> SnoozeActions(row, actions, onDismiss) { mode = SheetMode.Main }
                        SheetMode.Section -> SectionActions(row, sections, actions, onDismiss, newSection = { dialog = SheetDialog.NewSection }) { mode = SheetMode.Main }
                    }
                }
            }
        }
    }
    when (dialog) {
        SheetDialog.Rename -> TextDialog(
            title = ChatTexts.RENAME_TITLE, label = ChatTexts.TITLE_FIELD, initial = row.title, confirm = ChatTexts.SAVE,
            onDismiss = { dialog = SheetDialog.None },
            onConfirm = { actions.onRename(row, it); dialog = SheetDialog.None; onDismiss() },
        )
        SheetDialog.NewSection -> TextDialog(
            title = ChatTexts.NEW_SECTION, label = ChatTexts.SECTION_NAME, initial = "", confirm = ChatTexts.CREATE,
            onDismiss = { dialog = SheetDialog.None },
            onConfirm = { actions.onMoveToNew(row, it); dialog = SheetDialog.None; onDismiss() },
        )
        SheetDialog.None -> Unit
    }
}

@Composable
private fun MainActions(
    row: ChatRow, online: Boolean, a: ChatActions, close: () -> Unit,
    toSnooze: () -> Unit, toSection: () -> Unit, rename: () -> Unit,
) {
    fun done(block: () -> Unit): () -> Unit = { block(); close() }
    ActionRow(OrbIcons.Pin, if (row.pinned) ChatTexts.UNPIN else ChatTexts.PIN, online, onClick = done { a.onPin(row) })
    if (row.unread > 0) ActionRow(OrbIcons.CheckCheck, ChatTexts.MARK_READ, online, onClick = done { a.onMarkRead(row) })
    ActionRow(if (row.muted) OrbIcons.Bell else OrbIcons.BellOff, if (row.muted) ChatTexts.UNMUTE else ChatTexts.MUTE, online, hint = if (row.muted) null else ChatTexts.MUTE_HINT, onClick = done { a.onMute(row) })
    ActionRow(OrbIcons.Clock, ChatTexts.SNOOZE, online, onClick = toSnooze)
    ActionRow(OrbIcons.FolderInput, ChatTexts.MOVE_SECTION, online, onClick = toSection)
    ActionRow(OrbIcons.Pencil, ChatTexts.RENAME, online, onClick = rename)
    ActionRow(OrbIcons.Archive, ChatTexts.ARCHIVE, online, hint = ChatTexts.ARCHIVE_HINT, onClick = done { a.onArchive(row) })
    a.onDelete?.let { del -> ActionRow(OrbIcons.Trash, ChatTexts.DELETE, online, hint = ChatTexts.DELETE_HINT, danger = true, onClick = done { del(row) }) }
}

@Composable
private fun SnoozeActions(row: ChatRow, a: ChatActions, close: () -> Unit, back: () -> Unit) {
    fun pick(o: SnoozeOption): () -> Unit = { a.onSnooze(row, o); close() }
    ActionRow(OrbIcons.ArrowLeft, ChatTexts.SNOOZE, true, onClick = back)
    ActionRow(OrbIcons.Clock, ChatTexts.SNOOZE_1H, true, onClick = pick(SnoozeOption.OneHour))
    ActionRow(OrbIcons.Clock, ChatTexts.SNOOZE_3H, true, onClick = pick(SnoozeOption.ThreeHours))
    ActionRow(OrbIcons.Clock, ChatTexts.SNOOZE_TOMORROW, true, onClick = pick(SnoozeOption.Tomorrow))
    if (row.snoozedUntil != null) ActionRow(OrbIcons.Close, ChatTexts.UNSNOOZE, true, onClick = pick(SnoozeOption.Clear))
}

@Composable
private fun SectionActions(row: ChatRow, sections: List<ChatSection>, a: ChatActions, close: () -> Unit, newSection: () -> Unit, back: () -> Unit) {
    ActionRow(OrbIcons.ArrowLeft, ChatTexts.MOVE_SECTION, true, onClick = back)
    for (s in sections) {
        if (s.id != row.section) ActionRow(OrbIcons.Folder, s.name, true, onClick = { a.onMove(row, s.id); close() })
    }
    if (row.section != null) ActionRow(OrbIcons.Close, ChatTexts.OUT_OF_SECTION, true, onClick = { a.onMove(row, null); close() })
    ActionRow(OrbIcons.Plus, ChatTexts.NEW_SECTION, true, onClick = newSection)
}

@Composable
private fun ActionRow(icon: ImageVector, label: String, enabled: Boolean, hint: String? = null, danger: Boolean = false, onClick: () -> Unit) {
    val color = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
    Row(
        Modifier.fillMaxWidth().alpha(if (enabled) 1f else 0.38f).clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(horizontal = 24.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(icon, null, Modifier.size(24.dp), tint = if (danger) color else OrbTheme.colors.text2)
        Column {
            Text(label, style = MaterialTheme.typography.bodyLarge, color = color)
            if (hint != null) Text(hint, style = MaterialTheme.typography.bodyMedium, color = OrbTheme.colors.text2)
        }
    }
}

@Composable
fun TextDialog(title: String, label: String, initial: String, confirm: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { OutlinedTextField(text, { text = it }, label = { Text(label) }, singleLine = true) },
        confirmButton = { TextButton(onClick = { onConfirm(text) }, enabled = text.isNotBlank()) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(ChatTexts.CANCEL) } },
    )
}

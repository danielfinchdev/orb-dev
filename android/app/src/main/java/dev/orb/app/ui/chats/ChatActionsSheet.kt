package dev.orb.app.ui.chats

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.material3.Text
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.AgentMark
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbNote
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbSheetDivider
import dev.orb.app.ui.kit.OrbSheetItem
import dev.orb.app.ui.kit.OrbSheetLabel
import dev.orb.app.ui.kit.OrbTextField
import dev.orb.app.ui.kit.ProjectDot
import dev.orb.app.ui.kit.ProjectDotSize

/** What the sheet asks of the list; each one becomes a request to the PC. */
class ChatActions(
    val onPin: (ChatRow) -> Unit,
    val onMarkRead: (ChatRow) -> Unit,
    val onMute: (ChatRow, MuteOption) -> Unit,
    val onSnooze: (ChatRow, SnoozeOption) -> Unit,
    val onMove: (ChatRow, Long?) -> Unit,
    val onMoveToNew: (ChatRow, String) -> Unit,
    val onRename: (ChatRow, String) -> Unit,
    val onArchive: (ChatRow) -> Unit,
    /** Null: the PC cannot trash chats, so the action is not shown. */
    val onDelete: ((ChatRow) -> Unit)?,
    /** Null: the PC cannot mark a chat unread (an older PC), so the action is not shown. */
    val onMarkUnread: ((ChatRow) -> Unit)? = null,
    /** An older PC mutes only for good, so «1 hora» and «8 horas» would lie there. */
    val timedMute: Boolean = true,
) {
    /** The same actions with the deletion wired in (the list decides whether the PC can trash chats). */
    fun withDelete(onDelete: ((ChatRow) -> Unit)?) = ChatActions(
        onPin, onMarkRead, onMute, onSnooze, onMove, onMoveToNew, onRename, onArchive, onDelete, onMarkUnread, timedMute,
    )
}

private enum class SheetMode { Main, Mute, Snooze, Section }
private enum class SheetDialog { None, Rename, NewSection }

/** The sheet of a chat (screen 10): the main list and, behind «Silenciar», «Posponer» and «Mover a sección», one list each. */
@Composable
fun ChatActionsSheet(row: ChatRow, sections: List<ChatSection>, online: Boolean, actions: ChatActions, onDismiss: () -> Unit, nowMs: Long = System.currentTimeMillis()) {
    var mode by rememberSaveable { mutableStateOf(SheetMode.Main) }
    var dialog by rememberSaveable { mutableStateOf(SheetDialog.None) }
    OrbSheet(onDismiss = onDismiss, header = { SheetHeader(row) }) {
        if (!online) {
            Text(ChatTexts.NEEDS_PC, Modifier.padding(horizontal = 20.dp, vertical = 4.dp), color = OrbKit.warning, fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium)
            OrbNote(ChatTexts.NEEDS_PC_HINT, Modifier.padding(start = 20.dp, end = 20.dp, bottom = 6.dp))
        }
        when (mode) {
            SheetMode.Main -> MainActions(row, online, actions, onDismiss, nowMs, toMute = { mode = SheetMode.Mute }, toSnooze = { mode = SheetMode.Snooze }, toSection = { mode = SheetMode.Section }, rename = { dialog = SheetDialog.Rename })
            SheetMode.Mute -> MuteActions(row, actions, onDismiss) { mode = SheetMode.Main }
            SheetMode.Snooze -> SnoozeActions(row, actions, nowMs, onDismiss) { mode = SheetMode.Main }
            SheetMode.Section -> SectionActions(row, sections, actions, onDismiss, newSection = { dialog = SheetDialog.NewSection }) { mode = SheetMode.Main }
        }
    }
    when (dialog) {
        SheetDialog.Rename -> TextDialog(
            title = ChatTexts.RENAME, label = ChatTexts.TITLE_FIELD, initial = row.title, confirm = ChatTexts.SAVE,
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

/** `.sh`: the chat's agent, its title, and the project and mode under it. */
@Composable
private fun RowScope.SheetHeader(row: ChatRow) {
    AgentMark(if (row.direct) row.agent ?: "acp" else "orbe")
    Column(Modifier.weight(1f)) {
        Text(row.title, color = OrbKit.foreground, fontSize = 15.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (row.project != null) ProjectDot(row.project, size = ProjectDotSize.Normal)
            val mode = if (row.direct) ChatTexts.withAgent(row.project, agentName(row.agent)) else ChatTexts.withOrbe(row.project)
            Text(
                mode.replaceFirstChar { it.uppercase() }, color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 17.sp,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun MainActions(
    row: ChatRow, online: Boolean, a: ChatActions, close: () -> Unit, nowMs: Long,
    toMute: () -> Unit, toSnooze: () -> Unit, toSection: () -> Unit, rename: () -> Unit,
) {
    fun done(block: () -> Unit): () -> Unit = { block(); close() }
    ActionItem(if (row.pinned) ChatTexts.UNPIN else ChatTexts.PIN, OrbIcons.Pin, online, onClick = done { a.onPin(row) })
    if (row.unread > 0) ActionItem(ChatTexts.MARK_READ, OrbIcons.CheckCheck, online, onClick = done { a.onMarkRead(row) })
    else a.onMarkUnread?.let { unread -> ActionItem(ChatTexts.MARK_UNREAD, OrbIcons.Mail, online, onClick = done { unread(row) }) }
    if (row.muted) {
        val until = row.mutedUntil?.let { ChatTime.until(it, nowMs) }?.takeIf { it.isNotEmpty() } ?: ChatTexts.UNMUTE_FOREVER
        ActionItem(ChatTexts.UNMUTE, OrbIcons.Bell, online, meta = until, onClick = done { a.onMute(row, MuteOption.Clear) })
    } else {
        ActionItem(ChatTexts.MUTE, OrbIcons.BellOff, online, meta = if (a.timedMute) ChatTexts.MUTE_META else null, onClick = toMute)
    }
    ActionItem(ChatTexts.SNOOZE, OrbIcons.Clock, online, onClick = toSnooze)
    ActionItem(ChatTexts.MOVE_SECTION, OrbIcons.FolderInput, online, onClick = toSection)
    ActionItem(ChatTexts.RENAME, OrbIcons.Pencil, online, onClick = rename)
    ActionItem(ChatTexts.ARCHIVE, OrbIcons.Archive, online, onClick = done { a.onArchive(row) })
    // The PC can delete a chat (the mockup's footnote says it cannot): kept apart, in red, and confirmed before it runs.
    a.onDelete?.let { del ->
        OrbSheetDivider()
        OrbSheetLabel(ChatTexts.MORE_OPTIONS)
        ActionItem(ChatTexts.DELETE, OrbIcons.Trash, online, meta = ChatTexts.DELETE_HINT, danger = true, onClick = done { del(row) })
    }
}

@Composable
private fun MuteActions(row: ChatRow, a: ChatActions, close: () -> Unit, back: () -> Unit) {
    fun pick(o: MuteOption): () -> Unit = { a.onMute(row, o); close() }
    OrbSheetLabel(ChatTexts.MUTE_TITLE)
    if (a.timedMute) {
        OrbSheetItem(ChatTexts.MUTE_1H, pick(MuteOption.OneHour), icon = OrbIcons.BellOff)
        OrbSheetItem(ChatTexts.MUTE_8H, pick(MuteOption.EightHours), icon = OrbIcons.BellOff)
    }
    OrbSheetItem(ChatTexts.MUTE_ALWAYS, pick(MuteOption.Forever), icon = OrbIcons.BellOff)
    BackItem(back)
}

@Composable
private fun SnoozeActions(row: ChatRow, a: ChatActions, nowMs: Long, close: () -> Unit, back: () -> Unit) {
    fun pick(o: SnoozeOption): () -> Unit = { a.onSnooze(row, o); close() }
    OrbSheetLabel(ChatTexts.SNOOZE_TITLE)
    OrbSheetItem(ChatTexts.SNOOZE_1H, pick(SnoozeOption.OneHour), icon = OrbIcons.Clock)
    // «Esta tarde» is not offered once the afternoon is here: it would be a time already gone or hardly different from an hour.
    if (ChatTime.afternoonOffered(nowMs)) OrbSheetItem(ChatTexts.SNOOZE_AFTERNOON, pick(SnoozeOption.ThisAfternoon), icon = OrbIcons.Clock)
    OrbSheetItem(ChatTexts.SNOOZE_TOMORROW, pick(SnoozeOption.Tomorrow), icon = OrbIcons.Clock)
    if (row.snoozedUntil != null) OrbSheetItem(ChatTexts.UNSNOOZE, pick(SnoozeOption.Clear), icon = OrbIcons.Close, meta = ChatTime.until(row.snoozedUntil, nowMs).takeIf { it.isNotEmpty() })
    BackItem(back)
}

@Composable
private fun SectionActions(row: ChatRow, sections: List<ChatSection>, a: ChatActions, close: () -> Unit, newSection: () -> Unit, back: () -> Unit) {
    OrbSheetLabel(ChatTexts.MOVE_SECTION)
    OrbSheetItem(ChatTexts.NO_SECTION, { if (row.section != null) a.onMove(row, null); close() }, icon = OrbIcons.Folder)
    for (s in sections) {
        OrbSheetItem(s.name, { if (s.id != row.section) a.onMove(row, s.id); close() }, icon = OrbIcons.Folder, meta = if (s.id == row.section) ChatTexts.CURRENT else null)
    }
    OrbSheetItem(ChatTexts.NEW_SECTION, newSection, icon = OrbIcons.FolderPlus)
    BackItem(back)
}

@Composable
private fun BackItem(back: () -> Unit) {
    OrbSheetDivider()
    OrbSheetItem(ChatTexts.BACK, back, icon = OrbIcons.ArrowLeft)
}

/** A sheet row that waits for the PC: without a link it is dimmed and says so to a screen reader. */
@Composable
private fun ActionItem(text: String, icon: ImageVector, enabled: Boolean, meta: String? = null, danger: Boolean = false, onClick: () -> Unit) {
    OrbSheetItem(
        text, if (enabled) onClick else ({}), Modifier.alpha(if (enabled) 1f else 0.38f).semantics { if (!enabled) disabled() },
        icon = icon, meta = meta, danger = danger,
    )
}

/** `.mdlg` with one text field: the title of a chat or the name of a new section. The confirm button does nothing while the field is blank. */
@Composable
fun TextDialog(title: String, label: String, initial: String, confirm: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf(initial) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    fun submit() { if (text.isNotBlank()) onConfirm(text) }
    OrbDialog(
        onDismiss, title, OrbDialogAction(confirm, ::submit), dismiss = OrbDialogAction(ChatTexts.CANCEL, onDismiss),
        content = { OrbTextField(text, { text = it }, label, focus = focus, onDone = ::submit) },
    )
}

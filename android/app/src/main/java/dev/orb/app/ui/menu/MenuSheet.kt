package dev.orb.app.ui.menu

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Badge
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import dev.orb.app.ui.chats.ChatTexts
import dev.orb.app.ui.chats.InboxTexts
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.theme.OrbFonts
import dev.orb.app.ui.theme.OrbTheme

/**
 * What the menu shows. An entry whose PC method is not listed is not offered at all. Juegos (a local web view) and
 * Tutoriales (native) work without a connection, so they are always offered; Pizarra (also a local web view) needs
 * the PC's methods, because its drawing lives there.
 */
class MenuState(
    val pcLabel: String,
    val unreadNotices: Int = 0,
    val showSchedules: Boolean = true,
    val showActivity: Boolean = true,
    val showUsage: Boolean = true,
    val showWhiteboard: Boolean = true,
    /** What the chat list offers that the mockup does not draw; null when the menu is not opened from the list. */
    val inbox: InboxMenu? = null,
)

/** The list's ordering and the day summary, which live under «Más opciones» now that the Chats bar has no «⋮». */
class InboxMenu(val priority: Boolean, val canDigest: Boolean)

class MenuActions(
    val onNotices: () -> Unit = {},
    val onSchedules: () -> Unit = {},
    val onActivity: () -> Unit = {},
    val onUsage: () -> Unit = {},
    val onWhiteboard: () -> Unit = {},
    val onGames: () -> Unit = {},
    val onTutorials: () -> Unit = {},
    val onThisPhone: () -> Unit = {},
    val onAppearance: () -> Unit = {},
    val onLinkTest: () -> Unit = {},
    val onUnlink: () -> Unit = {},
    val onPriority: () -> Unit = {},
    val onReorder: () -> Unit = {},
    val onDigest: () -> Unit = {},
)

/** The ☰ menu of the Chats bar. Every choice closes the sheet first, then goes where it leads. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MenuSheet(state: MenuState, actions: MenuActions, onDismiss: () -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = OrbKit.popover, contentColor = OrbKit.foreground,
    ) {
        MenuContent(state, actions, onDismiss)
    }
}

@Composable
fun MenuContent(state: MenuState, actions: MenuActions, close: () -> Unit) {
    fun go(f: () -> Unit): () -> Unit = { close(); f() }
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = 16.dp)) {
        Text(MenuTexts.MENU, Modifier.padding(horizontal = 24.dp, vertical = 4.dp), style = MaterialTheme.typography.titleLarge, fontFamily = OrbFonts.title)
        Text(state.pcLabel, Modifier.padding(horizontal = 24.dp, vertical = 2.dp), style = MaterialTheme.typography.bodyMedium, color = OrbTheme.colors.text2)

        Section(MenuTexts.SECTION_WORK)
        Entry(MenuTexts.NOTICES, OrbIcons.Bell, go(actions.onNotices), badge = state.unreadNotices)
        if (state.showSchedules) Entry(MenuTexts.SCHEDULES, OrbIcons.Clock, go(actions.onSchedules))
        if (state.showActivity) Entry(MenuTexts.ACTIVITY, OrbIcons.Activity, go(actions.onActivity))
        if (state.showUsage) Entry(MenuTexts.USAGE, OrbIcons.Gauge, go(actions.onUsage))
        if (state.showWhiteboard) Entry(MenuTexts.WHITEBOARD, OrbIcons.PenTool, go(actions.onWhiteboard))
        Entry(MenuTexts.GAMES, OrbIcons.Gamepad2, go(actions.onGames))
        Entry(MenuTexts.TUTORIALS, OrbIcons.GraduationCap, go(actions.onTutorials))

        Section(MenuTexts.SECTION_SETTINGS)
        Entry(MenuTexts.THIS_PHONE, OrbIcons.Smartphone, go(actions.onThisPhone))
        Entry(MenuTexts.APPEARANCE, OrbIcons.Palette, go(actions.onAppearance))
        Entry(MenuTexts.LINK_TEST, OrbIcons.Activity, go(actions.onLinkTest))
        Entry(MenuTexts.UNLINK, OrbIcons.LogOut, go(actions.onUnlink), tint = MaterialTheme.colorScheme.error)

        // What the mockup does not draw but the phone keeps: it goes last, under its own label.
        state.inbox?.let { inbox ->
            Section(MenuTexts.MORE_OPTIONS)
            Entry(
                ChatTexts.ORDER_PRIORITY, OrbIcons.ListOrdered, go(actions.onPriority),
                meta = if (inbox.priority) ChatTexts.ORDER_PRIORITY_ON else ChatTexts.ORDER_PRIORITY_OFF,
            )
            if (inbox.priority) Entry(InboxTexts.current().reorder, OrbIcons.ArrowUp, go(actions.onReorder))
            if (inbox.canDigest) Entry(ChatTexts.DAY_SUMMARY, OrbIcons.Activity, go(actions.onDigest))
        }
    }
}

@Composable
private fun Section(title: String) =
    Text(title, Modifier.padding(start = 24.dp, end = 24.dp, top = 16.dp, bottom = 4.dp), style = MaterialTheme.typography.labelLarge, color = OrbTheme.colors.text3)

@Composable
private fun Entry(label: String, icon: ImageVector, onClick: () -> Unit, badge: Int = 0, tint: Color = Color.Unspecified, meta: String? = null) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).padding(horizontal = 24.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = if (tint == Color.Unspecified) OrbTheme.colors.text2 else tint)
        Text(label, Modifier.weight(1f).padding(start = 16.dp), style = MaterialTheme.typography.bodyLarge, color = if (tint == Color.Unspecified) Color.Unspecified else tint)
        if (meta != null) Text(meta, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text3)
        if (badge > 0) Badge { Text(if (badge > 99) "99+" else badge.toString()) }
    }
}

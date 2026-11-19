package dev.orb.app.ui.menu

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.chats.ChatTexts
import dev.orb.app.ui.chats.InboxTexts
import dev.orb.app.ui.connectionText
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbBadge
import dev.orb.app.ui.kit.OrbBadgeKind
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbSheetDivider
import dev.orb.app.ui.kit.OrbSheetItem
import dev.orb.app.ui.kit.OrbSheetLabel
import dev.orb.app.ui.kit.OrbSwitch
import dev.orb.app.ui.kit.OrbUnread
import dev.orb.app.ui.kit.OrbWordmark
import dev.orb.app.ui.tasks.TaskFilter
import dev.orb.app.ui.tasks.TaskTexts
import dev.orb.app.ui.thisphone.RouteKind

/**
 * What the menu shows. An entry whose PC method is not listed is not offered at all. Juegos (a local web view) and
 * Tutoriales (native) work without a connection, so they are always offered; Pizarra (also a local web view) needs
 * the PC's methods, because its drawing lives there.
 */
class MenuState(
    val pcName: String?,
    val connection: ConnectionState,
    /** The numbers of the bottom bar, repeated beside Chats and Tareas. */
    val unreadChats: Int = 0,
    val tasksToApprove: Int = 0,
    val showSchedules: Boolean = true,
    val showActivity: Boolean = true,
    val showUsage: Boolean = true,
    val showWhiteboard: Boolean = true,
    /** What the screen shows now, dark (true) or light (false), even when it follows the system; null leaves the switch out. */
    val dark: Boolean? = null,
    /** What the chat list offers that the mockup does not draw; null when the menu is not opened from the list. */
    val inbox: InboxMenu? = null,
    /** What the task board offers that the mockup does not draw; null when the phone has no task board. */
    val tasks: TasksMenu? = null,
)

/** The list's ordering and the day summary, which live under «Más opciones» now that the Chats bar has no «⋮». */
class InboxMenu(val priority: Boolean, val canDigest: Boolean)

/**
 * The board's search, new task, pausing the queue and what it shows, which live under «Más opciones» now that the Tareas bar
 * has no «⋮». [view] is what the board shows now; the entries offer the other two.
 */
class TasksMenu(val view: TaskFilter, val canCreate: Boolean, val canPause: Boolean)

class MenuActions(
    val onChats: () -> Unit = {},
    val onTasks: () -> Unit = {},
    val onProjects: () -> Unit = {},
    val onSchedules: () -> Unit = {},
    val onActivity: () -> Unit = {},
    val onUsage: () -> Unit = {},
    val onWhiteboard: () -> Unit = {},
    val onGames: () -> Unit = {},
    val onTutorials: () -> Unit = {},
    val onThisPhone: () -> Unit = {},
    /** The switch «Modo oscuro»: true forces dark, false forces light. */
    val onDark: (Boolean) -> Unit = {},
    val onPriority: () -> Unit = {},
    val onReorder: () -> Unit = {},
    val onDigest: () -> Unit = {},
    val onTasksSearch: () -> Unit = {},
    val onTasksNew: () -> Unit = {},
    val onTasksPause: () -> Unit = {},
    val onTasksView: (TaskFilter) -> Unit = {},
)

/** The ☰ menu: how the link stands on top, then where to go. Every choice but the switch closes the sheet first, then goes where it leads. */
@Composable
fun MenuSheet(state: MenuState, actions: MenuActions, onDismiss: () -> Unit) {
    OrbSheet(onDismiss, header = { MenuHeader(state) }) { MenuContent(state, actions, onDismiss, scroll = false) }
}

/** `.sh`: the mark on the left and the state of the link on the right. */
@Composable
private fun RowScope.MenuHeader(state: MenuState) {
    OrbWordmark(withE = false)
    Spacer(Modifier.weight(1f))
    when (state.connection) {
        is ConnectionState.Online -> OrbBadge(MenuTexts.CONNECTED, kind = OrbBadgeKind.Ok)
        ConnectionState.Connecting -> OrbBadge(MenuTexts.CONNECTING)
        else -> OrbBadge(MenuTexts.OFFLINE, kind = OrbBadgeKind.Warn)
    }
}

/** The line under the header: the PC and the way to it («DanLaptop · Tailscale»), or why it cannot be reached. */
fun menuStatusLine(state: MenuState): String {
    val pc = state.pcName?.takeIf { it.isNotBlank() } ?: "PC"
    return when (val c = state.connection) {
        is ConnectionState.Online -> "$pc · ${RouteKind.of(c.base)?.label ?: MenuTexts.CONNECTED}"
        is ConnectionState.Offline -> "$pc · ${MenuTexts.OFFLINE_LINE}"
        ConnectionState.Connecting -> pc
        else -> connectionText(c)
    }
}

/** [scroll] is false inside [OrbSheet], which scrolls its own body. */
@Composable
fun MenuContent(state: MenuState, actions: MenuActions, close: () -> Unit, scroll: Boolean = true) {
    fun go(f: () -> Unit): () -> Unit = { close(); f() }
    Column(
        Modifier.fillMaxWidth().then(if (scroll) Modifier.verticalScroll(rememberScrollState()) else Modifier).navigationBarsPadding().padding(bottom = 16.dp),
    ) {
        Text(menuStatusLine(state), Modifier.padding(horizontal = 20.dp), color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp)

        Counted(MenuTexts.CHATS, go(actions.onChats), OrbIcons.Chats, state.unreadChats)
        Counted(MenuTexts.TASKS, go(actions.onTasks), OrbIcons.Tasks, state.tasksToApprove)
        OrbSheetItem(MenuTexts.PROJECTS, go(actions.onProjects), icon = OrbIcons.FolderGit2)
        OrbSheetDivider()
        if (state.showSchedules) OrbSheetItem(MenuTexts.SCHEDULES, go(actions.onSchedules), icon = OrbIcons.CalendarClock)
        if (state.showWhiteboard) OrbSheetItem(MenuTexts.WHITEBOARD, go(actions.onWhiteboard), icon = OrbIcons.Presentation, meta = MenuTexts.PHONE_VIEW)
        if (state.showActivity) OrbSheetItem(MenuTexts.ACTIVITY, go(actions.onActivity), icon = OrbIcons.Activity)
        if (state.showUsage) OrbSheetItem(MenuTexts.USAGE, go(actions.onUsage), icon = OrbIcons.Gauge)
        OrbSheetItem(MenuTexts.GAMES, go(actions.onGames), icon = OrbIcons.Gamepad2, meta = MenuTexts.PHONE_VIEW)
        OrbSheetItem(MenuTexts.TUTORIALS, go(actions.onTutorials), icon = OrbIcons.GraduationCap, meta = MenuTexts.PHONE_VIEW)
        OrbSheetDivider()
        OrbSheetItem(MenuTexts.THIS_PHONE, go(actions.onThisPhone), icon = OrbIcons.Smartphone)
        state.dark?.let { dark ->
            // The whole row is the switch, announced as one; the sheet stays open so the change is seen at once.
            Row(
                Modifier.fillMaxWidth().defaultMinSize(minHeight = 52.dp).toggleable(value = dark, role = Role.Switch, onValueChange = actions.onDark)
                    .padding(start = 20.dp, end = 8.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Icon(OrbIcons.Moon, null, Modifier.size(20.dp), tint = OrbKit.mutedForeground)
                Text(MenuTexts.DARK_MODE, Modifier.weight(1f), color = OrbKit.foreground, fontSize = 15.sp, lineHeight = 22.sp)
                OrbSwitch(dark, null)
            }
        }

        // What the mockups do not draw but the phone keeps: it goes last, under its own label.
        if (state.inbox != null || state.tasks != null) OrbSheetLabel(MenuTexts.MORE_OPTIONS)
        state.inbox?.let { inbox ->
            OrbSheetItem(
                ChatTexts.ORDER_PRIORITY, go(actions.onPriority), icon = OrbIcons.ListOrdered,
                meta = if (inbox.priority) ChatTexts.ORDER_PRIORITY_ON else ChatTexts.ORDER_PRIORITY_OFF,
            )
            if (inbox.priority) OrbSheetItem(InboxTexts.current().reorder, go(actions.onReorder), icon = OrbIcons.ArrowUp)
            if (inbox.canDigest) OrbSheetItem(ChatTexts.DAY_SUMMARY, go(actions.onDigest), icon = OrbIcons.Activity)
        }
        state.tasks?.let { tasks ->
            OrbSheetItem(TaskTexts.SEARCH, go(actions.onTasksSearch), icon = OrbIcons.Search)
            if (tasks.canCreate) OrbSheetItem(TaskTexts.NEW_TASK, go(actions.onTasksNew), icon = OrbIcons.Plus)
            if (tasks.canPause) OrbSheetItem(TaskTexts.PAUSE, go(actions.onTasksPause), icon = OrbIcons.Pause)
            // The two views the board is not showing: «Activas» is where it starts, so there is always a way back to it.
            if (tasks.view != TaskFilter.Active) OrbSheetItem(TaskTexts.SEE_ACTIVE, go { actions.onTasksView(TaskFilter.Active) }, icon = OrbIcons.Tasks)
            if (tasks.view != TaskFilter.Done) OrbSheetItem(TaskTexts.SEE_DONE, go { actions.onTasksView(TaskFilter.Done) }, icon = OrbIcons.CircleCheck)
            if (tasks.view != TaskFilter.All) OrbSheetItem(TaskTexts.SEE_ALL_TASKS, go { actions.onTasksView(TaskFilter.All) }, icon = OrbIcons.Tasks)
        }
    }
}

/** A row of the sheet with the soft count bubble of the bottom bar at its end. */
@Composable
private fun Counted(text: String, onClick: () -> Unit, icon: ImageVector, count: Int) {
    OrbSheetItem(text, onClick, icon = icon, trailing = if (count > 0) ({ OrbUnread(count, soft = true) }) else null)
}

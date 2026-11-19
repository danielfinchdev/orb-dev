package dev.orb.app.ui.menu

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.ui.chats.ChatTexts
import dev.orb.app.ui.chats.InboxTexts
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbSheetItem
import dev.orb.app.ui.kit.OrbSheetLabel
import dev.orb.app.ui.tasks.TaskFilter
import dev.orb.app.ui.tasks.TaskTexts
import dev.orb.app.ui.theme.OrbFonts

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
    val onTasksSearch: () -> Unit = {},
    val onTasksNew: () -> Unit = {},
    val onTasksPause: () -> Unit = {},
    val onTasksView: (TaskFilter) -> Unit = {},
)

/** The ☰ menu of the Chats bar. Every choice closes the sheet first, then goes where it leads. */
@Composable
fun MenuSheet(state: MenuState, actions: MenuActions, onDismiss: () -> Unit) {
    OrbSheet(onDismiss) { MenuContent(state, actions, onDismiss, scroll = false) }
}

/** [scroll] is false inside [OrbSheet], which scrolls its own body. */
@Composable
fun MenuContent(state: MenuState, actions: MenuActions, close: () -> Unit, scroll: Boolean = true) {
    fun go(f: () -> Unit): () -> Unit = { close(); f() }
    Column(
        Modifier.fillMaxWidth().then(if (scroll) Modifier.verticalScroll(rememberScrollState()) else Modifier).navigationBarsPadding().padding(bottom = 16.dp),
    ) {
        Text(
            MenuTexts.MENU, Modifier.padding(horizontal = 20.dp, vertical = 4.dp).semantics { heading() }, color = OrbKit.foreground, fontSize = 20.sp,
            lineHeight = 28.sp, fontFamily = OrbFonts.title,
        )
        Text(state.pcLabel, Modifier.padding(horizontal = 20.dp, vertical = 2.dp), color = OrbKit.mutedForeground, fontSize = 14.sp, lineHeight = 20.sp)

        OrbSheetLabel(MenuTexts.SECTION_WORK)
        OrbSheetItem(MenuTexts.NOTICES, go(actions.onNotices), icon = OrbIcons.Bell, meta = state.unreadNotices.takeIf { it > 0 }?.let { if (it > 99) "99+" else it.toString() })
        if (state.showSchedules) OrbSheetItem(MenuTexts.SCHEDULES, go(actions.onSchedules), icon = OrbIcons.Clock)
        if (state.showActivity) OrbSheetItem(MenuTexts.ACTIVITY, go(actions.onActivity), icon = OrbIcons.Activity)
        if (state.showUsage) OrbSheetItem(MenuTexts.USAGE, go(actions.onUsage), icon = OrbIcons.Gauge)
        if (state.showWhiteboard) OrbSheetItem(MenuTexts.WHITEBOARD, go(actions.onWhiteboard), icon = OrbIcons.PenTool)
        OrbSheetItem(MenuTexts.GAMES, go(actions.onGames), icon = OrbIcons.Gamepad2)
        OrbSheetItem(MenuTexts.TUTORIALS, go(actions.onTutorials), icon = OrbIcons.GraduationCap)

        OrbSheetLabel(MenuTexts.SECTION_SETTINGS)
        OrbSheetItem(MenuTexts.THIS_PHONE, go(actions.onThisPhone), icon = OrbIcons.Smartphone)
        OrbSheetItem(MenuTexts.APPEARANCE, go(actions.onAppearance), icon = OrbIcons.Palette)
        OrbSheetItem(MenuTexts.LINK_TEST, go(actions.onLinkTest), icon = OrbIcons.Activity)
        OrbSheetItem(MenuTexts.UNLINK, go(actions.onUnlink), icon = OrbIcons.LogOut, danger = true)

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

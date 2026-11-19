package dev.orb.app.ui.shell

import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.NavDestination.Companion.hasRoute
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.chats.ChatListScreen
import dev.orb.app.ui.chats.ChatListViewModel
import dev.orb.app.ui.chats.ChatRef
import dev.orb.app.ui.chats.ChatTexts
import dev.orb.app.ui.chats.ChatsBackend
import dev.orb.app.ui.chats.ChatsMenu
import dev.orb.app.ui.menu.MenuActions
import dev.orb.app.ui.menu.InboxMenu
import dev.orb.app.ui.menu.MenuSheet
import dev.orb.app.ui.menu.TasksMenu
import dev.orb.app.ui.chats.ChatOrder
import dev.orb.app.ui.menu.MenuState
import dev.orb.app.ui.notes.NotesBackend
import dev.orb.app.ui.notes.NotesViewModel
import dev.orb.app.ui.chats.Message
import dev.orb.app.ui.connectionText
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbBottomBar
import dev.orb.app.ui.kit.OrbTab
import dev.orb.app.ui.offline.LocalReadOnly
import dev.orb.app.ui.offline.ReadOnlyBar
import dev.orb.app.ui.theme.DarkMode
import dev.orb.app.ui.theme.OrbMotion
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.ThemePrefs
import dev.orb.app.ui.projects.ProjectsBackend
import dev.orb.app.ui.projects.ProjectsScreen
import dev.orb.app.ui.projects.ProjectsViewModel
import dev.orb.app.ui.tasks.TaskFilter
import dev.orb.app.ui.tasks.TasksBackend
import dev.orb.app.ui.tasks.TasksScreen
import dev.orb.app.ui.tasks.TasksViewModel
import kotlinx.serialization.Serializable

@Serializable data object ChatsTab
@Serializable data object TasksTab
@Serializable data object ProjectsTab

private class Tab(val route: Any, val label: String, val icon: ImageVector)

private val tabs = listOf(
    Tab(ChatsTab, ChatTexts.TAB_CHATS, OrbIcons.Chats),
    Tab(TasksTab, ChatTexts.TAB_TASKS, OrbIcons.Tasks),
    Tab(ProjectsTab, ChatTexts.TAB_PROJECTS, OrbIcons.FolderGit2),
)

/** What the shell hands back to the app's navigation. */
class ShellActions(
    val onOpenChat: (ChatRef) -> Unit,
    val onSearch: () -> Unit,
    val onNewChat: () -> Unit,
    val onOpenTask: (Long) -> Unit = {},
    val onOpenProject: (String) -> Unit = {},
    val onNotices: () -> Unit = {},
    val onSchedules: () -> Unit = {},
    val onActivity: () -> Unit = {},
    val onUsage: () -> Unit = {},
    val onWhiteboard: () -> Unit = {},
    val onGames: () -> Unit = {},
    val onTutorials: () -> Unit = {},
    val onThisPhone: () -> Unit = {},
    /** Which menu entries the linked PC can serve; an entry it cannot is left out. */
    val menu: MenuAvailability = MenuAvailability(),
)

class MenuAvailability(val schedules: Boolean = true, val activity: Boolean = true, val usage: Boolean = true, val whiteboard: Boolean = true)

/** The three tabs. Each keeps its own state while the others are shown. */
@Composable
fun MainShell(
    backend: ChatsBackend, actions: ShellActions,
    // Where the list is grouped; tests run it inline.
    listDispatcher: kotlinx.coroutines.CoroutineDispatcher = kotlinx.coroutines.Dispatchers.Default,
    tasks: TasksBackend? = null,
    projects: ProjectsBackend? = null,
    notes: NotesBackend? = null,
    // The linked PC's name, which the menu names under its header.
    pcName: String? = null,
    // Where the menu's «Modo oscuro» switch writes; without it the switch is left out.
    theme: ThemePrefs? = null,
) {
    val shell = viewModel<ShellViewModel>(factory = viewModelFactory { initializer { ShellViewModel(backend, tasks) } })
    val unread by shell.unreadChats.collectAsStateWithLifecycle()
    val toApprove by shell.tasksToApprove.collectAsStateWithLifecycle()
    val connection by backend.connection.collectAsStateWithLifecycle()
    // The notices list lives in the backend, so the bell counts even while the center is closed.
    val noticesVm = notes?.let { viewModel<NotesViewModel>(factory = viewModelFactory { initializer { NotesViewModel(it) } }) }
    val unreadNotices = noticesVm?.state?.collectAsStateWithLifecycle()?.value?.unread ?: 0
    var menuOpen by rememberSaveable { mutableStateOf(false) }
    // The list's view model lives here because its ordering and day summary are choices of the ☰ menu.
    val chatsVm = viewModel<ChatListViewModel>(factory = viewModelFactory { initializer { ChatListViewModel(backend, dispatcher = listDispatcher) } })
    val chatsState by chatsVm.state.collectAsStateWithLifecycle()
    val nav = rememberNavController()
    val current by nav.currentBackStackEntryAsState()
    val fade = OrbMotion.Short
    // The board's view model lives here too: its search, new task, pause and view are choices of the ☰ menu.
    val tasksVm = tasks?.let { viewModel<TasksViewModel>(factory = viewModelFactory { initializer { TasksViewModel(it) } }) }
    val tasksState = tasksVm?.state?.collectAsStateWithLifecycle()?.value
    // An entry of the menu that belongs to the board takes the person to it first.
    fun openTasks() = nav.navigate(TasksTab) {
        popUpTo(nav.graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }

    // A choice of the menu that is one of the three tabs goes where the bottom bar would.
    fun openTab(route: Any) = nav.navigate(route) {
        popUpTo(nav.graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
    val look = theme?.settings?.collectAsStateWithLifecycle()?.value
    val systemDark = isSystemInDarkTheme()

    if (menuOpen) {
        MenuSheet(
            MenuState(
                pcName, connection, unread, toApprove, actions.menu.schedules, actions.menu.activity, actions.menu.usage, actions.menu.whiteboard,
                dark = look?.let { when (it.dark) { DarkMode.Dark -> true; DarkMode.Light -> false; DarkMode.System -> systemDark } },
                inbox = InboxMenu(chatsState.order == ChatOrder.Priority, chatsState.canDigest),
                tasks = tasksState?.let { TasksMenu(it.filter, it.canCreate, it.canPause && !it.paused && it.online) },
            ),
            MenuActions(
                onChats = { openTab(ChatsTab) }, onTasks = { openTab(TasksTab) }, onProjects = { openTab(ProjectsTab) },
                onSchedules = actions.onSchedules, onActivity = actions.onActivity, onUsage = actions.onUsage, onWhiteboard = actions.onWhiteboard, onGames = actions.onGames, onTutorials = actions.onTutorials,
                onThisPhone = actions.onThisPhone,
                // From «según el sistema» the switch shows what is on screen and a touch forces the opposite.
                onDark = { on -> theme?.setDark(if (on) DarkMode.Dark else DarkMode.Light) },
                onPriority = { chatsVm.setOrder(if (chatsState.order == ChatOrder.Priority) ChatOrder.Recent else ChatOrder.Priority) },
                onReorder = chatsVm::reorder, onDigest = chatsVm::showDigest,
                onTasksSearch = { openTasks(); tasksVm?.openSearch() }, onTasksNew = { openTasks(); tasksVm?.openNewTask() },
                onTasksPause = { openTasks(); tasksVm?.setPaused(true) }, onTasksView = { f: TaskFilter -> openTasks(); tasksVm?.setFilter(f) },
            ),
            onDismiss = { menuOpen = false },
        )
    }

    Scaffold(
        containerColor = Color.Transparent,
        bottomBar = {
            OrbNavigationBar(
                selected = { tab -> current?.destination?.hasRoute(tab.route::class) == true },
                unread = unread, toApprove = toApprove,
                onSelect = { tab ->
                    nav.navigate(tab.route) {
                        popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
                    }
                },
            )
        },
    ) { padding ->
        val readOnly = LocalReadOnly.current
        Column(Modifier.padding(padding)) {
            // The saved chats list draws its own read-only header; the other tabs keep theirs and get the note above.
            if (readOnly != null && current?.destination?.hasRoute(ChatsTab::class) != true) ReadOnlyBar(readOnly.info, readOnly.onBack)
            NavHost(
                nav, startDestination = ChatsTab, modifier = Modifier.weight(1f),
                enterTransition = { fadeIn(tween(fade, easing = OrbMotion.EaseOut)) },
                exitTransition = { fadeOut(tween(fade, easing = OrbMotion.EaseIn)) },
            ) {
                composable<ChatsTab> {
                    ChatListScreen(
                        chatsVm, ChatsMenu(onMenu = { menuOpen = true }, unreadNotices = unreadNotices, onNotices = actions.onNotices.takeIf { notes != null }),
                        onOpenChat = actions.onOpenChat, onSearch = actions.onSearch, onNewChat = actions.onNewChat, readOnly = readOnly,
                    )
                }
                composable<TasksTab> {
                    if (tasksVm == null) Message(ChatTexts.SOON_TASKS, ChatTexts.SOON_HINT) else {
                        TasksScreen(
                            tasksVm, ChatsMenu(onMenu = { menuOpen = true }, unreadNotices = unreadNotices, onNotices = actions.onNotices.takeIf { notes != null }),
                            onOpenTask = actions.onOpenTask,
                        )
                    }
                }
                composable<ProjectsTab> {
                    if (projects == null) Message(ChatTexts.SOON_PROJECTS, ChatTexts.SOON_HINT) else {
                        val vm = viewModel<ProjectsViewModel>(factory = viewModelFactory { initializer { ProjectsViewModel(projects) } })
                        ProjectsScreen(
                            vm, onOpenProject = actions.onOpenProject,
                            menu = ChatsMenu(onMenu = { menuOpen = true }, unreadNotices = unreadNotices, onNotices = actions.onNotices.takeIf { notes != null }),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun OrbNavigationBar(selected: (Tab) -> Boolean, unread: Int, toApprove: Int, onSelect: (Tab) -> Unit) {
    val items = tabs.map { tab ->
        OrbTab(
            tab.label, tab.label, tab.icon,
            count = when (tab.route) { ChatsTab -> unread; TasksTab -> toApprove; else -> 0 },
        )
    }
    val current = tabs.firstOrNull(selected)?.label
    OrbBottomBar(items, current ?: "", onSelect = { item -> tabs.first { it.label == item.key }.let(onSelect) })
}

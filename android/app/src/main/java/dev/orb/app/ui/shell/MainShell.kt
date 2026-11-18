package dev.orb.app.ui.shell

import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
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
import dev.orb.app.ui.menu.MenuSheet
import dev.orb.app.ui.menu.MenuState
import dev.orb.app.ui.notes.NotesBackend
import dev.orb.app.ui.notes.NotesViewModel
import dev.orb.app.ui.chats.Message
import dev.orb.app.ui.connectionText
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.theme.OrbMotion
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.projects.ProjectsBackend
import dev.orb.app.ui.projects.ProjectsScreen
import dev.orb.app.ui.projects.ProjectsViewModel
import dev.orb.app.ui.tasks.TasksBackend
import dev.orb.app.ui.tasks.TasksScreen
import dev.orb.app.ui.tasks.TasksViewModel
import kotlinx.serialization.Serializable

@Serializable data object ChatsTab
@Serializable data object TasksTab
@Serializable data object ProjectsTab

private class Tab(val route: Any, val label: String, val icon: ImageVector)

private val tabs = listOf(
    Tab(ChatsTab, ChatTexts.TAB_CHATS, OrbIcons.Chat),
    Tab(TasksTab, ChatTexts.TAB_TASKS, OrbIcons.Tasks),
    Tab(ProjectsTab, ChatTexts.TAB_PROJECTS, OrbIcons.Folder),
)

/** What the shell hands back to the app's navigation. */
class ShellActions(
    val onOpenChat: (ChatRef) -> Unit,
    val onSearch: () -> Unit,
    val onNewChat: () -> Unit,
    val onAppearance: () -> Unit,
    val onLinkTest: () -> Unit,
    val onUnlink: () -> Unit,
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
) {
    val shell = viewModel<ShellViewModel>(factory = viewModelFactory { initializer { ShellViewModel(backend) } })
    val unread by shell.unreadChats.collectAsStateWithLifecycle()
    val connection by backend.connection.collectAsStateWithLifecycle()
    // The notices list lives in the backend, so the bell counts even while the center is closed.
    val noticesVm = notes?.let { viewModel<NotesViewModel>(factory = viewModelFactory { initializer { NotesViewModel(it) } }) }
    val unreadNotices = noticesVm?.state?.collectAsStateWithLifecycle()?.value?.unread ?: 0
    var menuOpen by rememberSaveable { mutableStateOf(false) }
    val nav = rememberNavController()
    val current by nav.currentBackStackEntryAsState()
    val fade = OrbMotion.Short

    if (menuOpen) {
        MenuSheet(
            MenuState(connectionText(connection), unreadNotices, actions.menu.schedules, actions.menu.activity, actions.menu.usage, actions.menu.whiteboard),
            MenuActions(
                onNotices = actions.onNotices, onSchedules = actions.onSchedules, onActivity = actions.onActivity, onUsage = actions.onUsage, onWhiteboard = actions.onWhiteboard, onGames = actions.onGames, onTutorials = actions.onTutorials,
                onThisPhone = actions.onThisPhone, onAppearance = actions.onAppearance, onLinkTest = actions.onLinkTest, onUnlink = actions.onUnlink,
            ),
            onDismiss = { menuOpen = false },
        )
    }

    Scaffold(
        containerColor = Color.Transparent,
        bottomBar = {
            OrbNavigationBar(
                selected = { tab -> current?.destination?.hasRoute(tab.route::class) == true },
                unread = unread,
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
        NavHost(
            nav, startDestination = ChatsTab, modifier = Modifier.padding(padding),
            enterTransition = { fadeIn(tween(fade, easing = OrbMotion.EaseOut)) },
            exitTransition = { fadeOut(tween(fade, easing = OrbMotion.EaseIn)) },
        ) {
            composable<ChatsTab> {
                val vm = viewModel<ChatListViewModel>(factory = viewModelFactory { initializer { ChatListViewModel(backend, dispatcher = listDispatcher) } })
                ChatListScreen(
                    vm, ChatsMenu(onMenu = { menuOpen = true }, unreadNotices = unreadNotices, onNotices = actions.onNotices.takeIf { notes != null }),
                    onOpenChat = actions.onOpenChat, onSearch = actions.onSearch, onNewChat = actions.onNewChat,
                )
            }
            composable<TasksTab> {
                if (tasks == null) Message(ChatTexts.SOON_TASKS, ChatTexts.SOON_HINT) else {
                    val vm = viewModel<TasksViewModel>(factory = viewModelFactory { initializer { TasksViewModel(tasks) } })
                    TasksScreen(vm, onOpenTask = actions.onOpenTask)
                }
            }
            composable<ProjectsTab> {
                if (projects == null) Message(ChatTexts.SOON_PROJECTS, ChatTexts.SOON_HINT) else {
                    val vm = viewModel<ProjectsViewModel>(factory = viewModelFactory { initializer { ProjectsViewModel(projects) } })
                    ProjectsScreen(vm, onOpenProject = actions.onOpenProject)
                }
            }
        }
    }
}

@Composable
private fun OrbNavigationBar(selected: (Tab) -> Boolean, unread: Int, onSelect: (Tab) -> Unit) {
    NavigationBar(containerColor = androidx.compose.material3.MaterialTheme.colorScheme.surfaceContainerLow) {
        for (tab in tabs) {
            NavigationBarItem(
                selected = selected(tab), onClick = { onSelect(tab) }, label = { Text(tab.label) },
                icon = {
                    if (tab.route == ChatsTab && unread > 0) {
                        BadgedBox(badge = { Badge { Text(unread.toString()) } }) { Icon(tab.icon, null) }
                    } else Icon(tab.icon, null)
                },
                colors = NavigationBarItemDefaults.colors(
                    indicatorColor = androidx.compose.material3.MaterialTheme.colorScheme.primaryContainer,
                    selectedIconColor = androidx.compose.material3.MaterialTheme.colorScheme.onPrimaryContainer,
                ),
            )
        }
    }
}

@Composable
fun UnlinkDialog(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(ChatTexts.UNLINK_TITLE) },
        text = { Text(ChatTexts.UNLINK_BODY) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(ChatTexts.UNLINK_CONFIRM) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(ChatTexts.CANCEL) } },
    )
}

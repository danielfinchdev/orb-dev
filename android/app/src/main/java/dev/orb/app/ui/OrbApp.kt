package dev.orb.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.settings.AppearanceSheet
import dev.orb.app.ui.theme.OrbBackground
import dev.orb.app.ui.theme.OrbTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import dev.orb.app.AppContainer
import androidx.compose.runtime.LaunchedEffect
import dev.orb.app.ui.chats.ChatTexts
import dev.orb.app.ui.chats.NewChatScreen
import dev.orb.app.ui.chats.NewChatViewModel
import dev.orb.app.ui.chats.DirectChatScreen
import dev.orb.app.ui.chats.DirectChatViewModel
import dev.orb.app.ui.chats.SearchScreen
import dev.orb.app.ui.chats.OrbeChatScreen
import dev.orb.app.ui.chats.OrbeChatViewModel
import dev.orb.app.ui.theme.OrbMotion
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.navigation.toRoute
import dev.orb.app.ui.chats.SearchViewModel
import dev.orb.app.ui.shell.MainShell
import dev.orb.app.ui.projects.PrDetailScreen
import dev.orb.app.ui.projects.PrDetailViewModel
import dev.orb.app.ui.projects.PrListScreen
import dev.orb.app.ui.projects.PrListViewModel
import dev.orb.app.ui.projects.ProjectDetailScreen
import dev.orb.app.ui.projects.ProjectDetailViewModel
import dev.orb.app.ui.tasks.TaskDetailScreen
import dev.orb.app.ui.tasks.TaskDetailViewModel
import dev.orb.app.ui.tasks.TaskDiffScreen
import dev.orb.app.ui.tasks.TaskDiffViewModel
import dev.orb.app.ui.shell.ShellActions
import dev.orb.app.ui.shell.MenuAvailability
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.ui.menu.ActivityScreen
import dev.orb.app.ui.menu.ActivityViewModel
import dev.orb.app.ui.notes.NoticeTarget
import dev.orb.app.ui.notes.NotesScreen
import dev.orb.app.ui.notes.NotesViewModel
import dev.orb.app.ui.schedules.SchedulesScreen
import dev.orb.app.ui.schedules.SchedulesViewModel
import dev.orb.app.ui.usage.UsageScreen
import dev.orb.app.ui.thisphone.RuntimeThisPhoneBackend
import dev.orb.app.ui.thisphone.ThisPhoneScreen
import dev.orb.app.ui.thisphone.ThisPhoneViewModel
import dev.orb.app.ui.usage.UsageViewModel
import dev.orb.app.ui.shell.UnlinkDialog
import dev.orb.app.ui.home.HomeViewModel
import dev.orb.app.ui.linktest.LinkTestScreen
import dev.orb.app.ui.linktest.LinkTestViewModel
import dev.orb.app.ui.welcome.WelcomeScreen
import dev.orb.app.ui.welcome.WelcomeViewModel
import dev.orb.app.attach.AttachTexts
import dev.orb.app.share.ShareRequest
import dev.orb.app.ui.share.ShareDest
import dev.orb.app.ui.share.ShareScreen
import dev.orb.app.ui.share.ShareViewModel
import kotlinx.serialization.Serializable

@Serializable data object Welcome
@Serializable data object Home
@Serializable data object LinkTest
@Serializable data object Search
@Serializable data object NewChat

/** An Orbe conversation (`kind` = conversation) or a direct chat with an agent (`kind` = session). */
@Serializable data class ChatRoute(val kind: String, val id: String)
@Serializable data class TaskRoute(val id: Long)
@Serializable data class TaskChangesRoute(val id: Long)
@Serializable data class ProjectRoute(val name: String)
@Serializable data class PrListRoute(val name: String)
@Serializable data class PrRoute(val name: String, val number: Int)
@Serializable data object NoticesRoute
@Serializable data object SchedulesRoute
@Serializable data object ActivityRoute
@Serializable data object UsageRoute
@Serializable data object ThisPhoneRoute
@Serializable data class ShareRoute(val id: Long)

@Composable
fun OrbApp(container: AppContainer) {
    val theme by container.themePrefs.settings.collectAsStateWithLifecycle()
    OrbTheme(theme) {
        // Transparent so Cristal's colour field shows through; Surface still provides the content colour.
        OrbBackground { Surface(modifier = Modifier.fillMaxSize(), color = Color.Transparent) {
            // The saved link is read off the main thread; until it is known there is nothing to show.
            val linked by produceState<Boolean?>(null, container) { value = container.startup.await() }
            if (linked == null) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            } else {
                // Decided once at launch; a restored back stack wins over it after a rotation.
                val start: Any = remember { if (container.runtime.value != null) Home else Welcome }
                Box(Modifier.fillMaxSize()) {
                    OrbNav(container, start)
                    ShareWaiting(container, Modifier.align(Alignment.TopCenter).systemBarsPadding())
                }
            }
        } }
    }
}

@Composable
private fun OrbNav(container: AppContainer, start: Any) {
    val nav = rememberNavController()
    var appearance by rememberSaveable { mutableStateOf(false) }
    if (appearance) AppearanceSheet(container.themePrefs, onDismiss = { appearance = false })
    OpenFromNotice(container, nav)
    OpenShare(container, nav)
    NavHost(
        navController = nav, startDestination = start, modifier = Modifier.systemBarsPadding(),
        // A short slide with a fade: the chat opens from the side the list sits on.
        enterTransition = { slideInHorizontally(OrbMotion.standard(OrbMotion.Medium)) { it / 5 } + fadeIn(OrbMotion.standard(OrbMotion.Medium)) },
        exitTransition = { slideOutHorizontally(OrbMotion.standard(OrbMotion.Medium)) { -it / 8 } + fadeOut(OrbMotion.standard(OrbMotion.Short)) },
        popEnterTransition = { slideInHorizontally(OrbMotion.standard(OrbMotion.Medium)) { -it / 8 } + fadeIn(OrbMotion.standard(OrbMotion.Medium)) },
        popExitTransition = { slideOutHorizontally(OrbMotion.standard(OrbMotion.Medium)) { it / 5 } + fadeOut(OrbMotion.standard(OrbMotion.Short)) },
    ) {
        composable<Welcome> {
            val vm = viewModel<WelcomeViewModel>(factory = viewModelFactory {
                initializer { WelcomeViewModel(container.linker, container.deviceName, onLinked = container::linkWith) }
            })
            WelcomeScreen(vm, onLinked = { nav.navigate(Home) { popUpTo(Welcome) { inclusive = true } } })
        }
        composable<Home> {
            val backend = remember { container.chatsBackend() }
            val home = viewModel<HomeViewModel>(factory = viewModelFactory { initializer { HomeViewModel(container) } })
            val homeState by home.state.collectAsStateWithLifecycle()
            var confirming by rememberSaveable { mutableStateOf(false) }
            LaunchedEffect(homeState.unlinked) { if (homeState.unlinked) nav.navigate(Welcome) { popUpTo(Home) { inclusive = true } } }
            if (backend != null) {
                val tasksBackend = remember { container.tasksBackend() }
                val projectsBackend = remember { container.projectsBackend() }
                val notesBackend = remember { container.notesBackend() }
                val menuAvailable = remember {
                    MenuAvailability(
                        schedules = container.schedulesBackend()?.available(ApiMethods.SCHEDULES_LIST) == true,
                        activity = container.activityBackend()?.let { it.available(ApiMethods.ACTIVITY_LIST) || it.available(ApiMethods.LOGS_LIST) } == true,
                        usage = container.usageBackend()?.let { it.available(ApiMethods.USAGE_GET) || it.available(ApiMethods.AGENTS_STATUS) } == true,
                    )
                }
                MainShell(
                    backend, container.themePrefs,
                    ShellActions(
                        onOpenChat = { nav.navigate(ChatRoute(it.kind.wire, it.id)) },
                        onSearch = { nav.navigate(Search) },
                        onNewChat = { nav.navigate(NewChat) },
                        onAppearance = { appearance = true },
                        onLinkTest = { nav.navigate(LinkTest) },
                        onUnlink = { confirming = true },
                        onOpenTask = { nav.navigate(TaskRoute(it)) },
                        onOpenProject = { nav.navigate(ProjectRoute(it)) },
                        onNotices = { nav.navigate(NoticesRoute) },
                        onSchedules = { nav.navigate(SchedulesRoute) },
                        onActivity = { nav.navigate(ActivityRoute) },
                        onUsage = { nav.navigate(UsageRoute) },
                        onThisPhone = { nav.navigate(ThisPhoneRoute) },
                        menu = menuAvailable,
                    ),
                    tasks = tasksBackend,
                    projects = projectsBackend,
                    notes = notesBackend,
                )
            }
            if (confirming) UnlinkDialog(onConfirm = { confirming = false; home.unlink() }, onDismiss = { confirming = false })
        }
        composable<Search> {
            val backend = remember { container.chatsBackend() }
            if (backend != null) {
                val vm = viewModel<SearchViewModel>(factory = viewModelFactory { initializer { SearchViewModel(backend) } })
                SearchScreen(vm, onBack = { nav.popBackStack() }, onOpenChat = { nav.navigate(ChatRoute(it.kind.wire, it.id)) })
            }
        }
        composable<NewChat>(
            // A sheet-like screen: it rises from below and goes back down, unlike the side-by-side chat screens.
            enterTransition = { slideInVertically(OrbMotion.standard(OrbMotion.Medium)) { it / 6 } + fadeIn(OrbMotion.standard(OrbMotion.Medium)) },
            popExitTransition = { slideOutVertically(OrbMotion.standard(OrbMotion.Medium)) { it / 6 } + fadeOut(OrbMotion.standard(OrbMotion.Short)) },
        ) {
            val backend = remember { container.newChatBackend() }
            if (backend != null) {
                val vm = viewModel<NewChatViewModel>(factory = viewModelFactory { initializer { NewChatViewModel(backend) } })
                NewChatScreen(
                    vm, onClose = { nav.popBackStack() },
                    // The new chat takes the place of this screen, so back from it returns to the list.
                    onCreated = { nav.navigate(ChatRoute(it.kind, it.id)) { popUpTo<NewChat> { inclusive = true } } },
                )
            }
        }
        composable<ChatRoute> { entry ->
            val route = entry.toRoute<ChatRoute>()
            val conversation = route.id.toLongOrNull()
            val backend = remember { container.orbeChatBackend() }
            if (route.kind == "conversation" && conversation != null && backend != null) {
                val vm = viewModel<OrbeChatViewModel>(key = "orbe:$conversation", factory = viewModelFactory { initializer { OrbeChatViewModel(backend, conversation, attach = container.attachController()) } })
                OrbeChatScreen(vm, onBack = { nav.popBackStack() })
            } else if (route.kind == "session") {
                val direct = remember { container.directChatBackend() }
                if (direct != null) {
                    val vm = viewModel<DirectChatViewModel>(key = "session:${route.id}", factory = viewModelFactory { initializer { DirectChatViewModel(direct, route.id, attach = container.attachController()) } })
                    DirectChatScreen(
                        vm, onBack = { nav.popBackStack() },
                        onOpenChat = { nav.navigate(ChatRoute("session", it)) },
                    )
                }
            } else {
                Placeholder(ChatTexts.CHAT_SOON, onBack = { nav.popBackStack() })
            }
        }
        composable<TaskRoute> { entry ->
            val route = entry.toRoute<TaskRoute>()
            val backend = remember { container.tasksBackend() }
            if (backend != null) {
                val vm = viewModel<TaskDetailViewModel>(key = "task:${route.id}", factory = viewModelFactory { initializer { TaskDetailViewModel(backend, route.id) } })
                TaskDetailScreen(
                    vm, onBack = { nav.popBackStack() }, onOpenTask = { nav.navigate(TaskRoute(it)) },
                    onOpenChanges = { nav.navigate(TaskChangesRoute(it)) },
                )
            }
        }
        composable<TaskChangesRoute> { entry ->
            val route = entry.toRoute<TaskChangesRoute>()
            val backend = remember { container.tasksBackend() }
            if (backend != null) {
                val vm = viewModel<TaskDiffViewModel>(key = "changes:${route.id}", factory = viewModelFactory { initializer { TaskDiffViewModel(backend, route.id) } })
                TaskDiffScreen(vm, onBack = { nav.popBackStack() })
            }
        }
        composable<ProjectRoute> { entry ->
            val route = entry.toRoute<ProjectRoute>()
            val backend = remember { container.projectsBackend() }
            if (backend != null) {
                val vm = viewModel<ProjectDetailViewModel>(key = "project:${route.name}", factory = viewModelFactory { initializer { ProjectDetailViewModel(backend, route.name) } })
                ProjectDetailScreen(
                    vm, onBack = { nav.popBackStack() },
                    onOpenChat = { nav.navigate(ChatRoute(it.kind.wire, it.id)) }, onOpenTask = { nav.navigate(TaskRoute(it)) },
                    onOpenPrs = { nav.navigate(PrListRoute(it)) },
                )
            }
        }
        composable<PrListRoute> { entry ->
            val route = entry.toRoute<PrListRoute>()
            val backend = remember { container.projectsBackend() }
            if (backend != null) {
                val vm = viewModel<PrListViewModel>(key = "prs:${route.name}", factory = viewModelFactory { initializer { PrListViewModel(backend, route.name) } })
                PrListScreen(vm, onBack = { nav.popBackStack() }, onOpenPr = { nav.navigate(PrRoute(route.name, it)) })
            }
        }
        composable<PrRoute> { entry ->
            val route = entry.toRoute<PrRoute>()
            val backend = remember { container.projectsBackend() }
            if (backend != null) {
                val vm = viewModel<PrDetailViewModel>(key = "pr:${route.name}#${route.number}", factory = viewModelFactory { initializer { PrDetailViewModel(backend, route.name, route.number) } })
                PrDetailScreen(vm, onBack = { nav.popBackStack() })
            }
        }
        composable<NoticesRoute> {
            val backend = remember { container.notesBackend() }
            if (backend != null) {
                val vm = viewModel<NotesViewModel>(factory = viewModelFactory { initializer { NotesViewModel(backend) } })
                NotesScreen(
                    vm, onBack = { nav.popBackStack() },
                    onOpen = { target ->
                        when (target) {
                            is NoticeTarget.Chat -> nav.navigate(ChatRoute(target.kind, target.id))
                            is NoticeTarget.Task -> nav.navigate(TaskRoute(target.id))
                            NoticeTarget.ChatsTab -> nav.popBackStack()
                        }
                    },
                )
            }
        }
        composable<SchedulesRoute> {
            val backend = remember { container.schedulesBackend() }
            if (backend != null) {
                val vm = viewModel<SchedulesViewModel>(factory = viewModelFactory { initializer { SchedulesViewModel(backend) } })
                SchedulesScreen(vm, onBack = { nav.popBackStack() })
            }
        }
        composable<ActivityRoute> {
            val backend = remember { container.activityBackend() }
            if (backend != null) {
                val vm = viewModel<ActivityViewModel>(factory = viewModelFactory { initializer { ActivityViewModel(backend) } })
                ActivityScreen(vm, onBack = { nav.popBackStack() })
            }
        }
        composable<UsageRoute> {
            val backend = remember { container.usageBackend() }
            if (backend != null) {
                val vm = viewModel<UsageViewModel>(factory = viewModelFactory { initializer { UsageViewModel(backend) } })
                UsageScreen(vm, onBack = { nav.popBackStack() })
            }
        }
        composable<ThisPhoneRoute> {
            val backend = remember { RuntimeThisPhoneBackend(container) }
            val vm = viewModel<ThisPhoneViewModel>(factory = viewModelFactory { initializer { ThisPhoneViewModel(backend) } })
            ThisPhoneScreen(
                vm, onBack = { nav.popBackStack() }, onAppearance = { appearance = true },
                onUnlinked = { nav.navigate(Welcome) { popUpTo(0) { inclusive = true } } },
            )
        }
        composable<ShareRoute>(
            enterTransition = { slideInVertically(OrbMotion.standard(OrbMotion.Medium)) { it / 6 } + fadeIn(OrbMotion.standard(OrbMotion.Medium)) },
            popExitTransition = { slideOutVertically(OrbMotion.standard(OrbMotion.Medium)) { it / 6 } + fadeOut(OrbMotion.standard(OrbMotion.Short)) },
        ) { entry ->
            val route = entry.toRoute<ShareRoute>()
            val backend = remember { container.shareBackend() }
            if (backend != null) {
                val vm = viewModel<ShareViewModel>(key = "share:${route.id}", factory = viewModelFactory {
                    initializer {
                        val request = container.takeShare() ?: ShareRequest(null, emptyList(), 0, false)
                        ShareViewModel(
                            backend, request, container.attachController(),
                            onSent = { dest ->
                                nav.popBackStack()
                                if (dest is ShareDest.Chat) nav.navigate(ChatRoute(dest.ref.kind.wire, dest.ref.id))
                            },
                        )
                    }
                })
                ShareScreen(vm, onClose = { nav.popBackStack() })
            }
        }
        composable<LinkTest> {
            val backend = remember { container.linkTestBackend() }
            if (backend != null) {
                val vm = viewModel<LinkTestViewModel>(factory = viewModelFactory { initializer { LinkTestViewModel(backend) } })
                LinkTestScreen(vm)
            }
        }
    }
}

/** Opens what a tapped notice is about, once a PC is linked. */
@Composable
private fun OpenFromNotice(container: AppContainer, nav: androidx.navigation.NavHostController) {
    val target by container.openTarget.collectAsStateWithLifecycle()
    LaunchedEffect(target) {
        val t = target ?: return@LaunchedEffect
        container.openTarget.value = null
        if (container.runtime.value == null) return@LaunchedEffect
        when (t) {
            is NoticeTarget.Chat -> nav.navigate(ChatRoute(t.kind, t.id))
            is NoticeTarget.Task -> nav.navigate(TaskRoute(t.id))
            NoticeTarget.ChatsTab -> Unit
        }
    }
}

/** Opens the «Compartir con Orb» screen for content another app shared, once a PC is linked and the app is open. */
@Composable
private fun OpenShare(container: AppContainer, nav: androidx.navigation.NavHostController) {
    val pending by container.pendingShare.collectAsStateWithLifecycle()
    val linked by container.runtime.collectAsStateWithLifecycle()
    val id = pending?.id
    LaunchedEffect(id, linked != null) {
        if (id == null || linked == null || !container.gate.isOpen()) return@LaunchedEffect
        nav.navigate(ShareRoute(id)) { popUpTo<ShareRoute> { inclusive = true } }
    }
}

/** Shared content kept until the phone is linked: said plainly, never dropped silently. */
@Composable
private fun ShareWaiting(container: AppContainer, modifier: Modifier = Modifier) {
    val pending by container.pendingShare.collectAsStateWithLifecycle()
    val linked by container.runtime.collectAsStateWithLifecycle()
    if (pending != null && linked == null) {
        Surface(modifier.padding(16.dp), shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp), color = androidx.compose.material3.MaterialTheme.colorScheme.secondaryContainer) {
            androidx.compose.material3.Text(AttachTexts.SHARE_WAITING, Modifier.padding(12.dp), style = androidx.compose.material3.MaterialTheme.typography.bodyMedium)
        }
    }
}

/** Stands in for screens that other steps build; it only offers the way back. */
@Composable
private fun Placeholder(text: String, onBack: () -> Unit) {
    androidx.compose.foundation.layout.Column(
        Modifier.fillMaxSize().padding(24.dp), verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(12.dp),
    ) {
        androidx.compose.material3.TextButton(onClick = onBack) { androidx.compose.material3.Text(ChatTexts.BACK) }
        androidx.compose.material3.Text(text)
    }
}

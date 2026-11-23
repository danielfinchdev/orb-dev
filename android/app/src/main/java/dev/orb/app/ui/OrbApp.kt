package dev.orb.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.fillMaxSize
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbSpinner
import androidx.compose.material3.Surface
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.clearAndSetSemantics
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.lifecycle.compose.collectAsStateWithLifecycle
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
import androidx.navigation.NavDestination.Companion.hasRoute
import dev.orb.app.link.net.ConnectionState
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.compose.currentBackStackEntryAsState
import dev.orb.app.AppContainer
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import dev.orb.app.ui.chats.ChatTexts
import dev.orb.app.ui.chats.Brain
import dev.orb.app.ui.chats.NewChatOutcome
import dev.orb.app.ui.chats.NewChatSheet
import dev.orb.app.ui.chats.NewChatViewModel
import dev.orb.app.ui.chats.OrbeDraft
import dev.orb.app.ui.chats.OrbeDraftScreen
import dev.orb.app.ui.chats.OrbeDraftViewModel
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
import dev.orb.app.ui.lock.LockGate
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
import dev.orb.app.ui.menu.TutorialsScreen
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
import dev.orb.app.ui.home.HomeViewModel
import dev.orb.app.ui.linktest.LinkTestScreen
import dev.orb.app.ui.linktest.LinkTestViewModel
import dev.orb.app.ui.welcome.AndroidNoticeGate
import dev.orb.app.ui.scan.AndroidCameraAccess
import dev.orb.app.ui.scan.ScanHandoff
import dev.orb.app.ui.scan.ScanScreen
import dev.orb.app.ui.scan.ScanViewModel
import dev.orb.app.ui.scan.findActivity
import dev.orb.app.ui.scan.openScanner
import dev.orb.app.ui.welcome.AndroidLockOffer
import dev.orb.app.ui.welcome.WelcomeScreen
import dev.orb.app.ui.welcome.WelcomeViewModel
import dev.orb.app.ui.web.GamesScreen
import dev.orb.app.ui.web.RuntimeWhiteboardBackend
import dev.orb.app.ui.web.WhiteboardScreen
import dev.orb.app.ui.web.WhiteboardViewModel
import dev.orb.app.attach.AttachTexts
import dev.orb.app.share.ShareRequest
import dev.orb.app.ui.share.ShareDest
import dev.orb.app.ui.share.ShareScreen
import dev.orb.app.ui.share.ShareViewModel
import kotlinx.serialization.Serializable

@Serializable data object Welcome
@Serializable data object ScanRoute
@Serializable data object Home
@Serializable data object LinkTest
@Serializable data object Search

/** An Orbe chat that the PC creates with the first message; the choices of the new-chat sheet travel in the route. */
@Serializable data class OrbeDraftRoute(
    val setProject: Boolean, val project: String?, val brainAgent: String? = null, val brainModel: String? = null, val brainEffort: String? = null,
)

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
/** [project] null opens the project that is active on the PC. */
@Serializable data class WhiteboardRoute(val project: String? = null)
@Serializable data object GamesRoute
@Serializable data object TutorialsRoute
@Serializable data object ThisPhoneRoute
@Serializable data object UpdateRoute
@Serializable data class ShareRoute(val id: Long)

@Composable
fun OrbApp(container: AppContainer) {
    val theme by container.themePrefs.settings.collectAsStateWithLifecycle()
    OrbTheme(theme) {
        Surface(modifier = Modifier.fillMaxSize(), color = androidx.compose.material3.MaterialTheme.colorScheme.background) {
            // The saved link is read off the main thread; until it is known there is nothing to show.
            val linked by produceState<Boolean?>(null, container) { value = container.startup.await() }
            if (linked == null) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { OrbSpinner(size = 28.dp) }
            } else {
                // Decided once at launch; a restored back stack wins over it after a rotation.
                val start: Any = remember { if (container.runtime.value != null) Home else Welcome }
                // Kept above the lock so the person returns to where they were; while locked, no screen is composed at all.
                val nav = rememberNavController()
                // Also above the lock: the host below leaves the composition while locked, and an unlink that ends then must still send the person to the welcome page.
                val wasLinked = rememberSaveable { mutableStateOf(container.runtime.value != null) }
                androidx.compose.runtime.CompositionLocalProvider(dev.orb.app.ui.offline.LocalOffline provides container.offline) {
                    LockGate(container.lock, Modifier.systemBarsPadding()) {
                        PcDownHost(container, nav, wasLinked) {
                            Box(Modifier.fillMaxSize()) {
                                OrbNav(container, start, nav)
                                ShareWaiting(container, Modifier.align(Alignment.TopCenter).systemBarsPadding())
                                dev.orb.app.ui.approve.ApproveHost(container.approver)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Only the change from linked to unlinked sends the person to the welcome page, and never from the pages that belong to it. */
internal fun shouldReturnToWelcome(wasLinked: Boolean, linked: Boolean, onWelcomeOrScan: Boolean): Boolean =
    wasLinked && !linked && !onWelcomeOrScan

/**
 * Puts «No llego a tu PC» over the app when it opens without a link, and the read-only bar over it when the person chose to look
 * at what the phone holds. The app stays composed underneath (navigation keeps working) but hidden from touch and screen readers.
 */
@Composable
private fun PcDownHost(container: AppContainer, nav: androidx.navigation.NavHostController, wasLinked: MutableState<Boolean>, content: @Composable () -> Unit) {
    val gate = container.pcDown
    val down by gate.state.collectAsStateWithLifecycle()
    // Back to the welcome page when the local link has been erased (the person unlinked), so a rotation while unlinking cannot
    // lose the way. The connection state is not used: the PC removing this phone leaves the saved chats and the notice in place.
    val linked by container.runtime.collectAsStateWithLifecycle()
    LaunchedEffect(linked != null) {
        val here = nav.currentDestination
        if (shouldReturnToWelcome(wasLinked.value, linked != null, here?.hasRoute<Welcome>() == true || here?.hasRoute<ScanRoute>() == true)) {
            nav.navigate(Welcome) { popUpTo(0) { inclusive = true } }
        }
        wasLinked.value = linked != null
    }
    // Registered before the navigation host, so a deeper screen's own back step wins and this one only fires on the list.
    androidx.activity.compose.BackHandler(enabled = down.saved) { gate.closeSaved() }
    val readOnly = remember(container, gate) { dev.orb.app.ui.offline.ReadOnlyMode(container.offline, gate::closeSaved) }
    // The tabs (inside Home) draw the read-only note themselves; any screen opened over them gets it here.
    val outer by nav.currentBackStackEntryAsState()
    val onHome = outer?.destination?.hasRoute<Home>() == true
    Column(Modifier.fillMaxSize()) {
        if (down.saved && !onHome) dev.orb.app.ui.offline.ReadOnlyBar(container.offline, gate::closeSaved)
        Box(Modifier.weight(1f).fillMaxWidth()) {
            Box(Modifier.fillMaxSize().then(if (down.full != null) Modifier.clearAndSetSemantics {} else Modifier)) {
                androidx.compose.runtime.CompositionLocalProvider(dev.orb.app.ui.offline.LocalReadOnly provides readOnly.takeIf { down.saved }) { content() }
            }
            val full = down.full
            if (full != null) {
                Surface(
                    Modifier.fillMaxSize().pointerInput(Unit) { detectTapGestures { } },
                    color = androidx.compose.material3.MaterialTheme.colorScheme.background,
                ) {
                    when (full) {
                        dev.orb.app.ui.offline.DownKind.PcOff -> dev.orb.app.ui.offline.PcOffScreen(
                            container.offline, onSeeSaved = gate::openSaved,
                            // Runs on the container's scope: the screen leaves the composition as soon as the link is gone.
                            onLinkOther = { gate.unlink(container.scope) { container.unlink() } },
                            unlinking = down.unlinking,
                        )
                        dev.orb.app.ui.offline.DownKind.UpdateApp, dev.orb.app.ui.offline.DownKind.UpdatePc ->
                            dev.orb.app.ui.update.UpdateScreen(container.offline, seeSaved = gate::openSaved)
                    }
                }
            }
        }
    }
}

/** The new-chat sheet and where it leads; [fixedProject] chooses a project at the start (the project's page does), null leaves the PC's own choice. */
@Composable
private fun NewChatHost(container: AppContainer, nav: androidx.navigation.NavHostController, key: String, fixedProject: String?, onDismiss: () -> Unit) {
    val newChatBackend = remember { container.newChatBackend() } ?: return
    val vm = viewModel<NewChatViewModel>(key = key, factory = viewModelFactory { initializer { NewChatViewModel(newChatBackend) } })
    // Picked before the PC's options arrive, so they keep it instead of the active project.
    LaunchedEffect(vm, fixedProject) { if (fixedProject != null) vm.pickProject(fixedProject) }
    NewChatSheet(
        vm, onDismiss = onDismiss,
        onOutcome = { outcome ->
            onDismiss()
            when (outcome) {
                is NewChatOutcome.Session -> nav.navigate(ChatRoute("session", outcome.id))
                is NewChatOutcome.Draft -> with(outcome.draft) {
                    nav.navigate(OrbeDraftRoute(setProject, project, brain?.agent, brain?.model, brain?.reasoning))
                }
            }
        },
    )
}

@Composable
private fun OrbNav(container: AppContainer, start: Any, nav: androidx.navigation.NavHostController) {
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
        composable<Welcome> { entry ->
            val vm = viewModel<WelcomeViewModel>(factory = viewModelFactory {
                initializer { WelcomeViewModel(container.linker, container.deviceName, onLinked = container::linkWith, notices = AndroidNoticeGate(container.notificationAccess), lockOffer = AndroidLockOffer(container.lock)) }
            })
            // What the scanner left for this page (it may have been recreated meanwhile): used once, then erased.
            val handle = entry.savedStateHandle
            val fromScanner by handle.getStateFlow<String?>(ScanHandoff.KEY, null).collectAsStateWithLifecycle()
            val pasteFromScanner by handle.getStateFlow<Boolean>(ScanHandoff.PASTE_KEY, false).collectAsStateWithLifecycle()
            val codeFromScanner by handle.getStateFlow<Boolean>(ScanHandoff.CODE_KEY, false).collectAsStateWithLifecycle()
            LaunchedEffect(fromScanner, pasteFromScanner, codeFromScanner) {
                ScanHandoff.take(handle)?.let(vm::scanned)
                if (ScanHandoff.takePaste(handle)) vm.openLinkSheet()
                if (ScanHandoff.takeCode(handle)) vm.openSheet()
            }
            val noticesOn by container.notificationAccess.enabled.collectAsStateWithLifecycle()
            val toChats = { nav.navigate(Home) { popUpTo(Welcome) { inclusive = true } } }
            val context = androidx.compose.ui.platform.LocalContext.current
            val access = remember(context) { AndroidCameraAccess(context) }
            WelcomeScreen(
                vm, onDone = { toChats() }, noticesEnabled = noticesOn,
                onOpenThisPhone = { toChats(); nav.navigate(ThisPhoneRoute) },
                onScan = { openScanner(access.hasCamera, { nav.navigate(ScanRoute) }, vm::openSheet) },
            )
        }
        composable<ScanRoute> {
            val context = androidx.compose.ui.platform.LocalContext.current
            val access = remember(context) { AndroidCameraAccess(context) }
            val vm = viewModel<ScanViewModel>(factory = viewModelFactory { initializer { ScanViewModel(access) } })
            // The view model keeps the first access across a recreation, so the current Activity goes to that one.
            DisposableEffect(vm, context) {
                vm.attachActivity(context.findActivity())
                onDispose { vm.attachActivity(null) }
            }
            ScanScreen(
                vm, onBack = { nav.popBackStack() },
                // The welcome page takes the text from its saved state (see ScanHandoff), as if it had been pasted.
                onScanned = { text -> ScanHandoff.deliver(nav.previousBackStackEntry?.savedStateHandle, text); nav.popBackStack() },
                onPaste = { ScanHandoff.deliverPaste(nav.previousBackStackEntry?.savedStateHandle); nav.popBackStack() },
                onTypeCode = { ScanHandoff.deliverCode(nav.previousBackStackEntry?.savedStateHandle); nav.popBackStack() },
            )
        }
        composable<Home> {
            val backend = remember { container.chatsBackend() }
            val home = viewModel<HomeViewModel>(factory = viewModelFactory { initializer { HomeViewModel(container) } })
            val homeState by home.state.collectAsStateWithLifecycle()
            // Each opening of the sheet gets its own view model, so a closed sheet never comes back with old choices.
            var newChatSheet by rememberSaveable { mutableStateOf(0) }
            var newChatOpen by rememberSaveable { mutableStateOf(false) }
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
                        whiteboard = container.whiteboardBackend()?.let { b -> RuntimeWhiteboardBackend.NEEDED.all { b.available(it) } } == true,
                    )
                }
                MainShell(
                    backend,
                    ShellActions(
                        onOpenChat = { nav.navigate(ChatRoute(it.kind.wire, it.id)) },
                        onSearch = { nav.navigate(Search) },
                        onNewChat = { newChatSheet++; newChatOpen = true },
                        onOpenTask = { nav.navigate(TaskRoute(it)) },
                        onOpenProject = { nav.navigate(ProjectRoute(it)) },
                        onNotices = { nav.navigate(NoticesRoute) },
                        onSchedules = { nav.navigate(SchedulesRoute) },
                        onActivity = { nav.navigate(ActivityRoute) },
                        onUsage = { nav.navigate(UsageRoute) },
                        onWhiteboard = { nav.navigate(WhiteboardRoute()) },
                        onGames = { nav.navigate(GamesRoute) },
                        onTutorials = { nav.navigate(TutorialsRoute) },
                        onThisPhone = { nav.navigate(ThisPhoneRoute) },
                        menu = menuAvailable,
                    ),
                    tasks = tasksBackend,
                    projects = projectsBackend,
                    notes = notesBackend,
                    pcName = homeState.pcName,
                    theme = container.themePrefs,
                )
            }
            if (newChatOpen && backend != null) {
                NewChatHost(container, nav, key = "newchat:$newChatSheet", fixedProject = null, onDismiss = { newChatOpen = false })
            }
        }
        composable<Search> {
            val backend = remember { container.chatsBackend() }
            if (backend != null) {
                val vm = viewModel<SearchViewModel>(factory = viewModelFactory { initializer { SearchViewModel(backend) } })
                SearchScreen(
                    vm, onBack = { nav.popBackStack() }, onOpenChat = { nav.navigate(ChatRoute(it.kind.wire, it.id)) },
                    onOpenTask = { nav.navigate(TaskRoute(it)) }, onOpenProject = { nav.navigate(ProjectRoute(it)) },
                )
            }
        }
        composable<OrbeDraftRoute>(
            // Sheet-like: it rises from below and goes back down, unlike the side-by-side chat screens.
            enterTransition = { slideInVertically(OrbMotion.standard(OrbMotion.Medium)) { it / 6 } + fadeIn(OrbMotion.standard(OrbMotion.Medium)) },
            popExitTransition = { slideOutVertically(OrbMotion.standard(OrbMotion.Medium)) { it / 6 } + fadeOut(OrbMotion.standard(OrbMotion.Short)) },
        ) { entry ->
            val route = entry.toRoute<OrbeDraftRoute>()
            val backend = remember { container.newChatBackend() }
            if (backend != null) {
                val brain = route.brainAgent?.let { Brain(it, route.brainModel, route.brainEffort) }
                val vm = viewModel<OrbeDraftViewModel>(factory = viewModelFactory { initializer { OrbeDraftViewModel(backend, OrbeDraft(route.setProject, route.project, brain)) } })
                OrbeDraftScreen(
                    vm, onBack = { nav.popBackStack() }, mentions = remember { container.mentionSource() },
                    // The created conversation takes the draft's place, so back from it returns to the list.
                    onCreated = { nav.navigate(ChatRoute("conversation", it.toString())) { popUpTo<OrbeDraftRoute> { inclusive = true } } },
                )
            }
        }
        composable<ChatRoute> { entry ->
            val route = entry.toRoute<ChatRoute>()
            val conversation = route.id.toLongOrNull()
            val backend = remember { container.orbeChatBackend() }
            if (route.kind == "conversation" && conversation != null && backend != null) {
                val vm = viewModel<OrbeChatViewModel>(key = "orbe:$conversation", factory = viewModelFactory { initializer { OrbeChatViewModel(backend, conversation, attach = container.attachController()) } })
                val gone by vm.state.collectAsStateWithLifecycle()
                ChatGoneFromNotice(container, nav, route.kind, route.id, gone.deleted)
                OrbeChatScreen(vm, onBack = { nav.popBackStack() }, mentions = remember { container.mentionSource() })
            } else if (route.kind == "session") {
                val direct = remember { container.directChatBackend() }
                if (direct != null) {
                    val vm = viewModel<DirectChatViewModel>(key = "session:${route.id}", factory = viewModelFactory { initializer { DirectChatViewModel(direct, route.id, attach = container.attachController()) } })
                    val gone by vm.state.collectAsStateWithLifecycle()
                    ChatGoneFromNotice(container, nav, route.kind, route.id, gone.deleted)
                    DirectChatScreen(
                        vm, onBack = { nav.popBackStack() },
                        onOpenChat = { nav.navigate(ChatRoute("session", it)) },
                        mentions = remember { container.mentionSource() },
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
                var newChat by rememberSaveable { mutableStateOf(false) }
                ProjectDetailScreen(
                    vm, onBack = { nav.popBackStack() },
                    onOpenChat = { nav.navigate(ChatRoute(it.kind.wire, it.id)) }, onOpenTask = { nav.navigate(TaskRoute(it)) },
                    onOpenPrs = { nav.navigate(PrListRoute(it)) },
                    onOpenWhiteboard = { nav.navigate(WhiteboardRoute(it)) },
                    onNewChat = { newChat = true }, onOpenChanges = { nav.navigate(TaskChangesRoute(it)) },
                )
                if (newChat) NewChatHost(container, nav, key = "newchat:project:${route.name}", fixedProject = route.name, onDismiss = { newChat = false })
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
                        container.noticeChat = target as? NoticeTarget.Chat
                        if (target == NoticeTarget.ChatsTab) nav.popBackStack() else openNotice(nav, target)
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
        composable<WhiteboardRoute> { entry ->
            val route = entry.toRoute<WhiteboardRoute>()
            val backend = remember { container.whiteboardBackend() }
            if (backend != null) {
                val vm = viewModel<WhiteboardViewModel>(key = "whiteboard:${route.project}", factory = viewModelFactory { initializer { WhiteboardViewModel(backend, route.project) } })
                WhiteboardScreen(vm, onBack = { nav.popBackStack() })
            }
        }
        composable<GamesRoute> { GamesScreen(onBack = { nav.popBackStack() }) }
        composable<TutorialsRoute> { TutorialsScreen(onBack = { nav.popBackStack() }) }
        composable<UsageRoute> {
            val backend = remember { container.usageBackend() }
            if (backend != null) {
                val vm = viewModel<UsageViewModel>(factory = viewModelFactory { initializer { UsageViewModel(backend) } })
                UsageScreen(vm, onBack = { nav.popBackStack() })
            }
        }
        composable<UpdateRoute> {
            dev.orb.app.ui.update.UpdateScreen(container.offline, onBack = { nav.popBackStack() })
        }
        composable<ThisPhoneRoute> {
            val backend = remember { RuntimeThisPhoneBackend(container) }
            val vm = viewModel<ThisPhoneViewModel>(factory = viewModelFactory { initializer { ThisPhoneViewModel(backend) } })
            ThisPhoneScreen(
                vm, container.themePrefs, onBack = { nav.popBackStack() }, onLinkTest = { nav.navigate(LinkTest) },
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
                LinkTestScreen(vm, onBack = { nav.popBackStack() })
            }
        }
    }
}

/**
 * A tapped notice led to a chat the PC no longer has: instead of a dead chat the person is told so, back where they came
 * from, and the notice leaves the list. Only for a chat opened from a notice; a chat deleted while it is open keeps its screen.
 */
@Composable
private fun ChatGoneFromNotice(container: AppContainer, nav: androidx.navigation.NavHostController, kind: String, id: String, deleted: Boolean) {
    val context = androidx.compose.ui.platform.LocalContext.current
    LaunchedEffect(deleted) {
        if (deleted && container.chatGone(kind, id)) {
            android.widget.Toast.makeText(context, dev.orb.app.ui.notes.NotesTexts.CHAT_GONE, android.widget.Toast.LENGTH_SHORT).show()
            nav.popBackStack()
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
        openNotice(nav, t)
    }
}

/**
 * Where a notice leads; null for the chat list, where the person already is. The announced version opens the update page,
 * which says with the real state of the link whether there is anything to update.
 */
internal fun noticeRoute(t: NoticeTarget): Any? = when (t) {
    is NoticeTarget.Chat -> ChatRoute(t.kind, t.id)
    is NoticeTarget.Task -> TaskRoute(t.id)
    is NoticeTarget.TaskChanges -> TaskChangesRoute(t.id)
    is NoticeTarget.Account -> UsageRoute
    is NoticeTarget.Version -> UpdateRoute
    NoticeTarget.ChatsTab -> null
}

private fun openNotice(nav: androidx.navigation.NavHostController, t: NoticeTarget) {
    noticeRoute(t)?.let { nav.navigate(it) }
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
        OrbButton(ChatTexts.BACK, onBack, kind = OrbButtonKind.Ghost)
        androidx.compose.material3.Text(text)
    }
}

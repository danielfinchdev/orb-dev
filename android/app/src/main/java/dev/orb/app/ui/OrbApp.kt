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
import dev.orb.app.ui.chats.SearchScreen
import dev.orb.app.ui.chats.SearchViewModel
import dev.orb.app.ui.shell.MainShell
import dev.orb.app.ui.shell.ShellActions
import dev.orb.app.ui.shell.UnlinkDialog
import dev.orb.app.ui.home.HomeViewModel
import dev.orb.app.ui.linktest.LinkTestScreen
import dev.orb.app.ui.linktest.LinkTestViewModel
import dev.orb.app.ui.welcome.WelcomeScreen
import dev.orb.app.ui.welcome.WelcomeViewModel
import kotlinx.serialization.Serializable

@Serializable data object Welcome
@Serializable data object Home
@Serializable data object LinkTest
@Serializable data object Search
@Serializable data object NewChat

/** An Orbe conversation (`kind` = conversation) or a direct chat with an agent (`kind` = session). */
@Serializable data class ChatRoute(val kind: String, val id: String)

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
                OrbNav(container, start)
            }
        } }
    }
}

@Composable
private fun OrbNav(container: AppContainer, start: Any) {
    val nav = rememberNavController()
    var appearance by rememberSaveable { mutableStateOf(false) }
    if (appearance) AppearanceSheet(container.themePrefs, onDismiss = { appearance = false })
    NavHost(navController = nav, startDestination = start, modifier = Modifier.systemBarsPadding()) {
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
                MainShell(
                    backend, container.themePrefs,
                    ShellActions(
                        onOpenChat = { nav.navigate(ChatRoute(it.kind.wire, it.id)) },
                        onSearch = { nav.navigate(Search) },
                        onNewChat = { nav.navigate(NewChat) },
                        // Deleting and its undo come with the chat screens; the hook is here so the menu is ready.
                        onDelete = { },
                        onAppearance = { appearance = true },
                        onLinkTest = { nav.navigate(LinkTest) },
                        onUnlink = { confirming = true },
                    ),
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
        composable<NewChat> { Placeholder(ChatTexts.NEW_CHAT_SOON, onBack = { nav.popBackStack() }) }
        composable<ChatRoute> { Placeholder(ChatTexts.CHAT_SOON, onBack = { nav.popBackStack() }) }
        composable<LinkTest> {
            val backend = remember { container.linkTestBackend() }
            if (backend != null) {
                val vm = viewModel<LinkTestViewModel>(factory = viewModelFactory { initializer { LinkTestViewModel(backend) } })
                LinkTestScreen(vm)
            }
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

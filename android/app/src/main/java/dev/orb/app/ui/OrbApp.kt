package dev.orb.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
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
import dev.orb.app.ui.home.HomeScreen
import dev.orb.app.ui.home.HomeViewModel
import dev.orb.app.ui.linktest.LinkTestScreen
import dev.orb.app.ui.linktest.LinkTestViewModel
import dev.orb.app.ui.welcome.WelcomeScreen
import dev.orb.app.ui.welcome.WelcomeViewModel
import kotlinx.serialization.Serializable

@Serializable data object Welcome
@Serializable data object Home
@Serializable data object LinkTest

// Plain Material theme on purpose: the final design is not approved yet.
@Composable
fun OrbApp(container: AppContainer) {
    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            // The saved link is read off the main thread; until it is known there is nothing to show.
            val linked by produceState<Boolean?>(null, container) { value = container.startup.await() }
            if (linked == null) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            } else {
                // Decided once at launch; a restored back stack wins over it after a rotation.
                val start: Any = remember { if (container.runtime.value != null) Home else Welcome }
                OrbNav(container, start)
            }
        }
    }
}

@Composable
private fun OrbNav(container: AppContainer, start: Any) {
    val nav = rememberNavController()
    NavHost(navController = nav, startDestination = start, modifier = Modifier.systemBarsPadding()) {
        composable<Welcome> {
            val vm = viewModel<WelcomeViewModel>(factory = viewModelFactory {
                initializer { WelcomeViewModel(container.linker, container.deviceName, onLinked = container::linkWith) }
            })
            WelcomeScreen(vm, onLinked = { nav.navigate(Home) { popUpTo(Welcome) { inclusive = true } } })
        }
        composable<Home> {
            val vm = viewModel<HomeViewModel>(factory = viewModelFactory { initializer { HomeViewModel(container) } })
            HomeScreen(
                vm,
                onLinkTest = { nav.navigate(LinkTest) },
                onUnlinked = { nav.navigate(Welcome) { popUpTo(Home) { inclusive = true } } },
            )
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

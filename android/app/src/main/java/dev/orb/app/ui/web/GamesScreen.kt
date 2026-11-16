package dev.orb.app.ui.web

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import dev.orb.app.ui.menu.MenuTexts
import dev.orb.app.ui.shell.ScreenBar

/** «Juegos»: the mini-games, running in a local web view. They are on the phone, so no connection is needed. */
@Composable
fun GamesScreen(onBack: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val records = remember { GameRecords(context.applicationContext) }
    val onBackNow by rememberUpdatedState(onBack)
    // The page's close and the back arrow can both fire: the screen is popped once.
    val leave = remember { OnceAction { onBackNow() } }
    val bridge = remember { GamesBridge(onBest = records::save, onClose = leave::run) }
    val background = MaterialTheme.colorScheme.background
    Column(modifier.fillMaxSize()) {
        ScreenBar(MenuTexts.GAMES, leave::run, MenuTexts.BACK)
        LocalWebView("games/index.html", dark = background.luminance() < 0.5f, background = background, bridge = bridge, onBack = leave::run, modifier = Modifier.fillMaxWidth().weight(1f))
    }
}

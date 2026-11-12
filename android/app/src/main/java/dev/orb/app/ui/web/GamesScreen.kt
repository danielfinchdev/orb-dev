package dev.orb.app.ui.web

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
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
    val bridge = remember { GamesBridge(onBest = records::save, onClose = onBack) }
    val background = MaterialTheme.colorScheme.background
    Column(modifier.fillMaxSize()) {
        ScreenBar(MenuTexts.GAMES, onBack, MenuTexts.BACK)
        LocalWebView("games/index.html", dark = background.luminance() < 0.5f, background = background, bridge = bridge, onBack = onBack, modifier = Modifier.fillMaxWidth().weight(1f))
    }
}

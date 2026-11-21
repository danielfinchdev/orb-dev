package dev.orb.app.ui.offline

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.kit.OrbConnectedBadge
import dev.orb.app.ui.kit.OrbConnectionBand
import dev.orb.app.ui.theme.OrbMotion
import kotlinx.coroutines.delay

/** How long «Conectado» stays once the link is back. */
const val CONNECTED_SHOWN_MS = 2_500L

/**
 * The band under a chat's header. While the PC cannot be reached it says why, with the countdown to the next attempt
 * and «Reintentar»; when the link comes back it says «Conectado» for a moment and goes. Screens show it for any chat,
 * so the cache keeps being readable and what is written keeps queueing underneath.
 */
@Composable
fun ConnectionBand(connection: ConnectionState, modifier: Modifier = Modifier, info: OfflineInfo? = LocalOffline.current) {
    val down = connection !is ConnectionState.Online
    var wasDown by remember { mutableStateOf(false) }
    var connected by remember { mutableStateOf(false) }
    LaunchedEffect(down) {
        if (down) {
            wasDown = true
            connected = false
        } else if (wasDown) {
            connected = true
            delay(CONNECTED_SHOWN_MS)
            connected = false
            wasDown = false
        }
    }
    // A once-a-second clock, only while the link is down: the countdown is the only thing that moves.
    val clock = info?.clock ?: System::currentTimeMillis
    val now by produceState(clock(), info, down) { if (down) while (true) { value = clock(); delay(1_000) } }
    ConnectionBandContent(
        down = down, connected = connected && !down, text = OfflineTexts.band(connection, now), onRetry = info?.retryNow, modifier = modifier,
    )
}

/** The band as a pure function of what it shows; the stateful one above decides when. */
@Composable
fun ConnectionBandContent(down: Boolean, connected: Boolean, text: String?, onRetry: (() -> Unit)?, modifier: Modifier = Modifier) {
    AnimatedVisibility(
        down || connected, modifier,
        enter = fadeIn(OrbMotion.standard(OrbMotion.Short)) + expandVertically(OrbMotion.standard(OrbMotion.Short)),
        exit = fadeOut(OrbMotion.standard(OrbMotion.Short)) + shrinkVertically(OrbMotion.standard(OrbMotion.Short)),
    ) {
        // Leaving, the badge fades out in place of the band instead of the band reading «Reintento» for the last frames.
        Crossfade(targetState = down, animationSpec = OrbMotion.standard(OrbMotion.Short), label = "band") { isDown ->
            if (isDown) OrbConnectionBand(text.orEmpty(), action = if (onRetry != null) OfflineTexts.BAND_RETRY else null, onAction = onRetry)
            else OrbConnectedBadge(OfflineTexts.BAND_CONNECTED)
        }
    }
}

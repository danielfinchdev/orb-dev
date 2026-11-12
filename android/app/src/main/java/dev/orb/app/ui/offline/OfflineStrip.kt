package dev.orb.app.ui.offline

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow

/** What the offline note needs: the link's state, when the PC last answered and the way to try again at once. */
class OfflineInfo(
    val connection: StateFlow<ConnectionState>,
    val lastContact: StateFlow<Long?>,
    val retryNow: () -> Unit,
    val clock: () -> Long = System::currentTimeMillis,
)

val LocalOffline = compositionLocalOf<OfflineInfo?> { null }

/**
 * The note shown above saved data when the PC cannot be reached: when it answered last, the countdown to the next
 * attempt and «Reintentar ahora». Screens show it only while they are offline.
 */
@Composable
fun OfflineStrip(modifier: Modifier = Modifier) {
    val info = LocalOffline.current
    if (info == null) {
        Text(
            OfflineTexts.TITLE, modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.warn,
        )
        return
    }
    val connection by info.connection.collectAsStateWithLifecycle()
    val lastContact by info.lastContact.collectAsStateWithLifecycle()
    // A once-a-second clock, only while this note is on screen.
    val now by produceState(info.clock(), info) { while (true) { value = info.clock(); delay(1_000) } }
    val seen = (connection as? ConnectionState.Offline)?.lastSeen ?: lastContact
    val status = when (val c = connection) {
        is ConnectionState.Offline -> OfflineTexts.retryIn(c.nextRetryAt, now)
        ConnectionState.Connecting -> OfflineTexts.CONNECTING
        else -> null
    }
    Row(modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Column(Modifier.weight(1f)) {
            Text(
                if (status != null) "${OfflineTexts.TITLE} · $status" else OfflineTexts.TITLE,
                style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.warn,
            )
            Text(OfflineTexts.savedNote(seen, now), style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2)
        }
        TextButton(onClick = info.retryNow) { Text(OfflineTexts.RETRY_NOW) }
    }
}

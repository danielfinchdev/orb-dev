package dev.orb.app.ui.lock

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.lock.AppLock
import dev.orb.app.lock.LockNotice
import dev.orb.app.lock.LockTexts
import dev.orb.app.ui.theme.OrbTheme

/** The only thing shown while the app is locked: it asks the system to authenticate as soon as it appears. */
@Composable
fun LockScreen(lock: AppLock, modifier: Modifier = Modifier) {
    val notice by lock.notice.collectAsStateWithLifecycle()
    val busy by lock.busy.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { lock.unlock() }
    LockContent(notice, busy, onUnlock = { lock.unlock() }, onPin = { lock.unlock(pin = true) }, modifier)
}

@Composable
fun LockContent(notice: LockNotice?, busy: Boolean, onUnlock: () -> Unit, onPin: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(LockTexts.LOCKED_TITLE, Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
        Text(LockTexts.LOCKED_NOTE, style = MaterialTheme.typography.bodyMedium, color = OrbTheme.colors.text2, textAlign = TextAlign.Center)
        Text(LockTexts.UNLOCK_HINT, Modifier.padding(top = 12.dp), style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
        if (notice != null) {
            Text(LockTexts.notice(notice), style = MaterialTheme.typography.bodyMedium, color = OrbTheme.colors.warn, textAlign = TextAlign.Center)
        }
        Button(onClick = onUnlock, enabled = !busy) { Text(LockTexts.UNLOCK) }
        TextButton(onClick = onPin, enabled = !busy) { Text(LockTexts.USE_PIN) }
    }
}

/**
 * Shows [content] only while the app is open. While locked nothing of it is composed, so whatever waits for the
 * screen (a tapped notice, shared content) stays pending until the person unlocks, then goes on to its destination.
 */
@Composable
fun LockGate(lock: AppLock, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val locked by lock.gate.locked.collectAsStateWithLifecycle()
    if (locked) LockScreen(lock, modifier) else content()
}

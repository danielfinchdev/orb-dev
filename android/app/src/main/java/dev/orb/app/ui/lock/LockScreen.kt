package dev.orb.app.ui.lock

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.lock.AppLock
import dev.orb.app.lock.LockNotice
import dev.orb.app.lock.LockTexts
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbBanner
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbFoot
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbNote
import dev.orb.app.ui.kit.OrbWordmark
import dev.orb.app.ui.theme.OrbFonts

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
    Column(modifier.fillMaxSize().background(OrbKit.background)) {
        Column(
            Modifier.weight(1f).fillMaxWidth().padding(horizontal = 28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            OrbWordmark(fontSize = 32.sp)
            Spacer(Modifier.height(12.dp))
            Text(
                LockTexts.LOCKED_TITLE, Modifier.semantics { heading() }, color = OrbKit.foreground, fontSize = 24.sp, lineHeight = 30.sp,
                fontFamily = OrbFonts.title, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
            )
            Text(LockTexts.LOCKED_NOTE, color = OrbKit.mutedForeground, fontSize = 14.5.sp, lineHeight = 22.sp, textAlign = TextAlign.Center)
        }
        if (notice != null) {
            // Both failures use the mockup's error banner; "blocked" only differs in its words.
            OrbBanner(LockTexts.notice(notice), OrbIcons.CircleAlert, Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
        }
        OrbFoot(spacing = 6.dp) {
            OrbButton(
                if (notice != null) LockTexts.UNLOCK_AGAIN else LockTexts.UNLOCK, onUnlock, kind = OrbButtonKind.Primary, block = true,
                enabled = !busy, icon = OrbIcons.Fingerprint, big = true,
            )
            OrbButton(LockTexts.USE_PIN, onPin, kind = OrbButtonKind.Ghost, block = true, enabled = !busy)
            OrbNote(LockTexts.WHERE_TO_CHANGE, Modifier.fillMaxWidth().padding(top = 4.dp), center = true)
            if (notice == null) OrbNote(LockTexts.NEVER_MASTER, Modifier.fillMaxWidth(), center = true)
        }
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

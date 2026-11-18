package dev.orb.app.ui.chats

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbNote
import dev.orb.app.ui.kit.OrbTopBar
import dev.orb.app.ui.offline.ConnectionBand

/**
 * The Orbe chat before its first message: the project and the brain chosen in the new-chat sheet are already set, and the
 * PC creates the conversation when the first message is sent. Leaving with nothing written leaves nothing behind.
 */
@Composable
fun OrbeDraftScreen(vm: OrbeDraftViewModel, onBack: () -> Unit, onCreated: (Long) -> Unit, modifier: Modifier = Modifier) {
    val state by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(vm) { vm.created.collect(onCreated) }

    Column(modifier.fillMaxSize().imePadding()) {
        OrbTopBar(
            ChatTexts.NEW_CHAT, sub = ChatTexts.withOrbe(state.project), sideWidth = 56.dp,
            leading = { OrbIconButton(OrbIcons.ArrowLeft, ChatTexts.BACK, onBack) },
        )
        ConnectionBand(state.connection)
        Box(Modifier.weight(1f).fillMaxWidth()) {
            val pending = state.pending
            if (pending == null) {
                Column(Modifier.fillMaxSize().padding(horizontal = 28.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(ChatTexts.DRAFT_HINT, color = OrbKit.mutedForeground, fontSize = 14.5.sp, lineHeight = 21.sp, textAlign = TextAlign.Center)
                }
            } else {
                Column(Modifier.fillMaxSize().padding(16.dp)) { PendingRow(pending, state.online, onRetry = vm::retry, onDiscard = vm::discard, connection = state.connection) }
            }
        }
        // Without the link nothing can be created, so the field is not offered instead of swallowing what is written;
        // while a message is on its way or refused, it is the only one and has its own retry and discard.
        if (!state.online) OrbNote(ChatTexts.DRAFT_OFFLINE, Modifier.padding(horizontal = 20.dp, vertical = 16.dp))
        else if (state.pending == null) Composer(
            online = true, busy = false, mode = null, canSetMode = false, onSend = vm::send, onStop = {}, onMode = {},
            brain = state.brain ?: ChatTexts.BRAIN_UNKNOWN, mic = true,
        )
    }
}

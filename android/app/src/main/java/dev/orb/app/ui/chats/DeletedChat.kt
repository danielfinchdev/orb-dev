package dev.orb.app.ui.chats

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbEmpty
import dev.orb.app.ui.kit.OrbKit

/**
 * The PC says the conversation is gone. The way out is the list; asking the PC to bring it back stays as the quieter
 * second choice. Nothing leaves by itself, so the page does not promise to.
 */
@Composable
fun DeletedChatPage(onBack: () -> Unit, onRestore: (() -> Unit)?, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize().background(OrbKit.background), contentAlignment = Alignment.Center) {
        OrbEmpty(
            ChatTexts.DELETED_TITLE, text = ChatTexts.DELETED_BODY, icon = OrbIcons.MessageSquareX,
            actions = { OrbButton(ChatTexts.BACK_TO_CHATS, onBack, kind = OrbButtonKind.Primary) },
            below = { if (onRestore != null) OrbButton(ChatTexts.RESTORE_ASK, onRestore, kind = OrbButtonKind.Ghost) },
        )
    }
}

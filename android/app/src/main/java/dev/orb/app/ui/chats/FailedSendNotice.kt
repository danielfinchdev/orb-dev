package dev.orb.app.ui.chats

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

/**
 * Says [ChatTexts.SEND_FAILED_SNACK] once for each message that turns failed while the chat is open. Messages that were
 * already failed when the list loaded are the ones the person sees in the list, so they do not announce themselves again.
 * A failed message is never retried on its own, so the notice does not say it is.
 */
@Composable
internal fun FailedSendNotice(failed: Set<String>, loaded: Boolean, snackbar: SnackbarHostState) {
    var known by remember { mutableStateOf<Set<String>?>(null) }
    LaunchedEffect(failed, loaded) {
        if (!loaded) return@LaunchedEffect
        val before = known
        known = failed
        if (before != null && (failed - before).isNotEmpty()) snackbar.showSnackbar(ChatTexts.SEND_FAILED_SNACK)
    }
}

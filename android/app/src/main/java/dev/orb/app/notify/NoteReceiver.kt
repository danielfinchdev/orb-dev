package dev.orb.app.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import dev.orb.app.OrbApplication
import kotlinx.coroutines.launch

/**
 * A notification button answered without opening the app. Not exported: only Orb's own PendingIntents reach it, each
 * with a one-use token, and only with the phone unlocked ([NoteActionRunner]).
 */
class NoteReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val token = intent.getStringExtra(NoteIntents.EXTRA_TOKEN) ?: return
        val typed = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(NoteIntents.REPLY_KEY)?.toString()
        val container = (context.applicationContext as OrbApplication).container
        val pending = goAsync()
        container.scope.launch {
            try {
                container.answerNote(token, typed)
            } finally {
                pending.finish()
            }
        }
    }
}

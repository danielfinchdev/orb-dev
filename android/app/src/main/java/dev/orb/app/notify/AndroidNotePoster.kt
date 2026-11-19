package dev.orb.app.notify

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import dev.orb.app.MainActivity
import dev.orb.app.R

/** What travels in the intents of the notices: only a one-use token of a [NoteJob]. */
object NoteIntents {
    const val EXTRA_TOKEN = "dev.orb.app.noteToken"
    const val REPLY_KEY = "orb-reply"
}

object NotifyChannels {
    const val STATUS_ID = 19_001

    /** Creates the three channels (the id «orb-chats» of the messages is kept from the old app). */
    fun ensure(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        fun make(c: NoteChannel, name: String, importance: Int) {
            if (nm.getNotificationChannel(c.id) == null) nm.createNotificationChannel(NotificationChannel(c.id, name, importance))
        }
        make(NoteChannel.Messages, NotifyTexts.CHANNEL_MESSAGES, NotificationManager.IMPORTANCE_HIGH)
        make(NoteChannel.Approvals, NotifyTexts.CHANNEL_APPROVALS, NotificationManager.IMPORTANCE_HIGH)
        make(NoteChannel.Status, NotifyTexts.CHANNEL_STATUS, NotificationManager.IMPORTANCE_LOW)
    }
}

/**
 * Shows the notices as a messaging app's: one per chat (new lines replace it), a tap opens the app on that chat, and
 * the buttons that can act ([NoteJob.acts]) are answered by [NoteReceiver] with the app closed. Those buttons ask for
 * the phone to be unlocked first (Android 12+); the receiver checks it again for older versions.
 */
class AndroidNotePoster(
    private val context: Context,
    private val jobs: NoteJobs,
    // What the person chose for the lock screen; «nothing» also applies to the result notices.
    private val lockScreen: () -> LockScreenNotice = { LockScreenNotice.Generic },
    // True while the Orb lock is on: the result notice then carries no chat title.
    private val hideTitles: () -> Boolean = { false },
) : NotePoster {
    private fun flags(mutable: Boolean) =
        PendingIntent.FLAG_UPDATE_CURRENT or (if (mutable && Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE)

    private fun openApp(id: Int, slot: Int, job: NoteJob): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .setAction("dev.orb.app.NOTE.$id.$slot")
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(NoteIntents.EXTRA_TOKEN, jobs.keep(job))
        return PendingIntent.getActivity(context, id * 8 + slot, intent, flags(false))
    }

    private fun base(plan: NoteChannel, title: String, text: String) =
        NotificationCompat.Builder(context, plan.id)
            .setSmallIcon(R.drawable.ic_stat_orb)
            .setColor(COLOR)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)

    override fun show(plan: NotificationPlan) {
        NotifyChannels.ensure(context)
        jobs.drop(plan.id)
        val b = base(plan.channel, plan.title, plan.text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(plan.text))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(openApp(plan.id, 0, plan.tap))
        if (plan.silent) b.setSilent(true)
        when (plan.lockScreen) {
            LockScreenNotice.Full -> b.setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            LockScreenNotice.Generic -> {
                b.setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                b.setPublicVersion(base(plan.channel, plan.publicTitle, plan.publicText).build())
            }
            // SECRET: nothing at all while locked; no public version is given, so there is nothing to show instead.
            LockScreenNotice.Hidden -> b.setVisibility(NotificationCompat.VISIBILITY_SECRET)
        }
        plan.actions.forEachIndexed { i, a ->
            val slot = i + 1
            if (!a.job.acts) {
                b.addAction(0, a.label, openApp(plan.id, slot, a.job))
                return@forEachIndexed
            }
            val intent = Intent(context, NoteReceiver::class.java)
                .setAction("dev.orb.app.NOTE_ACTION.${plan.id}.$i")
                .putExtra(NoteIntents.EXTRA_TOKEN, jobs.keep(a.job))
            val pending = PendingIntent.getBroadcast(context, plan.id * 8 + slot, intent, flags(mutable = a.input))
            val action = NotificationCompat.Action.Builder(0, a.label, pending).setAuthenticationRequired(true)
            if (a.input) action.addRemoteInput(RemoteInput.Builder(NoteIntents.REPLY_KEY).setLabel(a.label).build()).setAllowGeneratedReplies(false)
            b.addAction(action.build())
        }
        notify(plan.id, b)
    }

    override fun say(job: NoteJob, text: String, goneAfterMs: Long?) {
        NotifyChannels.ensure(context)
        val title = if (hideTitles()) "Orb" else job.title
        val tap = NoteJob(job.group, "tap", title, target = job.target)
        val b = base(NoteChannel.Messages, title, text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setSilent(true)
            .setContentIntent(openApp(job.group, 0, tap))
        if (lockScreen() == LockScreenNotice.Hidden) b.setVisibility(NotificationCompat.VISIBILITY_SECRET)
        if (goneAfterMs != null) b.setTimeoutAfter(goneAfterMs)
        notify(job.group, b)
    }

    override fun clearNotes() {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        for (s in nm.activeNotifications) {
            if (s.id >= PcNotes.FIRST_ID && s.id < PcNotes.FIRST_ID + PcNotes.ID_COUNT) nm.cancel(s.id)
        }
        jobs.forgetActing()
    }

    private fun notify(id: Int, b: NotificationCompat.Builder) {
        try {
            NotificationManagerCompat.from(context).notify(id, b.build())
        } catch (e: SecurityException) {
            // Notifications turned off in Android's settings: there is nothing to show.
        }
    }

    private companion object {
        const val COLOR = 0xFF5B6EE8.toInt()
    }
}

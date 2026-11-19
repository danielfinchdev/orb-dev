package dev.orb.app.notify

import android.content.Context
import android.content.Intent
import android.provider.Settings

/** The way to Android's own notice settings: sound, importance and the permission live there, not in Orb. */
interface NoticeSettings {
    /** The settings of all the notices of Orb. */
    fun openApp()

    /** The settings of one channel (its sound, vibration and importance). */
    fun openChannel(channel: NoteChannel)
}

class AndroidNoticeSettings(private val context: Context) : NoticeSettings {
    override fun openApp() = start(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS))

    override fun openChannel(channel: NoteChannel) {
        // A channel exists only after its first notice; the page of a missing one would be empty.
        NotifyChannels.ensure(context)
        start(Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_CHANNEL_ID, channel.id))
    }

    private fun start(intent: Intent) {
        intent.putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { context.startActivity(intent) } catch (e: Exception) { /* no settings screen to show */ }
    }
}

package dev.orb.app.notify

import android.content.Context
import android.content.Intent
import android.app.NotificationManager
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * What Android lets Orb show right now, read from the system and never remembered.
 *
 * @property allowed the permission (Android 13 and later) and the app-wide switch of Android are on.
 * @property canAsk Android's own dialog can still be shown: version 13 or later, and it was not shown before.
 * @property offChannels the notice channels that matter (messages and approvals) that the person turned off in Android.
 */
data class NoticeStatus(val allowed: Boolean, val canAsk: Boolean, val offChannels: List<NoteChannel> = emptyList()) {
    /** True only when a notice can really arrive: a switch that says «on» must mean this. */
    val working: Boolean get() = allowed && offChannels.isEmpty()

    companion object {
        val On = NoticeStatus(allowed = true, canAsk = false)
    }
}

/** Whether Android lets Orb show notices, and the way to ask for it. */
interface NotificationAccess {
    /** The permission itself (not the channels): what the first-run flow reports. */
    val enabled: StateFlow<Boolean>
    val status: StateFlow<NoticeStatus>
    fun refresh()

    /** Shows Android's permission dialog the first time; afterwards the system's notification settings of Orb. */
    fun request()

    /** Android's answer to the dialog shown by [request]. */
    fun dialogResult(granted: Boolean)
}

// Android answers a request it will not show at once; a person needs far longer than this to read and tap the dialog.
private const val NO_DIALOG_NANOS = 300_000_000L

class AndroidNotificationAccess(
    private val context: Context,
    private val prefs: NotifyPrefs,
    private val sdk: Int = Build.VERSION.SDK_INT,
    private val clock: () -> Long = { System.nanoTime() },
) : NotificationAccess {
    private val _status = MutableStateFlow(read())
    override val status: StateFlow<NoticeStatus> = _status.asStateFlow()
    private val _enabled = MutableStateFlow(_status.value.allowed)
    override val enabled: StateFlow<Boolean> = _enabled.asStateFlow()

    /** Set by the activity, which owns the permission dialog. */
    @Volatile
    var launchDialog: (() -> Unit)? = null

    private var askedAt: Long? = null

    private fun read(): NoticeStatus {
        val compat = NotificationManagerCompat.from(context)
        val allowed = compat.areNotificationsEnabled()
        val off = if (!allowed) emptyList() else listOf(NoteChannel.Messages, NoteChannel.Approvals).filter {
            // A channel that does not exist yet has not been turned off by anybody.
            compat.getNotificationChannelCompat(it.id)?.importance == NotificationManager.IMPORTANCE_NONE
        }
        return NoticeStatus(allowed, canAsk = sdk >= 33 && !prefs.permissionAsked, offChannels = off)
    }

    override fun refresh() {
        val now = read()
        _status.value = now
        _enabled.value = now.allowed
    }

    override fun request() {
        refresh()
        if (_status.value.allowed) return
        val dialog = launchDialog
        if (_status.value.canAsk && dialog != null) {
            prefs.permissionAsked = true
            askedAt = clock()
            dialog()
            refresh()
            return
        }
        openSettings()
    }

    override fun dialogResult(granted: Boolean) {
        val since = askedAt
        askedAt = null
        refresh()
        // Android refuses without showing the dialog once it was refused for good (or answered by an older version of the
        // app): the button must still lead somewhere, so the settings page opens instead.
        if (!granted && since != null && clock() - since < NO_DIALOG_NANOS) openSettings()
    }

    private fun openSettings() {
        val intent = SettingsIntents.appNotices(context.packageName)
        try { context.startActivity(intent) } catch (e: Exception) { /* no settings screen to show */ }
    }
}

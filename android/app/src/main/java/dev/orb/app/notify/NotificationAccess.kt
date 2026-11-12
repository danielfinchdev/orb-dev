package dev.orb.app.notify

import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Whether Android lets Orb show notices, and the way to ask for it. */
interface NotificationAccess {
    val enabled: StateFlow<Boolean>
    fun refresh()

    /** Shows Android's permission dialog the first time; afterwards the system's notification settings of Orb. */
    fun request()
}

class AndroidNotificationAccess(private val context: Context, private val prefs: NotifyPrefs) : NotificationAccess {
    private val _enabled = MutableStateFlow(NotificationManagerCompat.from(context).areNotificationsEnabled())
    override val enabled: StateFlow<Boolean> = _enabled.asStateFlow()

    /** Set by the activity, which owns the permission dialog. */
    @Volatile
    var launchDialog: (() -> Unit)? = null

    override fun refresh() {
        _enabled.value = NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    override fun request() {
        refresh()
        if (_enabled.value) return
        val dialog = launchDialog
        if (Build.VERSION.SDK_INT >= 33 && dialog != null && !prefs.permissionAsked) {
            prefs.permissionAsked = true
            dialog()
            return
        }
        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { context.startActivity(intent) } catch (e: Exception) { /* no settings screen to show */ }
    }
}

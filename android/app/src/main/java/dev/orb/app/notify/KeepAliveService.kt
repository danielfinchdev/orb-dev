package dev.orb.app.notify

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import dev.orb.app.MainActivity
import dev.orb.app.OrbApplication
import dev.orb.app.R
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * «Mantener conectado»: a foreground service whose only job is to keep the app's process, and with it the link to the
 * PC, alive while the app is closed. It holds no wake lock; the link is the same one the app uses and the notices come
 * from [Notifier]. The fixed notice stays in the quiet «Estado de la conexión» channel.
 */
class KeepAliveService : Service() {
    private var watching: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val container = (application as OrbApplication).container
        try {
            NotifyChannels.ensure(this)
            val first = build(container.keepAliveText.value)
            if (Build.VERSION.SDK_INT >= 33) {
                startForeground(NotifyChannels.STATUS_ID, first, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
            } else {
                startForeground(NotifyChannels.STATUS_ID, first)
            }
        } catch (e: Exception) {
            // Android may refuse a foreground service started from the background; nothing to keep alive then.
            stopSelf()
            return START_NOT_STICKY
        }
        container.setKeepAlive(true)
        if (watching == null) {
            watching = container.scope.launch {
                container.keepAliveText.collect { text ->
                    try { NotificationManagerCompat.from(this@KeepAliveService).notify(NotifyChannels.STATUS_ID, build(text)) } catch (e: SecurityException) { /* notices off */ }
                }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        watching?.cancel()
        watching = null
        (application as OrbApplication).container.setKeepAlive(false)
        super.onDestroy()
    }

    private fun build(text: String): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, NoteChannel.Status.id)
            .setSmallIcon(R.drawable.ic_stat_orb)
            .setContentTitle("Orb")
            .setContentText(text)
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .setContentIntent(open)
            .build()
    }
}

class AndroidServiceLauncher(private val context: Context) : ServiceLauncher {
    override fun start(): Boolean = try {
        ContextCompat.startForegroundService(context, Intent(context, KeepAliveService::class.java))
        true
    } catch (e: Exception) {
        // Android 12+ does not let an app in the background start one (ForegroundServiceStartNotAllowedException).
        false
    }

    override fun stop() {
        context.stopService(Intent(context, KeepAliveService::class.java))
    }
}

class AndroidNetworkWatcher(private val context: Context) : NetworkWatcher {
    override fun watch(onChange: () -> Unit): AutoCloseable {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return AutoCloseable { }
        // Registering reports the network that is already there; only later ones are a change.
        var skip = cm.activeNetwork != null
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                if (skip) { skip = false; return }
                onChange()
            }
        }
        return try {
            cm.registerDefaultNetworkCallback(callback)
            AutoCloseable { try { cm.unregisterNetworkCallback(callback) } catch (e: Exception) { /* already gone */ } }
        } catch (e: Exception) {
            AutoCloseable { }
        }
    }
}

/** Brings the service back after a restart of the phone, when it was on and a PC is linked. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val container = (context.applicationContext as OrbApplication).container
        if (container.notifyPrefs.linked && container.notifyPrefs.settings.value.keepConnected) container.keepAliveLauncher.start()
    }
}

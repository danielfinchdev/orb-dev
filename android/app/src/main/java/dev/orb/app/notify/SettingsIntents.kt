package dev.orb.app.notify

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings

/**
 * The pages of Android's settings the app sends the person to. The notice pages exist only from Android 8; before that the
 * same action does nothing, so the app's own page (where notices can be switched off) opens instead.
 */
object SettingsIntents {
    fun appDetails(pkg: String): Intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", pkg, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun appNotices(pkg: String, sdk: Int = Build.VERSION.SDK_INT): Intent =
        if (sdk >= Build.VERSION_CODES.O) Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        else appDetails(pkg)

    fun channelNotices(pkg: String, channelId: String, sdk: Int = Build.VERSION.SDK_INT): Intent =
        if (sdk >= Build.VERSION_CODES.O) {
            Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_CHANNEL_ID, channelId).putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        } else appDetails(pkg)
}

package dev.orb.app

import android.content.Context
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The merged manifest (ours plus every library's) asks for exactly these permissions. A new line here is a decision about
 * what the app may do on somebody's phone: say why in the commit, and in the permissions note, before adding it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ManifestPermissionsTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    private fun requested(): List<String> =
        context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS).requestedPermissions.orEmpty().sorted()

    @Test fun theRequestedPermissionsAreExactlyTheOnesTheAppUses() {
        val expected = listOf(
            // The encrypted link to the PC and the update check.
            "android.permission.INTERNET",
            // Knowing a network came back, to retry the PC at once.
            "android.permission.ACCESS_NETWORK_STATE",
            // Notices (asked on Android 13 and later, after a plain sentence).
            "android.permission.POST_NOTIFICATIONS",
            // «Mantener conectado»: a foreground service of type remote messaging.
            "android.permission.FOREGROUND_SERVICE",
            "android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING",
            // Bringing that service back after a restart of the phone or an update of the app.
            "android.permission.RECEIVE_BOOT_COMPLETED",
            // The QR scanner only; the short code works without it.
            "android.permission.CAMERA",
            // The app lock (androidx.biometric: the second one is for Android 8 and 9).
            "android.permission.USE_BIOMETRIC",
            "android.permission.USE_FINGERPRINT",
            // androidx.core: keeps broadcast receivers registered in code from being reached by other apps.
            "${context.packageName}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
        ).sorted()
        assertEquals(expected, requested())
    }

    @Test fun nothingBeyondTheListCanSneakIn() {
        val forbidden = listOf(
            "RECORD_AUDIO", "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "MANAGE_EXTERNAL_STORAGE", "READ_MEDIA_IMAGES",
            "ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "READ_CONTACTS", "REQUEST_INSTALL_PACKAGES",
            "REQUEST_IGNORE_BATTERY_OPTIMIZATIONS", "QUERY_ALL_PACKAGES", "SYSTEM_ALERT_WINDOW", "VIBRATE", "WAKE_LOCK",
        ).map { "android.permission.$it" }
        assertEquals(emptyList<String>(), requested().filter { it in forbidden })
    }
}

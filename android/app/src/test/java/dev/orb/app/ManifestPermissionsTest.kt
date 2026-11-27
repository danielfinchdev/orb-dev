package dev.orb.app

import android.content.Context
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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
            "android.permission.ACCESS_LOCAL_NETWORK",
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

    /** Every component other apps can start, whoever declared it. */
    private fun exported(): List<Pair<String, String?>> {
        val info = context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.GET_ACTIVITIES or PackageManager.GET_SERVICES or PackageManager.GET_RECEIVERS or PackageManager.GET_PROVIDERS,
        )
        val all = (info.activities.orEmpty().map { it as android.content.pm.ComponentInfo to it.permission } +
            info.services.orEmpty().map { it as android.content.pm.ComponentInfo to it.permission } +
            info.receivers.orEmpty().map { it as android.content.pm.ComponentInfo to it.permission } +
            info.providers.orEmpty().map { it as android.content.pm.ComponentInfo to (it.readPermission ?: it.writePermission) })
        return all.filter { it.first.exported }.map { it.first.name to it.second }
    }

    // An empty affinity keeps another app's activity from being slipped into Orb's task (task hijacking on Android 7-10).
    /** Pan or no mode at all would lift the whole window while `imePadding` also lifts the box: a gap above the keyboard. */
    @Test fun theEntryActivityResizesForTheKeyboardSoOnlyTheInsetsMoveTheBox() {
        val info = context.packageManager.getActivityInfo(android.content.ComponentName(context, "dev.orb.app.MainActivity"), 0)
        assertEquals(
            android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE,
            info.softInputMode and android.view.WindowManager.LayoutParams.SOFT_INPUT_MASK_ADJUST,
        )
    }

    @Test fun theEntryActivityHasAnEmptyTaskAffinity() {
        // Robolectric reports an empty affinity as null, so the manifest source is what is checked.
        val xml = java.io.File("src/main/AndroidManifest.xml").readText()
        val main = Regex("<activity\\b[^>]*android:name=\"\\.MainActivity\"[^>]*>").find(xml)!!.value
        assertTrue(main, main.contains("android:taskAffinity=\"\""))
    }

    @Test fun theOnlyComponentsOthersCanStartAreTheEntryActivityAndTheBootReceiver() {
        // ComponentActivity is the host the debug-only Compose test library adds; it is not in a release build.
        val own = exported().filter { it.second == null && it.first != "androidx.activity.ComponentActivity" }.map { it.first }.sorted()
        assertEquals(listOf("dev.orb.app.MainActivity", "dev.orb.app.notify.BootReceiver").sorted(), own)
    }

    @Test fun libraryComponentsThatAreExportedStayBehindAPermission() {
        // Not a failure: written down so a new one is noticed (profileinstaller's receiver is guarded by DUMP).
        val guarded = exported().filter { it.second != null }
        println("exported library components behind a permission: $guarded")
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

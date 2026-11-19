package dev.orb.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Where the app may ask Android for a permission. Reading the sources is the only way to prove that nothing asks at start-up
 * or from a service: every request must be reachable only from a tap, after the sentence that explains it.
 */
class PermissionRequestsTest {
    private val main: File = generateSequence(File("").absoluteFile) { it.parentFile }
        .map { File(it, "app/src/main/java/dev/orb/app") }.first { it.isDirectory }

    private fun sources() = main.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()

    private fun relative(f: File) = f.relativeTo(main).path.replace('\\', '/')

    @Test fun onlyTheNoticeDialogAndTheScannerEverRequestAPermission() {
        val asking = Regex("""RequestPermission\(|RequestMultiplePermissions\(|requestPermissions\(|\.launch\(Manifest\.permission""")
        val files = sources().filter { asking.containsMatchIn(it.readText()) }.map(::relative).sorted()
        assertEquals(listOf("MainActivity.kt", "ui/scan/ScanScreen.kt"), files)
    }

    @Test fun theActivityOnlyKeepsTheDialogReadyForTheNoticeAccessAndNeverShowsItItself() {
        val launches = File(main, "MainActivity.kt").readLines().filter { ".launch(" in it }
        assertEquals(1, launches.size)
        // It is the callback that the notice access calls from a tap (see AndroidNotificationAccess.request), not a call of onCreate.
        assertTrue(launches.single().contains("launchDialog ="))
    }

    @Test fun theNoticeDialogIsOnlyReachedThroughRequestFromTheFirstRunGateAndThisPhone() {
        val callers = sources().filter { "dialog()" in it.readText() }.map(::relative)
        assertEquals(listOf("notify/NotificationAccess.kt"), callers)
        val requesters = sources().filter { "notificationAccess.request()" in it.readText() || "access.request()" in it.readText() }.map(::relative).sorted()
        assertEquals(listOf("ui/thisphone/ThisPhoneModel.kt", "ui/welcome/AndroidNoticeGate.kt"), requesters)
    }

    @Test fun theScannerAsksOnlyWhenItOpensAndNeverAgainByItself() {
        assertTrue(File(main, "ui/scan/ScanScreen.kt").readText().contains("takeRequest()"))
    }
}

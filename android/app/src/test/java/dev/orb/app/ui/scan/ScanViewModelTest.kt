package dev.orb.app.ui.scan

import androidx.lifecycle.SavedStateHandle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ScanViewModelTest {
    private class Camera(
        var granted: Boolean = false,
        var explain: Boolean = false,
        override var hasCamera: Boolean = true,
    ) : CameraAccess {
        var settings = 0
        override fun granted() = granted
        override fun canExplain() = explain
        override fun openSettings() { settings++ }
    }

    private val link = "http://192.168.1.20:3131/#vincular=ABCDEF&pc=" + "A".repeat(43) + "&v=4"

    @Test fun grantedPermissionOpensTheCameraAndNothingIsAsked() {
        val vm = ScanViewModel(Camera(granted = true))
        assertEquals(ScanPermission.Granted, vm.state.value.permission)
        assertFalse(vm.takeRequest())
    }

    @Test fun theDialogIsAskedOnceAndNeverAgainByItself() {
        val vm = ScanViewModel(Camera())
        assertTrue(vm.takeRequest())
        assertFalse(vm.takeRequest())
        vm.permissionResult(false)
        assertFalse(vm.takeRequest())
        vm.resumed()
        assertFalse(vm.takeRequest())
    }

    @Test fun aFirstRefusalCanBeAskedAgainWithTheButtonOnly() {
        val camera = Camera(explain = true)
        val vm = ScanViewModel(camera)
        vm.takeRequest()
        vm.permissionResult(false)
        assertEquals(ScanPermission.Denied, vm.state.value.permission)
        assertTrue(vm.canAskAgain())
    }

    @Test fun aRefusalForGoodSendsThePersonToTheSettingsAndTheStateIsReadOnReturn() {
        val camera = Camera(explain = false)
        val vm = ScanViewModel(camera)
        vm.takeRequest()
        vm.asking()
        vm.permissionResult(false)
        assertEquals(ScanPermission.Blocked, vm.state.value.permission)
        assertFalse(vm.canAskAgain())
        vm.openSettings()
        assertEquals(1, camera.settings)
        vm.resumed()
        assertEquals(ScanPermission.Blocked, vm.state.value.permission)
        camera.granted = true
        vm.resumed()
        assertEquals(ScanPermission.Granted, vm.state.value.permission)
    }

    @Test fun closingTheDialogByTappingOutsideIsNotARefusalForGood() {
        var now = 0L
        val vm = ScanViewModel(Camera(explain = false)) { now }
        vm.takeRequest()
        vm.asking()
        now += 2_000_000_000L // the person looked at the dialog for two seconds
        vm.permissionResult(false)
        assertEquals(ScanPermission.Denied, vm.state.value.permission)
        assertTrue(vm.canAskAgain())
    }

    @Test fun aSecondRefusalIsFinalEvenIfTheDialogWasSeen() {
        var now = 0L
        val vm = ScanViewModel(Camera(explain = false)) { now }
        vm.takeRequest()
        vm.asking(); now += 2_000_000_000L; vm.permissionResult(false)
        vm.asking(); now += 2_000_000_000L; vm.permissionResult(false)
        assertEquals(ScanPermission.Blocked, vm.state.value.permission)
    }

    @Test fun anAnswerWithoutTheDialogIsFinalAtOnce() {
        var now = 0L
        val vm = ScanViewModel(Camera(explain = false)) { now }
        vm.takeRequest()
        vm.asking(); now += 20_000_000L; vm.permissionResult(false)
        assertEquals(ScanPermission.Blocked, vm.state.value.permission)
    }

    @Test fun theScannerCanBeRecreatedWithoutTheWelcomePageInMemory() {
        // The scanner only needs the camera; what it read travels through the welcome's saved state.
        val handle = SavedStateHandle()
        val vm = ScanViewModel(Camera(granted = true))
        vm.onText(link)
        ScanHandoff.deliver(handle, vm.state.value.found!!)
        val recreated = ScanViewModel(Camera(granted = true))
        assertNull(recreated.state.value.found)
        assertEquals(link, ScanHandoff.take(handle))
        assertNull(ScanHandoff.take(handle))
    }

    @Test fun pastingFromTheScannerIsTakenOnce() {
        val handle = SavedStateHandle()
        ScanHandoff.deliverPaste(handle)
        assertTrue(ScanHandoff.takePaste(handle))
        assertFalse(ScanHandoff.takePaste(handle))
    }

    @Test fun deliveringToNoOneIsHarmless() = ScanHandoff.deliver(null, link)

    @Test fun aPermissionTakenAwayInTheSettingsIsNoticedOnReturn() {
        val camera = Camera(granted = true)
        val vm = ScanViewModel(camera)
        camera.granted = false
        vm.resumed()
        assertEquals(ScanPermission.Blocked, vm.state.value.permission)
    }

    @Test fun aValidOrbLinkIsAcceptedOnceEvenIfTheCameraSeesItAgain() {
        val vm = ScanViewModel(Camera(granted = true))
        vm.onText(link)
        assertEquals(link, vm.state.value.found)
        vm.onText(link)
        vm.onText(link.replace("ABCDEF", "ZZZZZZ"))
        assertEquals(link, vm.state.value.found)
    }

    @Test fun somethingThatIsNotOrbIsIgnoredWithAPhraseAndScanningGoesOn() {
        val vm = ScanViewModel(Camera(granted = true))
        vm.onText("https://example.com/promo")
        assertEquals("Ese código no es de Orb.", vm.state.value.hint)
        assertNull(vm.state.value.found)
        vm.onText("WIFI:S:casa;T:WPA;P:clave;;")
        assertNull(vm.state.value.found)
        vm.onText(link)
        assertEquals(link, vm.state.value.found)
        assertNull(vm.state.value.hint)
    }

    @Test fun nothingIsReadWithoutThePermission() {
        val vm = ScanViewModel(Camera())
        vm.onText(link)
        assertNull(vm.state.value.found)
    }

    @Test fun theTorchNeedsAFlashAndGoesOffWhenTheScreenLeaves() {
        val vm = ScanViewModel(Camera(granted = true))
        vm.toggleTorch()
        assertFalse(vm.state.value.torch)
        vm.flashFound(true)
        vm.toggleTorch()
        assertTrue(vm.state.value.torch)
        vm.paused()
        assertFalse(vm.state.value.torch)
        vm.toggleTorch()
        vm.flashFound(false)
        assertFalse(vm.state.value.torch)
    }

    @Test fun readingALinkSwitchesTheTorchOff() {
        val vm = ScanViewModel(Camera(granted = true))
        vm.flashFound(true)
        vm.toggleTorch()
        vm.onText(link)
        assertFalse(vm.state.value.torch)
    }

    @Test fun aPhoneWithoutACameraGoesToTheShortCodeSheet() {
        var scanner = 0
        var sheet = 0
        openScanner(false, { scanner++ }, { sheet++ })
        openScanner(true, { scanner++ }, { sheet++ })
        assertEquals(1, scanner)
        assertEquals(1, sheet)
    }

    @Test fun theManifestAsksForTheCameraButDoesNotRequireOneAndNeverForVibration() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertTrue(manifest.contains("android.permission.CAMERA"))
        assertTrue(Regex("""android.hardware.camera"\s+android:required="false"""").containsMatchIn(manifest))
        assertFalse(manifest.contains("android.permission.VIBRATE"))
    }
}

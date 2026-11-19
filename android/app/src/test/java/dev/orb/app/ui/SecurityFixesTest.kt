package dev.orb.app.ui

import dev.orb.app.link.net.PairError
import dev.orb.app.link.net.pcNameOrNull
import dev.orb.app.link.payload.LinkVia
import dev.orb.app.ui.scan.CameraAccess
import dev.orb.app.ui.scan.ScanViewModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WelcomeJumpTest {
    @Test fun theConnectionBeingUnlinkedWhileTheLocalLinkIsKeptDoesNotLeaveTheScreen() {
        // The PC removed this phone: runtime stays non-null, so there is no linked -> unlinked change.
        assertFalse(shouldReturnToWelcome(wasLinked = true, linked = true, onWelcomeOrScan = false))
    }

    @Test fun unlinkingByThePersonGoesOnce() {
        assertTrue(shouldReturnToWelcome(wasLinked = true, linked = false, onWelcomeOrScan = false))
        // The effect records the new state afterwards, so a relaunch finds no change.
        assertFalse(shouldReturnToWelcome(wasLinked = false, linked = false, onWelcomeOrScan = false))
    }

    @Test fun aRecreatedHostWithoutLinkNeitherNavigatesNorClosesTheScanner() {
        assertFalse(shouldReturnToWelcome(wasLinked = false, linked = false, onWelcomeOrScan = true))
        assertFalse(shouldReturnToWelcome(wasLinked = true, linked = false, onWelcomeOrScan = true))
    }
}

class ScanActivityTest {
    private class Camera : CameraAccess {
        var attached: android.app.Activity? = null
        var calls = 0
        override val hasCamera = true
        override fun granted() = false
        override fun canExplain() = attached != null
        override fun openSettings() {}
        override fun attach(current: android.app.Activity?) { attached = current; calls++ }
    }

    @Test fun theViewModelHandsTheCurrentActivityToItsOwnAccess() {
        val camera = Camera()
        val vm = ScanViewModel(camera)
        assertFalse(camera.canExplain())
        vm.attachActivity(null)
        vm.attachActivity(null)
        assertEquals(2, camera.calls)
    }
}

class PairTextViaTest {
    private val spent = PairError.Refused(401, "x", null, null, null)

    @Test fun aMistypedShortCodeIsNotCalledSpent() {
        val t = pairErrorText(spent, LinkVia.CODE)
        assertEquals("El código no coincide o ya no vale. Compruébalo o genera uno nuevo en el PC.", t)
    }

    @Test fun qrAndLinkKeepTheUsualText() {
        assertTrue(pairErrorText(spent, LinkVia.QR).contains("ya no vale: ha caducado"))
        assertTrue(pairErrorText(spent).contains("ya no vale: ha caducado"))
    }
}

class PcNameTextTest {
    @Test fun formatCharactersAreDropped() {
        // U+202E reverses what follows; U+200B and U+2060 are invisible.
        assertEquals("Mi PC", pcNameOrNull("\u202EMi\u200B P\u2060C"))
        assertNull(pcNameOrNull("\u202E\u200B"))
    }

    @Test fun aNormalNamePasses() = assertEquals("Mi PC", pcNameOrNull("Mi PC"))

    @Test fun lineBreaksAndControlsBecomeOneLine() {
        assertEquals("Casa Salón", pcNameOrNull("Casa\n\r\u0007Salón"))
        assertEquals("a b", pcNameOrNull("a b"))
    }

    @Test fun aLongNameIsCutAtSixty() {
        assertEquals(60, pcNameOrNull("x".repeat(500))!!.length)
    }

    @Test fun blankIsNull() {
        assertNull(pcNameOrNull("  \n "))
        assertNull(pcNameOrNull(null))
    }
}

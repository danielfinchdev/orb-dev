package dev.orb.app.ui.scan

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ScanScreenTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private fun show(state: ScanUiState, actions: ScanActions = ScanActions()) {
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, false) { ScanContent(state, actions) } }
        rule.waitForIdle()
    }

    @Test fun theCameraStateShowsTheRealExpiryAndTheWayOut() {
        var pasted = 0
        show(ScanUiState(permission = ScanPermission.Granted), ScanActions(paste = { pasted++ }))
        rule.onNodeWithText("Escanea el QR de tu Orb").assertIsDisplayed()
        rule.onNodeWithText("Caduca a los 5 minutos y sirve una vez.").assertIsDisplayed()
        rule.onNodeWithText("Pegar el enlace del QR").performClick()
        assertEquals(1, pasted)
    }

    @Test fun theTorchButtonOnlyAppearsWithAFlash() {
        show(ScanUiState(permission = ScanPermission.Granted, hasFlash = false))
        rule.onNodeWithContentDescription("Linterna").assertDoesNotExist()
    }

    @Test fun theTorchShowsWhenThePhoneHasAFlash() {
        show(ScanUiState(permission = ScanPermission.Granted, hasFlash = true, torch = true))
        rule.onNodeWithContentDescription("Linterna").assertIsDisplayed()
        rule.onNodeWithText("Linterna encendida. Caduca a los 5 minutos y sirve una vez.").assertIsDisplayed()
    }

    @Test fun aRefusedPermissionOffersTheButtonThePasteAndTheCodeByHand() {
        var given = 0
        var pasted = 0
        var typed = 0
        show(ScanUiState(permission = ScanPermission.Denied), ScanActions(give = { given++ }, paste = { pasted++ }, typeCode = { typed++ }))
        rule.onNodeWithText("Necesito la cámara").assertIsDisplayed()
        rule.onNodeWithText("Orb solo la usa para leer el QR de tu PC. La imagen no sale del móvil.").assertIsDisplayed()
        rule.onNodeWithText("Dar permiso de cámara").performClick()
        rule.onNodeWithText("Pegar el enlace del QR").performClick()
        rule.onNodeWithText("Escribir el código a mano").performClick()
        assertEquals(1, given)
        assertEquals(1, pasted)
        assertEquals(1, typed)
    }

    @Test fun aPermissionRefusedForGoodOpensTheSettingsInstead() {
        var settings = 0
        show(ScanUiState(permission = ScanPermission.Blocked), ScanActions(settings = { settings++ }))
        rule.onNodeWithText("Dar permiso de cámara").assertDoesNotExist()
        rule.onNodeWithText("Abrir los ajustes").performClick()
        assertEquals(1, settings)
    }

    @Test fun aRefusedCodeShowsItsPhraseWhileScanningGoesOn() {
        show(ScanUiState(permission = ScanPermission.Granted, hint = ScanTexts.NOT_ORB))
        rule.onNodeWithText("Ese código no es de Orb.").assertExists()
        rule.onNodeWithText("Escanea el QR de tu Orb").assertIsDisplayed()
    }

    private class Camera : CameraAccess {
        override val hasCamera = true
        override fun granted() = true
        override fun canExplain() = true
        override fun openSettings() {}
    }

    private fun scanning(text: String): Int {
        var scanned = 0
        val vm = ScanViewModel(Camera())
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, false) {
                ScanScreen(vm, onBack = {}, onScanned = { scanned++ }, onPaste = {}, viewfinder = { androidx.compose.runtime.LaunchedEffect(Unit) { vm.onText(text) } })
            }
        }
        rule.waitForIdle()
        return scanned
    }

    @Test fun aQrThatIsNotOrbNeverReachesTheWelcomePage() {
        assertEquals(0, scanning("https://example.com/promo"))
        rule.onNodeWithText("Ese código no es de Orb.").assertExists()
    }

    @Test fun anOrbQrReachesTheWelcomePageOnce() {
        assertEquals(1, scanning("http://192.168.1.20:3131/#vincular=ABCDEF&pc=" + "A".repeat(43) + "&v=4"))
    }
}

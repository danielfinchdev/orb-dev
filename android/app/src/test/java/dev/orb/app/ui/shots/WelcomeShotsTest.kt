package dev.orb.app.ui.shots

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.welcome.PcIdentity
import dev.orb.app.ui.welcome.WelcomeActions
import dev.orb.app.ui.welcome.WelcomeContent
import dev.orb.app.ui.welcome.WelcomeStage
import dev.orb.app.ui.welcome.WelcomeUiState
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** First start, screens 01, 03 and 04 with their variants, light and dark: `ORB_SHOTS=1` turns them on. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = Shots.PHONE)
class WelcomeShotsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val qr = PcIdentity("DanLaptop", listOf("8f3a", "c21d", "77e0"), viaCode = false)
    private val short = qr.copy(viaCode = true)

    private fun shoot(name: String, state: WelcomeUiState) {
        Shots.assumeEnabled()
        var dark by mutableStateOf(false)
        rule.setContent { ShotFrame(OrbPaletteChoice.Grafito, dark) { WelcomeContent(state, WelcomeActions()) } }
        rule.waitForIdle()
        Shots.save(rule.activity, "$name-claro")
        dark = true
        rule.waitForIdle()
        Shots.save(rule.activity, "$name-oscuro")
    }

    @Test fun bienvenida() = shoot("01-bienvenida", WelcomeUiState())
    @Test fun codigoCorto() = shoot("01-bienvenida-codigo-corto", WelcomeUiState(sheet = true))
    @Test fun huellaQr() = shoot("03-huella-qr", WelcomeUiState(stage = WelcomeStage.Fingerprint, pc = qr, password = "secreto", passwordLength = 7))
    @Test fun huellaCodigoCorto() = shoot("03-huella-codigo-corto", WelcomeUiState(stage = WelcomeStage.Fingerprint, pc = short))
    @Test fun huellaComprobando() = shoot("03-huella-comprobando", WelcomeUiState(stage = WelcomeStage.Fingerprint, pc = qr, checking = true, passwordLength = 10))
    @Test fun huellaMal() = shoot(
        "03-huella-contrasena-mal",
        WelcomeUiState(stage = WelcomeStage.Fingerprint, pc = qr, password = "secreto", passwordLength = 7, passwordError = "No es la contraseña. Te quedan 3 intentos con este código."),
    )
    @Test fun enlazandoPasos() = shoot("04-enlazando-pasos", WelcomeUiState(stage = WelcomeStage.Linking, pc = qr))
    @Test fun enlazandoAvisos() = shoot("04-enlazando-avisos", WelcomeUiState(stage = WelcomeStage.Done, pc = qr, noticeDialog = true))
    @Test fun enlazandoListo() = shoot("04-enlazando-listo", WelcomeUiState(stage = WelcomeStage.Done, pc = qr, noticesOn = true))
    @Test fun enlazandoAhoraNo() = shoot("04-enlazando-ahora-no", WelcomeUiState(stage = WelcomeStage.Done, pc = qr, noticesLater = true))
}

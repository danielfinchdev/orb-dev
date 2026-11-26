package dev.orb.app.ui.shots

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import dev.orb.app.lock.LockNotice
import dev.orb.app.ui.chats.DeletedChatPage
import dev.orb.app.ui.lock.LockContent
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.welcome.WelcomeActions
import dev.orb.app.ui.welcome.WelcomeContent
import dev.orb.app.ui.welcome.WelcomeErrorKind
import dev.orb.app.ui.welcome.WelcomeUiState
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Screens 05 (lock) and 08 (errors) with their variants, light and dark: `ORB_SHOTS=1` turns them on. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = Shots.PHONE)
class ErrorShotsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private fun shoot(name: String, content: @androidx.compose.runtime.Composable () -> Unit) {
        Shots.assumeEnabled()
        var dark by mutableStateOf(false)
        rule.setContent { ShotFrame(OrbPaletteChoice.Grafito, dark) { content() } }
        rule.waitForIdle()
        Shots.save(rule.activity, "$name-claro")
        dark = true
        rule.waitForIdle()
        Shots.save(rule.activity, "$name-oscuro")
    }

    @Test fun desbloqueoEspera() = shoot("05-desbloqueo") { LockContent(null, busy = false, onUnlock = {}, onPin = {}) }
    @Test fun desbloqueoFallo() = shoot("05-desbloqueo-fallo") { LockContent(LockNotice.NotRecognized, busy = false, onUnlock = {}, onPin = {}) }
    @Test fun desbloqueoBloqueado() = shoot("05-desbloqueo-bloqueado") { LockContent(LockNotice.Blocked, busy = false, onUnlock = {}, onPin = {}) }

    @Test fun qrCaducado() = shoot("08-qr-caducado") {
        WelcomeContent(
            WelcomeUiState(error = "El código ha caducado. Genera uno nuevo en el PC.", errorKind = WelcomeErrorKind.CodeSpent), WelcomeActions(),
        )
    }

    @Test fun direccionNoPrivada() = shoot("08-direccion-no-privada") {
        WelcomeContent(
            WelcomeUiState(error = "Esa dirección no es privada. Usa el Wi-Fi de casa o Tailscale.", errorKind = WelcomeErrorKind.NotPrivate), WelcomeActions(),
        )
    }

    @Test fun chatBorrado() = shoot("08-chat-borrado") { DeletedChatPage(onBack = {}, onRestore = null) }
    @Test fun chatBorradoRestaurable() = shoot("08-chat-borrado-restaurar") { DeletedChatPage(onBack = {}, onRestore = {}) }
}

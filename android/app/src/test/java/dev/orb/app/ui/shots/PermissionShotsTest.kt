package dev.orb.app.ui.shots

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import dev.orb.app.notify.NoteChannel
import dev.orb.app.notify.NoticeStatus
import dev.orb.app.ui.theme.MemoryStore
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.ThemePrefs
import dev.orb.app.ui.thisphone.CameraState
import dev.orb.app.ui.thisphone.FakeThisPhoneBackend
import dev.orb.app.ui.thisphone.ThisPhoneScreen
import dev.orb.app.ui.thisphone.ThisPhoneViewModel
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Pictures of «Este móvil» (screen 24) with the permission rows: `24-este-movil-grafito-<mode>-<variant>`. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = Shots.PHONE)
class PermissionShotsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private fun shot(variant: String, scrollTo: String, setup: FakeThisPhoneBackend.() -> Unit) {
        Shots.assumeEnabled()
        val backend = FakeThisPhoneBackend().apply(setup)
        val theme = ThemePrefs(MemoryStore()).also { it.setPalette(OrbPaletteChoice.Grafito) }
        val vm = ThisPhoneViewModel(backend)
        var dark by mutableStateOf(false)
        rule.setContent { ShotFrame(OrbPaletteChoice.Grafito, dark) { ThisPhoneScreen(vm, theme, onBack = {}, onLinkTest = {}, onUnlinked = {}) } }
        rule.waitForIdle()
        rule.onNodeWithText(scrollTo).performScrollTo()
        rule.waitForIdle()
        Shots.save(rule.activity, "24-este-movil-grafito-claro-$variant")
        dark = true
        rule.waitForIdle()
        Shots.save(rule.activity, "24-este-movil-grafito-oscuro-$variant")
    }

    @Test fun allowedBottom() = shot("permisos-concedidos-abajo", "Sin restricción. Android no cierra Orb para ahorrar batería.") { }

    @Test fun deniedBottom() = shot("permisos-denegados-abajo", "Limitada. Android puede cerrar Orb para ahorrar batería y dejarías de recibir avisos con la app cerrada. En la pantalla que se abre, busca Orb y déjala sin restricciones.") {
        camera = CameraState.NotAllowed
        battery = true
    }

    @Test fun noticesBlocked() = shot("avisos-desactivados", "Avisos desactivados en Android") {
        noticeStatus.value = NoticeStatus(allowed = false, canAsk = false)
    }

    @Test fun noticesAskable() = shot("avisos-permitir", "Avisos desactivados en Android") {
        noticeStatus.value = NoticeStatus(allowed = false, canAsk = true)
    }

    @Test fun channelOff() = shot("canal-apagado", "Un aviso está apagado en Android") {
        noticeStatus.value = NoticeStatus(allowed = true, canAsk = false, offChannels = listOf(NoteChannel.Messages))
    }
}

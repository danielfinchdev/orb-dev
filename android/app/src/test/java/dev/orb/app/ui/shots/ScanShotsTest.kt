package dev.orb.app.ui.shots

import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import dev.orb.app.ui.scan.ScanActions
import dev.orb.app.ui.scan.ScanContent
import dev.orb.app.ui.scan.ScanPermission
import dev.orb.app.ui.scan.ScanUiState
import dev.orb.app.ui.theme.OrbPaletteChoice
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Screen 02 with its variants, light and dark: `ORB_SHOTS=1` turns them on. The camera is a plain fill, as Robolectric has none. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = Shots.PHONE)
class ScanShotsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private fun shoot(name: String, state: ScanUiState) {
        Shots.assumeEnabled()
        var dark by mutableStateOf(false)
        rule.setContent {
            ShotFrame(OrbPaletteChoice.Grafito, dark) {
                ScanContent(state, ScanActions()) { androidx.compose.foundation.layout.Box(Modifier.matchParentSize().background(androidx.compose.ui.graphics.Color(0xFF8A8F98))) }
            }
        }
        rule.waitForIdle()
        Shots.save(rule.activity, "$name-claro")
        dark = true
        rule.waitForIdle()
        Shots.save(rule.activity, "$name-oscuro")
    }

    private val live = ScanUiState(permission = ScanPermission.Granted, hasFlash = true)

    @Test fun buscando() = shoot("02-escaner-buscando", live)
    @Test fun linterna() = shoot("02-escaner-linterna", live.copy(torch = true))
    @Test fun leido() = shoot("02-escaner-leido", live.copy(found = "x"))
    @Test fun noEsDeOrb() = shoot("02-escaner-no-es-de-orb", live.copy(hint = "Ese código no es de Orb."))
    @Test fun pidiendoPermiso() = shoot("02-escaner-pidiendo-permiso", ScanUiState())
    @Test fun sinPermiso() = shoot("02-escaner-sin-permiso", ScanUiState(permission = ScanPermission.Denied))
    @Test fun sinPermisoAjustes() = shoot("02-escaner-sin-permiso-ajustes", ScanUiState(permission = ScanPermission.Blocked))
}

package dev.orb.app.ui.shots

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.PcVersions
import dev.orb.app.lock.LockSettings
import dev.orb.app.ui.chats.ChatListScreen
import dev.orb.app.ui.chats.ChatListViewModel
import dev.orb.app.ui.chats.ChatsMenu
import dev.orb.app.ui.chats.FakeChatsBackend
import dev.orb.app.ui.chats.row
import dev.orb.app.ui.menu.InboxMenu
import dev.orb.app.ui.menu.MenuActions
import dev.orb.app.ui.menu.MenuSheet
import dev.orb.app.ui.menu.MenuState
import dev.orb.app.ui.thisphone.FakeThisPhoneBackend
import dev.orb.app.ui.thisphone.ThisPhoneScreen
import dev.orb.app.ui.thisphone.ThisPhoneViewModel
import dev.orb.app.ui.theme.MemoryStore
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.ThemePrefs
import kotlinx.coroutines.Dispatchers
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.Calendar

/**
 * Pictures of the menu (screen 23) and «Este móvil» (screen 24) in every variant of their mockups, by day and by night:
 * `ORB_SHOTS=1` turns them on. The names follow `23-menu-<palette>-<mode>[-<variant>]`.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = Shots.PHONE)
class MenuShotsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val online = ConnectionState.Online("http://100.101.102.103:4310", "DanLaptop", PcVersions(4, 2, "3.8.8"))

    private fun saveBoth(name: (String) -> String, setDark: (Boolean) -> Unit) {
        rule.waitForIdle()
        Shots.save(rule.activity, name("claro"))
        setDark(true)
        rule.waitForIdle()
        Shots.save(rule.activity, name("oscuro"))
    }

    // ------------------------------------------------------------------------------------------------ 23 · Menú

    private fun menu(palette: OrbPaletteChoice, connection: ConnectionState, variant: String) {
        Shots.assumeEnabled()
        val chats = listOf(row("1", title = "Versión 2.0 de la app", agent = "claude"), row("2", title = "Ajustar estilos con Cursor", agent = "cursor"))
        val vm = ChatListViewModel(FakeChatsBackend(chats), dispatcher = Dispatchers.Unconfined)
        var dark by mutableStateOf(false)
        rule.setContent {
            ShotFrame(palette, dark) {
                Box {
                    ChatListScreen(vm, ChatsMenu(onMenu = {}), onOpenChat = {}, onSearch = {}, onNewChat = {})
                    MenuSheet(
                        MenuState("DanLaptop", connection, unreadChats = 3, tasksToApprove = 1, dark = dark, inbox = null),
                        MenuActions(onDark = { dark = it }), onDismiss = {},
                    )
                }
            }
        }
        saveBoth({ "23-menu-${palette.key}-$it$variant" }) { dark = it }
    }

    @Test fun menuConnectedGrafito() = menu(OrbPaletteChoice.Grafito, online, "")
    @Test fun menuOfflineGrafito() = menu(OrbPaletteChoice.Grafito, ConnectionState.Offline(null, null), "-sin-conexion")
    @Test fun menuConnectedOceano() = menu(OrbPaletteChoice.Oceano, online, "")

    /** The two entries of «Más opciones» that the mockup does not draw, as the phone shows them under the rows. */
    @Test fun menuWithMoreOptionsGrafito() {
        Shots.assumeEnabled()
        var dark by mutableStateOf(false)
        rule.setContent {
            ShotFrame(OrbPaletteChoice.Grafito, dark) {
                MenuSheet(
                    MenuState("DanLaptop", online, unreadChats = 3, tasksToApprove = 1, dark = dark, inbox = InboxMenu(priority = false, canDigest = true)),
                    MenuActions(), onDismiss = {},
                )
            }
        }
        rule.onNodeWithText("Más opciones").performScrollTo()
        saveBoth({ "23-menu-grafito-$it-mas-opciones" }) { dark = it }
    }

    // ------------------------------------------------------------------------------------------------ 24 · Este móvil

    private fun thisPhone(palette: OrbPaletteChoice, variant: String, setup: FakeThisPhoneBackend.() -> Unit = {}, steps: () -> Unit = {}) {
        Shots.assumeEnabled()
        val backend = FakeThisPhoneBackend()
        var clock = 0L
        backend.probeTook = { clock += 38 }
        backend.setup()
        val theme = ThemePrefs(MemoryStore()).also { it.setPalette(palette) }
        val vm = ThisPhoneViewModel(backend, now = { clock })
        var dark by mutableStateOf(false)
        rule.setContent { ShotFrame(palette, dark) { ThisPhoneScreen(vm, theme, onBack = {}, onLinkTest = {}, onUnlinked = {}) } }
        rule.waitForIdle()
        steps()
        saveBoth({ "24-este-movil-${palette.key}-$it$variant" }) { dark = it }
    }

    @Test fun thisPhoneConnectedGrafito() = thisPhone(OrbPaletteChoice.Grafito, "")

    @Test fun thisPhoneConnectedBottomGrafito() = thisPhone(OrbPaletteChoice.Grafito, "-abajo") {
        rule.onNodeWithText("Prueba de conexión").performScrollTo()
    }

    @Test fun thisPhoneOfflineGrafito() = thisPhone(
        OrbPaletteChoice.Grafito, "-sin-conexion",
        setup = {
            val lastSeen = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, 13); set(Calendar.MINUTE, 20) }.timeInMillis
            connection.value = ConnectionState.Offline(null, lastSeen)
        },
    )

    @Test fun thisPhoneLockScreenSheetGrafito() = thisPhone(OrbPaletteChoice.Grafito, "-pantalla-de-bloqueo") {
        rule.onNodeWithText("En la pantalla de bloqueo").performScrollTo().performClick()
    }

    @Test fun thisPhoneAppLockSheetGrafito() = thisPhone(
        OrbPaletteChoice.Grafito, "-bloqueo-app", setup = { lock.value = LockSettings(enabled = true) },
    ) {
        rule.onNodeWithText("Bloqueo de la app").performScrollTo().performClick()
    }

    @Test fun thisPhoneUnlinkDialogGrafito() = thisPhone(OrbPaletteChoice.Grafito, "-desvincular") {
        rule.onNodeWithText("Desvincular este móvil").performScrollTo().performClick()
    }

    @Test fun thisPhoneConnectedOceano() = thisPhone(OrbPaletteChoice.Oceano, "")
}

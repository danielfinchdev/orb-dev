package dev.orb.app.ui.shots

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.PcVersions
import dev.orb.app.ui.chats.ChatListScreen
import dev.orb.app.ui.chats.ChatListViewModel
import dev.orb.app.ui.chats.ChatRow
import dev.orb.app.ui.chats.ChatsMenu
import dev.orb.app.ui.chats.FakeChatsBackend
import dev.orb.app.ui.chats.row
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbBottomBar
import dev.orb.app.ui.kit.OrbTab
import dev.orb.app.ui.offline.LocalOffline
import dev.orb.app.ui.offline.OfflineInfo
import dev.orb.app.ui.offline.PcOffActions
import dev.orb.app.ui.offline.PcOffContent
import dev.orb.app.ui.offline.PcOffRetry
import dev.orb.app.ui.offline.ReadOnlyBar
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.update.UpdateActions
import dev.orb.app.ui.update.UpdateContent
import dev.orb.app.ui.update.UpdateView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/** Screens 06 (PC apagado) and 07 (Actualizar) with every variant, light and dark: `ORB_SHOTS=1` turns them on. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = Shots.PHONE)
class PcDownShotsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val palette = OrbPaletteChoice.Grafito

    private fun shoot(name: String, content: @androidx.compose.runtime.Composable () -> Unit) {
        Shots.assumeEnabled()
        var dark by mutableStateOf(false)
        rule.setContent { ShotFrame(palette, dark, content) }
        rule.waitForIdle()
        Shots.save(rule.activity, "$name-claro")
        dark = true
        rule.waitForIdle()
        Shots.save(rule.activity, "$name-oscuro")
    }

    private val last = "Última conexión: hoy, 19:52."

    @Test fun pcApagado() = shoot("06-pc-apagado") {
        PcOffContent("DanLaptop", last, PcOffRetry.Waiting("Reintento en 12 s", 0.6f), false, PcOffActions())
    }

    @Test fun pcReintentandoAhora() = shoot("06-reintentando-ahora") {
        PcOffContent("DanLaptop", last, PcOffRetry.Connecting, false, PcOffActions())
    }

    @Test fun pcOtroPc() = shoot("06-otro-pc") {
        PcOffContent("DanLaptop", last, PcOffRetry.Waiting("Reintento en 12 s", 0.6f), true, PcOffActions())
    }

    @Test fun pcSinNombreNiHistorial() = shoot("06-sin-nombre-sin-historial") {
        PcOffContent(null, "Aún no se ha conectado con este PC.", PcOffRetry.Waiting("Reintento en 3 s", 0.1f), false, PcOffActions())
    }

    private fun at(h: Int, m: Int): Long = LocalDate.now().atTime(LocalTime.of(h, m)).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()

    @Test fun pcChatsGuardados() = shoot("06-chats-guardados") {
        val rows: List<ChatRow> = listOf(
            row("41", title = "Versión 2.0 de la app", pinned = true, unread = 2, lastText = "Tarea #41 espera tu OK", at = java.time.Instant.ofEpochMilli(at(13, 31)).toString()),
            row("r1", title = "Revisar pasarela", project = "api-pagos", unread = 1, at = java.time.Instant.ofEpochMilli(at(12, 10)).toString(), lastText = "Hecho, he añadido un límite de tres."),
        )
        val backend = FakeChatsBackend(rows).apply { connectionState.value = ConnectionState.Offline(null, at(19, 52)) }
        val vm = ChatListViewModel(backend, dispatcher = Dispatchers.Unconfined)
        val info = OfflineInfo(MutableStateFlow(ConnectionState.Offline(null, at(19, 52))), MutableStateFlow(at(19, 52)), {}, clock = { at(20, 0) })
        val tabs = listOf(OrbTab("chats", "Chats", OrbIcons.Chat, 3), OrbTab("tasks", "Tareas", OrbIcons.Tasks, 1), OrbTab("projects", "Proyectos", OrbIcons.FolderGit2))
        CompositionLocalProvider(LocalOffline provides info) {
            Column(Modifier.fillMaxSize()) {
                ReadOnlyBar(info, onBack = {})
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    ChatListScreen(vm, ChatsMenu(onMenu = {}, unreadNotices = 0, onNotices = {}), onOpenChat = {}, onSearch = {}, onNewChat = {})
                }
                OrbBottomBar(tabs, "chats", {})
            }
        }
    }

    @Test fun actualizaApp() = shoot("07-actualiza-app") {
        UpdateContent(UpdateView.App("3.8.8", 5, "3.9.0"), false, UpdateActions())
    }

    @Test fun actualizaAppSinNavegador() = shoot("07-actualiza-app-sin-navegador") {
        UpdateContent(UpdateView.App("3.8.8", 5, "3.9.0"), true, UpdateActions())
    }

    @Test fun actualizaAppAlArrancar() = shoot("07-actualiza-app-al-arrancar") {
        UpdateContent(UpdateView.App("3.8.8", 5, "3.9.0"), false, UpdateActions(seeSaved = {}))
    }

    @Test fun actualizaPc() = shoot("07-actualiza-pc") {
        UpdateContent(UpdateView.Pc("3.8.8", null, null), false, UpdateActions())
    }

    @Test fun alDia() = shoot("07-al-dia") {
        UpdateContent(UpdateView.UpToDate("3.8.8", 4, "3.8.8"), false, UpdateActions(back = {}))
    }

    @Test fun sinComprobar() = shoot("07-sin-comprobar") {
        UpdateContent(UpdateView.Unknown("3.8.8"), false, UpdateActions(back = {}))
    }
}

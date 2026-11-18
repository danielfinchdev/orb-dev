package dev.orb.app.ui.shots

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import dev.orb.app.link.api.ConfirmAction
import dev.orb.app.link.api.Confirmed
import dev.orb.app.link.api.UserConfirmation
import dev.orb.app.ui.chats.ChatListScreen
import dev.orb.app.ui.chats.ChatListViewModel
import dev.orb.app.ui.chats.ChatState
import dev.orb.app.ui.chats.ChatsMenu
import dev.orb.app.ui.chats.FakeChatsBackend
import dev.orb.app.ui.chats.row
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.AgentMark
import dev.orb.app.ui.kit.OrbBadge
import dev.orb.app.ui.kit.OrbBadgeKind
import dev.orb.app.ui.kit.OrbBottomBar
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbCard
import dev.orb.app.ui.kit.OrbChip
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbEmpty
import dev.orb.app.ui.kit.OrbGroupHeader
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbNote
import dev.orb.app.ui.kit.OrbProgress
import dev.orb.app.ui.kit.OrbRow
import dev.orb.app.ui.kit.OrbSearchButton
import dev.orb.app.ui.kit.OrbSearchField
import dev.orb.app.ui.kit.OrbSegmented
import dev.orb.app.ui.kit.OrbSettingRow
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbSheetDivider
import dev.orb.app.ui.kit.OrbSheetItem
import dev.orb.app.ui.kit.OrbSheetLabel
import dev.orb.app.ui.kit.OrbSnackbar
import dev.orb.app.ui.kit.OrbSubtitle
import dev.orb.app.ui.kit.OrbSwitch
import dev.orb.app.ui.kit.OrbTab
import dev.orb.app.ui.kit.OrbTopBar
import dev.orb.app.ui.kit.OrbUnread
import dev.orb.app.ui.kit.OrbWordmark
import dev.orb.app.ui.kit.ProjectDot
import dev.orb.app.ui.kit.ProjectDotSize
import dev.orb.app.ui.theme.OrbPaletteChoice
import kotlinx.coroutines.Dispatchers
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Pictures of the Orb UI 2.0 pieces and of the shell, to compare with the mockups: `ORB_SHOTS=1` turns them on. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = Shots.PHONE)
class KitShotsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private fun twoModes(name: String, palette: OrbPaletteChoice = OrbPaletteChoice.Grafito, after: () -> Unit = {}, content: @Composable () -> Unit) {
        var dark by mutableStateOf(false)
        rule.setContent { ShotFrame(palette, dark, content) }
        rule.waitForIdle()
        after()
        rule.waitForIdle()
        Shots.save(rule.activity, "$name-${palette.key}-claro")
        dark = true
        rule.waitForIdle()
        Shots.save(rule.activity, "$name-${palette.key}-oscuro")
    }

    @Test
    @Config(sdk = [35], qualifiers = "w390dp-h1260dp-xhdpi")
    fun gallery() {
        Shots.assumeEnabled()
        twoModes("kit-piezas") {
            Column(Modifier.fillMaxSize()) {
                OrbTopBar(
                    "", sub = "PC de Dani · conectado", center = { OrbWordmark() },
                    leading = { OrbIconButton(OrbIcons.Menu, "Menú", {}) }, actions = { OrbIconButton(OrbIcons.Bell, "Avisos", {}, badge = "2") },
                )
                Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OrbSearchButton("Buscar chats y proyectos", {})
                    OrbSearchField("api", {}, "Buscar")
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        OrbChip("Todos", true, {}); OrbChip("No leídos", false, {}, count = 3); OrbChip("Directos", false, {})
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        OrbButton("Aprobar", {}, kind = OrbButtonKind.Primary); OrbButton("Rechazar", {}); OrbButton("Más", {}, kind = OrbButtonKind.Ghost)
                        OrbButton("Borrar", {}, kind = OrbButtonKind.Danger, small = true)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        OrbSwitch(true, {}); OrbSwitch(false, {})
                        OrbSegmented(listOf("Claro", "Oscuro", "Sistema"), 1, {})
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        OrbBadge("Hecha", kind = OrbBadgeKind.Ok); OrbBadge("Espera", kind = OrbBadgeKind.Warn); OrbBadge("Error", kind = OrbBadgeKind.Err)
                        OrbBadge("PR", kind = OrbBadgeKind.Info); OrbBadge("Nueva", kind = OrbBadgeKind.Acc); OrbBadge("Normal")
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        AgentMark("claude"); AgentMark("codex"); AgentMark("cursor"); AgentMark("orbe"); AgentMark("gemini")
                        ProjectDot("app-movil", size = ProjectDotSize.Small); ProjectDot("api-pagos"); ProjectDot("tienda-online"); ProjectDot(null)
                        ProjectDot("tienda-online", size = ProjectDotSize.Large)
                        OrbUnread(2); OrbUnread(14, soft = true)
                    }
                }
                OrbGroupHeader("Fijados", icon = OrbIcons.Pin)
                OrbGroupHeader("app-movil", project = "app-movil", count = 3, collapsed = false)
                OrbRow(
                    "Ajustar estilos con Cursor", lead = { AgentMark("cursor") }, time = "13:46",
                    subtitle = { OrbSubtitle("Trabajando · Editando styles.css") },
                )
                OrbRow(
                    "Pantalla de pagos", lead = { AgentMark("orbe") }, time = "13:20", badge = { OrbUnread(1) },
                    subtitle = { OrbSubtitle("Esperando tu aprobación") },
                )
                OrbGroupHeader("Sin proyecto", noProject = true)
                Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OrbCard {
                        OrbSettingRow("Avisos", subtitle = "Cuando una tarea espera tu OK", divider = false) { OrbSwitch(true, {}) }
                        OrbSettingRow("Sonido", subtitle = "Solo con el móvil sin silenciar") { OrbSwitch(false, {}) }
                    }
                    OrbProgress(0.62f)
                    OrbNote("Se guarda solo en este móvil.")
                    OrbEmpty("Nada por aquí", text = "Cuando haya algo, aparecerá en esta lista.", icon = OrbIcons.Chat)
                    OrbSnackbar("Chat archivado", actionLabel = "Deshacer")
                }
            }
        }
    }

    @Test fun sheet() {
        Shots.assumeEnabled()
        twoModes("kit-hoja") {
            Box(Modifier.fillMaxSize()) {
                OrbSheet({}, title = "Acciones del chat", showClose = true) {
                    OrbSheetItem("Fijar", {}, icon = OrbIcons.Pin)
                    OrbSheetItem("Silenciar", {}, icon = OrbIcons.BellOff, meta = "Desactivado")
                    OrbSheetLabel("Posponer")
                    OrbSheetItem("Una hora", {}, checked = true)
                    OrbSheetItem("Hasta mañana", {}, checked = false)
                    OrbSheetDivider()
                    OrbSheetItem("Eliminar", {}, icon = OrbIcons.Trash, danger = true)
                }
            }
        }
    }

    @Test fun dialog() {
        Shots.assumeEnabled()
        twoModes("kit-dialogo") {
            OrbDialog({}, "¿Eliminar el chat?", OrbDialogAction("Eliminar", {}, danger = true), text = "Se quita de la lista. Puedes deshacerlo unos segundos.", dismiss = OrbDialogAction("Cancelar", {}))
        }
    }

    @OptIn(UserConfirmation::class)
    private fun shell(palette: OrbPaletteChoice) {
        Shots.assumeEnabled()
        val rows = listOf(
            row("1", title = "Carrito que no guarda", project = "tienda-online", agent = "claude", state = ChatState.Working),
            row("2", title = "Revisar pasarela", project = "api-pagos", unread = 2),
            row("3", title = "Orb 3.8.4 seguimiento", pinned = true),
        )
        val vm = ChatListViewModel(FakeChatsBackend(rows), dispatcher = Dispatchers.Unconfined)
        val tabs = listOf(OrbTab("chats", "Chats", OrbIcons.Chat, 2), OrbTab("tasks", "Tareas", OrbIcons.Tasks, 1), OrbTab("projects", "Proyectos", OrbIcons.Folder))
        twoModes("09-chats", palette, after = { vm.delete(rows[2], Confirmed(ConfirmAction.TrashConversation, "3")) }) {
            Column(Modifier.fillMaxSize()) {
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    ChatListScreen(vm, ChatsMenu(onMenu = {}), onOpenChat = {}, onSearch = {}, onNewChat = {})
                }
                OrbBottomBar(tabs, "chats", {})
            }
        }
    }

    @Test fun shellGrafito() = shell(OrbPaletteChoice.Grafito)
    @Test fun shellOceano() = shell(OrbPaletteChoice.Oceano)
}

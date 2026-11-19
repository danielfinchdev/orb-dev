package dev.orb.app.ui.shots

import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.chats.DirectChatScreen
import dev.orb.app.ui.chats.DirectChatViewModel
import dev.orb.app.ui.chats.FakeDirectChatBackend
import dev.orb.app.ui.chats.QueuedMsg
import dev.orb.app.ui.chats.SessionInfo
import dev.orb.app.ui.chats.jstr
import dev.orb.app.ui.chats.row
import dev.orb.app.ui.offline.LocalOffline
import dev.orb.app.ui.offline.OfflineInfo
import dev.orb.app.ui.theme.OrbPaletteChoice
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/**
 * Pictures of the direct chat with an agent (15) in each variant of the mockup, to set them beside it: `ORB_SHOTS=1` turns
 * them on. The main one has no suffix; the others say which state of the mockup they are.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = Shots.PHONE)
class DirectChatShotsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    // The dots and the spinner stand still so a picture is the same every time.
    @Before fun still() {
        Settings.Global.putFloat(rule.activity.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
    }

    private val zone = ZoneId.systemDefault()
    private fun at(h: Int, m: Int): String = LocalDate.now().atTime(LocalTime.of(h, m)).atZone(zone).toInstant().toString()

    private fun line(id: Long, role: String, kind: String, body: String, time: String = at(14, 1)) =
        """{"id":$id,"session_id":"s1","role":"$role","kind":"$kind","body":$body,"at":"$time"}"""

    private val edit = """{"id":"t1","name":"Edit","input":{"file_path":"styles.css"}}"""
    private val build = """{"id":"t2","name":"Bash","input":{"command":"npm run build"}}"""

    private fun head() = listOf(
        line(1, "user", "text", jstr("Pon el botón principal en verde y comprueba que compila")),
        line(2, "assistant", "text", jstr("Cambiado en `styles.css`. Ahora compilo."), at(14, 2)),
        line(3, "tool", "tool", edit, at(14, 2)),
        line(4, "tool", "tool_result", """{"id":"t1","output":"2 líneas"}""", at(14, 2)),
    )

    private val permission = line(
        5, "system", "approval",
        """{"id":"r1","tool":"Bash","title":"npm run build","reason":"Compila el proyecto para comprobar el cambio.","input":{"command":"npm run build"},"status":"pending"}""",
        at(14, 3),
    )

    private fun sessionRow(status: String, agent: String = "claude") = SessionInfo(
        id = "s1", title = "Ajustar estilos", project = "app-movil", agent = agent, model = "Opus", status = status, permission = "editar",
        settled = false, archived = false, contextUsed = 62, contextSize = 100,
    )

    private fun backend(rows: List<String>, status: String): FakeDirectChatBackend = FakeDirectChatBackend(rows).apply {
        headerRow.value = row("s1", title = "Ajustar estilos", project = "app-movil", agent = "claude")
        infoOnPc = sessionRow(status)
    }

    private val queued = listOf(QueuedMsg(1, "Luego sube el cambio a la rama dev", 0), QueuedMsg(2, "Y avísame cuando esté", 0))

    private fun workingBackend(): FakeDirectChatBackend {
        val rows = head() + line(5, "tool", "tool", build, at(14, 3)) + line(6, "user", "text", """{"text":"Mejor un verde más oscuro","steer":true}""", at(14, 4))
        return backend(rows, "running").apply { queueOnPc = queued }
    }

    private fun vm(b: FakeDirectChatBackend) = DirectChatViewModel(b, "s1", dispatcher = Dispatchers.Unconfined)

    private fun shoot(
        palette: OrbPaletteChoice, suffix: String, vm: DirectChatViewModel, info: OfflineInfo? = null, after: () -> Unit = {},
    ) {
        var dark by mutableStateOf(false)
        rule.setContent {
            ShotFrame(palette, dark) {
                CompositionLocalProvider(LocalOffline provides info) {
                    DirectChatScreen(vm, onBack = {}, onOpenChat = {}, nowMs = { System.currentTimeMillis() })
                }
            }
        }
        rule.waitForIdle()
        after()
        rule.waitForIdle()
        Shots.save(rule.activity, "15-chat-directo-${palette.key}-claro$suffix")
        dark = true
        if (rule.mainClock.autoAdvance) rule.waitForIdle() else repeat(4) { rule.mainClock.advanceTimeByFrame() }
        Shots.save(rule.activity, "15-chat-directo-${palette.key}-oscuro$suffix")
    }

    private fun perm(palette: OrbPaletteChoice) {
        Shots.assumeEnabled()
        shoot(palette, "", vm(backend(head() + permission, "running")))
    }

    @Test fun asksForPermission() = perm(OrbPaletteChoice.Grafito)
    @Test fun asksForPermissionOceano() = perm(OrbPaletteChoice.Oceano)

    @Test fun working() {
        Shots.assumeEnabled()
        shoot(OrbPaletteChoice.Grafito, "-trabajando", vm(workingBackend()))
    }

    @Test fun editingTheQueue() {
        Shots.assumeEnabled()
        shoot(OrbPaletteChoice.Grafito, "-cola", vm(workingBackend()), after = { rule.onAllNodesWithContentDescription("Editar")[0].performClick() })
    }

    @Test fun stopped() {
        Shots.assumeEnabled()
        shoot(OrbPaletteChoice.Grafito, "-parada", vm(backend(head(), "interrupted")))
    }

    @Test fun theSheet() {
        Shots.assumeEnabled()
        shoot(OrbPaletteChoice.Grafito, "-menu", vm(backend(head() + permission, "idle")), after = {
            rule.onNodeWithContentDescription("Más acciones del chat").performClick()
        })
    }

    @Test fun theSheetWithMoreOptions() {
        Shots.assumeEnabled()
        shoot(OrbPaletteChoice.Grafito, "-menu-mas", vm(backend(head() + permission, "idle")), after = {
            rule.onNodeWithContentDescription("Más acciones del chat").performClick()
            rule.waitForIdle()
            rule.onNodeWithText("Más opciones").performClick()
        })
    }

    @Test fun compacting() {
        Shots.assumeEnabled()
        shoot(OrbPaletteChoice.Grafito, "-compactar", vm(backend(head() + permission, "idle")), after = {
            rule.onNodeWithContentDescription("Más acciones del chat").performClick()
            rule.waitForIdle()
            rule.onNodeWithText("Compactar contexto").performClick()
        })
    }

    @Test fun withoutALink() {
        Shots.assumeEnabled()
        val b = backend(head() + permission, "running")
        b.connectionState.value = ConnectionState.Offline(nextRetryAt = 11_000, lastSeen = null)
        shoot(OrbPaletteChoice.Grafito, "-sin-conexion", vm(b), OfflineInfo(b.connectionState, MutableStateFlow(null), {}, { 5_000L }))
    }
}

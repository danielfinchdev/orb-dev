package dev.orb.app.ui.shots

import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import dev.orb.app.data.json
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.ui.chats.BrainInfo
import dev.orb.app.ui.chats.FakeOrbeChatBackend
import dev.orb.app.ui.chats.LiveTask
import dev.orb.app.ui.chats.OrbeChatScreen
import dev.orb.app.ui.chats.OrbeChatViewModel
import dev.orb.app.ui.chats.PendingMessage
import dev.orb.app.ui.chats.PendingState
import dev.orb.app.ui.chats.QueuedMsg
import dev.orb.app.ui.chats.TaskDetail
import dev.orb.app.ui.chats.row
import dev.orb.app.ui.offline.LocalOffline
import dev.orb.app.ui.offline.OfflineInfo
import dev.orb.app.ui.theme.OrbPaletteChoice
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.JsonPrimitive
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
 * Pictures of the chat with Orbe (13) and of the same chat without a link (28), with the mockups' own conversation, to
 * set them beside the mockups: `ORB_SHOTS=1` turns them on.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = Shots.PHONE)
class ChatShotsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    // The dots and the spinner stand still so a picture is the same every time.
    @Before fun still() {
        Settings.Global.putFloat(rule.activity.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
    }

    private val zone = ZoneId.systemDefault()
    private fun at(h: Int, m: Int): String = LocalDate.now().atTime(LocalTime.of(h, m)).atZone(zone).toInstant().toString()
    private fun ms(h: Int, m: Int): Long = LocalDate.now().atTime(LocalTime.of(h, m)).atZone(zone).toInstant().toEpochMilli()

    private fun line(id: Long, role: String, body: String, time: String, meta: String = "null", extra: String = "") =
        """{"id":$id,"conversation_id":7,"role":"$role","body":${JsonPrimitive(body)},"meta":$meta,"at":"$time"$extra}"""

    private val push = "Añade notificaciones push al registro y pruébalo en el emulador"
    private val plan = "Vale. Lo divido en dos tareas:\n1. Codex añade el registro en `push.ts` (#42).\n2. Claude lo prueba en el emulador cuando acabe la 1."

    private fun backend(rows: List<String>, title: String, project: String) = FakeOrbeChatBackend(rows).apply {
        headerRow.value = row("7", title = title, project = project)
        brainOnPc = BrainInfo("Claude Code", "Opus", "high")
        modeOnPc = "preguntar"
    }

    private fun working(b: FakeOrbeChatBackend, partial: String = "", queued: Int = 0) {
        val src = """{"conversation":7,"busy":true,"since":${System.currentTimeMillis() - 12_000},"partial":${JsonPrimitive(partial)},"tools":[],"queued":$queued,"waiting":false}"""
        b.events.tryEmit(LinkEvent("chat:state", json(src)))
    }

    /** One picture of the screen per mode; [after] runs once it is up (a tap, some text...). */
    private fun shoot(
        name: String, palette: OrbPaletteChoice, suffix: String, vm: OrbeChatViewModel, info: OfflineInfo? = null,
        queued: List<QueuedMsg> = emptyList(), after: () -> Unit = {},
    ) {
        var dark by mutableStateOf(false)
        rule.setContent {
            ShotFrame(palette, dark) {
                CompositionLocalProvider(LocalOffline provides info) {
                    OrbeChatScreen(vm, onBack = {}, liveRefreshMs = 0, queued = queued, onEditQueued = { _, _ -> }, onRemoveQueued = {})
                }
            }
        }
        rule.waitForIdle()
        after()
        rule.waitForIdle()
        Shots.save(rule.activity, "$name-${palette.key}-claro$suffix")
        dark = true
        rule.waitForIdle()
        Shots.save(rule.activity, "$name-${palette.key}-oscuro$suffix")
    }

    private fun vm(b: FakeOrbeChatBackend) = OrbeChatViewModel(b, 7, dispatcher = Dispatchers.Unconfined)

    private val quoted = listOf(QueuedMsg(1, "y luego súbelo a la rama dev", 0))

    // ---- 13 · Chat con Orbe ----

    private fun thread13() = listOf(line(1, "usuario", push, at(13, 51)), line(2, "orb", plan, at(13, 52)))

    private fun working13(palette: OrbPaletteChoice, suffix: String = "") {
        Shots.assumeEnabled()
        val b = backend(thread13(), "Versión 2.0 de la app", "app-movil")
        b.liveOnPc = listOf(LiveTask(42, "Registro de notificaciones", "codex", "Leyendo src/push.ts", null, false))
        val vm = vm(b)
        working(b, queued = 1)
        shoot("13-chat", palette, suffix, vm, queued = quoted)
    }

    @Test fun working() = working13(OrbPaletteChoice.Grafito)
    @Test fun workingOceano() = working13(OrbPaletteChoice.Oceano)

    @Test fun arriving() {
        Shots.assumeEnabled()
        val b = backend(listOf(line(1, "usuario", push, at(13, 51))), "Versión 2.0 de la app", "app-movil")
        val vm = vm(b)
        working(b, partial = "Vale. Lo divido en dos tareas:\n1. Codex añade el registro en `push.ts`.\n2. Claude lo prueba en el emulador cuando acabe la 1")
        shoot("13-chat", OrbPaletteChoice.Grafito, "-llegando", vm)
    }

    @Test fun upToDate() {
        Shots.assumeEnabled()
        val rows = thread13() + line(3, "system", "La tarea #42 terminó", at(13, 58), """{"kind":"attention","task":42}""")
        val b = backend(rows, "Versión 2.0 de la app", "app-movil")
        b.taskDetail = TaskDetail(42, "Registro de notificaciones", "done", "codex", "C:/app-movil", emptyList(), null)
        val vm = vm(b)
        shoot("13-chat", OrbPaletteChoice.Grafito, "-reposo", vm, after = {
            rule.onNode(hasSetTextAction()).performTextInput("Gracias, súbelo a la rama dev")
        })
    }

    @Test fun editingTheQueue() {
        Shots.assumeEnabled()
        val b = backend(thread13(), "Versión 2.0 de la app", "app-movil")
        val vm = vm(b)
        working(b, queued = 1)
        shoot("13-chat", OrbPaletteChoice.Grafito, "-cola", vm, queued = quoted, after = { rule.onNodeWithText("Editar").performClick() })
    }

    @Test fun waitingForApproval() {
        Shots.assumeEnabled()
        val rows = thread13() + line(3, "system", "La tarea #42 espera tu OK: toca la red", at(13, 56), """{"kind":"attention","task":42}""")
        val b = backend(rows, "Versión 2.0 de la app", "app-movil")
        b.taskDetail = TaskDetail(42, "Registro de notificaciones", "awaiting_approval", "codex", "C:/app-movil", listOf("red"), "h1")
        shoot("13-chat", OrbPaletteChoice.Grafito, "-aprobar", vm(b))
    }

    // ---- 28 · Sin conexión dentro de un chat ----

    private val fixedNow = 5_000_000L

    private fun offlineInfo(state: MutableStateFlow<ConnectionState>) = OfflineInfo(state, MutableStateFlow(null), {}, { fixedNow })

    private val orbeReply = "Hecho, he añadido un límite de tres reintentos y un registro del fallo."

    @Test fun withoutALink() {
        Shots.assumeEnabled()
        val b = backend(listOf(line(1, "orb", orbeReply, at(14, 40))), "Revisar pasarela", "api-pagos")
        b.connectionState.value = ConnectionState.Offline(nextRetryAt = fixedNow + 6_000, lastSeen = null)
        b.queue.value = listOf(
            PendingMessage("a", "Perfecto. ¿Puedes subirlo a la rama dev?", PendingState.Waiting, null, ms(14, 41)),
            PendingMessage("b", "Y avísame cuando esté", PendingState.Waiting, null, ms(14, 42)),
        )
        shoot("28-sin-conexion", OrbPaletteChoice.Grafito, "", vm(b), offlineInfo(b.connectionState))
    }

    @Test fun backOnline() {
        Shots.assumeEnabled()
        val b = backend(listOf(line(1, "orb", orbeReply, at(14, 40))), "Revisar pasarela", "api-pagos")
        b.connectionState.value = ConnectionState.Offline(nextRetryAt = fixedNow + 6_000, lastSeen = null)
        b.queue.value = listOf(
            PendingMessage("a", "Perfecto. ¿Puedes subirlo a la rama dev?", PendingState.Waiting, null, ms(14, 41)),
            PendingMessage("b", "Y avísame cuando esté", PendingState.Waiting, null, ms(14, 42)),
        )
        val vm = vm(b)
        // The link returns: the first message is already in the thread (two ticks), the second only reached the PC (one).
        b.loadResult = Result.failure(IllegalStateException("not read yet"))
        shoot("28-sin-conexion", OrbPaletteChoice.Grafito, "-reconectado", vm, offlineInfo(b.connectionState), after = {
            b.connectionState.value = dev.orb.app.data.ONLINE
            b.queue.value = emptyList()
            b.rows.value = b.rows.value + line(3, "usuario", "Perfecto. ¿Puedes subirlo a la rama dev?", at(14, 41), extra = ",\"clientId\":\"a\"")
        })
    }

    @Test fun updatePc() {
        Shots.assumeEnabled()
        val b = backend(listOf(line(1, "orb", orbeReply, at(14, 40))), "Revisar pasarela", "api-pagos")
        b.connectionState.value = ConnectionState.UpdatePc
        b.queue.value = listOf(PendingMessage("a", "Perfecto. ¿Puedes subirlo a la rama dev?", PendingState.Waiting, null, ms(14, 41)))
        shoot("28-sin-conexion", OrbPaletteChoice.Grafito, "-actualizar", vm(b), offlineInfo(b.connectionState))
    }

    @Test fun refused() {
        Shots.assumeEnabled()
        val b = backend(listOf(line(1, "orb", orbeReply, at(14, 40))), "Revisar pasarela", "api-pagos")
        b.queue.value = listOf(PendingMessage("a", "Perfecto. ¿Puedes subirlo a la rama dev?", PendingState.Failed, "refused 400", ms(14, 41)))
        shoot("28-sin-conexion", OrbPaletteChoice.Grafito, "-no-enviado", vm(b))
    }
}

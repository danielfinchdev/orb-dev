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
import dev.orb.app.ui.chats.OrbeQueued
import dev.orb.app.ui.chats.TaskStat
import dev.orb.app.ui.tasks.TaskAction
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
        after: () -> Unit = {},
    ) {
        var dark by mutableStateOf(false)
        rule.setContent {
            ShotFrame(palette, dark) {
                CompositionLocalProvider(LocalOffline provides info) {
                    OrbeChatScreen(vm, onBack = {}, liveRefreshMs = 0)
                }
            }
        }
        rule.waitForIdle()
        after()
        rule.waitForIdle()
        Shots.save(rule.activity, "$name-${palette.key}-claro$suffix")
        dark = true
        if (rule.mainClock.autoAdvance) rule.waitForIdle() else repeat(4) { rule.mainClock.advanceTimeByFrame() }
        Shots.save(rule.activity, "$name-${palette.key}-oscuro$suffix")
    }

    private fun vm(b: FakeOrbeChatBackend) = OrbeChatViewModel(b, 7, dispatcher = Dispatchers.Unconfined, attach = shotAttach())

    private val quoted = listOf(OrbeQueued("q1", "y luego súbelo a la rama dev", 1_000L))

    // ---- 13 · Chat con Orbe ----

    private fun thread13() = listOf(line(1, "usuario", push, at(13, 51)), line(2, "orb", plan, at(13, 52)))

    private fun working13(palette: OrbPaletteChoice, suffix: String = "") {
        Shots.assumeEnabled()
        val b = backend(thread13(), "Versión 2.0 de la app", "app-movil")
        b.liveOnPc = listOf(LiveTask(42, "Registro de notificaciones", "codex", "Leyendo src/push.ts", null, false))
        val vm = vm(b)
        b.queueOnPc = quoted
        working(b, queued = 1)
        shoot("13-chat", palette, suffix, vm)
    }

    // ---- 08 · Envío fallido, dentro del chat entero (cabecera, lista y caja) con el aviso de abajo ----

    private fun failedSend(palette: OrbPaletteChoice) {
        Shots.assumeEnabled()
        val b = backend(thread13(), "Versión 2.0 de la app", "app-movil")
        val vm = vm(b)
        // The clock stands still so the bottom notice, which only lasts a few seconds, is there for both pictures.
        rule.mainClock.autoAdvance = false
        shoot("08-envio-fallido", palette, "", vm) {
            b.queue.value = listOf(PendingMessage("c1", "Y que no se pierdan si el PC está apagado", PendingState.Failed, "refused 400", ms(13, 54)))
            rule.mainClock.advanceTimeBy(500)
        }
    }

    @Test fun failedSend() = failedSend(OrbPaletteChoice.Grafito)
    @Test fun failedSendOceano() = failedSend(OrbPaletteChoice.Oceano)

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
        b.taskDetail = TaskDetail(42, "Registro de notificaciones", "done", "codex", "C:/app-movil", emptyList(), null, actions = emptySet())
        val vm = vm(b)
        shoot("13-chat", OrbPaletteChoice.Grafito, "-reposo", vm, after = {
            rule.onNode(hasSetTextAction()).performTextInput("Gracias, súbelo a la rama dev")
        })
    }

    @Test fun editingTheQueue() {
        Shots.assumeEnabled()
        val b = backend(thread13(), "Versión 2.0 de la app", "app-movil")
        b.queueOnPc = quoted
        val vm = vm(b)
        working(b, queued = 1)
        shoot("13-chat", OrbPaletteChoice.Grafito, "-cola", vm, after = { rule.onNodeWithText("Editar").performClick() })
    }

    @Test fun theQueueAsAList() {
        Shots.assumeEnabled()
        val b = backend(thread13(), "Versión 2.0 de la app", "app-movil")
        b.queueOnPc = quoted + OrbeQueued("q2", "avísame cuando acabe", 2_000L)
        val vm = vm(b)
        working(b, queued = 2)
        shoot("13-chat", OrbPaletteChoice.Grafito, "-cola-lista", vm, after = { rule.onNodeWithText("Editar").performClick() })
    }

    @Test fun waitingForApproval() {
        Shots.assumeEnabled()
        val rows = thread13() + line(3, "system", "La tarea #42 espera tu OK: toca la red", at(13, 56), """{"kind":"attention","task":42}""")
        val b = backend(rows, "Versión 2.0 de la app", "app-movil")
        b.taskDetail = TaskDetail(42, "Registro de notificaciones", "awaiting_approval", "codex", "C:/app-movil", listOf("red"), "h1", folderNow = "C:/app-movil", actions = setOf(TaskAction.Approve),
            description = "Añade el registro de notificaciones push y pruébalo en el emulador.")
        shoot("13-chat", OrbPaletteChoice.Grafito, "-aprobar", vm(b))
    }

    // ---- 14 · Aprobaciones y deshacer ----

    private val task42 = TaskDetail(
        42, "Registro de notificaciones", "done", "codex", "C:/app-movil", emptyList(), null, reviewAgent = "claude",
        actions = setOf(TaskAction.SeeChanges, TaskAction.UndoHeld, TaskAction.AcceptHeld),
    )
    private val task43 = TaskDetail(
        43, "Borrar build/ y reinstalar dependencias", "awaiting_approval", "codex", "C:/app-movil", listOf("destructive"), "h43", folderNow = "C:/app-movil",
        folderMoved = false, actions = setOf(TaskAction.Approve), description = "Borra la carpeta build/ y vuelve a instalar las dependencias con npm ci.",
    )
    private val task45 = TaskDetail(
        45, "Limpiar la carpeta de pruebas", "blocked", "codex", "C:/app-movil", emptyList(), null, held = true,
        heldReasons = "ha eliminado 2714 archivos", heldFolder = "C:/app-movil", actions = setOf(TaskAction.SeeChanges),
    )
    private val task46 = TaskDetail(
        46, "Migrar el registro a Room", "awaiting_approval", "codex", "C:/app-movil", listOf("external_write"), "h46", model = "gpt",
        actions = setOf(TaskAction.Approve), reasoning = "high",
        description = (1..9).joinToString("\n") { "Paso $it: revisar el módulo $it, migrar sus consultas a Room y actualizar sus pruebas para que sigan pasando." },
    )
    private val task47 = TaskDetail(
        47, "Subir la web nueva", "awaiting_approval", "codex", "C:/app-movil", listOf("publish"), "h47", folderNow = "D:/otros/app-movil", folderMoved = true,
        actions = setOf(TaskAction.Approve), description = "Sube la web nueva al servidor y avisa por correo.",
    )
    private val task44 = TaskDetail(44, "Instalar dependencias", "running", "codex", "C:/app-movil", emptyList(), "h44", autonomy = "auto", approvalRequired = false)

    private fun thread14(auto: Boolean = false, question: Boolean = false): List<String> {
        val rows = ArrayList<String>()
        if (question) {
            val meta = """{"kind":"question","header":null,"question":"¿Uso Room o DataStore para guardar el registro?","multi":false,"status":"pending","answer":null,"options":[{"label":"Room"},{"label":"DataStore"}]}"""
            rows += line(1, "orb", "¿Uso Room o DataStore para guardar el registro?", at(13, 57), meta)
        } else {
            rows += line(1, "system", "La tarea #42 terminó", at(13, 57), """{"kind":"task-end","task":42,"status":"done"}""")
            rows += line(2, "orb", "La #42 está lista. La #43 borra muchos archivos: ¿la apruebas?", at(13, 58))
        }
        if (auto) rows += line(3, "system", "Tarea #44 creada", at(13, 59), """{"kind":"attention","task":44}""")
        rows += line(4, "system", "⚠️ La tarea #43 espera tu OK", at(14, 0), """{"kind":"attention","task":43}""")
        return rows
    }

    private fun backend14(auto: Boolean = false, question: Boolean = false) =
        backend(thread14(auto, question), "Versión 2.0 de la app", "app-movil").apply {
            modeOnPc = if (auto) "auto" else "preguntar"
            detailsOnPc[42] = task42
            detailsOnPc[43] = task43
            detailsOnPc[44] = task44
            statOnPc = TaskStat(3, 42, 7)
        }

    /** The snackbar lives four seconds: the clock stops so a picture can catch it. */
    private fun holdClock() { rule.mainClock.autoAdvance = false }
    private fun settle() {
        repeat(2) { org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); rule.mainClock.advanceTimeBy(300) }
    }

    private fun approvals(palette: OrbPaletteChoice, suffix: String = "", auto: Boolean = false, question: Boolean = false, setup: (FakeOrbeChatBackend) -> Unit = {}, after: () -> Unit = {},
        afterWith: (OrbeChatViewModel) -> Unit = {},
    ) {
        Shots.assumeEnabled()
        val b = backend14(auto, question)
        setup(b)
        val vm = vm(b)
        shoot("14-aprobaciones", palette, suffix, vm, after = { after(); afterWith(vm) })
    }

    @Test fun approvalsAsk() = approvals(OrbPaletteChoice.Grafito)
    @Test fun approvalsAskOceano() = approvals(OrbPaletteChoice.Oceano)
    @Test fun approvalsAuto() = approvals(OrbPaletteChoice.Grafito, "-auto", auto = true)

    @Test fun approvalsRejected() = approvals(
        OrbPaletteChoice.Grafito, "-rechazada",
        setup = { b -> b.onAction = { if (it == "task 43 false") b.detailsOnPc[43] = task43.copy(status = "cancelled", actions = emptySet(), decision = "rejected") } },
        after = { rule.onNodeWithText("Rechazar").performClick(); rule.onNodeWithText("Rechazar y cancelar").performClick() },
    )

    @Test fun approvalsAccepted() = approvals(
        OrbPaletteChoice.Grafito, "-aceptada",
        setup = { b -> b.onAction = { if (it == "taskaccept 42") b.detailsOnPc[42] = task42.copy(accepted = true, actions = setOf(TaskAction.SeeChanges, TaskAction.UndoHeld)) } },
        after = { rule.onNodeWithText("Aceptar cambios").performClick() },
    )

    @Test fun approvalsConfirmUndo() = approvals(OrbPaletteChoice.Grafito, "-deshacer", after = { rule.onNodeWithText("Deshacer").performClick() })

    @Test fun approvalsUndone() = approvals(
        OrbPaletteChoice.Grafito, "-deshecho",
        setup = { b -> b.onAction = { if (it == "undo 42") b.detailsOnPc[42] = task42.copy(undone = true, actions = emptySet()) } },
        after = { rule.onNodeWithText("Deshacer").performClick(); rule.waitForIdle(); holdClock(); rule.onNodeWithText("Deshacer esta tarea").performClick(); settle() },
    )

    private fun heldThread() = listOf(
        line(1, "system", "La tarea #45 terminó", at(13, 57), """{"kind":"attention","task":45}"""),
    )

    private fun approvalsOn(palette: OrbPaletteChoice, suffix: String, rows: List<String>, detail: TaskDetail) {
        Shots.assumeEnabled()
        val b = backend(rows, "Versión 2.0 de la app", "app-movil").apply { detailsOnPc[detail.id] = detail; modeOnPc = "preguntar" }
        shoot("14-aprobaciones", palette, suffix, vm(b))
    }

    @Test fun approvalsHeld() = approvalsOn(OrbPaletteChoice.Grafito, "-retenida", heldThread(), task45)

    @Test fun approvalsFolderMoved() = approvalsOn(
        OrbPaletteChoice.Grafito, "-carpeta-movida",
        listOf(line(1, "system", "La tarea #47 espera tu OK", at(13, 57), """{"kind":"attention","task":47}""")), task47,
    )

    @Test fun approvalsLongDescription() = approvalsOn(
        OrbPaletteChoice.Grafito, "-descripcion-larga",
        listOf(line(1, "system", "La tarea #46 espera tu OK", at(13, 57), """{"kind":"attention","task":46}""")), task46,
    )

    @Test fun approvalsAgentQuestion() = approvals(OrbPaletteChoice.Grafito, "-pregunta", question = true)

    @Test fun approvalsAgentQuestionOwnAnswer() = approvals(
        OrbPaletteChoice.Grafito, "-pregunta-propia", question = true,
        after = { rule.onNodeWithText("Otra respuesta…").performClick(); rule.waitForIdle() },
    )

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

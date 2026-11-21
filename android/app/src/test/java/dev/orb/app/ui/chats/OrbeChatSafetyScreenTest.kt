package dev.orb.app.ui.chats

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.tasks.TaskAction
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** What a task card shows and offers where the person decides about a task: nothing cut, nothing approved blind. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class OrbeChatSafetyScreenTest {
    @get:Rule val rule = createComposeRule()

    private val openedTasks = ArrayList<Long>()
    private val openedChanges = ArrayList<Long>()

    private fun screen(b: FakeOrbeChatBackend, fontScale: Float = 1f) {
        val vm = OrbeChatViewModel(b, 7, dispatcher = Dispatchers.Unconfined)
        rule.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale)) {
                OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                    OrbeChatScreen(vm, onBack = {}, liveRefreshMs = 0, onOpenTask = { openedTasks += it }, onOpenChanges = { openedChanges += it })
                }
            }
        }
        rule.waitForIdle()
    }

    private val attention = raw(4, "system", "⚠️ La tarea #42 espera tu OK", """{"kind":"attention","task":42}""")
    private val ended = raw(4, "system", "La tarea #42 terminó", """{"kind":"task-end","task":42,"status":"done","result":"Listo"}""")

    private fun waiting(extra: TaskDetail.() -> TaskDetail = { this }) = TaskDetail(
        42, "Borrar build/ y reinstalar", "awaiting_approval", "codex", "C:/app-movil", listOf("destructive"), "h1", model = "gpt", folderNow = "C:/app-movil", folderMoved = false,
        actions = setOf(TaskAction.Approve), description = "Borra la carpeta build/ y vuelve a instalar las dependencias.",
    ).extra()

    // ---------- a task Orb stopped ----------

    private fun held(actions: Set<TaskAction>) = TaskDetail(
        45, "Limpiar la carpeta de pruebas", "blocked", "codex", "C:/app-movil", emptyList(), null, held = true,
        heldReasons = "ha eliminado 2714 archivos", heldFolder = "C:/app-movil", actions = actions,
    )

    @Test fun aHeldTaskSaysWhyAndOnlyOffersToLookAtTheChanges() {
        val b = FakeOrbeChatBackend(listOf(raw(4, "system", "Tarea #45", """{"kind":"attention","task":45}""")))
        b.taskDetail = held(setOf(TaskAction.SeeChanges))
        screen(b)
        rule.onNodeWithText("Retenida para que la revises: ha eliminado 2714 archivos en C:/app-movil.").assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText("Aceptar").fetchSemanticsNodes().size)
        assertEquals(0, rule.onAllNodesWithText("Deshacer").fetchSemanticsNodes().size)
        assertEquals(0, rule.onAllNodesWithText("Aprobar").fetchSemanticsNodes().size)
        rule.onNodeWithText("Ver cambios").performClick()
        assertEquals(listOf(45L), openedChanges)
        assertTrue(b.calls.none { it.startsWith("taskaccept") || it.startsWith("undo") })
    }

    @Test fun aHeldTaskWithoutChangesToSeeOpensTheTask() {
        val b = FakeOrbeChatBackend(listOf(raw(4, "system", "Tarea #45", """{"kind":"attention","task":45}""")))
        b.taskDetail = held(emptySet())
        screen(b)
        rule.onNodeWithText("Ver la tarea").performClick()
        assertEquals(listOf(45L), openedTasks)
        assertTrue(openedChanges.isEmpty())
    }

    @Test fun aHeldTaskThatTheThreadAnnouncesAsEndedIsNotAcceptedFromTheCard() {
        val b = FakeOrbeChatBackend(listOf(raw(4, "system", "La tarea #45 terminó", """{"kind":"task-end","task":45,"status":"blocked","result":"x"}""")))
        b.taskDetail = held(setOf(TaskAction.SeeChanges, TaskAction.AcceptHeld, TaskAction.UndoHeld))
        screen(b)
        // Even if a (wrong) set of actions reached the card, the held card draws none of them.
        assertEquals(0, rule.onAllNodesWithText("Aceptar").fetchSemanticsNodes().size)
        assertEquals(0, rule.onAllNodesWithText("Deshacer").fetchSemanticsNodes().size)
    }

    // ---------- the card that asks for the OK ----------

    @Test fun theCardKeepsToTheFingerprintLineAndNothingTheOkCoversIsOnIt() {
        val title = "Migrar el registro de notificaciones push a Room. ".repeat(18).trim()
        val path = "C:/Users/dani/proyectos/clientes/tienda-online/aplicaciones/movil/android/".repeat(10).trim()
        val description = "Revisa cada consulta del módulo y actualiza las pruebas. ".repeat(10).trim()
        val codes = (1..8).map { "motivo-$it-" + "largo".repeat(28) }
        val b = FakeOrbeChatBackend(listOf(attention))
        b.taskDetail = waiting { copy(title = title, project = path, folderNow = path, reasons = codes, description = description, reasoning = "high") }
        screen(b, fontScale = 2f)
        // The description, the folder and the reasons sentence are read whole on the task's own screen.
        assertEquals(0, rule.onAllNodesWithText(description, substring = true).fetchSemanticsNodes().size)
        assertEquals(0, rule.onAllNodesWithText("Pide tu OK porque", substring = true).fetchSemanticsNodes().size)
        assertEquals(0, rule.onAllNodesWithText("Aprobar").fetchSemanticsNodes().size)
        rule.onNodeWithText("Ver y aprobar").performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals(listOf(42L), openedTasks)
        assertTrue(b.calls.toString(), b.calls.none { it.startsWith("task ") })
    }

    /** Whatever the fingerprint covers (or the PC does not say), the card only opens the task and calls nothing. */
    private fun assertOnlyOpensTheTask(detail: TaskDetail) {
        val b = FakeOrbeChatBackend(listOf(attention))
        b.taskDetail = detail
        screen(b)
        assertEquals(0, rule.onAllNodesWithText("Aprobar").fetchSemanticsNodes().size)
        rule.onNodeWithText("Ver y aprobar").performClick()
        rule.waitForIdle()
        assertEquals(listOf(42L), openedTasks)
        assertTrue(b.calls.toString(), b.calls.none { it.startsWith("task ") })
    }

    @Test fun aLongDescriptionOnlyOpensTheTask() = assertOnlyOpensTheTask(waiting { copy(description = "x".repeat(601)) })

    @Test fun aDescriptionOfManyShortLinesOnlyOpensTheTask() =
        assertOnlyOpensTheTask(waiting { copy(description = (1..13).joinToString("\n") { "paso $it" }) })

    @Test fun aTaskWhoseFolderMovedOnlyOpensTheTask() = assertOnlyOpensTheTask(waiting { copy(reasons = listOf("ruta_cambiada")) })

    @Test fun aPcThatDoesNotSayIfTheFolderMovedOnlyOpensTheTask() =
        assertOnlyOpensTheTask(waiting { copy(project = "C:/viejo/app-movil", folderNow = "C:/nuevo/app-movil", folderMoved = null) })

    @Test fun aFolderThePcSaysMovedOnlyOpensTheTask() =
        assertOnlyOpensTheTask(waiting { copy(project = "D:/otros/app-movil", folderNow = "C:/app-movil", folderMoved = true) })

    @Test fun aFolderOutsideOrbsOwnOnlyOpensTheTask() = assertOnlyOpensTheTask(waiting { copy(folderNow = "app-movil", folderOutside = true) })

    @Test fun aCutDescriptionOnlyOpensTheTask() = assertOnlyOpensTheTask(waiting { copy(descriptionCut = true) })

    @Test fun aPcThatDoesNotSayTheCurrentFolderOnlyOpensTheTask() = assertOnlyOpensTheTask(waiting { copy(folderNow = null) })

    @Test fun aPerfectlyApprovableTaskStillOnlyOpensTheTask() = assertOnlyOpensTheTask(waiting())

    @Test fun theCardSaysWhoAndWhereTheFingerprintCoversNotWhoRunsIt() {
        val b = FakeOrbeChatBackend(listOf(attention))
        b.taskDetail = waiting { copy(runner = "claude", readonly = true, mode = "aislada", fast = true) }
        screen(b)
        rule.onNodeWithText("Codex · app-movil · elimina datos").assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText("Claude", substring = true).fetchSemanticsNodes().size)
    }

    // ---------- a card without data ----------

    private fun assertNeutralEnd() {
        assertEquals(0, rule.onAllNodesWithText("Espera tu OK").fetchSemanticsNodes().size)
        assertEquals(0, rule.onAllNodesWithText("Rechazar").fetchSemanticsNodes().size)
        assertEquals(0, rule.onAllNodesWithText("Ver y aprobar").fetchSemanticsNodes().size)
        assertEquals(0, rule.onAllNodesWithText("Aprobar").fetchSemanticsNodes().size)
        rule.onNodeWithText("Ver la tarea").assertIsDisplayed()
    }

    @Test fun anEndedTaskWhoseReadFailedStaysNeutral() {
        val b = FakeOrbeChatBackend(listOf(ended))
        b.detailResult = Result.failure(LinkException(LinkError.Refused(404, "No existe esa tarea")))
        screen(b)
        assertNeutralEnd()
        rule.onNodeWithText("Ver la tarea").performClick()
        assertEquals(listOf(42L), openedTasks)
    }

    @Test fun anEndedTaskWhoseReadHasNotArrivedYetIsNeutralToo() {
        val b = FakeOrbeChatBackend(listOf(ended))
        b.detailGate = CompletableDeferred()
        screen(b)
        assertNeutralEnd()
    }
}

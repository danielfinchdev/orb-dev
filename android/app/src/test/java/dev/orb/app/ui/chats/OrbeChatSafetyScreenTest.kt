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

    /**
     * The text has no line cap: the layout was asked with no `maxLines`, so nothing can end in an ellipsis however long the
     * text or large the font. Robolectric measures every character one pixel wide and never wraps, so the size of the box says
     * nothing here; the input of the layout does, and the pictures of the card show the rest.
     */
    private fun assertNoCap(text: String) {
        rule.onNodeWithText(text, substring = true, useUnmergedTree = true).performScrollTo()
        val node = rule.onNodeWithText(text, substring = true, useUnmergedTree = true).fetchSemanticsNode()
        val out = ArrayList<TextLayoutResult>()
        node.config[SemanticsActions.GetTextLayoutResult].action!!.invoke(out)
        val input = out.first().layoutInput
        assertEquals("«${text.take(40)}…» has a line cap", Int.MAX_VALUE, input.maxLines)
        assertEquals(2f, input.density.fontScale, 0f)
    }

    private val attention = raw(4, "system", "⚠️ La tarea #42 espera tu OK", """{"kind":"attention","task":42}""")
    private val ended = raw(4, "system", "La tarea #42 terminó", """{"kind":"task-end","task":42,"status":"done","result":"Listo"}""")

    private fun waiting(extra: TaskDetail.() -> TaskDetail = { this }) = TaskDetail(
        42, "Borrar build/ y reinstalar", "awaiting_approval", "codex", "C:/app-movil", listOf("destructive"), "h1", model = "gpt", folderNow = "C:/app-movil",
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

    @Test fun nothingTheOkIsAboutIsCutAndTheButtonStillSaysApprove() {
        val title = "Migrar el registro de notificaciones push a Room. ".repeat(18).trim()
        val path = "C:/Users/dani/proyectos/clientes/tienda-online/aplicaciones/movil/android/".repeat(10).trim()
        val description = "Revisa cada consulta del módulo y actualiza las pruebas. ".repeat(10).trim()
        val codes = (1..8).map { "motivo-$it-" + "largo".repeat(28) }
        val b = FakeOrbeChatBackend(listOf(attention))
        b.taskDetail = waiting { copy(title = title, project = path, folderNow = path, reasons = codes, description = description, reasoning = "high") }
        screen(b, fontScale = 2f)
        assertNoCap("#42 " + title)
        assertNoCap("Pide tu OK porque: ${codes.first()}")
        assertNoCap(description)
        assertNoCap(path)
        assertEquals(0, rule.onAllNodesWithText("Ver y aprobar").fetchSemanticsNodes().size)
        rule.onNodeWithText("Aprobar").performScrollTo().performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("task 42 true h1"))
    }

    @Test fun aDescriptionOverTheLimitIsCutSoTheButtonOnlyOpensTheTask() {
        val long = "x".repeat(TaskDetail.CARD_DESCRIPTION_CHARS + 1)
        val b = FakeOrbeChatBackend(listOf(attention))
        b.taskDetail = waiting { copy(description = long) }
        screen(b)
        rule.onNodeWithText("…", substring = true).assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText("Aprobar").fetchSemanticsNodes().size)
        rule.onNodeWithText("Ver y aprobar").performClick()
        rule.waitForIdle()
        assertEquals(listOf(42L), openedTasks)
        assertTrue(b.calls.toString(), b.calls.none { it.startsWith("task ") })
    }

    @Test fun aDescriptionOfManyShortLinesIsAlsoOverTheLimit() {
        val lines = (1..TaskDetail.CARD_DESCRIPTION_LINES + 1).joinToString("\n") { "paso $it" }
        val b = FakeOrbeChatBackend(listOf(attention))
        b.taskDetail = waiting { copy(description = lines) }
        screen(b)
        rule.onNodeWithText("Ver y aprobar").performClick()
        rule.waitForIdle()
        assertEquals(listOf(42L), openedTasks)
        assertTrue(b.calls.none { it.startsWith("task ") })
    }

    @Test fun theCardShowsTheAgentAndFolderTheFingerprintCoversNotWhoRunsIt() {
        val b = FakeOrbeChatBackend(listOf(attention))
        b.taskDetail = waiting { copy(runner = "claude", readonly = true, mode = "aislada", fast = true) }
        screen(b)
        rule.onNodeWithText("Codex (gpt) · modo rápido · en una copia aislada · solo lectura").assertIsDisplayed()
        rule.onNodeWithText("C:/app-movil").assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText("Claude", substring = true).fetchSemanticsNodes().size)
    }

    @Test fun aTaskWhoseFolderMovedCannotBeApprovedFromTheCard() {
        val b = FakeOrbeChatBackend(listOf(attention))
        b.taskDetail = waiting { copy(reasons = listOf("ruta_cambiada")) }
        screen(b)
        rule.onNodeWithText("Ver y aprobar").performClick()
        rule.waitForIdle()
        assertEquals(listOf(42L), openedTasks)
        assertTrue(b.calls.none { it.startsWith("task ") })
    }

    @Test fun aMovedProjectShowsTheCurrentFolderWithTheWarningAndSendsTheHashOfIt() {
        val b = FakeOrbeChatBackend(listOf(attention))
        b.taskDetail = waiting { copy(project = "C:/viejo/app-movil", folderNow = "C:/nuevo/app-movil") }
        screen(b)
        rule.onNodeWithText("C:/nuevo/app-movil").assertIsDisplayed()
        rule.onNodeWithText("La carpeta del proyecto ha cambiado desde que se creó la tarea.").assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText("C:/viejo/app-movil").fetchSemanticsNodes().size)
        rule.onNodeWithText("Aprobar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("task 42 true h1"))
    }

    @Test fun aPcThatDoesNotSayTheCurrentFolderOnlyOpensTheTask() {
        val b = FakeOrbeChatBackend(listOf(attention))
        b.taskDetail = waiting { copy(folderNow = null) }
        screen(b)
        rule.onNodeWithText("Ver y aprobar").performClick()
        rule.waitForIdle()
        assertEquals(listOf(42L), openedTasks)
        assertTrue(b.calls.none { it.startsWith("task ") })
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

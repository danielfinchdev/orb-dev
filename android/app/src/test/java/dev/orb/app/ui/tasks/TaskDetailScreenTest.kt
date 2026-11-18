package dev.orb.app.ui.tasks

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.OrbPaletteChoice
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class TaskDetailScreenTest {
    @get:Rule val rule = createComposeRule()

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    private fun show(b: FakeTasksBackend, id: Long, onChanges: (Long) -> Unit = {}, onOpen: (Long) -> Unit = {}) {
        val vm = TaskDetailViewModel(b, id, reloadDebounceMs = 0)
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                TaskDetailScreen(vm, onBack = {}, onOpenTask = onOpen, onOpenChanges = onChanges, nowMs = { 1_800_000_000_000L })
            }
        }
        rule.waitForIdle()
    }

    private fun backend(d: TaskDetail) = FakeTasksBackend().also { it.details[d.id] = Result.success(d) }

    @Test fun waitingTaskExplainsWhyAndOffersTheWayOut() {
        val d = detail(
            task(44, "Traducir la FAQ", status = "queued", waiting = TaskWait("notice", "Claude al 94 % del límite", emptyList())),
            description = "Traducir faq.html al inglés",
        )
        val b = backend(d)
        show(b, 44)
        rule.onNodeWithText("#44 Traducir la FAQ").assertIsDisplayed()
        rule.onNodeWithText("¿Por qué espera?").assertIsDisplayed()
        rule.onNodeWithText("Claude al 94 % del límite").assertIsDisplayed()
        rule.onNodeWithText("Traducir faq.html al inglés").assertIsDisplayed()
        rule.onNodeWithText("Iniciar de todos modos").performClick()
        rule.waitForIdle()
        assertEquals(emptyList<String>(), b.calls)
        rule.onNodeWithText("¿Iniciar esta tarea ahora?").assertIsDisplayed()
        rule.onNodeWithText("Iniciar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("launch 44"), b.calls)
    }

    @Test fun rejectingAsksBeforeCancellingTheTask() {
        val b = backend(detail(task(45, status = "awaiting_approval"), previewHash = "h1"))
        show(b, 45)
        rule.onNodeWithText("Rechazar").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Rechazarla cancela la tarea.").assertIsDisplayed()
        assertEquals(emptyList<String>(), b.calls)
        rule.onNodeWithText("Rechazar y cancelar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("decide 45 false h1"), b.calls)
    }

    @Test fun cancelAsksBeforeAskingThePc() {
        val b = backend(detail(task(44, status = "queued")))
        show(b, 44)
        rule.onNodeWithText("Cancelar").performScrollTo().performClick()
        rule.onNodeWithText("¿Cancelar esta tarea?").assertIsDisplayed()
        assertEquals(emptyList<String>(), b.calls)
        rule.onNodeWithText("Volver").performClick()
        rule.waitForIdle()
        assertEquals(emptyList<String>(), b.calls)
        rule.onNodeWithText("Cancelar").performScrollTo().performClick()
        rule.onNodeWithText("Cancelar tarea").performClick()
        rule.waitForIdle()
        assertEquals(listOf("cancel 44"), b.calls)
    }

    @Test fun heldTaskShowsTheReasonAcceptAndAConfirmedUndo() {
        val d = detail(task(5, status = "blocked", held = TaskHeld("ha eliminado 214 archivos", "C:/p")), hasCheckpoint = true)
        val b = backend(d)
        show(b, 5)
        rule.onNodeWithText("Retenida para que la revises: ha eliminado 214 archivos en C:/p.").assertIsDisplayed()
        rule.onNodeWithText("Rechazar").performClick()
        rule.onNodeWithText("Rechazar los cambios").assertIsDisplayed()
        assertEquals(emptyList<String>(), b.calls)
        // The button on the card and the one in the dialog.
        rule.onAllNodesWithText("Rechazar").assertCountEquals(2)
        rule.onAllNodesWithText("Rechazar")[1].performClick()
        rule.waitForIdle()
        assertEquals(listOf("undo 5"), b.calls)
    }

    @Test fun acceptAsksThePc() {
        val d = detail(task(5, status = "blocked", held = TaskHeld("x", null)), hasCheckpoint = true)
        val b = backend(d)
        show(b, 5)
        rule.onNodeWithText("Aprobar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("accept 5"), b.calls)
    }

    @Test fun seeChangesOpensTheDiff() {
        var opened = 0L
        show(backend(detail(task(9, status = "done"), hasCheckpoint = true)), 9, onChanges = { opened = it })
        rule.onNodeWithText("Ver cambios").performScrollTo().performClick()
        assertEquals(9L, opened)
    }

    @Test fun anUnreadableTaskOffersToTryAgain() {
        show(FakeTasksBackend(), 3)
        rule.onNodeWithText("Reintentar").assertIsDisplayed()
    }

    @Test fun dependenciesOpenTheirTask() {
        var opened = 0L
        val d = detail(task(7, status = "queued"), dependencies = listOf(TaskLink(3, "Compilar", "running")))
        show(backend(d), 7, onOpen = { opened = it })
        rule.onNodeWithText("#3 Compilar · En curso").performScrollTo().performClick()
        assertEquals(3L, opened)
    }
}

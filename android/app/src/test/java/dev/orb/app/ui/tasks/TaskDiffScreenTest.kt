package dev.orb.app.ui.tasks

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.ThemeChoice
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
class TaskDiffScreenTest {
    @get:Rule val rule = createComposeRule()

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    private val files = listOf(
        DiffFile("M", "src/push.ts", 2, 1, false, PATCH, false),
        DiffFile("A", "logo.png", 0, 0, true, "", false),
    )

    private fun show(b: FakeTasksBackend) {
        val vm = TaskDiffViewModel(b, 4)
        rule.setContent { OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { TaskDiffScreen(vm, onBack = {}) } }
        rule.waitForIdle()
    }

    private fun backend(diff: TaskDiff, d: TaskDetail = detail(task(4, status = "done"), hasCheckpoint = true)) =
        FakeTasksBackend().also { it.details[4] = Result.success(d); it.diffs[4] = Result.success(diff) }

    @Test fun showsTheSummaryTheFileChipsAndTheLinesOfTheFirstFile() {
        show(backend(TaskDiff(true, files, 0)))
        rule.onNodeWithText("Cambios de la #4").assertIsDisplayed()
        rule.onNodeWithText("2 archivos · +2 −1").assertIsDisplayed()
        rule.onNodeWithText("push.ts +2 −1").assertIsDisplayed()
        rule.onNodeWithText("export async function init() {").assertIsDisplayed()
        rule.onNodeWithText("export function init() {}").assertIsDisplayed()
    }

    @Test fun aFileWithoutPatchSaysThereIsNoContentChange() {
        show(backend(TaskDiff(true, listOf(DiffFile("R", "src/new-name.ts", 0, 0, false, "", false)), 0)))
        rule.onNodeWithText("Sin cambios de contenido en este archivo").assertIsDisplayed()
    }

    @Test fun tappingAChipShowsTheOtherFile() {
        show(backend(TaskDiff(true, files, 0)))
        rule.onNodeWithText("logo.png").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Archivo binario: no hay vista previa.").assertIsDisplayed()
    }

    @Test fun aCutPatchSaysItIsTooBigInsteadOfBreaking() {
        show(backend(TaskDiff(true, listOf(DiffFile("M", "big.sql", 90000, 0, false, "", true)), 0)))
        rule.onNodeWithText("El cambio es demasiado grande para verlo aquí. Ábrelo en el PC.").assertIsDisplayed()
    }

    @Test fun aLongDiffOnlyComposesWhatIsVisible() {
        val patch = "diff --git a/x b/x\n@@ -1,5000 +1,5000 @@\n" + (0 until 5000).joinToString("") { "+row number $it\n" }
        show(backend(TaskDiff(true, listOf(DiffFile("M", "x", 5000, 0, false, patch, false)), 0)))
        rule.onNodeWithText("row number 0").assertIsDisplayed()
        assert(rule.onAllNodesWithText("row number", substring = true).fetchSemanticsNodes().size < 100)
    }

    @Test fun acceptGoesToThePcAndUndoAsksFirst() {
        val b = backend(TaskDiff(true, files, 0))
        show(b)
        rule.onNodeWithText("Aprobar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("accept 4"), b.calls)
        rule.onNodeWithText("Rechazar").performClick()
        rule.onNodeWithText("Rechazar los cambios").assertIsDisplayed()
        assertEquals(listOf("accept 4"), b.calls)
        rule.onAllNodesWithText("Rechazar")[1].performClick()
        rule.waitForIdle()
        assertEquals(listOf("accept 4", "undo 4"), b.calls)
    }

    @Test fun withoutChangesItExplainsWhy() {
        show(backend(TaskDiff(false, emptyList(), 0)))
        rule.onNodeWithText("No hay cambios que mostrar").assertIsDisplayed()
    }
}

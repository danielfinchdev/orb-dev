package dev.orb.app.ui.projects

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.ui.chats.ChatRef
import dev.orb.app.ui.chats.row
import dev.orb.app.ui.tasks.task
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
class ProjectDetailScreenTest {
    @get:Rule val rule = createComposeRule()

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    private fun backend() = FakeProjectsBackend().also {
        it.detailResult = Result.success(
            ProjectDetailData(
                listOf(row("1", title = "Versión 2.0 de la app", project = "app-movil")),
                listOf(task(7, "Ajustar el pie", status = "running", project = "app-movil")),
                ProjectGit("dev", 2, null, null),
            ),
        )
    }

    private fun show(b: FakeProjectsBackend, onBack: () -> Unit = {}, onChat: (ChatRef) -> Unit = {}, onTask: (Long) -> Unit = {}) {
        val vm = ProjectDetailViewModel(b, "app-movil", reloadDebounceMs = 0)
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { ProjectDetailScreen(vm, onBack, onChat, onTask) } }
        rule.waitForIdle()
    }

    @Test fun showsChatsTasksBranchAndActions() {
        show(backend())
        rule.onNodeWithText("Versión 2.0 de la app").assertIsDisplayed()
        rule.onNodeWithText("#7 Ajustar el pie").assertIsDisplayed()
        rule.onNodeWithText("dev · 2 cambios").assertIsDisplayed()
        for (t in listOf("Revisión", "Revisión de seguridad", "Bitácora del proyecto", "Terminar proyecto")) rule.onNodeWithText(t).performScrollTo().assertIsDisplayed()
    }

    @Test fun rowsOpenTheExistingChatAndTask() {
        var chat: ChatRef? = null
        var taskId = 0L
        show(backend(), onChat = { chat = it }, onTask = { taskId = it })
        rule.onNodeWithText("Versión 2.0 de la app").performClick()
        rule.onNodeWithText("#7 Ajustar el pie").performClick()
        assertEquals("1", chat?.id)
        assertEquals(7L, taskId)
    }

    @Test fun finishNeedsConfirmationAndThenLeaves() {
        val b = backend()
        var left = 0
        show(b, onBack = { left++ })
        rule.onNodeWithText("Terminar proyecto").performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals(emptyList<String>(), b.calls)
        rule.onNodeWithText("Cancelar").performClick()
        rule.waitForIdle()
        assertEquals(emptyList<String>(), b.calls)
        rule.onNodeWithText("Terminar proyecto").performScrollTo().performClick()
        rule.onNodeWithText("Terminar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("finish app-movil"), b.calls)
        assertEquals(1, left)
    }

    @Test fun reviewsAskBeforeSpendingThePlan() {
        val b = backend()
        show(b)
        rule.onNodeWithText("Revisión de seguridad").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("¿Pedir la revisión de seguridad?").assertIsDisplayed()
        assertEquals(emptyList<String>(), b.calls)
        rule.onNodeWithText("Pedir revisión").performClick()
        rule.waitForIdle()
        assertEquals(listOf("security app-movil"), b.calls)
    }

    @Test fun logOpensInASheetWithThePcsText() {
        val b = backend()
        b.logResult = Result.success("Entrada del lunes")
        show(b)
        rule.onNodeWithText("Bitácora del proyecto").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Entrada del lunes").assertIsDisplayed()
    }

    @Test fun missingMethodsHideTheirRows() {
        val b = backend()
        b.unavailable = setOf(ApiMethods.PROJECTS_FINISH.name, ApiMethods.PROJECTS_SECURITY_REVIEW.name)
        show(b)
        rule.onNodeWithText("Terminar proyecto").assertDoesNotExist()
        rule.onNodeWithText("Revisión de seguridad").assertDoesNotExist()
    }
}

package dev.orb.app.ui.projects

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.ui.chats.ChatRef
import dev.orb.app.ui.chats.row
import dev.orb.app.ui.tasks.task
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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

    private val running = task(7, "Ajustar el pie", status = "running", project = "app-movil")
    private val done = task(8, "Cambiar los colores", status = "done", project = "app-movil")

    private fun backend(tasks: List<dev.orb.app.ui.tasks.TaskRow> = listOf(running), git: ProjectGit? = ProjectGit("dev", 2, null, null)) = FakeProjectsBackend().also {
        it.detailResult = Result.success(
            ProjectDetailData(listOf(row("1", title = "Versión 2.0 de la app", project = "app-movil")), tasks, git, "android"),
        )
    }

    private class Taps {
        var chat: ChatRef? = null
        var task = 0L
        var changes = 0L
        var newChat: String? = null
        var prs: String? = null
        var left = 0
    }

    private fun show(b: FakeProjectsBackend, taps: Taps = Taps()): Taps {
        val vm = ProjectDetailViewModel(b, "app-movil", reloadDebounceMs = 0)
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                ProjectDetailScreen(
                    vm, onBack = { taps.left++ }, onOpenChat = { taps.chat = it }, onOpenTask = { taps.task = it },
                    onOpenPrs = { taps.prs = it }, onNewChat = { taps.newChat = it }, onOpenChanges = { taps.changes = it },
                )
            }
        }
        rule.waitForIdle()
        return taps
    }

    @Test fun headerShowsTheNameAndAUsefulLineAndTheBarTheBranch() {
        show(backend())
        check(rule.onAllNodesWithText("app-movil").fetchSemanticsNodes().size >= 2)
        rule.onNodeWithText("android · rama dev").assertIsDisplayed()
        rule.onNodeWithText("1 tarea en curso").assertIsDisplayed()
    }

    @Test fun showsChatsAndTheRowsOfMoreOfTheProject() {
        show(backend())
        rule.onNodeWithText("Versión 2.0 de la app").assertIsDisplayed()
        rule.onNodeWithText("Más del proyecto").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("dev · 2").performScrollTo().assertIsDisplayed()
        for (t in listOf("Revisión de seguridad", "Bitácora del proyecto", "Pull requests", "Revisión", "Tareas del proyecto", "Terminar proyecto")) {
            rule.onNodeWithText(t).performScrollTo().assertIsDisplayed()
        }
    }

    @Test fun theChatRowOpensTheChatAndTheTasksRowListsTheProjectsTasks() {
        val taps = show(backend())
        rule.onNodeWithText("Versión 2.0 de la app").performClick()
        assertEquals("1", taps.chat?.id)
        rule.onNodeWithText("Tareas del proyecto").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("#7 Ajustar el pie").performClick()
        assertEquals(7L, taps.task)
    }

    @Test fun theTwoButtonsStartATaskAndAChatOfThisProject() {
        val b = backend()
        val taps = show(b)
        rule.onNodeWithText("Nuevo chat").performClick()
        assertEquals("app-movil", taps.newChat)
        rule.onNodeWithText("Tarea").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Nueva tarea").assertIsDisplayed()
        rule.onNodeWithContentDescription("Título").performTextInput("Ajustar")
        rule.onNodeWithContentDescription("Qué tiene que hacer").performTextInput("el pie")
        rule.onNodeWithText("Crear tarea").performClick()
        rule.waitForIdle()
        assertEquals(listOf("task app-movil|Ajustar|el pie"), b.calls)
    }

    @Test fun theTaskButtonIsHiddenWhenThePcCannotCreateTasks() {
        val b = backend().also { it.unavailable = setOf(ApiMethods.TASKS_CREATE.name) }
        show(b)
        rule.onNodeWithText("Tarea").assertDoesNotExist()
        rule.onNodeWithText("Nuevo chat").assertIsDisplayed()
    }

    @Test fun branchSheetNamesEachThingForWhatItIs() {
        val b = backend(listOf(running, done), ProjectGit("dev", 2, 3, null))
        show(b)
        rule.onNodeWithText("Rama y cambios").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Rama").assertIsDisplayed()
        rule.onNodeWithText("2 archivos sin confirmar").assertIsDisplayed()
        rule.onNodeWithText("3 commits sin subir").assertIsDisplayed()
        rule.onNodeWithText("1 tarea con cambios sin aceptar").assertIsDisplayed()
        rule.onNodeWithText("Los cambios sin confirmar de todo el proyecto solo se ven en el PC.").assertIsDisplayed()
        for (t in listOf("Revisión cruzada", "Revisión de seguridad", "Ver cambios")) rule.onAllNodesWithText(t).onLast().assertIsDisplayed()
    }

    @Test fun seeChangesOpensTheOnlyTaskWithUnacceptedChanges() {
        val taps = show(backend(listOf(running, done)))
        rule.onNodeWithText("Rama y cambios").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Ver cambios").performClick()
        rule.waitForIdle()
        assertEquals(8L, taps.changes)
    }

    @Test fun seeChangesAsksWhichTaskWhenSeveralHaveUnacceptedChanges() {
        val other = task(9, "Pasar a Compose", status = "done", project = "app-movil")
        val taps = show(backend(listOf(running, done, other, task(10, "Ya aceptada", status = "done", accepted = true, project = "app-movil"))))
        rule.onNodeWithText("Rama y cambios").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("2 tareas con cambios sin aceptar").assertIsDisplayed()
        rule.onNodeWithText("Ver cambios").performClick()
        rule.waitForIdle()
        assertEquals(0L, taps.changes)
        rule.onNodeWithText("Cambios por aceptar").assertIsDisplayed()
        rule.onNodeWithText("#10 Ya aceptada").assertDoesNotExist()
        rule.onNodeWithText("#9 Pasar a Compose").performClick()
        rule.waitForIdle()
        assertEquals(9L, taps.changes)
    }

    @Test fun seeChangesWithNoneSaysSoAndPromisesNothingMore() {
        val taps = show(backend(listOf(running)))
        rule.onNodeWithText("Rama y cambios").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Ninguna tarea con cambios sin aceptar").assertIsDisplayed()
        rule.onNodeWithText("No hay cambios de tareas por aceptar").assertIsDisplayed()
        rule.onNodeWithText("Ver cambios").assertIsNotEnabled()
        rule.onNodeWithText("Ver cambios").performClick()
        assertEquals(0L, taps.changes)
    }

    @Test fun aFolderWithoutGitSaysSoInTheSheet() {
        show(backend(git = null))
        rule.onNodeWithText("Rama y cambios").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onAllNodesWithText("Sin git").onLast().assertIsDisplayed()
        rule.onNodeWithText("Cambios").assertDoesNotExist()
    }

    @Test fun reviewsFromTheSheetAskBeforeSpendingThePlan() {
        val b = backend()
        show(b)
        rule.onNodeWithText("Rama y cambios").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Revisión cruzada").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("¿Pedir la revisión del proyecto?").assertIsDisplayed()
        assertEquals(emptyList<String>(), b.calls)
        rule.onNodeWithText("Pedir revisión").performClick()
        rule.waitForIdle()
        assertEquals(listOf("review app-movil"), b.calls)

        rule.onNodeWithText("Rama y cambios").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onAllNodesWithText("Revisión de seguridad").onLast().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("¿Pedir la revisión de seguridad?").assertIsDisplayed()
        rule.onNodeWithText("Cancelar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("review app-movil"), b.calls)
    }

    @Test fun reviewsFromMoreOfTheProjectAskToo() {
        val b = backend()
        show(b)
        rule.onNodeWithText("Revisión de seguridad").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("¿Pedir la revisión de seguridad?").assertIsDisplayed()
        assertEquals(emptyList<String>(), b.calls)
        rule.onNodeWithText("Pedir revisión").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Revisión").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Pedir revisión").performClick()
        rule.waitForIdle()
        assertEquals(listOf("security app-movil", "review app-movil"), b.calls)
    }

    @Test fun finishNeedsConfirmationAndThenLeaves() {
        val b = backend()
        val taps = show(b)
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
        assertEquals(1, taps.left)
    }

    @Test fun finishTellsThePlainTruthAboutTheTasks() {
        show(backend())
        rule.onNodeWithText("Terminar proyecto").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("¿Terminar «app-movil»?").assertIsDisplayed()
        rule.onNodeWithText(ProjectTexts.FINISH_BODY).assertIsDisplayed()
        assertTrue(ProjectTexts.FINISH_BODY.contains("tareas pendientes se cancelan"))
        assertTrue(ProjectTexts.FINISH_BODY.contains("programadas se pausan"))
        assertTrue(!ProjectTexts.FINISH_BODY.contains("se conservan"))
    }

    @Test fun aFinishedProjectOffersToReopenAndNothingElseThatActs() {
        val b = FakeProjectsBackend().also {
            it.detailResult = Result.success(
                ProjectDetailData(listOf(row("1", title = "Versión 2.0 de la app", project = "app-movil")), emptyList(), null, "android", "k1", "2026-10-01T10:00:00Z"),
            )
        }
        show(b)
        rule.onAllNodesWithText("Proyecto terminado").let { check(it.fetchSemanticsNodes().isNotEmpty()) }
        check(rule.onAllNodesWithText("Está en «Terminados»", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())
        for (t in listOf("Tarea", "Nuevo chat", "Terminar proyecto", "Revisión de seguridad", "Rama y cambios")) rule.onNodeWithText(t).assertDoesNotExist()
        rule.onNodeWithText("Versión 2.0 de la app").assertIsDisplayed()
        rule.onNodeWithText("Reabrir").performClick()
        rule.waitForIdle()
        assertEquals(listOf("reopen k1"), b.calls)
    }

    @Test fun moreOfTheProjectKeepsPullRequestsAndTheirRoute() {
        val taps = show(backend())
        rule.onNodeWithText("Pull requests").performScrollTo().performClick()
        assertEquals("app-movil", taps.prs)
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
        b.unavailable = setOf(ApiMethods.PROJECTS_FINISH.name, ApiMethods.PROJECTS_SECURITY_REVIEW.name, ApiMethods.PROJECTS_PRS.name)
        show(b)
        rule.onNodeWithText("Terminar proyecto").assertDoesNotExist()
        rule.onNodeWithText("Revisión de seguridad").assertDoesNotExist()
        rule.onNodeWithText("Pull requests").assertDoesNotExist()
    }

    @Test fun withoutTheLinkTheActionsDoNotAct() {
        val b = backend().also { it.connectionState.value = ConnectionState.Offline(null, null) }
        show(b)
        rule.onNodeWithText("Tarea").assertIsNotEnabled()
        rule.onNodeWithText("Terminar proyecto").performScrollTo().assertIsNotEnabled()
    }

    @Test fun aFailedLoadOffersToTryAgain() {
        val b = FakeProjectsBackend().also { it.detailResult = Result.failure(LinkException(LinkError.Offline)) }
        show(b)
        rule.onNodeWithText(ProjectTexts.DETAIL_ERROR).assertIsDisplayed()
        rule.onNodeWithText("Reintentar").assertIsDisplayed()
    }
}

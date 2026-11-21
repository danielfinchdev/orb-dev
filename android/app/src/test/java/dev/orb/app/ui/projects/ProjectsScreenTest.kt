package dev.orb.app.ui.projects

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.coroutines.CompletableDeferred
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
class ProjectsScreenTest {
    @get:Rule val rule = createComposeRule()

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    private val list = listOf(
        project("app-movil", "android", active = true, open = 2, git = ProjectGit("dev", 2, null, null)),
        project("api-pagos", "web", git = ProjectGit("main", 0, null, null)),
        project("tienda-online", "web", open = 1, approve = 1),
        project("prueba-orb", "web"),
    )
    private val done = listOf(FinishedProject("k1", "viejo", "web", "2026-10-01T10:00:00Z"))

    private fun show(b: FakeProjectsBackend, onOpen: (String) -> Unit = {}) {
        val vm = ProjectsViewModel(b, reloadDebounceMs = 0)
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { ProjectsScreen(vm, onOpen) } }
        rule.waitForIdle()
    }

    /** The backend as a 3.8.8 PC answers: the plain list first and then the same projects with their git. */
    private fun withGit() = FakeProjectsBackend(list.map { it.copy(git = null) }, done).also {
        it.gitResult = Result.success(list.mapNotNull { p -> p.git?.let { g -> p.name to g } }.toMap())
    }

    @Test fun cardsShowBranchChangesAndTheStateOfTheTasks() {
        show(withGit())
        rule.onNodeWithText("app-movil").assertIsDisplayed()
        rule.onNodeWithText("dev · 2 archivos sin confirmar").assertIsDisplayed()
        rule.onNodeWithText("main · al día").assertIsDisplayed()
        rule.onNodeWithText("2 tareas").assertIsDisplayed()
        rule.onNodeWithText("1 por aprobar").assertIsDisplayed()
        rule.onAllNodesWithText("Tranquilo").onFirst().assertIsDisplayed()
        for (chip in listOf("Activos", "android", "web", "Terminados")) rule.onAllNodesWithText(chip)[0].assertIsDisplayed()
        rule.onNodeWithText("Nuevo", useUnmergedTree = true).assertExists()
    }

    @Test fun theHeaderCountsTheProjectsLikeTheMockup() {
        show(withGit())
        rule.onNodeWithText("Proyectos").assertIsDisplayed()
        rule.onNodeWithText("4 activos").assertIsDisplayed()
    }

    @Test fun anOlderPcShowsCardsWithoutABranchLine() {
        val b = withGit().also { it.gitReadable = false }
        show(b)
        rule.onNodeWithText("app-movil").assertIsDisplayed()
        rule.onNodeWithText("dev · 2 archivos sin confirmar").assertDoesNotExist()
        rule.onNodeWithText("main · al día").assertDoesNotExist()
        assertEquals(0, b.gitCount)
    }

    @Test fun theBranchLineArrivesLateWithoutHoldingTheCardsBack() {
        val b = withGit().also { it.gitGate = CompletableDeferred() }
        show(b)
        rule.onNodeWithText("app-movil").assertIsDisplayed()
        rule.onNodeWithText("dev · 2 archivos sin confirmar").assertDoesNotExist()
        b.gitGate!!.complete(Unit)
        rule.waitForIdle()
        rule.onNodeWithText("dev · 2 archivos sin confirmar").assertIsDisplayed()
    }

    @Test fun projectsWithoutGitHaveNoLine() {
        val b = withGit().also { it.gitResult = Result.success(mapOf("app-movil" to ProjectGit("dev", 1, null, null))) }
        show(b)
        rule.onNodeWithText("dev · 1 archivo sin confirmar").assertIsDisplayed()
        rule.onAllNodesWithText("main · al día").assertCountEquals(0)
    }

    @Test fun anActiveCardSaysSoToAScreenReader() {
        show(withGit())
        rule.onNode(hasText("app-movil") and SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, ProjectTexts.ACTIVE_STATE)).assertExists()
        rule.onNode(hasText("api-pagos") and SemanticsMatcher.keyIsDefined(SemanticsProperties.StateDescription)).assertDoesNotExist()
    }

    @Test fun tappingACardOpensTheProject() {
        var opened = ""
        show(withGit(), onOpen = { opened = it })
        rule.onNodeWithText("api-pagos").performClick()
        assertEquals("api-pagos", opened)
    }

    @Test fun longPressOffersToMakeTheProjectActiveOrClearIt() {
        val b = withGit()
        show(b)
        rule.onNodeWithText("api-pagos").performTouchInput { longClick() }
        rule.waitForIdle()
        rule.onNodeWithText("Hacer activo").performClick()
        rule.waitForIdle()
        assertEquals(listOf("active api-pagos"), b.calls)
        rule.onNodeWithText("app-movil").performTouchInput { longClick() }
        rule.waitForIdle()
        rule.onNodeWithText("Es el proyecto activo del PC.").assertIsDisplayed()
        rule.onNodeWithText("Quitar de activo").performClick()
        rule.waitForIdle()
        assertEquals("active null", b.calls.last())
    }

    @Test fun finishedSectionOffersReopenAndOpensTheProject() {
        val b = withGit()
        var opened = ""
        show(b, onOpen = { opened = it })
        rule.onNodeWithText("Terminados").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("viejo").assertIsDisplayed()
        rule.onNodeWithText("Reabrir").performClick()
        rule.waitForIdle()
        assertEquals(listOf("reopen k1"), b.calls)
        rule.onNodeWithText("viejo").performClick()
        assertEquals("viejo", opened)
    }

    @Test fun newProjectSheetCreatesThroughThePcWithTheChosenCategory() {
        val b = withGit()
        show(b)
        rule.onNodeWithText("Nuevo", useUnmergedTree = true).performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Nuevo proyecto").assertIsDisplayed()
        rule.onNodeWithText("Sin categoría").assertIsDisplayed()
        for (c in listOf("web", "android", "windows", "linux", "ios", "multi")) check(rule.onAllNodesWithText(c).fetchSemanticsNodes().isNotEmpty()) { c }
        rule.onNodeWithText("Clonar, importar, renombrar y eliminar proyectos: en el PC.").assertExists()
        rule.onNodeWithContentDescription("Nombre del proyecto").performTextInput("demo")
        rule.onNodeWithText("Crear").performClick()
        rule.waitForIdle()
        assertEquals(listOf("create demo|null|"), b.calls)
    }

    @Test fun newProjectOffersTheFreeCategoriesOfThePcAndSendsTheOneChosen() {
        // «godot» belongs to a finished project only, so no chip of the filter row repeats it.
        val b = FakeProjectsBackend(list, listOf(FinishedProject("k2", "juego", "godot", null)))
        show(b)
        rule.onNodeWithText("Nuevo", useUnmergedTree = true).performClick()
        rule.waitForIdle()
        rule.onNodeWithText("godot").performScrollTo().performClick()
        rule.onNodeWithContentDescription("Nombre del proyecto").performTextInput("demo")
        rule.onNodeWithText("Crear").performClick()
        rule.waitForIdle()
        assertEquals(listOf("create demo|godot|"), b.calls)
    }

    @Test fun theIconRowFollowsTheNameAndNotesLiveUnderMoreOptions() {
        val b = withGit()
        show(b)
        rule.onNodeWithText("Nuevo", useUnmergedTree = true).performClick()
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Icono: aún sin nombre").assertIsDisplayed()
        rule.onNodeWithContentDescription("Nombre del proyecto").performTextInput("demo")
        rule.onNodeWithContentDescription("Icono de demo").assertIsDisplayed()
        rule.onNodeWithText("Notas (opcional)").assertDoesNotExist()
        rule.onNodeWithText("Más opciones").performClick()
        rule.onNodeWithContentDescription("Notas (opcional)").performTextInput("para probar")
        rule.onNodeWithText("Crear").performClick()
        rule.waitForIdle()
        assertEquals(listOf("create demo|null|para probar"), b.calls)
    }

    @Test fun createNeedsAName() {
        val b = withGit()
        show(b)
        rule.onNodeWithText("Nuevo", useUnmergedTree = true).performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Crear").performClick()
        rule.waitForIdle()
        assertEquals(emptyList<String>(), b.calls)
    }

    @Test fun createAndFinishedAreHiddenWhenThePcDoesNotListThem() {
        val b = withGit()
        b.unavailable = setOf(ApiMethods.PROJECTS_CREATE.name, ApiMethods.PROJECTS_FINISHED.name)
        show(b)
        rule.onNodeWithText("Nuevo").assertDoesNotExist()
        rule.onNodeWithText("Terminados").assertDoesNotExist()
    }

    @Test fun noProjectsInvitesToCreateOne() {
        val b = FakeProjectsBackend(emptyList(), emptyList())
        show(b)
        rule.onNodeWithText("Aún no hay proyectos").assertIsDisplayed()
        rule.onNodeWithText("Crea uno para agrupar sus chats y tareas.").assertIsDisplayed()
        rule.onNodeWithText("Nuevo proyecto").performClick()
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Nombre del proyecto").assertIsDisplayed()
    }

    @Test fun aFailedFirstLoadOffersToTryAgain() {
        val b = FakeProjectsBackend().also { it.listResult = Result.failure(LinkException(LinkError.Offline)) }
        show(b)
        rule.onNodeWithText(ProjectTexts.LOAD_ERROR).assertIsDisplayed()
        b.listResult = null
        b.data = ProjectsData(list, done)
        rule.onNodeWithText("Reintentar").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("app-movil").assertIsDisplayed()
    }

    @Test fun savedProjectsStayOnScreenWithoutTheLink() {
        val b = FakeProjectsBackend().also {
            it.connectionState.value = ConnectionState.Offline(null, null)
            it.listResult = Result.failure(LinkException(LinkError.Offline))
            it.savedFlow.value = ProjectsData(list.map { p -> p.copy(git = null) }, done)
        }
        show(b)
        rule.onNodeWithText("app-movil").assertIsDisplayed()
        rule.onNodeWithText("2 tareas").assertIsDisplayed()
    }
}


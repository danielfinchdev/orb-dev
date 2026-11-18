package dev.orb.app.ui.projects

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import dev.orb.app.link.api.ApiMethods
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
class ProjectsScreenTest {
    @get:Rule val rule = createComposeRule()

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    private val list = listOf(project("app-movil", "android", active = true, open = 2), project("api-pagos", "web"))
    private val done = listOf(FinishedProject("k1", "viejo", "web", "2026-10-01T10:00:00Z"))

    private fun show(b: FakeProjectsBackend, onOpen: (String) -> Unit = {}) {
        val vm = ProjectsViewModel(b, reloadDebounceMs = 0)
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { ProjectsScreen(vm, onOpen) } }
        rule.waitForIdle()
    }

    @Test fun gridShowsProjectsCategoriesAndOpenTasks() {
        show(FakeProjectsBackend(list, done))
        rule.onNodeWithText("app-movil").assertIsDisplayed()
        rule.onNodeWithText("2 tareas").assertIsDisplayed()
        rule.onNodeWithText("Tranquilo").assertIsDisplayed()
        for (chip in listOf("Activos", "android", "web", "Terminados")) rule.onAllNodesWithText(chip)[0].assertIsDisplayed()
        rule.onNodeWithText("Nuevo", useUnmergedTree = true).assertExists()
    }

    @Test fun tappingACardOpensTheProject() {
        var opened = ""
        show(FakeProjectsBackend(list), onOpen = { opened = it })
        rule.onNodeWithText("api-pagos").performClick()
        assertEquals("api-pagos", opened)
    }

    @Test fun finishedSectionOffersReopen() {
        val b = FakeProjectsBackend(list, done)
        show(b)
        rule.onNodeWithText("Terminados").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("viejo").assertIsDisplayed()
        rule.onNodeWithText("Reabrir").performClick()
        rule.waitForIdle()
        assertEquals(listOf("reopen k1"), b.calls)
    }

    @Test fun newProjectFormCreatesThroughThePc() {
        val b = FakeProjectsBackend(list)
        show(b)
        rule.onNodeWithText("Nuevo", useUnmergedTree = true).performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Nombre").performTextInput("demo")
        rule.onNodeWithText("Crear proyecto").performClick()
        rule.waitForIdle()
        assertEquals(listOf("create demo|null|"), b.calls)
    }

    @Test fun createAndFinishedAreHiddenWhenThePcDoesNotListThem() {
        val b = FakeProjectsBackend(list, done)
        b.unavailable = setOf(ApiMethods.PROJECTS_CREATE.name, ApiMethods.PROJECTS_FINISHED.name)
        show(b)
        rule.onNodeWithText("Nuevo").assertDoesNotExist()
        rule.onNodeWithText("Terminados").assertDoesNotExist()
    }
}

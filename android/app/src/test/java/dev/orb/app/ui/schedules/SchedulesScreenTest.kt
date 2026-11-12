package dev.orb.app.ui.schedules

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.ThemeChoice
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
class SchedulesScreenTest {
    @get:Rule val rule = createComposeRule()

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    private fun show(b: FakeSchedulesBackend, onBack: () -> Unit = {}) {
        val vm = SchedulesViewModel(b, reloadDebounceMs = 0)
        rule.setContent { OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { SchedulesScreen(vm, onBack) } }
        rule.waitForIdle()
    }

    @Test fun listShowsTheScheduleAndWhenItRuns() {
        show(FakeSchedulesBackend(listOf(schedule(1), schedule(2, "Pruebas", enabled = false))))
        rule.onNodeWithText("Revisar dependencias").assertIsDisplayed()
        rule.onNodeWithText("Pruebas").assertIsDisplayed()
        rule.onNodeWithText("Programadas").assertIsDisplayed()
    }

    @Test fun emptyListExplainsWhatToDo() {
        show(FakeSchedulesBackend())
        rule.onNodeWithText("No hay tareas programadas").assertIsDisplayed()
    }

    @Test fun runNowAsksForConfirmationFirst() {
        val b = FakeSchedulesBackend(listOf(schedule(1)))
        show(b)
        rule.onNodeWithContentDescription("Más acciones").performClick()
        rule.onNodeWithText("Ejecutar ahora").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.isEmpty())
        rule.onNodeWithText("¿Ejecutar ahora?").assertIsDisplayed()
        rule.onNodeWithText("Ejecutar ahora").performClick()
        rule.waitForIdle()
        assertEquals(listOf("run 1"), b.calls)
    }

    @Test fun turningOffAsksForConfirmation() {
        val b = FakeSchedulesBackend(listOf(schedule(1)))
        show(b)
        rule.onNode(androidx.compose.ui.test.isToggleable()).performClick()
        rule.waitForIdle()
        assertTrue(b.calls.isEmpty())
        rule.onNodeWithText("¿Desactivar esta tarea programada?").assertIsDisplayed()
        rule.onNodeWithText("Desactivar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("update 1 enabled=false approve=false title=null description=null"), b.calls)
    }

    @Test fun newScheduleFormCreatesThroughThePc() {
        val b = FakeSchedulesBackend()
        show(b)
        rule.onNodeWithText("Nueva", useUnmergedTree = true).performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Título").performTextInput("Tests")
        rule.onNodeWithText("Instrucciones").performTextInput("Corre los tests")
        rule.onNodeWithText("Programar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("create app-movil|Tests|daily|09:00|[]|6|false"), b.calls)
    }

    @Test fun createAndRunAreHiddenWhenThePcLacksThem() {
        val b = FakeSchedulesBackend(listOf(schedule(1)))
        b.unavailable = setOf(ApiMethods.SCHEDULES_CREATE.name, ApiMethods.SCHEDULES_RUN.name, ApiMethods.SCHEDULES_UPDATE.name)
        show(b)
        rule.onNodeWithText("Nueva").assertDoesNotExist()
        rule.onNodeWithContentDescription("Más acciones").assertDoesNotExist()
    }
}

private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.onNodeWithContentDescription(d: String) =
    onNode(androidx.compose.ui.test.hasContentDescription(d))

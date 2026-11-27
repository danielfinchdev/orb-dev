package dev.orb.app.ui.schedules

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performTouchInput
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.ui.chats.ChatTime
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.TimeZone

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w390dp-h844dp-xhdpi")
class SchedulesScreenTest {
    @get:Rule val rule = createComposeRule()

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    // «Now» is Thursday 12 November 2026, 12:00 in Madrid; the phone is in UTC so the schedule's own zone shows.
    private val now = ChatTime.parse("2026-11-12T11:00:00.000Z")!!

    private fun show(b: FakeSchedulesBackend, onBack: () -> Unit = {}) {
        val vm = SchedulesViewModel(b, reloadDebounceMs = 0)
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { SchedulesScreen(vm, onBack, clock = { now }, zone = TimeZone.getTimeZone("UTC")) } }
        rule.waitForIdle()
    }

    private fun field(label: String) = rule.onNode(hasSetTextAction() and hasContentDescription(label))
    private fun button(text: String) = rule.onNode(hasText(text) and hasClickAction())
    // The chips sit in rows that scroll sideways inside a sheet that scrolls: the click action works wherever they are drawn.
    private fun tap(text: String) {
        rule.onNodeWithText(text).performSemanticsAction(SemanticsActions.OnClick)
        rule.waitForIdle()
    }

    private fun openMore() {
        rule.onNodeWithText("Más opciones").performScrollTo().performClick()
        rule.waitForIdle()
    }

    private fun openRowSheet(title: String = "Revisar dependencias") {
        rule.onNodeWithText(title).performTouchInput { longClick() }
        rule.waitForIdle()
    }

    // The list

    @Test fun rowsShowTheNameTheFrequencyTheNextRunAndTheLastOne() {
        val b = FakeSchedulesBackend(
            listOf(
                schedule(1, tz = "Europe/Madrid", nextRun = "2026-11-16T08:00:00.000Z"),
                schedule(2, "Copia de la bitácora", every = "daily", whenText = "cada día a las 23:30", lastRun = "2026-11-11T22:30:00.000Z", lastTask = 7, nextRun = null),
            ),
        )
        b.outcomeMap = Result.success(mapOf(7L to "done"))
        show(b)
        rule.onNodeWithText("Programadas").assertIsDisplayed()
        rule.onNodeWithText("2 tareas programadas").assertIsDisplayed()
        rule.onNodeWithText("Revisar dependencias").assertIsDisplayed()
        rule.onNodeWithText("Cada lunes a las 9:00 · app-movil").assertIsDisplayed()
        rule.onNodeWithText("Próxima: lun 16, 9:00 (Madrid)").assertIsDisplayed()
        rule.onNodeWithText("Cada día a las 23:30 · app-movil").assertIsDisplayed()
        rule.onNodeWithText("Última: ayer, bien").assertIsDisplayed()
        rule.onNodeWithText("Mantén pulsada una para «Ejecutar ahora». Para borrarla, usa el PC.").assertExists()
    }

    @Test fun aPausedScheduleHasNoNextRunAndSaysItIsPaused() {
        show(FakeSchedulesBackend(listOf(schedule(1, enabled = false, tz = "Europe/Madrid"))))
        rule.onNodeWithText("En pausa").assertIsDisplayed()
        assertTrue(rule.onAllNodesWithText("Próxima", substring = true).fetchSemanticsNodes().isEmpty())
    }

    @Test fun aMonthlyScheduleIsShownAsMonthly() {
        show(FakeSchedulesBackend(listOf(schedule(1, every = "monthly", monthDay = 5, whenText = "el día 5 de cada mes a las 09:00", weekdays = emptyList()))))
        rule.onNodeWithText("El día 5 de cada mes a las 9:00 · app-movil").assertIsDisplayed()
        assertTrue(rule.onAllNodesWithText("Una sola vez", substring = true).fetchSemanticsNodes().isEmpty())
    }

    @Test fun aFrequencyTheAppDoesNotKnowIsNotCalledASingleRun() {
        show(FakeSchedulesBackend(listOf(schedule(1, every = "yearly", whenText = "yearly"))))
        rule.onNodeWithText("Frecuencia definida en el PC · app-movil").assertIsDisplayed()
        assertTrue(rule.onAllNodesWithText("Una sola vez", substring = true).fetchSemanticsNodes().isEmpty())
    }

    @Test fun theBackArrowGoesBack() {
        var back = 0
        show(FakeSchedulesBackend(listOf(schedule(1))), onBack = { back++ })
        rule.onNode(hasContentDescription("Volver")).performClick()
        assertEquals(1, back)
    }

    // The states

    @Test fun emptyListExplainsAndOffersToProgram() {
        show(FakeSchedulesBackend())
        rule.onNodeWithText("No hay tareas programadas").assertIsDisplayed()
        rule.onNodeWithText("Programa una para que Orb la lance sola a su hora.").assertIsDisplayed()
        button("Programar").assertIsDisplayed()
    }

    @Test fun whileTheFirstReadWaitsNothingIsSaidAboutAnEmptyList() {
        val b = FakeSchedulesBackend()
        b.listGate = kotlinx.coroutines.CompletableDeferred()
        show(b)
        assertTrue(rule.onAllNodesWithText("No hay tareas programadas").fetchSemanticsNodes().isEmpty())
        assertTrue(rule.onAllNodesWithText("No se pudieron cargar", substring = true).fetchSemanticsNodes().isEmpty())
    }

    @Test fun aFailedFirstReadOffersToTryAgain() {
        val b = FakeSchedulesBackend(listOf(schedule(1)))
        b.listResult = Result.failure(LinkException(LinkError.Timeout))
        show(b)
        rule.onNodeWithText("No se pudieron cargar las tareas programadas desde el PC.").assertIsDisplayed()
        b.listResult = null
        button("Reintentar").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Revisar dependencias").assertIsDisplayed()
    }

    @Test fun withoutTheLinkTheSavedRowsStayButNothingCanBeChanged() {
        val b = FakeSchedulesBackend(listOf(schedule(1)))
        b.connectionState.value = dev.orb.app.link.net.ConnectionState.Offline(null, null)
        b.listResult = Result.failure(LinkException(LinkError.Offline))
        b.savedItems.value = listOf(schedule(1))
        show(b)
        rule.onNodeWithText("Revisar dependencias").assertIsDisplayed()
        rule.onNode(isToggleable()).assertIsNotEnabled()
        openRowSheet()
        rule.onNodeWithText("Ejecutar ahora").assertIsNotEnabled()
        rule.onNodeWithText("Editar").assertIsNotEnabled()
    }

    // The sheet of a row

    @Test fun aLongPressOpensTheSheetOfThatRow() {
        show(FakeSchedulesBackend(listOf(schedule(1))))
        openRowSheet()
        rule.onNodeWithText("Ejecutar ahora").assertIsDisplayed()
        rule.onNodeWithText("Editar").assertIsDisplayed()
        rule.onNodeWithText("Desactivar").assertIsDisplayed()
        rule.onNodeWithText("Para borrarla, usa el PC.").assertIsDisplayed()
    }

    @Test fun theRowsHaveNoMoreButtonAndTheLongPressActionIsOfferedToAScreenReader() {
        show(FakeSchedulesBackend(listOf(schedule(1))))
        rule.onNode(hasContentDescription("Más acciones: Revisar dependencias")).assertDoesNotExist()
        val long = rule.onNodeWithText("Revisar dependencias").fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsActions.OnLongClick]
        assertEquals("Abrir acciones", long.label)
        rule.onNodeWithText("Revisar dependencias").performTouchInput { longClick() }
        rule.waitForIdle()
        rule.onNodeWithText("Ejecutar ahora").assertIsDisplayed()
        rule.onNodeWithText("Desactivar").assertIsDisplayed()
    }

    @Test fun theLongPressIsAnActionOfTheRowWithItsOwnName() {
        show(FakeSchedulesBackend(listOf(schedule(1))))
        val row = rule.onNode(SemanticsMatcher.keyIsDefined(SemanticsActions.OnLongClick)).fetchSemanticsNode()
        assertEquals("Abrir acciones", row.config[SemanticsActions.OnLongClick].label)
    }

    @Test fun runNowAsksForConfirmationFirst() {
        val b = FakeSchedulesBackend(listOf(schedule(1)))
        show(b)
        openRowSheet()
        rule.onNodeWithText("Ejecutar ahora").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.isEmpty())
        rule.onNodeWithText("¿Ejecutar ahora?").assertIsDisplayed()
        button("Ejecutar ahora").performClick()
        rule.waitForIdle()
        assertEquals(listOf("run 1"), b.calls)
    }

    @Test fun turningOffWithTheSwitchAsksForConfirmation() {
        val b = FakeSchedulesBackend(listOf(schedule(1)))
        show(b)
        rule.onNode(isToggleable()).performClick()
        rule.waitForIdle()
        assertTrue(b.calls.isEmpty())
        rule.onNodeWithText("¿Desactivar esta tarea programada?").assertIsDisplayed()
        button("Desactivar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("update 1 enabled=false approve=false title=null description=null"), b.calls)
    }

    @Test fun turningOffFromTheSheetAsksToo_AndTurningOnDoesNot() {
        val b = FakeSchedulesBackend(listOf(schedule(1), schedule(2, "Pruebas", enabled = false)))
        show(b)
        openRowSheet()
        rule.onNodeWithText("Desactivar").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("¿Desactivar esta tarea programada?").assertIsDisplayed()
        button("Cancelar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.isEmpty())
        openRowSheet("Pruebas")
        rule.onNodeWithText("Activar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("update 2 enabled=true approve=false title=null description=null"), b.calls)
    }

    @Test fun createRunAndUpdateAreHiddenWhenThePcLacksThem() {
        val b = FakeSchedulesBackend(listOf(schedule(1)))
        b.unavailable = setOf(ApiMethods.SCHEDULES_CREATE.name, ApiMethods.SCHEDULES_RUN.name, ApiMethods.SCHEDULES_UPDATE.name)
        show(b)
        assertTrue(rule.onAllNodesWithText("Programar").fetchSemanticsNodes().isEmpty())
        assertTrue(rule.onAllNodesWithText("Más acciones", substring = true).fetchSemanticsNodes().isEmpty())
        assertTrue(rule.onAllNodes(isToggleable()).fetchSemanticsNodes().isEmpty())
    }

    // Approval

    @Test fun anAssistantsScheduleIsMarkedAndCannotRunOrBeSwitchedOnBeforeTheOk() {
        val b = FakeSchedulesBackend(listOf(schedule(1, approved = false)))
        show(b)
        rule.onNodeWithText("Pendiente de aprobación").assertIsDisplayed()
        rule.onNode(isToggleable()).assertIsNotEnabled()
        openRowSheet()
        rule.onNodeWithText("Ejecutar ahora").assertIsNotEnabled()
        rule.onNodeWithText("Revisar y aprobar…").assertIsEnabled()
        assertTrue(rule.onAllNodesWithText("Desactivar").fetchSemanticsNodes().isEmpty())
    }

    @Test fun theApprovalDialogShowsEverythingAndAsksBeforeApproving() {
        val b = FakeSchedulesBackend(
            listOf(schedule(1, approved = false, agent = "claude", model = "opus", readonly = true, autonomy = "preguntar", tz = "Europe/Madrid", notifyMobile = true)),
        )
        show(b)
        openRowSheet()
        rule.onNodeWithText("Revisar y aprobar…").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.isEmpty())
        rule.onNodeWithText("Aprobar tarea programada").assertIsDisplayed()
        rule.onNodeWithText("Mira las dependencias").assertIsDisplayed()
        rule.onNodeWithText("Cada lunes a las 9:00").assertExists()
        rule.onNodeWithText("9:00 (Madrid)").assertExists()
        rule.onNodeWithText("Claude · opus").assertExists()
        rule.onNodeWithText("Pregunta antes de cada acción").assertExists()
        rule.onNodeWithText("Una vez aprobada, se ejecuta sola a su hora, con lo que ves aquí.").assertExists()
        button("Aprobar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("update 1 enabled=null approve=true title=null description=null"), b.calls)
    }

    @Test fun theApprovalDialogShowsWhatThePcHasNowNotWhatTheListShowed() {
        val b = FakeSchedulesBackend(listOf(schedule(1, approved = false)))
        show(b)
        b.items = listOf(schedule(1, "Otro nombre", approved = false))
        openRowSheet()
        rule.onNodeWithText("Revisar y aprobar…").performClick()
        rule.waitForIdle()
        assertTrue(rule.onAllNodesWithText("Revisar dependencias").fetchSemanticsNodes().isEmpty())
        assertTrue(rule.onAllNodesWithText("Otro nombre").fetchSemanticsNodes().size >= 2)
        rule.onNodeWithText("Ha cambiado en el PC desde que abriste la lista. Esto es lo que se aprobaría ahora.").assertIsDisplayed()
    }

    @Test fun theApproveButtonStaysOffWhenThePcCannotBeRead() {
        val b = FakeSchedulesBackend(listOf(schedule(1, approved = false)))
        show(b)
        b.listResult = Result.failure(LinkException(LinkError.Timeout))
        openRowSheet()
        rule.onNodeWithText("Revisar y aprobar…").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("No se pudo leer del PC. Sin verla entera, no se aprueba.").assertIsDisplayed()
        button("Aprobar").assertIsNotEnabled()
        button("Cancelar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.isEmpty())
    }

    // Create

    @Test fun theFloatingButtonOpensTheSheetWithTheInstructionsInView() {
        show(FakeSchedulesBackend(listOf(schedule(1))))
        button("Programar").performClick()
        rule.waitForIdle()
        field("Nombre de la tarea").assertIsDisplayed()
        field("Instrucciones").assertIsDisplayed()
        rule.onNodeWithText("Hora").assertIsDisplayed()
        rule.onNodeWithText("Proyecto").assertIsDisplayed()
        rule.onNodeWithText("Más opciones").assertIsDisplayed()
        for (d in listOf("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")) rule.onNode(hasContentDescription(d)).assertExists()
        button("Guardar").assertIsNotEnabled()
    }

    @Test fun savingNeedsTheNameAndTheInstructionsAndSendsTheDaysAndTheHour() {
        val b = FakeSchedulesBackend()
        show(b)
        button("Programar").performClick()
        rule.waitForIdle()
        field("Nombre de la tarea").performTextInput("Tests")
        button("Guardar").assertIsNotEnabled()
        field("Instrucciones").performTextInput("Corre los tests")
        button("Guardar").assertIsEnabled()
        // Monday is chosen by default; Friday joins it.
        rule.onNode(hasContentDescription("viernes")).performClick()
        button("Guardar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("create app-movil|Tests|weekly|09:00|[1, 5]|6|false|any|null"), b.calls)
        val sent = b.created.single()
        assertEquals("Corre los tests", sent.description)
        assertEquals(true, sent.notifyMobile)
        assertNull(sent.tz)
    }

    @Test fun withoutADayTheSheetCannotBeSaved() {
        val b = FakeSchedulesBackend()
        show(b)
        button("Programar").performClick()
        rule.waitForIdle()
        field("Nombre de la tarea").performTextInput("Tests")
        field("Instrucciones").performTextInput("Corre los tests")
        rule.onNode(hasContentDescription("lunes")).performClick()
        rule.onNodeWithText("Elige al menos un día.").assertExists()
        button("Guardar").assertIsNotEnabled()
    }

    @Test fun theTimeRowOpensThePickerAndKeepsWhatIsPicked() {
        val b = FakeSchedulesBackend()
        show(b)
        button("Programar").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Hora").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Elige la hora").assertIsDisplayed()
        button("Elegir").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("9:00").assertExists()
    }

    @Test fun theMoreOptionsHoldEveryFrequencyTheAgentTheModelAndTheSwitches() {
        val b = FakeSchedulesBackend()
        show(b)
        button("Programar").performClick()
        rule.waitForIdle()
        assertTrue(rule.onAllNodesWithText("Frecuencia").fetchSemanticsNodes().isEmpty())
        openMore()
        rule.waitForIdle()
        for (t in listOf("Días de la semana", "Cada mes", "Cada N horas", "Cada hora", "Una sola vez", "Cualquiera", "Claude", "Codex", "Solo lectura", "Ejecutar siempre en el mismo chat", "Avisar al móvil", "Pedir permiso siempre", "Zona horaria")) {
            rule.onNodeWithText(t).assertExists()
        }
    }

    @Test fun anOlderPcIsNotOfferedMonthlyNorTheZoneNorThePermissions() {
        val b = FakeSchedulesBackend()
        b.unavailable = setOf(ApiMethods.CHAT_EDIT_QUEUED.name)
        show(b)
        button("Programar").performClick()
        rule.waitForIdle()
        openMore()
        rule.waitForIdle()
        rule.onNodeWithText("Cada hora").assertExists()
        for (t in listOf("Cada mes", "Avisar al móvil", "Pedir permiso siempre", "Zona horaria")) {
            assertTrue(t, rule.onAllNodesWithText(t).fetchSemanticsNodes().isEmpty())
        }
    }

    @Test fun aMonthlyScheduleCanBeCreatedWithItsDayAndZone() {
        val b = FakeSchedulesBackend()
        show(b)
        button("Programar").performClick()
        rule.waitForIdle()
        field("Nombre de la tarea").performTextInput("Informe")
        field("Instrucciones").performTextInput("Haz el informe")
        openMore()
        rule.waitForIdle()
        tap("Cada mes")
        rule.waitForIdle()
        field("Día del mes").performTextReplacement("15")
        field("Zona horaria").performTextReplacement("Europe/Madrid")
        rule.onNode(hasContentDescription("Pedir permiso siempre") and isToggleable()).performSemanticsAction(SemanticsActions.OnClick)
        button("Guardar").performClick()
        rule.waitForIdle()
        val sent = b.created.single()
        assertEquals("monthly", sent.every)
        assertEquals(15, sent.monthDay)
        assertEquals("Europe/Madrid", sent.tz)
        assertEquals("preguntar", sent.autonomy)
    }

    @Test fun aSingleRunNeedsADateFromThePicker() {
        val b = FakeSchedulesBackend()
        show(b)
        button("Programar").performClick()
        rule.waitForIdle()
        field("Nombre de la tarea").performTextInput("Tests")
        field("Instrucciones").performTextInput("Corre los tests")
        openMore()
        rule.waitForIdle()
        tap("Una sola vez")
        rule.waitForIdle()
        rule.onNodeWithText("Fecha").assertExists()
        button("Guardar").assertIsNotEnabled()
    }

    @Test fun theAgentAndModelChoicesTravelWithTheSchedule() {
        val b = FakeSchedulesBackend()
        show(b)
        button("Programar").performClick()
        rule.waitForIdle()
        field("Nombre de la tarea").performTextInput("Tests")
        field("Instrucciones").performTextInput("Corre los tests")
        openMore()
        rule.waitForIdle()
        tap("Claude")
        rule.waitForIdle()
        tap("Sonnet")
        button("Guardar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("create app-movil|Tests|weekly|09:00|[1]|6|false|claude|sonnet"), b.calls)
    }

    // Edit

    @Test fun editOpensWithWhatTheScheduleHasAndSendsOnlyTheChange() {
        val b = FakeSchedulesBackend(listOf(schedule(1)))
        show(b)
        openRowSheet()
        rule.onNodeWithText("Editar").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Editar tarea").assertIsDisplayed()
        field("Nombre de la tarea").assert(hasText("Revisar dependencias"))
        field("Instrucciones").assert(hasText("Mira las dependencias"))
        button("Guardar").assertIsEnabled()
        field("Nombre de la tarea").performTextReplacement("Revisar dependencias 2")
        button("Guardar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("update 1 enabled=null approve=false title=Revisar dependencias 2 description=null"), b.calls)
        assertNull(b.patches.single().every)
    }

    @Test fun editingAFrequencyTheAppCannotDrawLeavesItAlone() {
        val b = FakeSchedulesBackend(listOf(schedule(1, every = "yearly", whenText = "yearly")))
        show(b)
        openRowSheet()
        rule.onNodeWithText("Editar").performClick()
        rule.waitForIdle()
        openMore()
        rule.waitForIdle()
        rule.onNodeWithText("Esta tarea se repite de una forma que solo se cambia en el PC.").assertExists()
        field("Nombre de la tarea").performTextReplacement("Revisar dependencias!")
        button("Guardar").performClick()
        rule.waitForIdle()
        val p = b.patches.single()
        assertNull(p.every)
        assertNull(p.atTime)
        assertNull(p.weekdays)
        assertEquals("Revisar dependencias!", p.title)
    }

    @Test fun aMonthlyScheduleOpensAsMonthlyEvenOnAnOlderPc() {
        val b = FakeSchedulesBackend(listOf(schedule(1, every = "monthly", monthDay = 5, weekdays = emptyList())))
        b.unavailable = setOf(ApiMethods.CHAT_EDIT_QUEUED.name)
        show(b)
        openRowSheet()
        rule.onNodeWithText("Editar").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Día del mes").assertExists()
        openMore()
        rule.waitForIdle()
        rule.onNodeWithText("Cada mes").assertExists()
    }

    @Test fun whatThePcOnlyLetsItsOwnWindowTakeOffIsShownLocked() {
        val b = FakeSchedulesBackend(listOf(schedule(1, readonly = true, autonomy = "preguntar")))
        show(b)
        openRowSheet()
        rule.onNodeWithText("Editar").performClick()
        rule.waitForIdle()
        openMore()
        rule.waitForIdle()
        assertEquals(2, rule.onAllNodesWithText("Solo se quita en el PC.").fetchSemanticsNodes().size)
        rule.onNode(hasContentDescription("Solo lectura") and isToggleable()).assertIsNotEnabled()
        rule.onNode(hasContentDescription("Pedir permiso siempre") and isToggleable()).assertIsNotEnabled()
    }
}

package dev.orb.app.ui.tasks

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import dev.orb.app.ui.chats.ChatTime
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
class TaskDetailScreenTest {
    @get:Rule val rule = createComposeRule()

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    /** Twelve minutes after the tasks of the fixture were created. */
    private val now = ChatTime.parse("2026-11-11T09:00:00.000Z")!! + 12 * 60_000L

    private fun show(b: FakeTasksBackend, id: Long, onChanges: (Long) -> Unit = {}, onOpen: (Long) -> Unit = {}) {
        val vm = TaskDetailViewModel(b, id, reloadDebounceMs = 0)
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                TaskDetailScreen(vm, onBack = {}, onOpenTask = onOpen, onOpenChanges = onChanges, nowMs = { now })
            }
        }
        rule.waitForIdle()
    }

    private fun backend(d: TaskDetail) = FakeTasksBackend().also { it.details[d.id] = Result.success(d) }

    private fun top(text: String) = rule.onNodeWithText(text).fetchSemanticsNode().positionInRoot.y
    private fun SemanticsNodeInteraction.assertStateDescription(text: String?) = assert(
        SemanticsMatcher("state description is $text") {
            (if (SemanticsProperties.StateDescription in it.config) it.config[SemanticsProperties.StateDescription] else null) == text
        },
    )
    private fun menu() = rule.onNodeWithContentDescription("Más").performClick().also { rule.waitForIdle() }

    // The header

    @Test fun theBarSaysTheNumberTheTitleAndWhoRunsIt() {
        val d = detail(task(44, "Traducir la FAQ", status = "queued", project = "api-pagos", agent = "claude").copy(model = "Sonnet"))
        show(backend(d), 44)
        rule.onNodeWithText("#44 Traducir la FAQ").assertIsDisplayed()
        rule.onNodeWithText("api-pagos · Claude · Sonnet").assertIsDisplayed()
    }

    @Test fun theBadgeSaysTheStateWhenAndByWhomItWasMade() {
        show(backend(detail(task(44, status = "queued"), createdBy = "orbe")), 44)
        rule.onNodeWithText("En cola · creada hace 12 min por Orbe").assertIsDisplayed()
    }

    // ¿Por qué espera?, one card per reason

    @Test fun waitingTaskExplainsWhyAndOffersTheWayOut() {
        val d = detail(
            task(44, "Traducir la FAQ", status = "queued", waiting = TaskWait("notice", "Claude al 94 % del límite", emptyList())),
            description = "Traducir faq.html al inglés",
        )
        val b = backend(d)
        show(b, 44)
        rule.onNodeWithText("¿Por qué espera?").assertIsDisplayed()
        rule.onNodeWithText("Claude al 94 % del límite").assertIsDisplayed()
        rule.onNodeWithText("Traducir faq.html al inglés").assertIsDisplayed()
        rule.onNodeWithText("Otra cuenta o agente").assertIsDisplayed()
        rule.onNodeWithText("Iniciar de todos modos").performClick()
        rule.waitForIdle()
        assertEquals(emptyList<String>(), b.calls)
        rule.onNodeWithText("¿Iniciar esta tarea ahora?").assertIsDisplayed()
        rule.onNodeWithText("Iniciar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("launch 44"), b.calls)
    }

    @Test fun aUsageLimitSaysTheAccountThePercentAndWhenItComesBack() {
        val until = "2026-11-19T14:00:00.000Z"
        val clock = TaskLines.clock(until)!!
        val w = TaskWait("notice", "Límite", emptyList(), account = "Claude", until = until, percent = 94)
        show(backend(detail(task(44, status = "queued", waiting = w))), 44)
        rule.onNodeWithText("Claude va al 94 % de su límite. Vuelve a las $clock; la cola la lanzará sola.").assertIsDisplayed()
    }

    @Test fun aBusyFolderNamesTheTaskThatWritesThere() {
        show(backend(detail(task(45, status = "queued", waiting = TaskWait("folder", null, emptyList(), by = 42)))), 45)
        rule.onNodeWithText("Otra tarea escribe en esta carpeta (#42). La cola la lanzará sola cuando la otra tarea termine.").assertIsDisplayed()
    }

    @Test fun waitingForOtherTasksSaysWhichAndCannotBeForced() {
        val w = TaskWait("deps", null, listOf(WaitDep(43, "blocked", true)))
        show(backend(detail(task(41, status = "queued", waiting = w))), 41)
        rule.onNodeWithText("Espera a la #43: #43 está por aprobar. La cola la lanzará sola cuando se resuelva.").assertIsDisplayed()
        rule.onNodeWithText("Iniciar de todos modos").assertDoesNotExist()
    }

    @Test fun aPausedQueueAndAManualStartHaveTheirOwnNote() {
        show(backend(detail(task(7, status = "queued", waiting = TaskWait("paused", null, emptyList())))), 7)
        rule.onNodeWithText(TaskTexts.WAIT_PAUSED_NOTE).assertIsDisplayed()
    }

    @Test fun aManualStartIsExplained() {
        show(backend(detail(task(7, status = "queued", waiting = TaskWait("manual", null, emptyList())))), 7)
        rule.onNodeWithText(TaskTexts.WAIT_MANUAL_NOTE).assertIsDisplayed()
    }

    @Test fun aTaskWaitingForItsTurnSaysSo() {
        show(backend(detail(task(7, status = "queued"))), 7)
        rule.onNodeWithText("Es su turno en la cola: empieza en cuanto le toque.").assertIsDisplayed()
    }

    // The order of the cards

    @Test fun theReasonComesFirstThenWhatToDoThenTheDetails() {
        val d = detail(task(44, status = "queued", result = "Algo salió", waiting = TaskWait("manual", null, emptyList())), description = "Traducir")
        show(backend(d), 44)
        assertTrue(top("¿Por qué espera?") < top("Qué tiene que hacer"))
        assertTrue(top("Qué tiene que hacer") < top("Resultado"))
        assertTrue(top("Resultado") < top("Detalles"))
    }

    @Test fun theResultIsVisibleRightAfterWhatToDo() {
        show(backend(detail(task(9, status = "done", result = "Terminado sin problemas"), description = "Hacer algo")), 9)
        rule.onNodeWithText("Terminado sin problemas").assertIsDisplayed()
    }

    // Held for review

    @Test fun heldTaskShowsTheReasonSeeChangesAndAcceptAndUndoIsInTheMenuWithItsConfirmation() {
        val d = detail(task(5, status = "blocked", held = TaskHeld("ha eliminado 214 archivos", "C:/p")), hasCheckpoint = true)
        val b = backend(d)
        show(b, 5)
        rule.onNodeWithText("Retenida para revisión").assertIsDisplayed()
        rule.onNodeWithText("Retenida · creada hace 12 min por Orbe").assertIsDisplayed()
        rule.onNodeWithText("Orb la paró: ha eliminado 214 archivos en C:/p. Revisa los cambios antes de seguir.").assertIsDisplayed()
        rule.onNodeWithText("Ver cambios").assertIsDisplayed()
        rule.onNodeWithText("Aceptar").assertIsDisplayed()
        // The card no longer carries «Deshacer»: it is in the «⋮» menu, and asks before touching anything.
        rule.onNodeWithText("Deshacer").assertDoesNotExist()
        menu()
        rule.onNodeWithText("Deshacer").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("¿Deshacer esta tarea?").assertIsDisplayed()
        assertEquals(emptyList<String>(), b.calls)
        rule.onNodeWithText("Deshacer").performClick()
        rule.waitForIdle()
        assertEquals(listOf("undo 5"), b.calls)
    }

    @Test fun undoInTheMenuReadsTheTaskAgainAndUsesTheCheckpointItSaw() {
        val d = detail(task(5, status = "blocked", held = TaskHeld("ha eliminado 214 archivos", "C:/p")), hasCheckpoint = true, checkpointId = "cp1")
        val b = backend(d)
        show(b, 5)
        menu()
        rule.onNodeWithText("Deshacer").performClick()
        rule.waitForIdle()
        // Moving the button changed nothing about what it sends.
        rule.onNodeWithText("Deshacer").performClick()
        rule.waitForIdle()
        assertEquals(listOf("cp1"), b.undoCheckpoints)
    }

    @Test fun aHeldTaskDrawsAllThreeButtonsOfTheBarAndSaysWhyTheOffOnesAreOff() {
        val d = detail(task(5, status = "blocked", held = TaskHeld("ha eliminado 214 archivos", "C:/p")), hasCheckpoint = true)
        show(backend(d), 5)
        rule.onNodeWithText("Cancelar tarea").assertIsNotEnabled()
        rule.onNodeWithText("Cancelar tarea").assertStateDescription(TaskTexts.BAR_CANCEL_DONE)
        rule.onNodeWithText("Reasignar").assertStateDescription(null)
        rule.onNodeWithText("Seguir").assertIsDisplayed()
    }

    @Test fun aFailedTaskKeepsTheBarAndItsOffButtonsSayWhy() {
        val d = detail(task(8, status = "failed"))
        val b = backend(d)
        b.unavailable = setOf("tasks.reassign", "tasks.followup")
        show(b, 8)
        for (t in listOf("Cancelar tarea", "Reasignar", "Seguir")) rule.onNodeWithText(t).assertIsDisplayed()
        rule.onNodeWithText("Cancelar tarea").assertIsNotEnabled()
        rule.onNodeWithText("Cancelar tarea").assertStateDescription(TaskTexts.BAR_CANCEL_DONE)
        rule.onNodeWithText("Reasignar").assertIsNotEnabled()
        rule.onNodeWithText("Reasignar").assertStateDescription(TaskTexts.BAR_PC_NO)
        rule.onNodeWithText("Seguir").assertIsNotEnabled()
    }

    @Test fun acceptAsksThePc() {
        val d = detail(task(5, status = "blocked", held = TaskHeld("x", null)), hasCheckpoint = true)
        val b = backend(d)
        show(b, 5)
        rule.onNodeWithText("Aceptar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("accept 5"), b.calls)
    }

    @Test fun seeChangesOpensTheDiffFromAHeldTaskAndFromAFinishedOne() {
        var opened = 0L
        show(backend(detail(task(5, status = "blocked", held = TaskHeld("x", null)), hasCheckpoint = true)), 5, onChanges = { opened = it })
        rule.onNodeWithText("Ver cambios").performScrollTo().performClick()
        assertEquals(5L, opened)
    }

    @Test fun seeChangesOpensTheDiffOfAFinishedTask() {
        var opened = 0L
        show(backend(detail(task(9, status = "done"), hasCheckpoint = true)), 9, onChanges = { opened = it })
        rule.onNodeWithText("Ver cambios").performScrollTo().performClick()
        assertEquals(9L, opened)
    }

    // Not finished

    @Test fun aFailedTaskSaysItDidNotFinishAndOffersAnotherAgentOrToTryAgain() {
        val b = backend(detail(task(8, status = "failed")))
        show(b, 8)
        rule.onNodeWithText("Fallida · creada hace 12 min por Orbe").assertIsDisplayed()
        rule.onNodeWithText("No terminó").assertIsDisplayed()
        rule.onNodeWithText("El agente se detuvo antes de acabar. Puedes volver a intentarlo.").assertIsDisplayed()
        rule.onNodeWithText("Otra cuenta o agente").assertIsDisplayed()
        rule.onNodeWithText("Reintentar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("retry 8"), b.calls)
    }

    @Test fun aTaskStoppedByTheLimitSaysWhenItComesBack() {
        val until = "2026-11-19T14:00:00.000Z"
        val clock = TaskLines.clock(until)!!
        show(backend(detail(task(8, status = "limited", limitedUntil = until))), 8)
        rule.onNodeWithText("La cuenta llegó a su límite de uso y vuelve a las $clock. Puedes volver a intentarlo.").assertIsDisplayed()
    }

    // The OK

    @Test fun rejectingAsksBeforeCancellingTheTask() {
        val b = backend(detail(task(45, status = "awaiting_approval"), previewHash = "h1"))
        show(b, 45)
        rule.onNodeWithText("Espera tu OK").assertIsDisplayed()
        rule.onNodeWithText("Rechazar").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Rechazarla cancela la tarea.").assertIsDisplayed()
        assertEquals(emptyList<String>(), b.calls)
        rule.onNodeWithText("Rechazar y cancelar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("decide 45 false h1"), b.calls)
    }

    // The data

    @Test fun theDetailsSayTheReviewTheDependenciesAndWhetherItIsScheduled() {
        val d = detail(
            task(44, "Traducir", status = "done", agent = "claude", scheduleId = 3), review = TaskReview(50, "correcto", "codex", "2026-11-11T09:30:00.000Z"),
            dependencies = listOf(TaskLink(41, "Compilar", "done")), mode = "aislada",
        )
        show(backend(d), 44)
        for (t in listOf("Revisión", "Codex (cruzada) · correcto", "Depende de", "#41", "Programada", "Sí", "Copia aislada")) rule.onAllNodesWithText(t).onFirst().performScrollTo().assertIsDisplayed()
    }

    @Test fun theFolderIsNeverARawPathAndTheTechnicalFactsAreFolded() {
        val d = detail(task(44, status = "queued", project = "api-pagos", agent = "claude").copy(model = "Sonnet"), mode = "carpeta")
        show(backend(d), 44)
        rule.onNodeWithText("api-pagos").performScrollTo().assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText("C:/p", substring = true).fetchSemanticsNodes().size)
        // Agent, model and reasoning are not asked for here: they wait under «Más opciones».
        rule.onNodeWithText("Razonamiento").assertDoesNotExist()
        rule.onNodeWithText("Más opciones").performScrollTo().performClick()
        rule.waitForIdle()
        for (t in listOf("Agente", "Modelo", "Razonamiento")) rule.onNodeWithText(t).performScrollTo().assertIsDisplayed()
    }

    @Test fun aTaskWaitingForAnOkWithoutFactsShowsAgentModelAndReasoningInTheDetails() {
        val d = detail(task(44, status = "awaiting_approval", agent = "claude").copy(model = "Sonnet"), previewHash = "h1")
        show(backend(d), 44)
        for (t in listOf("Agente", "Modelo", "Razonamiento")) rule.onNodeWithText(t).performScrollTo().assertIsDisplayed()
    }

    @Test fun fileNamesInTheBriefAreDrawnInMonospace() {
        val spans = CodeSpans.of("Traducir faq.html al inglés, versión 3.8.8 y `npm test`.")
        val mono = spans.spanStyles.map { spans.text.substring(it.start, it.end) }
        assertEquals(listOf("faq.html", "npm test"), mono)
        assertEquals("Traducir faq.html al inglés, versión 3.8.8 y npm test.", spans.text)
    }

    @Test fun aReviewByTheTasksOwnAgentIsNotCalledCrossed() {
        val d = detail(task(44, status = "done", agent = "codex"), review = TaskReview(50, "con fallos", "codex", null))
        show(backend(d), 44)
        rule.onNodeWithText("Codex · con fallos").performScrollTo().assertIsDisplayed()
    }

    @Test fun anUnscheduledTaskWithoutDependenciesSaysNoAndNothing() {
        show(backend(detail(task(44, status = "queued"))), 44)
        rule.onNodeWithText("Programada").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("No").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("—").performScrollTo().assertIsDisplayed()
    }

    @Test fun theDetailsKeepReadOnlyAndTheAccount() {
        val d = detail(task(44, status = "queued").copy(readonly = true)).copy(accountLabel = "Claude Pro", branch = "orb/44")
        show(backend(d), 44)
        rule.onNodeWithText("Más opciones").performScrollTo().performClick()
        rule.waitForIdle()
        for (t in listOf("Solo lectura", "Cuenta", "Claude Pro", "Rama", "orb/44")) rule.onNodeWithText(t).performScrollTo().assertIsDisplayed()
    }

    // The fixed bar

    @Test fun theBarOffersCancelReassignAndFollowAndCancelAsksFirst() {
        val b = backend(detail(task(44, status = "queued")))
        show(b, 44)
        rule.onNodeWithText("Reasignar").assertIsDisplayed()
        rule.onNodeWithText("Seguir").assertIsDisplayed()
        rule.onNodeWithText("Cancelar tarea").performClick()
        rule.onNodeWithText("¿Cancelar la tarea #44?").assertIsDisplayed()
        rule.onNodeWithText("Se quita de la cola y no se ejecutará. Puedes crearla otra vez.").assertIsDisplayed()
        assertEquals(emptyList<String>(), b.calls)
        rule.onNodeWithText("Volver").performClick()
        rule.waitForIdle()
        assertEquals(emptyList<String>(), b.calls)
        rule.onNodeWithText("Cancelar tarea").performClick()
        rule.onAllNodesWithText("Cancelar tarea").onLast().performClick()
        rule.waitForIdle()
        assertEquals(listOf("cancel 44"), b.calls)
    }

    @Test fun cancellingARunningTaskWarnsTheAgentStopsAtOnce() {
        show(backend(detail(task(44, status = "running"))), 44)
        rule.onNodeWithText("Cancelar tarea").performClick()
        rule.onNodeWithText("El agente se detendrá de inmediato.").assertIsDisplayed()
    }

    @Test fun theBarOffersOnlyWhatTheTaskAllows() {
        show(backend(detail(task(44, status = "done"))), 44)
        rule.onNodeWithText("Cancelar tarea").assertDoesNotExist()
        rule.onNodeWithText("Reasignar").assertDoesNotExist()
        rule.onNodeWithText("Seguir").assertIsDisplayed()
    }

    @Test fun reassignListsTheAgentsThePcOffersAndKeepsTheReasoningUnderMoreOptions() {
        val b = backend(detail(task(44, status = "queued", agent = "claude")))
        b.agentList = Result.success(listOf(AgentChoice("claude", "Claude", "Sonnet 5.5"), AgentChoice("codex", "Codex", "Codex Pro · gpt-5")))
        show(b, 44)
        rule.onNodeWithText("Reasignar").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Reasignar a otra cuenta o agente").assertIsDisplayed()
        for (t in listOf("Automático", "Claude · Sonnet 5.5", "Codex · Codex Pro · gpt-5", "Actual", "Más opciones")) rule.onAllNodesWithText(t).onLast().assertIsDisplayed()
        // «Razonamiento» is also a row of the details behind the sheet
        rule.onAllNodesWithText("Razonamiento").onLast().assertIsDisplayed()
        rule.onNodeWithText("Codex · Codex Pro · gpt-5").performClick()
        rule.onNodeWithText("alto").performClick()
        rule.onAllNodesWithText("Reasignar").onLast().performClick()
        rule.waitForIdle()
        assertEquals(listOf("reassign 44 codex high"), b.calls)
    }

    @Test fun followUpTakesTheTextAndSendsIt() {
        val b = backend(detail(task(44, status = "queued")))
        show(b, 44)
        rule.onNodeWithText("Seguir").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Seguir con una instrucción").assertIsDisplayed()
        rule.onNodeWithText("Enviar").assertIsNotEnabled()
        rule.onNodeWithContentDescription("Añade lo que falta…").performTextInput("Y revisa el pie")
        rule.onNodeWithText("Enviar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("followup 44 Y revisa el pie"), b.calls)
    }

    // What the screen keeps, in the «⋯» menu

    @Test fun theHistoryTheSubtasksAndTheDependenciesAreInTheMenu() {
        val d = detail(
            task(7, status = "queued"), events = listOf(TaskEvent("orbe", "task.created", "Creada por Orbe", "2026-11-11T09:00:00.000Z")),
            dependencies = listOf(TaskLink(3, "Compilar", "running")), children = listOf(TaskLink(8, "Revisar", "queued")),
        )
        var opened = 0L
        show(backend(d), 7, onOpen = { opened = it })
        menu()
        for (t in listOf("Historial", "Subtareas", "Depende de")) rule.onAllNodesWithText(t).onLast().assertIsDisplayed()
        rule.onNodeWithText("Historial").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Creada por Orbe").assertIsDisplayed()
        rule.onNodeWithText("Historial (1)").assertIsDisplayed()
    }

    @Test fun dependenciesOpenTheirTask() {
        var opened = 0L
        val d = detail(task(7, status = "queued"), dependencies = listOf(TaskLink(3, "Compilar", "running")))
        show(backend(d), 7, onOpen = { opened = it })
        menu()
        rule.onAllNodesWithText("Depende de").onLast().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("#3 Compilar · En curso").performClick()
        assertEquals(3L, opened)
    }

    @Test fun subtasksOpenTheirTask() {
        var opened = 0L
        val d = detail(task(7, status = "queued"), children = listOf(TaskLink(8, "Revisar", "queued")))
        show(backend(d), 7, onOpen = { opened = it })
        menu()
        rule.onNodeWithText("Subtareas").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("#8 Revisar · En cola").performClick()
        assertEquals(8L, opened)
    }

    @Test fun reviewingTheTaskAsksFirstThenRequestsItOnThePc() {
        val b = backend(detail(task(9, status = "done")))
        show(b, 9)
        menu()
        rule.onNodeWithText("Revisar tarea").performClick()
        rule.onNodeWithText("¿Pedir la revisión cruzada?").assertIsDisplayed()
        assertEquals(emptyList<String>(), b.calls)
        rule.onNodeWithText("Pedir revisión").performClick()
        rule.waitForIdle()
        assertEquals(listOf("review 9"), b.calls)
    }

    @Test fun theMenuButtonIsAlwaysThereAndAnEmptyHistorySaysSo() {
        show(backend(detail(task(7, status = "queued"))), 7)
        menu()
        rule.onNodeWithText("Subtareas").assertDoesNotExist()
        rule.onNodeWithText("Historial").performClick()
        rule.waitForIdle()
        rule.onNodeWithText(TaskTexts.HISTORY_EMPTY).assertIsDisplayed()
    }

    @Test fun anUnreadableTaskOffersToTryAgain() {
        show(FakeTasksBackend(), 3)
        rule.onNodeWithText("Reintentar").assertIsDisplayed()
    }

}

package dev.orb.app.ui.chats

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import dev.orb.app.ui.tasks.TaskAction
import dev.orb.app.data.ONLINE
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.offline.CONNECTED_SHOWN_MS
import dev.orb.app.ui.offline.LocalOffline
import dev.orb.app.ui.offline.OfflineInfo
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class OrbeChatScreenTest {
    @get:Rule val rule = createComposeRule()

    private val thread = listOf(
        raw(1, "usuario", "El carrito no guarda los productos cuando recargo."),
        raw(2, "orb", "Solo vive en **memoria** y se pierde al recargar."),
    )

    private val retries = ArrayList<Unit>()
    private var clockMs = 1_000_000L

    private val openedTasks = ArrayList<Long>()
    private val openedChanges = ArrayList<Long>()

    private fun screen(b: FakeOrbeChatBackend, theme: OrbPaletteChoice = OrbPaletteChoice.Grafito, withOffline: Boolean = false, mentions: MentionSource? = null): OrbeChatViewModel {
        val vm = OrbeChatViewModel(b, 7, dispatcher = Dispatchers.Unconfined)
        val info = if (withOffline) OfflineInfo(b.connectionState, MutableStateFlow(null), { retries += Unit }, { clockMs }) else null
        rule.setContent {
            OrbTheme(theme, dark = false) { CompositionLocalProvider(LocalOffline provides info) { OrbeChatScreen(vm, onBack = {}, liveRefreshMs = 0, onOpenTask = { openedTasks += it }, onOpenChanges = { openedChanges += it }, mentions = mentions) } }
        }
        rule.waitForIdle()
        return vm
    }

    @Test fun paintsTheThreadAndTheHeader() {
        screen(FakeOrbeChatBackend(thread))
        rule.onNodeWithText("Carrito que no guarda").assertIsDisplayed()
        rule.onNodeWithText("tienda-online · al día").assertIsDisplayed()
        rule.onNodeWithText("El carrito no guarda los productos cuando recargo.").assertIsDisplayed()
        rule.onNodeWithText("Escribe a Orbe…").assertIsDisplayed()
        rule.onNodeWithText("Orbe").assertIsDisplayed()
    }

    @Test fun theHeaderSaysWhatOrbeIsDoingNow() {
        val b = FakeOrbeChatBackend(thread)
        screen(b)
        b.events.tryEmit(stateEvent(7, busy = true))
        rule.waitForIdle()
        rule.onNodeWithText("tienda-online · Orbe trabajando").assertIsDisplayed()
        b.events.tryEmit(stateEvent(7, busy = false, answer = raw(5, "orb", "Listo.")))
        rule.waitForIdle()
        rule.onNodeWithText("tienda-online · al día").assertIsDisplayed()
    }

    @Test fun aMessageTheCacheHoldsHasTwoTicksAndSaysItIsSaved() {
        screen(FakeOrbeChatBackend(thread))
        rule.onAllNodesWithContentDescription("Guardado en el PC", substring = true).assertCountEquals(1)
    }

    @Test fun showsThinkingThenTheLiveTextThenTheFinalLine() {
        val b = FakeOrbeChatBackend(thread)
        screen(b)
        b.events.tryEmit(stateEvent(7, busy = true, partial = ""))
        rule.waitForIdle()
        rule.onNodeWithText("Pensando…").assertIsDisplayed()
        b.events.tryEmit(stateEvent(7, busy = true, partial = "Voy a revisar el almacén"))
        rule.waitForIdle()
        rule.onNodeWithText("Voy a revisar el almacén").assertIsDisplayed()
        // The caret says the text is arriving: no «Escribiendo…» and no counter of seconds.
        assertEquals(0, rule.onAllNodesWithText("Escribiendo…").fetchSemanticsNodes().size)
        b.events.tryEmit(stateEvent(7, busy = false, answer = raw(5, "orb", "Listo, ya guarda.")))
        rule.waitForIdle()
        rule.onNodeWithText("Listo, ya guarda.").assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText("Pensando…").fetchSemanticsNodes().size)
    }

    @Test fun aToolStepReplacesThinkingAndTheQueueIsCounted() {
        val b = FakeOrbeChatBackend(thread)
        screen(b)
        b.events.tryEmit(stateEvent(7, busy = true, tools = """[{"name":"Read","target":"src/push.ts"}]""", queued = 1))
        rule.waitForIdle()
        rule.onNodeWithText("Leyendo src/push.ts").assertIsDisplayed()
        rule.onNodeWithText("1 en cola").assertIsDisplayed()
    }

    @Test fun tappingAnOptionAnswersAtOnceAndNamesWhoAsks() {
        val b = FakeOrbeChatBackend(thread + raw(3, "orb", "¿Dónde guardo el carrito?", questionMeta()))
        screen(b)
        rule.onNodeWithText("Orbe pregunta").performScrollTo().assertIsDisplayed()
        // The mockup draws no help sentence and no buttons on the card: the chips are the answer.
        assertEquals(0, rule.onAllNodesWithText("Responder").fetchSemanticsNodes().size)
        assertEquals(0, rule.onAllNodesWithText("Saltar").fetchSemanticsNodes().size)
        rule.onNodeWithText("IndexedDB").performScrollTo().performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("answer 3 IndexedDB - false"))
        // The card closes into the answer.
        rule.onNodeWithText("Respondida: IndexedDB").assertIsDisplayed()
    }

    @Test fun anOwnAnswerIsWrittenInTheBoxAndGoesAsTheAnswer() {
        val b = FakeOrbeChatBackend(thread + raw(3, "orb", "¿Dónde guardo el carrito?", questionMeta()))
        screen(b)
        rule.onNodeWithText("Otra respuesta…").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Respondiendo a Orbe").assertIsDisplayed()
        rule.onNode(hasSetTextAction()).performTextInput("En SQLite")
        rule.onNodeWithContentDescription("Enviar mensaje").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("answer 3  En SQLite false"))
        assertTrue(b.calls.toString(), b.calls.none { it.startsWith("send ") })
    }

    @Test fun cancellingTheAnswerGivesTheBoxBackToOrdinaryMessages() {
        val b = FakeOrbeChatBackend(thread + raw(3, "orb", "¿Dónde guardo el carrito?", questionMeta()))
        screen(b)
        rule.onNodeWithText("Otra respuesta…").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Cancelar").performClick()
        rule.waitForIdle()
        assertEquals(0, rule.onAllNodesWithText("Respondiendo a Orbe").fetchSemanticsNodes().size)
        rule.onNode(hasSetTextAction()).performTextInput("Otra cosa")
        rule.onNodeWithContentDescription("Enviar mensaje").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("send Otra cosa"))
    }

    @Test fun aQuestionThatTakesSeveralIsAnsweredFromTheBoxWithTheChipsPicked() {
        val b = FakeOrbeChatBackend(thread + raw(3, "orb", "¿Dónde guardo el carrito?", questionMeta(multi = true)))
        screen(b)
        rule.onNodeWithText("IndexedDB").performScrollTo().performClick()
        rule.onNodeWithText("localStorage").performClick()
        rule.waitForIdle()
        // Nothing left yet; the box sends the picked options even with no text.
        assertTrue(b.calls.none { it.startsWith("answer") })
        rule.onNodeWithContentDescription("Enviar mensaje").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("answer 3 IndexedDB|localStorage - false"))
    }

    @Test fun skippingAQuestionLivesInItsMoreMenu() {
        val b = FakeOrbeChatBackend(thread + raw(3, "orb", "¿Dónde guardo el carrito?", questionMeta()))
        screen(b)
        rule.onNodeWithText("Orbe pregunta").performScrollTo()
        // The header of the question has its own «⋯»; the header of the screen has another.
        rule.onAllNodesWithContentDescription("Más opciones")[1].performClick()
        rule.onNodeWithText("Saltar esta pregunta").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("answer 3  - true"))
    }

    @Test fun reportHasAnAcceptButton() {
        val b = FakeOrbeChatBackend(thread + raw(8, "orb", "Informe listo", """{"kind":"report","tasks":[42],"accepted":false}"""))
        screen(b)
        rule.onNodeWithText("Aceptar informe").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.contains("accept 8"))
        rule.onNodeWithText("Aceptado · tareas #42").assertIsDisplayed()
    }

    @Test fun sendBecomesStopWhileTheTurnRuns() {
        val b = FakeOrbeChatBackend(thread)
        val vm = screen(b)
        // Idle with nothing typed: there is no stop, and the arrow is off.
        assertEquals(0, rule.onAllNodesWithContentDescription("Parar").fetchSemanticsNodes().size)
        rule.onNodeWithContentDescription("Enviar mensaje").assertIsNotEnabled()
        b.events.tryEmit(stateEvent(7, busy = true))
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Parar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.contains("stop"))
        // Typing turns it back into Enviar, which queues the message behind the turn.
        rule.onNode(hasSetTextAction()).performTextInput("Otra cosa")
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Enviar mensaje").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.contains("send Otra cosa"))
        rule.onNodeWithText("Otra cosa").assertIsDisplayed()
        assertTrue(vm.state.value.items.last() is ChatItem.Waiting)
    }

    @Test fun theBoxShowsPermissionsTheBrainAndAMicrophoneThatIsOff() {
        val b = FakeOrbeChatBackend(thread)
        b.brainOnPc = BrainInfo("Claude Code", "Opus", "high")
        screen(b)
        // The label of the box says the current mode; the selector itself is under the header only where an OK is asked.
        assertEquals(0, rule.onAllNodesWithText("Preguntar").fetchSemanticsNodes().size)
        rule.onNodeWithContentDescription("Permisos de las tareas: Preguntar").assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText("Preguntar: te pido el OK antes de cada cambio.").fetchSemanticsNodes().size)
        rule.onNodeWithContentDescription("Agente de este chat: Opus · alto").assertIsDisplayed()
        rule.onNodeWithContentDescription("Este móvil no tiene dictado por voz").assertIsNotEnabled()
        assertTrue(b.brainReads > 0)
    }

    @Test fun theModeSelectorAppearsUnderTheHeaderWhereAnOkIsAsked() {
        val b = FakeOrbeChatBackend(thread + attention)
        b.taskDetail = waiting42
        screen(b)
        rule.onNodeWithText("Preguntar: te pido el OK antes de cada cambio.").assertIsDisplayed()
        rule.onNodeWithText("Auto").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("mode auto"))
    }

    @Test fun theMenuHoldsTheModeWhenNothingAsksForAnOk() {
        val b = FakeOrbeChatBackend(thread)
        screen(b)
        rule.onNodeWithContentDescription("Más opciones").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Preguntar: te pido el OK antes de cada cambio.").assertIsDisplayed()
        rule.onNodeWithText("Auto").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("mode auto"))
    }

    @Test fun withoutWhatThePcSaysTheBrainIsNotInvented() {
        screen(FakeOrbeChatBackend(thread))
        rule.onNodeWithContentDescription("Agente de este chat: El del PC").assertIsDisplayed()
    }

    @Test fun offlineSaysSoAndStillAcceptsText() {
        val b = FakeOrbeChatBackend(thread)
        screen(b)
        b.goOffline()
        rule.waitForIdle()
        rule.onNodeWithText("Sin conexión con tu PC. Reintentando…").assertIsDisplayed()
        rule.onNodeWithText("Reconectando…").assertIsDisplayed()
        rule.onNode(hasSetTextAction()).performTextInput("Hazlo")
        rule.onNodeWithContentDescription("Enviar mensaje").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Se enviará al volver").assertIsDisplayed()
    }

    @Test fun theBandCountsDownAndRetriesAtOnce() {
        val b = FakeOrbeChatBackend(thread)
        screen(b, withOffline = true)
        b.connectionState.value = ConnectionState.Offline(nextRetryAt = clockMs + 6_000, lastSeen = null)
        rule.waitForIdle()
        rule.onNodeWithText("Sin conexión con tu PC. Reintento\u00A0en\u00A06\u00A0s.").assertIsDisplayed()
        rule.onNodeWithText("Reintentar").performClick()
        assertEquals(1, retries.size)
    }

    @Test fun whenTheLinkReturnsItSaysConnectedForAMomentAndGoes() {
        val b = FakeOrbeChatBackend(thread)
        screen(b, withOffline = true)
        b.goOffline()
        rule.waitForIdle()
        b.connectionState.value = ONLINE
        rule.waitForIdle()
        rule.onNodeWithText("Conectado").assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText("Sin conexión con tu PC. Reintentando…").fetchSemanticsNodes().size)
        rule.mainClock.advanceTimeBy(CONNECTED_SHOWN_MS + 600)
        rule.waitForIdle()
        assertEquals(0, rule.onAllNodesWithText("Conectado").fetchSemanticsNodes().size)
    }

    @Test fun aPcThatNeedsUpdatingDoesNotPromiseTheSend() {
        val b = FakeOrbeChatBackend(thread)
        screen(b)
        b.connectionState.value = ConnectionState.UpdatePc
        rule.waitForIdle()
        rule.onNode(hasSetTextAction()).performTextInput("Hazlo")
        rule.onNodeWithContentDescription("Enviar mensaje").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("No saldrá hasta actualizar Orb en el PC").assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText("Se enviará al volver").fetchSemanticsNodes().size)
        rule.onNodeWithText("Actualiza Orb en tu PC. Lo que escribas se queda en este móvil hasta entonces.").assertIsDisplayed()
    }

    @Test fun theRunningTaskHasALiveCard() {
        val b = FakeOrbeChatBackend(thread + raw(3, "system", "Tarea #42 creada", """{"task":42}"""))
        b.liveOnPc = listOf(LiveTask(42, "Registro de notificaciones", "codex", "Leyendo src/push.ts", null, false))
        screen(b)
        rule.onNodeWithText("#42 Registro de notificaciones", substring = true).assertIsDisplayed()
        rule.onNodeWithText("En curso").assertIsDisplayed()
        rule.onNodeWithText("Codex · Leyendo src/push.ts", substring = true).assertIsDisplayed()
    }

    @Test fun aTaskThatIsNotRunningHasNoLiveCard() {
        val b = FakeOrbeChatBackend(thread + raw(3, "system", "Tarea #42 creada", """{"task":42}"""))
        screen(b)
        assertEquals(0, rule.onAllNodesWithText("En curso").fetchSemanticsNodes().size)
    }

    private val attention = raw(4, "system", "⚠️ La tarea #42 espera tu OK", """{"kind":"attention","task":42}""")
    private val waiting42 get() = TaskDetail(
        42, "Borrar build/ y reinstalar", "awaiting_approval", "codex", "C:/app-movil", listOf("destructive"), "h1", model = "gpt", folderNow = "C:/app-movil", folderMoved = false,
        actions = setOf(TaskAction.Approve), description = "Borra la carpeta build/ y vuelve a instalar las dependencias.",
    )

    @Test fun theWaitingCardIsCompactAndItsButtonNeverApproves() {
        val b = FakeOrbeChatBackend(thread + attention)
        b.taskDetail = waiting42
        screen(b)
        rule.onNodeWithText("#42 Borrar build/ y reinstalar").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("Codex · app-movil · elimina datos").assertIsDisplayed()
        rule.onNodeWithText("Espera tu OK").assertIsDisplayed()
        // What the OK covers is read whole in the task's own screen, not on the card.
        assertEquals(0, rule.onAllNodesWithText("Borra la carpeta build/ y vuelve a instalar las dependencias.").fetchSemanticsNodes().size)
        assertEquals(0, rule.onAllNodesWithText("Pide tu OK porque: elimina datos").fetchSemanticsNodes().size)
        assertEquals(0, rule.onAllNodesWithText("Aprobar").fetchSemanticsNodes().size)
        rule.onNodeWithText("Ver y aprobar").performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals(listOf(42L), openedTasks)
        assertTrue(b.calls.toString(), b.calls.none { it.startsWith("task ") })
    }

    @Test fun aCardWithoutAFingerprintOnlyOpensTheTask() {
        val b = FakeOrbeChatBackend(thread + attention)
        b.taskDetail = waiting42.copy(hash = null)
        screen(b)
        rule.onNodeWithText("Ver y aprobar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.none { it.startsWith("task ") })
        assertEquals(listOf(42L), openedTasks)
    }

    @Test fun rejectingAsksFirst() {
        val b = FakeOrbeChatBackend(thread + attention)
        b.taskDetail = waiting42
        screen(b)
        rule.onNodeWithText("Rechazar").performClick()
        rule.onNodeWithText("¿Rechazar la tarea #42?").assertIsDisplayed()
        rule.onNodeWithText("«Borrar build/ y reinstalar». Rechazarla cancela la tarea.").assertIsDisplayed()
        assertTrue(b.calls.none { it.startsWith("task ") })
        rule.onNodeWithText("Rechazar y cancelar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.contains("task 42 false h1"))
    }

    @Test fun underAutoAWaitingTaskIsCalledDelicate() {
        val b = FakeOrbeChatBackend(thread + attention)
        b.modeOnPc = "auto"
        b.taskDetail = waiting42
        screen(b)
        rule.onNodeWithText("Delicado: pide tu OK").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("Auto: Orb aprueba lo normal y te pregunta lo delicado.").assertIsDisplayed()
    }

    @Test fun aTaskAutoLetThroughSaysSoOnlyWhenThePcRecordsIt() {
        val running = raw(4, "system", "Tarea #44 creada", """{"kind":"attention","task":44}""")
        val b = FakeOrbeChatBackend(thread + running)
        b.modeOnPc = "auto"
        b.taskDetail = TaskDetail(44, "Instalar dependencias", "running", "codex", "C:/app-movil", emptyList(), "h9", autonomy = "auto", approvalRequired = false)
        screen(b)
        rule.onNodeWithText("Aprobada sola por Auto: es lo normal").assertIsDisplayed()
    }

    @Test fun aTaskMadeUnderAskNeverClaimsToHaveBeenLetThroughByAuto() {
        val running = raw(4, "system", "Tarea #44 creada", """{"kind":"attention","task":44}""")
        val b = FakeOrbeChatBackend(thread + running)
        b.modeOnPc = "auto"
        b.taskDetail = TaskDetail(44, "Instalar dependencias", "running", "codex", "C:/app-movil", emptyList(), "h9", autonomy = "preguntar", approvalRequired = false)
        screen(b)
        assertEquals(0, rule.onAllNodesWithText("Aprobada sola por Auto: es lo normal").fetchSemanticsNodes().size)
    }

    private val doneTask get() = TaskDetail(
        42, "Registro de notificaciones", "done", "codex", "C:/app-movil", emptyList(), null, reviewAgent = "claude",
        actions = setOf(TaskAction.SeeChanges, TaskAction.UndoHeld, TaskAction.AcceptHeld),
    )
    private val ended = raw(4, "system", "La tarea #42 terminó", """{"kind":"task-end","task":42,"status":"done","result":"Listo"}""")

    @Test fun aFinishedTaskCountsItsChangesAndOffersChangesUndoAccept() {
        val b = FakeOrbeChatBackend(thread + ended)
        b.taskDetail = doneTask
        b.statOnPc = TaskStat(3, 42, 7)
        screen(b)
        rule.onNodeWithText("#42 Registro de notificaciones").assertIsDisplayed()
        rule.onNodeWithText("Hecha").assertIsDisplayed()
        rule.onNodeWithText("3 archivos · +42 −7 · revisada por Claude").assertIsDisplayed()
        rule.onNodeWithText("Cambios").performClick()
        assertEquals(listOf(42L), openedChanges)
        rule.onNodeWithText("Aceptar cambios").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.contains("taskaccept 42"))
    }

    @Test fun undoAsksBeforeTouchingTheFilesAndThenOffersToSeeTheTask() {
        val b = FakeOrbeChatBackend(thread + ended)
        b.taskDetail = doneTask
        b.statOnPc = TaskStat(3, 42, 7)
        screen(b)
        rule.onNodeWithText("Deshacer").performClick()
        rule.onNodeWithText("¿Deshacer la tarea #42?").assertIsDisplayed()
        rule.onNodeWithText("Se revierten los 3 archivos que cambió. Los cambios posteriores se conservan.").assertIsDisplayed()
        assertTrue(b.calls.none { it == "undo 42" })
        rule.onNodeWithText("Cancelar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.none { it == "undo 42" })
        rule.onNodeWithText("Deshacer").performClick()
        rule.onNodeWithText("Deshacer esta tarea").performClick()
        rule.waitForIdle()
        assertEquals(1, b.calls.count { it == "undo 42" })
        rule.onNodeWithText("Deshecho").assertIsDisplayed()
        rule.onNodeWithText("Ver").performClick()
        assertEquals(listOf(42L), openedTasks)
    }

    @Test fun aFinishedTaskFromAnOldPcShowsNoNumbers() {
        val b = FakeOrbeChatBackend(thread + ended)
        b.taskDetail = doneTask.copy(reviewAgent = null)
        b.statOnPc = null
        screen(b)
        assertEquals(0, rule.onAllNodesWithText("archivos", substring = true).fetchSemanticsNodes().size)
        rule.onNodeWithText("Cambios").assertIsDisplayed()
    }

    @Test fun anAcceptedTaskFoldsToOneLine() {
        val b = FakeOrbeChatBackend(thread + ended)
        b.taskDetail = doneTask.copy(accepted = true, actions = setOf(TaskAction.SeeChanges, TaskAction.UndoHeld))
        screen(b)
        rule.onNodeWithText("#42 Aceptada").assertIsDisplayed()
        rule.onNodeWithText("Completada").assertIsDisplayed()
    }

    @Test fun anUndoneTaskSaysSoAndOffersNothing() {
        val b = FakeOrbeChatBackend(thread + ended)
        b.taskDetail = doneTask.copy(undone = true, actions = emptySet())
        screen(b)
        rule.onNodeWithText("Deshecha").assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText("Aceptar cambios").fetchSemanticsNodes().size)
    }


    @Test fun theLabelOfTheBoxOnlyShowsTheMode() {
        val b = FakeOrbeChatBackend(thread)
        screen(b)
        rule.onNodeWithContentDescription("Permisos de las tareas: Preguntar").assertIsDisplayed()
        rule.onNodeWithContentDescription("Permisos de las tareas: Preguntar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.none { it.startsWith("mode") })
    }

    // ---------- The PC's queue ----------

    private val queued1 = OrbeQueued("q1", "y luego súbelo a la rama dev", 1_000L)

    @Test fun theQueueBarQuotesTheFirstMessageAndEditsIt() {
        val b = FakeOrbeChatBackend(thread)
        b.queueOnPc = listOf(queued1)
        screen(b)
        b.events.tryEmit(stateEvent(7, busy = true, queued = 1))
        rule.waitForIdle()
        rule.onNodeWithText("1 en cola: «y luego súbelo a la rama dev»").assertIsDisplayed()
        rule.onNodeWithText("Editar").performClick()
        rule.onNodeWithText("Editar mensaje en cola").assertIsDisplayed()
        rule.onNodeWithContentDescription("Editar mensaje en cola").performTextReplacement("y luego súbelo a main")
        rule.onNodeWithText("Guardar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.contains("queue-edit q1 y luego súbelo a main"))
        rule.onNodeWithText("1 en cola: «y luego súbelo a main»").assertIsDisplayed()
    }

    @Test fun removingFromTheEditorLeavesTheBarEmpty() {
        val b = FakeOrbeChatBackend(thread)
        b.queueOnPc = listOf(queued1)
        screen(b)
        b.events.tryEmit(stateEvent(7, busy = true, queued = 1))
        rule.waitForIdle()
        rule.onNodeWithText("Editar").performClick()
        rule.onNodeWithText("Quitar").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.contains("queue-remove q1"))
        assertEquals(0, rule.onAllNodesWithText("Editar").fetchSemanticsNodes().size)
    }

    @Test fun severalQueuedMessagesAreListedEachWithItsOwnEditAndRemove() {
        val b = FakeOrbeChatBackend(thread)
        b.queueOnPc = listOf(queued1, OrbeQueued("q2", "avísame cuando acabe", 2_000L))
        screen(b)
        b.events.tryEmit(stateEvent(7, busy = true, queued = 2))
        rule.waitForIdle()
        rule.onNodeWithText("Editar").performClick()
        rule.onNodeWithText("Mensajes en cola").assertIsDisplayed()
        rule.onNodeWithText("avísame cuando acabe").assertIsDisplayed()
        rule.onAllNodesWithContentDescription("Quitar")[1].performClick()
        rule.waitForIdle()
        assertTrue(b.calls.contains("queue-remove q2"))
    }

    @Test fun thePcsRefusalAppearsInTheEditorWordForWord() {
        val b = FakeOrbeChatBackend(thread)
        b.queueOnPc = listOf(queued1)
        val text = "Un mensaje en cola no puede ser un comando (/clear, /compact): quítalo y envía el comando."
        b.editResult = Result.failure(dev.orb.app.link.net.LinkException(dev.orb.app.link.net.LinkError.Refused(400, text)))
        screen(b)
        b.events.tryEmit(stateEvent(7, busy = true, queued = 1))
        rule.waitForIdle()
        rule.onNodeWithText("Editar").performClick()
        rule.onNodeWithContentDescription("Editar mensaje en cola").performTextReplacement("/clear")
        rule.onNodeWithText("Guardar").performClick()
        rule.waitForIdle()
        rule.onNodeWithText(text).assertIsDisplayed()
        rule.onNodeWithText("Editar mensaje en cola").assertIsDisplayed()
    }

    @Test fun anOldPcOnlyCountsTheQueue() {
        val b = FakeOrbeChatBackend(thread)
        b.queueAvailable = false
        screen(b)
        b.events.tryEmit(stateEvent(7, busy = true, queued = 2))
        rule.waitForIdle()
        rule.onNodeWithText("2 en cola").assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText("Editar").fetchSemanticsNodes().size)
    }

    @Test fun theMoreSheetOffersToCompactAndAsksThePc() {
        val b = FakeOrbeChatBackend(thread)
        screen(b)
        rule.onNodeWithContentDescription("Más opciones").performClick()
        rule.onNodeWithText("Compactar la conversación").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.contains("compact"))
    }

    @Test fun deletedChatShowsA28() {
        val b = FakeOrbeChatBackend(thread)
        b.loadResult = refused("Esa conversación ya no existe.").map { 0 }
        screen(b)
        rule.onNodeWithText("Este chat ya no existe").assertIsDisplayed()
        rule.onNodeWithText("Ir a Chats").assertIsDisplayed()
    }

    @Test fun a28OffersToAskThePcToRestoreAndCallsIt() {
        val b = FakeOrbeChatBackend(thread)
        b.loadResult = refused("Ese chat está en la papelera. Restáuralo para seguir.").map { 0 }
        screen(b)
        rule.onNodeWithText("Pedir al PC que lo restaure").assertIsDisplayed()
        b.loadResult = Result.success(0)
        rule.onNodeWithText("Pedir al PC que lo restaure").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.contains("restore"))
    }

    @Test fun a28HidesTheRestoreButtonWhenThePcCannot() {
        val b = FakeOrbeChatBackend(thread).apply { restoreAvailable = false }
        b.loadResult = refused("Esa conversación ya no existe.").map { 0 }
        screen(b)
        assertEquals(0, rule.onAllNodesWithText("Pedir al PC que lo restaure").fetchSemanticsNodes().size)
    }

    @Test fun anotherPalettePaintsTheSameChat() {
        screen(FakeOrbeChatBackend(thread), OrbPaletteChoice.Oceano)
        rule.onNodeWithText("Escribe a Orbe…").assertIsDisplayed()
    }

    @Test fun slashCompactIsListedAndAsksThePcWithoutAnExtraQuestion() {
        val b = FakeOrbeChatBackend(thread)
        screen(b)
        rule.onNodeWithContentDescription("Escribe a Orbe…").performTextInput("/")
        rule.onNodeWithText("/compact").assertIsDisplayed()
        rule.onNodeWithText("Resume la conversación para liberar contexto").assertIsDisplayed()
        rule.onNodeWithText("/compact").performClick()
        rule.waitForIdle()
        assertTrue(b.calls.toString(), b.calls.contains("compact"))
        // The command is not sent as a message and the box is empty again.
        assertTrue(b.calls.none { it.startsWith("send") })
        rule.onNodeWithText("/compact").assertDoesNotExist()
    }

    @Test fun anAtInTheBoxListsWhatThePcOffersAndInsertsTheToken() {
        val src = MentionSource { listOf(MentionOption("@tarea:43", "#43 Borrar build/", "tarea · app-movil", MentionKind.Task)) }
        screen(FakeOrbeChatBackend(thread), mentions = src)
        rule.onNodeWithContentDescription("Escribe a Orbe…").performTextInput("Revisa el @")
        rule.waitForIdle()
        rule.onNodeWithText("#43 Borrar build/").assertIsDisplayed()
        rule.onNodeWithText("#43 Borrar build/").performClick()
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Escribe a Orbe…").assertTextContains("Revisa el @tarea:43 ")
    }
}

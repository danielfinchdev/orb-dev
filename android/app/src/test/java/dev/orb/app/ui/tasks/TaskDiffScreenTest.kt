package dev.orb.app.ui.tasks

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isSelectable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.pinch
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.assertCountEquals
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
class TaskDiffScreenTest {
    @get:Rule val rule = createComposeRule()

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    private val files = listOf(
        DiffFile("M", "src/push.ts", 31, 0, false, PATCH, false),
        DiffFile("M", "src/main.ts", 9, 7, false, "@@ -4,2 +4,2 @@\n-old line\n+new line\n", false),
        DiffFile("A", "logo.png", 0, 0, true, "", false),
    )

    private fun show(b: FakeTasksBackend) {
        val vm = TaskDiffViewModel(b, 4)
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { TaskDiffScreen(vm, onBack = {}) } }
        rule.waitForIdle()
    }

    private fun backend(diff: TaskDiff, d: TaskDetail = detail(task(4, status = "done"), hasCheckpoint = true)) =
        FakeTasksBackend().also { it.details[4] = Result.success(d); it.diffs[4] = Result.success(diff) }

    private fun zoomIs(percent: Int) = SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Ampliación $percent %")

    // The diff

    @Test fun showsTheSummaryAChipPerFileWithItsPlusAndMinusAndTheLinesOfTheFirst() {
        show(backend(TaskDiff(true, files, 0)))
        rule.onNodeWithText("Cambios de la #4").assertIsDisplayed()
        rule.onNodeWithText("3 archivos · +40 −7").assertIsDisplayed()
        for (t in listOf("push.ts", "+31", "main.ts", "+9", "logo.png")) rule.onNodeWithText(t).assertIsDisplayed()
        // the removed lines of the second file, in its chip and in the total
        rule.onAllNodesWithText("−7").assertCountEquals(2)
        rule.onNodeWithText("+40").assertIsDisplayed()
        rule.onNodeWithText("export async function init() {").assertIsDisplayed()
        rule.onNodeWithText("export function init() {}").assertIsDisplayed()
        // the first chip is the chosen one
        rule.onNode(isSelectable() and hasText("push.ts")).assertExists()
    }

    @Test fun theLinesCarryTheirNumbersAndTheHeadingNamesTheFile() {
        show(backend(TaskDiff(true, files, 0)))
        rule.onNodeWithText("src/push.ts · @@ -1,3 +1,4 @@").assertIsDisplayed()
        // line 1 of both versions, then the removed line (old number 2) and the added ones (new numbers 2 and 3)
        rule.onAllNodesWithText("2").assertCountEquals(2)
        rule.onNodeWithText("3").assertIsDisplayed()
    }

    @Test fun theHintTellsToSwipeAndPinchWithSeveralFilesAndOnlyToPinchWithOne() {
        show(backend(TaskDiff(true, files, 0)))
        rule.onNodeWithText("Desliza a los lados para cambiar de archivo · pellizca para ampliar").assertIsDisplayed()
    }

    @Test fun oneFileOnlyOffersToPinch() {
        show(backend(TaskDiff(true, files.take(1), 0)))
        rule.onNodeWithText("Pellizca para ampliar").assertIsDisplayed()
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

    @Test fun filesBeyondTheListAreCountedAtTheEndOfTheLast() {
        show(backend(TaskDiff(true, listOf(DiffFile("M", "a.ts", 1, 1, false, "@@ -1 +1 @@\n-a\n+b\n", false)), 4)))
        rule.onNodeWithText("4 archivos más sin mostrar.").assertIsDisplayed()
    }

    // The zoom

    @Test fun theDiffStartsAtItsOwnSizeAndTheButtonsEnlargeAndReduceItWithinLimits() {
        show(backend(TaskDiff(true, files, 0)))
        rule.onNode(zoomIs(100)).assertExists()
        rule.onNodeWithContentDescription("Reducir el diff").assertIsNotEnabled()
        rule.onNodeWithContentDescription("Ampliar el diff").performClick()
        rule.waitForIdle()
        rule.onNode(zoomIs(150)).assertExists()
        rule.onNodeWithContentDescription("Reducir el diff").assertIsEnabled()
        repeat(8) { rule.onNodeWithContentDescription("Ampliar el diff").performClick() }
        rule.waitForIdle()
        // never beyond four times
        rule.onNode(zoomIs(400)).assertExists()
        rule.onNodeWithContentDescription("Ampliar el diff").assertIsNotEnabled()
        repeat(12) { rule.onNodeWithContentDescription("Reducir el diff").performClick() }
        rule.waitForIdle()
        rule.onNode(zoomIs(100)).assertExists()
    }

    @Test fun pinchingWithTwoFingersEnlargesTheDiff() {
        show(backend(TaskDiff(true, files, 0)))
        rule.onNode(zoomIs(100)).performTouchInput {
            pinch(
                Offset(center.x - 20f, center.y), Offset(center.x - 120f, center.y),
                Offset(center.x + 20f, center.y), Offset(center.x + 120f, center.y),
            )
        }
        rule.waitForIdle()
        rule.onNode(zoomIs(100)).assertDoesNotExist()
    }

    @Test fun theDiffOffersEnlargingToAScreenReaderToo() {
        show(backend(TaskDiff(true, files, 0)))
        val actions = rule.onNode(zoomIs(100)).fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsActions.CustomActions].map { it.label }
        assertEquals(listOf("Ampliar el diff", "Reducir el diff"), actions)
    }

    // «Aceptar» and «Deshacer»

    @Test fun acceptGoesToThePcAndOffersToGoBackAndUndoAsksFirst() {
        val b = backend(TaskDiff(true, files, 0))
        show(b)
        rule.onNodeWithText("Aceptar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("accept 4"), b.calls)
        // «Cambios aceptados · Deshacer»
        rule.onNodeWithText("Cambios aceptados").assertIsDisplayed()
        rule.onAllNodesWithText("Deshacer").assertCountEquals(2)
        rule.onAllNodesWithText("Deshacer")[1].performClick()
        rule.waitForIdle()
        rule.onNodeWithText("¿Deshacer esta tarea?").assertIsDisplayed()
        assertEquals(listOf("accept 4"), b.calls)
        rule.onAllNodesWithText("Deshacer").onLast().performClick()
        rule.waitForIdle()
        assertEquals(listOf("accept 4", "undo 4"), b.calls)
    }

    @Test fun undoFromTheBarAsksFirstAndSaysHowManyFiles() {
        val b = backend(TaskDiff(true, files, 0))
        show(b)
        rule.onNodeWithText("Deshacer").performClick()
        rule.onNodeWithText("¿Deshacer esta tarea?").assertIsDisplayed()
        rule.onNodeWithText("Se restauran los 3 archivos que cambió esta tarea. Los cambios posteriores se conservan.").assertIsDisplayed()
        assertEquals(emptyList<String>(), b.calls)
    }

    @Test fun anAcceptedTaskCanStillBeUndoneWhilePointOfReturnExists() {
        val b = backend(TaskDiff(true, files, 0), detail(task(4, status = "done"), hasCheckpoint = true, accepted = true))
        show(b)
        rule.onNodeWithText("Aceptada").assertIsDisplayed()
        rule.onNodeWithText("Aceptar").assertDoesNotExist()
        rule.onNodeWithText("Deshacer").performClick()
        rule.onAllNodesWithText("Deshacer").onLast().performClick()
        rule.waitForIdle()
        assertEquals(listOf("undo 4"), b.calls)
    }

    // The run the diff belongs to

    @Test fun aDiffOfAnotherRunShowsNeitherTheDiffNorTheButtons() {
        val b = backend(TaskDiff(true, files, 0, checkpointId = "run1", runKnown = true), detail(task(4, status = "done"), hasCheckpoint = true, checkpointId = "run2"))
        show(b)
        rule.onNodeWithText("Los cambios de la última ejecución aún no están listos").assertIsDisplayed()
        rule.onNodeWithText("Aceptar").assertDoesNotExist()
        rule.onNodeWithText("Deshacer").assertDoesNotExist()
        rule.onNodeWithText("export async function init() {").assertDoesNotExist()
    }

    @Test fun aDiffOfTheSameRunOffersThem() {
        val b = backend(TaskDiff(true, files, 0, checkpointId = "run2", runKnown = true), detail(task(4, status = "done"), hasCheckpoint = true, checkpointId = "run2"))
        show(b)
        rule.onNodeWithText("Aceptar").assertIsDisplayed()
        rule.onNodeWithText("Deshacer").assertIsDisplayed()
        rule.onNodeWithText("Aceptar").performClick()
        rule.waitForIdle()
        assertEquals(listOf<String?>("run2"), b.acceptCheckpoints)
    }

    @Test fun thePcSayingTheLastRunIsNotDoneYetOffersNoButtons() {
        show(backend(TaskDiff(false, emptyList(), 0, reason = "notdone")))
        rule.onNodeWithText("Los cambios de la última ejecución aún no están listos").assertIsDisplayed()
        rule.onNodeWithText("Aceptar").assertDoesNotExist()
        rule.onNodeWithText("Deshacer").assertDoesNotExist()
    }

    // Why there is nothing to show

    @Test fun reasonNoPhotoIsToldWithItsTrueSentence() {
        show(backend(TaskDiff(false, emptyList(), 0, reason = "nophoto")))
        rule.onNodeWithText("Esta tarea no tiene un punto de vuelta guardado o ya se deshizo, así que no hay cambios que comparar.").assertIsDisplayed()
    }

    @Test fun reasonNoGitIsToldWithItsTrueSentence() {
        show(backend(TaskDiff(false, emptyList(), 0, reason = "nogit")))
        rule.onNodeWithText("El PC no puede enseñar los cambios línea a línea de una carpeta sin git.").assertIsDisplayed()
    }

    @Test fun reasonTheRepositoryIsGoneIsToldWithItsTrueSentence() {
        show(backend(TaskDiff(false, emptyList(), 0, reason = "gone")))
        rule.onNodeWithText("El repositorio de esta tarea ya no existe en el PC, así que no hay cambios que enseñar.").assertIsDisplayed()
    }

    @Test fun aTaskJoinedByHandIsToldAndOnlyOffersAcceptWithItsOwnRun() {
        val b = backend(
            TaskDiff(false, emptyList(), 0, reason = "joinedbyhand"),
            detail(task(4, status = "done"), hasCheckpoint = true, checkpointId = "run7"),
        )
        show(b)
        rule.onNodeWithText("Los cambios de esta tarea se unieron a mano en el PC. Aquí no se pueden ver ni deshacer.").assertIsDisplayed()
        rule.onNodeWithText("Deshacer").assertDoesNotExist()
        rule.onNodeWithText("Aceptar").performClick()
        rule.waitForIdle()
        assertEquals(listOf<String?>("run7"), b.acceptCheckpoints)
    }

    @Test fun aTaskWithoutFinalPhotoIsToldAndOffersNoButtonAtAll() {
        show(backend(TaskDiff(false, emptyList(), 0, reason = "nophotoafter")))
        rule.onNodeWithText("El PC no pudo guardar el estado final de esta tarea, así que aquí no hay cambios que enseñar. Deshacerla devolvería toda su carpeta a como estaba antes, también lo que se cambió después: solo se puede hacer desde el PC.").assertIsDisplayed()
        rule.onNodeWithText("Aceptar").assertDoesNotExist()
        rule.onNodeWithText("Deshacer").assertDoesNotExist()
    }

    @Test fun anUnfinishedMergeIsToldAndOffersNoButtonAtAll() {
        show(backend(TaskDiff(false, emptyList(), 0, reason = "resolveonpc")))
        rule.onNodeWithText("La unión de los cambios de esta tarea quedó sin terminar. Resuélvela en el PC.").assertIsDisplayed()
        rule.onNodeWithText("Aceptar").assertDoesNotExist()
        rule.onNodeWithText("Deshacer").assertDoesNotExist()
    }

    @Test fun anOldRestorePointIsToldAndOnlyOffersAccept() {
        show(backend(TaskDiff(false, emptyList(), 0, reason = "unknownrun")))
        rule.onNodeWithText("Este punto de vuelta es anterior a la última actualización de Orb y no se puede comprobar a qué ejecución pertenece. Para deshacerla, hazlo desde el PC.").assertIsDisplayed()
        rule.onNodeWithText("Aceptar").assertIsDisplayed()
        rule.onNodeWithText("Deshacer").assertDoesNotExist()
    }

    @Test fun aGoneRepositoryOffersAcceptButNoUndo() {
        show(backend(TaskDiff(false, emptyList(), 0, reason = "gone")))
        rule.onNodeWithText("El repositorio de esta tarea ya no existe en el PC, así que no hay cambios que enseñar.").assertIsDisplayed()
        rule.onNodeWithText("Aceptar").assertIsDisplayed()
        rule.onNodeWithText("Deshacer").assertDoesNotExist()
    }

    @Test fun noPhotoOffersAcceptButNoUndo() {
        show(backend(TaskDiff(false, emptyList(), 0, reason = "nophoto")))
        rule.onNodeWithText("Aceptar").assertIsDisplayed()
        rule.onNodeWithText("Deshacer").assertDoesNotExist()
    }

    @Test fun noPhotoOfATaskAlreadyUndoneOffersNothing() {
        show(backend(TaskDiff(false, emptyList(), 0, reason = "nophoto"), detail(task(4, status = "done", undone = true), hasCheckpoint = true)))
        rule.onNodeWithText("Aceptar").assertDoesNotExist()
        rule.onNodeWithText("Deshacer").assertDoesNotExist()
    }

    @Test fun aFolderWithoutGitOffersBothAndKeepsItsConfirmation() {
        val b = backend(TaskDiff(false, emptyList(), 0, reason = "nogit"))
        show(b)
        rule.onNodeWithText("Aceptar").assertIsDisplayed()
        rule.onNodeWithText("Deshacer").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("¿Deshacer esta tarea?").assertIsDisplayed()
        assertEquals(emptyList<String>(), b.calls)
    }

    private fun refusalIsShownAsItIs(words: String) {
        val b = backend(TaskDiff(true, files, 0))
        show(b)
        b.actionResult = Result.failure(dev.orb.app.link.net.LinkException(dev.orb.app.link.net.LinkError.Refused(409, words)))
        rule.onNodeWithText("Aceptar").performClick()
        rule.waitForIdle()
        rule.onNodeWithText(words).assertIsDisplayed()
    }

    @Test fun thePcsRefusalForNoFinalPhotoIsShownAsItIs() =
        refusalIsShownAsItIs("el PC no guardó el estado final de esta tarea; deshacerla devolvería toda su carpeta a como estaba antes, también lo que se cambió después. Hazlo desde el PC si de verdad quieres eso")

    @Test fun thePcsRefusalForAnUnfinishedMergeIsShownAsItIs() =
        refusalIsShownAsItIs("la unión de esta tarea quedó sin terminar; resuélvela en el PC")

    @Test fun aReasonThisAppDoesNotKnowKeepsTheGenericSentenceAndNoButtons() {
        show(backend(TaskDiff(false, emptyList(), 0, reason = "somethingnew")))
        rule.onNodeWithText("No hay cambios que mostrar").assertIsDisplayed()
        rule.onNodeWithText("Aceptar").assertDoesNotExist()
        rule.onNodeWithText("Deshacer").assertDoesNotExist()
    }

    @Test fun thePcsRefusalToUndoWorkJoinedByHandIsShownAsItIs() {
        val b = backend(TaskDiff(true, files, 0))
        show(b)
        val words = "esta tarea se unió a mano en el PC; deshazla desde el PC"
        b.actionResult = Result.failure(dev.orb.app.link.net.LinkException(dev.orb.app.link.net.LinkError.Refused(409, words)))
        rule.onNodeWithText("Deshacer").performClick()
        rule.waitForIdle()
        rule.onAllNodesWithText("Deshacer").onLast().performClick()
        rule.waitForIdle()
        rule.onNodeWithText(words).assertIsDisplayed()
    }

    @Test fun aPcThatGivesNoReasonKeepsTheGenericSentence() {
        show(backend(TaskDiff(false, emptyList(), 0)))
        rule.onNodeWithText("No hay cambios que mostrar").assertIsDisplayed()
        rule.onNodeWithText("La tarea no cambió archivos, sigue en marcha, se deshizo o el proyecto no usa git.").assertIsDisplayed()
        rule.onNodeWithText("Aceptar").assertDoesNotExist()
        rule.onNodeWithText("Deshacer").assertDoesNotExist()
    }

    @Test fun anUnavailableDiffWithoutReasonOffersNoButtonAndKeepsTheGenericSentence() {
        show(backend(TaskDiff(available = false, files = emptyList(), more = 0, reason = null)))
        rule.onNodeWithText("No hay cambios que mostrar").assertIsDisplayed()
        rule.onNodeWithText("Aceptar").assertDoesNotExist()
        rule.onNodeWithText("Deshacer").assertDoesNotExist()
    }

    @Test fun anAvailableDiffWithoutFilesSaysTheTaskChangedNone() {
        show(backend(TaskDiff(true, emptyList(), 0)))
        rule.onNodeWithText("La tarea no cambió ningún archivo.").assertIsDisplayed()
    }

    @Test fun hiddenFilesAreSaidAndNeverPromisedAsAll() {
        val b = backend(TaskDiff(true, files, 0, hidden = 2))
        show(b)
        rule.onNodeWithText("2 archivos no se enseñan porque parecen contener secretos.").assertIsDisplayed()
        // the undo dialog does not count the files: some of them are not shown
        rule.onNodeWithText("Deshacer").performClick()
        rule.onNodeWithText("Se restauran los archivos modificados por esta tarea. Los cambios posteriores se conservan.").assertIsDisplayed()
    }

    @Test fun oneHiddenFileIsSaidInTheSingular() {
        show(backend(TaskDiff(true, emptyList(), 0, hidden = 1)))
        rule.onNodeWithText("1 archivo no se enseña porque parece contener secretos.").assertIsDisplayed()
    }

    // The «⋯» menu

    private fun menu() = rule.onNodeWithContentDescription("Más opciones").performClick().also { rule.waitForIdle() }

    @Test fun theMenuOffersTheCrossReviewTheSecurityReviewAndTheBranch() {
        show(backend(TaskDiff(true, files, 0)))
        menu()
        for (t in listOf("Revisión cruzada", "Revisión de seguridad", "Ver rama")) rule.onNodeWithText(t).assertIsDisplayed()
    }

    @Test fun theCrossReviewAsksFirstThenRequestsItOnThePc() {
        val b = backend(TaskDiff(true, files, 0))
        show(b)
        menu()
        rule.onNodeWithText("Revisión cruzada").performClick()
        rule.onNodeWithText("¿Pedir la revisión cruzada?").assertIsDisplayed()
        assertEquals(emptyList<String>(), b.calls)
        rule.onNodeWithText("Pedir revisión").performClick()
        rule.waitForIdle()
        assertEquals(listOf("review 4"), b.calls)
    }

    @Test fun theSecurityReviewAsksFirstThenAsksForTheProjectOfTheTask() {
        val b = backend(TaskDiff(true, files, 0))
        show(b)
        menu()
        rule.onNodeWithText("Revisión de seguridad").performClick()
        rule.onNodeWithText("¿Pedir la revisión de seguridad?").assertIsDisplayed()
        rule.onNodeWithText("Pedir revisión").performClick()
        rule.waitForIdle()
        assertEquals(listOf("security api-pagos"), b.calls)
    }

    @Test fun theBranchIsOnlyReadAndShown() {
        val b = backend(TaskDiff(true, files, 0))
        show(b)
        menu()
        rule.onNodeWithText("Ver rama").performClick()
        rule.waitForIdle()
        assertEquals(listOf("branch api-pagos"), b.calls)
        rule.onNodeWithText("Rama del proyecto: main").assertIsDisplayed()
    }

    @Test fun whatThePcCannotDoIsNotInTheMenu() {
        val b = backend(TaskDiff(true, files, 0))
        b.unavailable = setOf(dev.orb.app.link.api.ApiMethods.PROJECTS_SECURITY_REVIEW.name, dev.orb.app.link.api.ApiMethods.PROJECTS_BRANCH.name)
        show(b)
        menu()
        rule.onNodeWithText("Revisión cruzada").assertIsDisplayed()
        rule.onNodeWithText("Revisión de seguridad").assertDoesNotExist()
        rule.onNodeWithText("Ver rama").assertDoesNotExist()
    }

    @Test fun withoutAnythingToOfferThereIsNoMenuButton() {
        val b = backend(TaskDiff(true, files, 0))
        b.unavailable = setOf(
            dev.orb.app.link.api.ApiMethods.TASKS_REVIEW.name, dev.orb.app.link.api.ApiMethods.PROJECTS_SECURITY_REVIEW.name, dev.orb.app.link.api.ApiMethods.PROJECTS_BRANCH.name,
        )
        show(b)
        rule.onNodeWithContentDescription("Más opciones").assertDoesNotExist()
    }
}

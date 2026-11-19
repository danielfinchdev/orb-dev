package dev.orb.app.ui.tasks

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.orb.app.data.json
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.ui.chats.ChatTexts
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
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

/** What the task screens must show before an OK and what they send with «Aceptar» and «Deshacer». */
object GuardsFixture {
    /** `tasks.get` of a task that waits for the OK, with every field the fingerprint covers and every new warning of the PC. */
    val FULL = """{"id":9,"title":"Publicar la web","status":"awaiting_approval","agent":"any","assigned_to":"claude","model":"opus","modelLabel":"Claude Opus",
        "reasoning":"high","fast":true,"mode":"aislada","readonly":true,"autonomy":"preguntar","project_path":"C:/orb/web","folderNow":"D:/otros/web",
        "folderMoved":true,"folderOutside":true,"descriptionCut":true,"sensitivity":["publish","financial"],"user_asked":["haz push a main"],
        "previewHash":"hh","description":"Sube la web nueva al servidor y avisa por correo.","created_by":"orbe","events":[]}"""

    fun parsed(src: String = FULL): TaskDetail = TasksParser.detail(json(src))!!
}

@OptIn(ExperimentalCoroutinesApi::class)
class TaskGuardsViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)
    @After fun tearDown() = Dispatchers.resetMain()

    private fun TestScope.vm(b: FakeTasksBackend, id: Long): TaskDetailViewModel {
        val vm = TaskDetailViewModel(b, id)
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        return vm
    }

    private fun TestScope.said(vm: TaskDetailViewModel): ArrayList<String> {
        val out = ArrayList<String>()
        backgroundScope.launch { vm.messages.collect { out += it } }
        return out
    }

    private val held = TaskHeld("ha eliminado 2714 archivos", "C:/p")
    private fun heldTask(id: Long = 5, checkpoint: String? = "cp1") =
        detail(task(id, status = "blocked", held = held), hasCheckpoint = true, checkpointId = checkpoint)

    @Test fun theDetailParsesEveryFieldTheNewPcAdds() {
        val d = GuardsFixture.parsed()
        val f = d.facts!!
        assertEquals("any", f.agent)
        assertEquals(listOf("publish", "financial"), f.reasons)
        assertEquals(listOf("haz push a main"), f.userAsked)
        assertEquals(true, f.folderMoved)
        assertTrue(f.folderOutside && f.descriptionCut && f.fast && f.readonly)
        assertEquals("hh", f.hash)
    }

    @Test fun approvingSendsTheHashOfWhatIsShown() = runTest(dispatcher) {
        val d = GuardsFixture.parsed()
        val b = FakeTasksBackend().also { it.details[9] = Result.success(d) }
        val vm = vm(b, 9)
        vm.approve(true)
        runCurrent()
        assertEquals(listOf("decide 9 true hh"), b.calls)
    }

    @Test fun aPcThatGivesNothingNewIsApprovedAsBefore() = runTest(dispatcher) {
        val d = detail(task(9, status = "awaiting_approval"), previewHash = "h1")
        assertNull(d.facts)
        val b = FakeTasksBackend().also { it.details[9] = Result.success(d) }
        val vm = vm(b, 9)
        vm.approve(true)
        runCurrent()
        assertEquals(listOf("decide 9 true h1"), b.calls)
    }

    @Test fun undoSendsThePointOfReturnTheDialogWasOpenedOn() = runTest(dispatcher) {
        val b = FakeTasksBackend().also { it.details[5] = Result.success(heldTask(5, "cp1")) }
        val vm = vm(b, 5)
        vm.askUndo()
        // The task runs again while the dialog is open.
        b.details[5] = Result.success(heldTask(5, "cp2"))
        vm.refresh()
        runCurrent()
        vm.undo()
        runCurrent()
        assertEquals(listOf<String?>("cp1"), b.undoCheckpoints)
    }

    @Test fun aPcWithoutPointOfReturnIsAskedAsBefore() = runTest(dispatcher) {
        val b = FakeTasksBackend().also { it.details[5] = Result.success(heldTask(5, null)) }
        val vm = vm(b, 5)
        vm.askUndo()
        vm.undo()
        runCurrent()
        assertEquals(listOf<String?>(null), b.undoCheckpoints)
    }

    @Test fun whenThePcRefusesTheUndoItsWordsAreShownAndTheTaskIsReadAgain() = runTest(dispatcher) {
        val b = FakeTasksBackend().also { it.details[5] = Result.success(heldTask(5, "cp1")) }
        val vm = vm(b, 5)
        val said = said(vm)
        val reason = "la tarea se ha vuelto a ejecutar desde que abriste «Deshacer»; ábrela de nuevo para revisarla"
        b.actionResult = Result.failure(LinkException(LinkError.Refused(400, reason)))
        vm.askUndo()
        b.details[5] = Result.success(heldTask(5, "cp2"))
        vm.undo()
        runCurrent()
        assertEquals(listOf(reason), said)
        assertEquals("cp2", vm.state.value.detail?.checkpointId)
    }

    @Test fun acceptReadsTheTaskAgainAndDoesNothingIfTheHoldChanged() = runTest(dispatcher) {
        val b = FakeTasksBackend().also { it.details[5] = Result.success(heldTask(5, "cp1")) }
        val vm = vm(b, 5)
        val said = said(vm)
        // Orb held it for another reason after another run.
        b.details[5] = Result.success(
            detail(task(5, status = "blocked", held = TaskHeld("ha tocado .env", "C:/p")), hasCheckpoint = true, checkpointId = "cp2"),
        )
        vm.accept()
        runCurrent()
        assertTrue(b.calls.toString(), b.calls.none { it.startsWith("accept") })
        assertEquals(listOf(TaskTexts.ACCEPT_CHANGED), said)
        assertEquals("cp2", vm.state.value.detail?.checkpointId)
    }

    @Test fun acceptStillWorksWhenTheTaskIsAsThePersonSawIt() = runTest(dispatcher) {
        val b = FakeTasksBackend().also { it.details[5] = Result.success(heldTask(5, "cp1")) }
        val vm = vm(b, 5)
        vm.accept()
        runCurrent()
        assertEquals(listOf("accept 5"), b.calls)
    }

    @Test fun diffUndoSendsThePointOfReturnToo() = runTest(dispatcher) {
        val b = FakeTasksBackend().also {
            it.details[4] = Result.success(detail(task(4, status = "done"), hasCheckpoint = true, checkpointId = "cpA"))
            it.diffs[4] = Result.success(TaskDiff(true, emptyList(), 0))
        }
        val vm = TaskDiffViewModel(b, 4)
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        vm.askUndo()
        vm.undo()
        runCurrent()
        assertEquals(listOf<String?>("cpA"), b.undoCheckpoints)
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class TaskGuardsScreenTest {
    @get:Rule val rule = createComposeRule()

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    private fun show(b: FakeTasksBackend, id: Long) {
        val vm = TaskDetailViewModel(b, id, reloadDebounceMs = 0)
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                TaskDetailScreen(vm, onBack = {}, onOpenTask = {}, onOpenChanges = {}, nowMs = { 1_800_000_000_000L })
            }
        }
        rule.waitForIdle()
    }

    @Test fun theApprovalShowsEverythingTheFingerprintCovers() {
        val b = FakeTasksBackend().also { it.details[9] = Result.success(GuardsFixture.parsed()) }
        show(b, 9)
        val texts = listOf(
            // The whole brief and why it asks.
            "Sube la web nueva al servidor y avisa por correo.", ChatTexts.asksBecause(listOf("publish", "financial")),
            // Who runs it (the agent the fingerprint covers: «any» is «Automático»), how, and the Preguntar permission.
            ChatTexts.approvalWho("Automático", "opus", "high", true, "aislada", true, "preguntar"),
            // The folder the OK is about, with its warnings, and the cut text.
            "D:/otros/web", ChatTexts.FOLDER_CHANGED_NOTE, ChatTexts.FOLDER_OUTSIDE_NOTE, ChatTexts.DESCRIPTION_CUT_NOTE,
            // What the person's own message asked for.
            ChatTexts.USER_ASKED_LABEL, "haz push a main",
        )
        for (t in texts) rule.onAllNodesWithText(t).onFirst().performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("Aprobar").performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals(listOf("decide 9 true hh"), b.calls)
    }

    @Test fun aPcThatSaysNothingNewShowsTheBriefAndApprovesAsBefore() {
        val b = FakeTasksBackend().also { it.details[9] = Result.success(detail(task(9, status = "awaiting_approval"), description = "Hace algo", previewHash = "h1")) }
        show(b, 9)
        rule.onNodeWithText("Hace algo").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("Aprobar").performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals(listOf("decide 9 true h1"), b.calls)
    }
}

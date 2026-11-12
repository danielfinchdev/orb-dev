package dev.orb.app.ui.tasks

import dev.orb.app.link.api.ApiMethods
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

const val PATCH = """diff --git a/src/push.ts b/src/push.ts
index 111..222 100644
--- a/src/push.ts
+++ b/src/push.ts
@@ -1,3 +1,4 @@
 import { app } from './app';
-export function init() {}
+export async function init() {
+  await register(app.token);
\ No newline at end of file
"""

class DiffParserTest {
    @Test fun dropsTheHeaderAndClassifiesTheLines() {
        val l = DiffParser.lines(PATCH)
        assertEquals(DiffLineKind.Hunk, l.first().kind)
        assertEquals(
            listOf(DiffLineKind.Hunk, DiffLineKind.Context, DiffLineKind.Del, DiffLineKind.Add, DiffLineKind.Add, DiffLineKind.Note),
            l.map { it.kind },
        )
        assertEquals("import { app } from './app';", l[1].text)
        assertEquals("export function init() {}", l[2].text)
        assertEquals("  await register(app.token);", l[4].text)
    }

    @Test fun anEmptyPatchHasNoLines() {
        assertTrue(DiffParser.lines("").isEmpty())
    }

    @Test fun aLongPatchIsParsedInOnePass() {
        val big = buildString {
            append("diff --git a/x b/x\n@@ -1,20000 +1,20000 @@\n")
            repeat(20_000) { append("+line $it\n") }
        }
        assertEquals(20_001, DiffParser.lines(big).size)
    }

    @Test fun parsesTheAnswerOfTheDiffMethod() {
        val json = Json.parseToJsonElement(
            """{"available":true,"files":[{"status":"M","path":"a.ts","added":3,"removed":1,"binary":false,"patch":"@@ -1 +1 @@\n-a\n+b\n","cut":false},
               {"status":"A","path":"img.png","added":0,"removed":0,"binary":true,"patch":"","cut":false}],"more":2}""",
        )
        val d = TasksParser.diff(json)
        assertTrue(d.available)
        assertEquals(2, d.files.size)
        assertEquals(2, d.more)
        assertTrue(d.files[1].binary)
        assertEquals(3, d.added)
        assertFalse(TasksParser.diff(Json.parseToJsonElement("""{"available":false,"files":[],"more":0}""")).available)
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class TaskDiffViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = kotlinx.coroutines.Dispatchers.setMain(dispatcher)
    @After fun tearDown() = kotlinx.coroutines.Dispatchers.resetMain()

    private val files = listOf(DiffFile("M", "src/push.ts", 2, 1, false, PATCH, false), DiffFile("A", "main.ts", 9, 0, false, "@@ -0,0 +1 @@\n+x\n", false))

    private fun backend(d: TaskDetail, diff: TaskDiff = TaskDiff(true, files, 0)) = FakeTasksBackend().also {
        it.details[d.id] = Result.success(d)
        it.diffs[d.id] = Result.success(diff)
    }

    private fun TestScope.vm(b: FakeTasksBackend, id: Long = 4): TaskDiffViewModel {
        val vm = TaskDiffViewModel(b, id)
        backgroundScope.launch { vm.state.collect { } }
        runCurrent()
        return vm
    }

    private val done = detail(task(4, "Push", status = "done"), hasCheckpoint = true)

    @Test fun loadsTheFilesAndTheTaskFlags() = runTest(dispatcher) {
        val s = vm(backend(done)).state.value
        assertEquals(2, s.diff?.files?.size)
        assertEquals("Push", s.title)
        assertTrue(s.canAccept && s.canUndo)
    }

    @Test fun anAcceptedTaskCannotBeAcceptedAgain() = runTest(dispatcher) {
        val s = vm(backend(detail(task(4, status = "done"), accepted = true, hasCheckpoint = true))).state.value
        assertTrue(s.accepted && !s.canAccept && s.canUndo)
    }

    @Test fun anUndoneTaskOffersNeitherUndoNorADiff() = runTest(dispatcher) {
        val d = detail(task(4, status = "done", undone = true), hasCheckpoint = true)
        val s = vm(backend(d, TaskDiff(false, emptyList(), 0))).state.value
        assertFalse(s.canUndo)
        assertFalse(s.diff!!.available)
    }

    @Test fun methodsThePcDoesNotListHideTheButtons() = runTest(dispatcher) {
        val b = backend(done)
        b.unavailable = setOf(ApiMethods.TASKS_UNDO.name)
        val s = vm(b).state.value
        assertTrue(s.canAccept)
        assertFalse(s.canUndo)
    }

    @Test fun acceptAndUndoGoToThePcOnceEach() = runTest(dispatcher) {
        val b = backend(done)
        b.gate = CompletableDeferred()
        val vm = vm(b)
        vm.accept(); vm.accept(); vm.undo()
        runCurrent()
        assertTrue(vm.state.value.busy)
        b.gate!!.complete(Unit)
        advanceUntilIdle()
        assertEquals(listOf("accept 4"), b.calls)
        vm.undo()
        advanceUntilIdle()
        assertEquals(listOf("accept 4", "undo 4"), b.calls)
    }

    @Test fun aDiffTheAnswerCannotBeReadShowsTheErrorAndRetries() = runTest(dispatcher) {
        val b = FakeTasksBackend()
        b.details[4] = Result.success(done)
        val vm = vm(b)
        assertTrue(vm.state.value.error != null)
        b.diffs[4] = Result.success(TaskDiff(true, files, 0))
        vm.refresh()
        runCurrent()
        assertEquals(null, vm.state.value.error)
        assertEquals(2, vm.state.value.diff?.files?.size)
    }
}

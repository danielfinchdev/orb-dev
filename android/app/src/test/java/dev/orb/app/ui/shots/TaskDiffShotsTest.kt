package dev.orb.app.ui.shots

import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.ui.tasks.DiffFile
import dev.orb.app.ui.tasks.FakeTasksBackend
import dev.orb.app.ui.tasks.TaskDiff
import dev.orb.app.ui.tasks.TaskDiffScreen
import dev.orb.app.ui.tasks.TaskDiffViewModel
import dev.orb.app.ui.tasks.detail
import dev.orb.app.ui.tasks.task
import dev.orb.app.ui.theme.OrbPaletteChoice
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The changes screen (19) with the mockup's own diff, one picture per variant of the mockup («Diff», «Menú ⋯», «Deshacer»,
 * «Aceptado») and per state it leaves out: `ORB_SHOTS=1` turns them on.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = Shots.PHONE)
class TaskDiffShotsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Before fun still() {
        Settings.Global.putFloat(rule.activity.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
    }

    private val push = """diff --git a/push.ts b/push.ts
--- a/push.ts
+++ b/push.ts
@@ -1,6 +1,14 @@
 import { app } from './app';
-export function init() {}
+export async function init() {
+  const perm = await askPermission();
+  if (perm !== 'granted') return;
+  await register(app.token);
+}
@@ -40,3 +48,9 @@
 // retry
+const delay = (ms) => new Promise(r =>
+  setTimeout(r, ms));
 export default init;
"""

    private val main = "@@ -10,3 +10,5 @@\n-const old = 1;\n+const next = 2;\n+const more = 3;\n ready();\n"

    private fun mockupFiles() = listOf(
        DiffFile("M", "push.ts", 31, 0, false, push, false),
        DiffFile("M", "main.ts", 9, 7, false, main, false),
        DiffFile("M", "package.json", 0, 0, false, "", false),
    )

    private fun shoot(
        name: String, diff: TaskDiff = TaskDiff(true, mockupFiles(), 0), palette: OrbPaletteChoice = OrbPaletteChoice.Grafito,
        accepted: Boolean = false, status: String = "done", checkpoint: String? = null, after: () -> Unit = {},
    ) {
        Shots.assumeEnabled()
        val b = FakeTasksBackend().also {
            it.details[42] = Result.success(detail(task(42, "Subir push", status = status, project = "app-movil", agent = "cursor"), hasCheckpoint = true, accepted = accepted, checkpointId = checkpoint))
            it.diffs[42] = Result.success(diff)
        }
        val vm = TaskDiffViewModel(b, 42, reloadDebounceMs = 0)
        var dark by mutableStateOf(false)
        rule.setContent { ShotFrame(palette, dark) { TaskDiffScreen(vm, onBack = {}) } }
        rule.waitForIdle()
        after()
        rule.waitForIdle()
        Shots.save(rule.activity, "19-cambios-${palette.key}-claro$name")
        dark = true
        rule.waitForIdle()
        Shots.save(rule.activity, "19-cambios-${palette.key}-oscuro$name")
    }

    // The variants of the mockup

    @Test fun diff() = shoot("")
    @Test fun diffOceano() = shoot("", palette = OrbPaletteChoice.Oceano)
    @Test fun menu() = shoot("-menu") { rule.onNodeWithContentDescription("Más opciones").performClick() }
    @Test fun menuOceano() = shoot("-menu", palette = OrbPaletteChoice.Oceano) { rule.onNodeWithContentDescription("Más opciones").performClick() }
    @Test fun undoDialog() = shoot("-deshacer") { rule.onNodeWithText("Deshacer").performClick() }
    @Test fun accepted() = shoot("-aceptado") { rule.onNodeWithText("Aceptar cambios").performClick() }

    // What the mockup leaves out

    @Test fun zoomed() = shoot("-ampliado") {
        repeat(2) {
            rule.onNodeWithContentDescription("Más opciones").performClick()
            rule.waitForIdle()
            rule.onNodeWithText("Ampliar el diff").performClick()
            rule.waitForIdle()
        }
    }
    @Test fun secondFile() = shoot("-segundo-archivo") { rule.onNodeWithText("main.ts").performClick() }
    @Test fun alreadyAccepted() = shoot("-ya-aceptada", accepted = true)
    @Test fun notReady() = shoot(
        "-no-listo", TaskDiff(true, mockupFiles(), 0, checkpointId = "run1", runKnown = true), checkpoint = "run2",
    )
    @Test fun noPhoto() = shoot("-sin-punto-de-vuelta", TaskDiff(false, emptyList(), 0, reason = "nophoto"))
    @Test fun joinedByHand() = shoot("-unida-a-mano", TaskDiff(false, emptyList(), 0, reason = "joinedbyhand"), checkpoint = "run1")
    @Test fun noFinalPhoto() = shoot("-sin-foto-final", TaskDiff(false, emptyList(), 0, reason = "nophotoafter"))
    @Test fun mergeUnfinished() = shoot("-union-sin-terminar", TaskDiff(false, emptyList(), 0, reason = "resolveonpc"))
    @Test fun oldRestorePoint() = shoot("-punto-antiguo", TaskDiff(false, emptyList(), 0, reason = "unknownrun"))
    @Test fun noGit() = shoot("-sin-git", TaskDiff(false, emptyList(), 0, reason = "nogit"))
    @Test fun hiddenFiles() = shoot("-ocultos", TaskDiff(true, mockupFiles(), 0, hidden = 2))
}

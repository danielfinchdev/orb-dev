package dev.orb.app.ui.shots

import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import dev.orb.app.ui.tasks.FakeTasksBackend
import dev.orb.app.ui.tasks.GuardsFixture
import dev.orb.app.ui.tasks.TaskDetailScreen
import dev.orb.app.ui.tasks.TaskDetailViewModel
import dev.orb.app.ui.theme.OrbPaletteChoice
import kotlinx.coroutines.Dispatchers
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The task's own screen asking for an OK with everything the PC's fingerprint covers (18): `ORB_SHOTS=1` turns it on. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = Shots.PHONE)
class TaskShotsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Before fun still() {
        Settings.Global.putFloat(rule.activity.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
    }

    @Test fun approveWithEveryFact() {
        Shots.assumeEnabled()
        val b = FakeTasksBackend().also { it.details[9] = Result.success(GuardsFixture.parsed()) }
        val vm = TaskDetailViewModel(b, 9, reloadDebounceMs = 0)
        val palette = OrbPaletteChoice.Grafito
        rule.setContent {
            ShotFrame(palette, dark = false) {
                TaskDetailScreen(vm, onBack = {}, onOpenTask = {}, onOpenChanges = {}, nowMs = { 1_800_000_000_000L })
            }
        }
        rule.waitForIdle()
        Shots.save(rule.activity, "18-tarea-${palette.key}-claro-aprobar")
    }
}

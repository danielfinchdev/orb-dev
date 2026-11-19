package dev.orb.app.ui.shots

import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.ui.chats.ChatTime
import dev.orb.app.ui.tasks.AgentChoice
import dev.orb.app.ui.tasks.FakeTasksBackend
import dev.orb.app.ui.tasks.GuardsFixture
import dev.orb.app.ui.tasks.TaskDetail
import dev.orb.app.ui.tasks.TaskDetailScreen
import dev.orb.app.ui.tasks.TaskDetailViewModel
import dev.orb.app.ui.tasks.TaskHeld
import dev.orb.app.ui.tasks.TaskReview
import dev.orb.app.ui.tasks.TaskWait
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
import java.util.GregorianCalendar

/**
 * The task's own screen (18) with the mockup's own task, one picture per variant of the mockup («En cola», «Retenida»,
 * «Fallida» and the three sheets) and the OK with everything the fingerprint covers: `ORB_SHOTS=1` turns them on.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = Shots.PHONE)
class TaskShotsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Before fun still() {
        Settings.Global.putFloat(rule.activity.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
    }

    /** «15:00» in whatever time zone the test runs in, as an ISO moment of the PC. */
    private fun threeOClock(): String = ChatTime.iso(GregorianCalendar().apply { set(2026, 10, 19, 15, 0, 0); set(java.util.Calendar.MILLISECOND, 0) }.timeInMillis)

    private val created = "2026-11-19T11:48:00.000Z"
    private val now = ChatTime.parse(created)!! + 12 * 60_000L

    private fun mockupTask(status: String, waiting: TaskWait? = null, held: TaskHeld? = null): TaskDetail =
        detail(
            task(44, "Traducir la FAQ", status = status, project = "api-pagos", agent = "claude", waiting = waiting, held = held)
                .copy(createdAt = created, model = "Sonnet"),
            description = "Traducir faq.html al inglés sin tocar los enlaces ni el estilo.", mode = "aislada", createdBy = "orbe",
            review = TaskReview(50, null, "codex", null), hasCheckpoint = held != null, checkpointId = if (held != null) "cp1" else null,
        )

    private fun shoot(name: String, d: TaskDetail, palette: OrbPaletteChoice = OrbPaletteChoice.Grafito, after: () -> Unit = {}) {
        Shots.assumeEnabled()
        val b = FakeTasksBackend().also {
            it.details[d.id] = Result.success(d)
            it.agentList = Result.success(listOf(AgentChoice("claude", "Claude", "Sonnet 5.5"), AgentChoice("codex", "Codex"), AgentChoice("cursor", "Cursor")))
        }
        val vm = TaskDetailViewModel(b, d.id, reloadDebounceMs = 0)
        var dark by mutableStateOf(false)
        rule.setContent {
            ShotFrame(palette, dark) {
                TaskDetailScreen(vm, onBack = {}, onOpenTask = {}, onOpenChanges = {}, nowMs = { now })
            }
        }
        rule.waitForIdle()
        after()
        rule.waitForIdle()
        Shots.save(rule.activity, "18-tarea-${palette.key}-claro$name")
        dark = true
        rule.waitForIdle()
        Shots.save(rule.activity, "18-tarea-${palette.key}-oscuro$name")
    }

    private fun waitingNotice() = mockupTask("queued", TaskWait("notice", "Límite", emptyList(), account = "Claude", until = threeOClock(), percent = 94))

    // The variants of the mockup

    @Test fun waiting() = shoot("", waitingNotice())
    @Test fun waitingOceano() = shoot("", waitingNotice(), OrbPaletteChoice.Oceano)
    @Test fun held() = shoot("-retenida", mockupTask("blocked", held = TaskHeld("borró 12 archivos", null)))
    @Test fun heldOceano() = shoot("-retenida", mockupTask("blocked", held = TaskHeld("borró 12 archivos", null)), OrbPaletteChoice.Oceano)
    @Test fun failed() = shoot("-fallida", mockupTask("failed"))
    @Test fun cancelDialog() = shoot("-cancelar", waitingNotice()) { rule.onNodeWithText("Cancelar tarea").performClick() }
    @Test fun reassignSheet() = shoot("-reasignar", waitingNotice()) { rule.onNodeWithText("Reasignar").performClick() }
    @Test fun followupSheet() = shoot("-seguir", waitingNotice()) { rule.onNodeWithText("Seguir").performClick() }

    // What the mockup leaves out

    @Test fun launchDialog() = shoot("-iniciar", waitingNotice()) { rule.onNodeWithText("Iniciar de todos modos").performClick() }
    @Test fun busyFolder() = shoot("-carpeta", mockupTask("queued", TaskWait("folder", null, emptyList(), by = 42)))
    @Test fun running() = shoot("-en-curso", mockupTask("running").let { it.copy(row = it.row.copy(percent = 60, note = "Traduciendo faq.html")) })

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

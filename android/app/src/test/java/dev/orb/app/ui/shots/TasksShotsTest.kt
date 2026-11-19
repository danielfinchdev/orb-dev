package dev.orb.app.ui.shots

import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.link.net.PcVersions
import dev.orb.app.ui.chats.ChatsMenu
import dev.orb.app.ui.chats.ChatTime
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbBottomBar
import dev.orb.app.ui.kit.OrbTab
import dev.orb.app.ui.tasks.FakeTasksBackend
import dev.orb.app.ui.tasks.TaskHeld
import dev.orb.app.ui.tasks.TaskWait
import dev.orb.app.ui.tasks.TasksData
import dev.orb.app.ui.tasks.TasksScreen
import dev.orb.app.ui.tasks.TasksViewModel
import dev.orb.app.ui.tasks.WaitDep
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
 * Pictures of the task board (17) with the mockup's own tasks, one per variant of the mockup and per state the mockup
 * leaves out: `ORB_SHOTS=1` turns them on.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = Shots.PHONE)
class TasksShotsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Before fun still() {
        Settings.Global.putFloat(rule.activity.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
    }

    private val tabs = listOf(OrbTab("chats", "Chats", OrbIcons.Chat, 3), OrbTab("tasks", "Tareas", OrbIcons.Tasks, 1), OrbTab("projects", "Proyectos", OrbIcons.FolderGit2))

    /** «15:00» in whatever time zone the test runs in, as an ISO moment of the PC. */
    private fun threeOClock(): String = ChatTime.iso(GregorianCalendar().apply { set(2026, 10, 19, 15, 0, 0); set(java.util.Calendar.MILLISECOND, 0) }.timeInMillis)

    private val held = task(43, "Borrar build/ y reinstalar", status = "blocked", project = "app-movil", agent = "codex", held = TaskHeld("borra 214 archivos", null))

    private fun mockupRows() = listOf(
        task(43, "Borrar build/ y reinstalar", status = "awaiting_approval", project = "app-movil", agent = "codex"),
        task(42, "Ajustar estilos", status = "running", project = "app-movil", agent = "cursor", percent = 60),
        task(41, "Probar push en el emulador", project = "app-movil", agent = null, waiting = TaskWait("deps", null, listOf(WaitDep(43, "queued", false)))),
        task(44, "Traducir la FAQ al inglés", project = "api-pagos", agent = "claude", waiting = TaskWait("notice", "Límite", emptyList(), account = "Claude", until = threeOClock(), percent = 94)),
        task(45, "Ajustar margen del pie", project = "app-movil", agent = null, waiting = TaskWait("folder", null, emptyList())),
    )

    private fun backend(rows: List<dev.orb.app.ui.tasks.TaskRow>, paused: Boolean) = FakeTasksBackend(rows, paused).apply {
        connectionState.value = ConnectionState.Online("http://pc", "PC de Dani", PcVersions(1, 1, "3.8.8"))
        for (t in rows) details[t.id] = Result.success(detail(t, previewHash = "h${t.id}"))
    }

    private fun twoModes(name: String, palette: OrbPaletteChoice, suffix: String, after: () -> Unit = {}, content: @androidx.compose.runtime.Composable () -> Unit) {
        var dark by mutableStateOf(false)
        rule.setContent { ShotFrame(palette, dark, content) }
        rule.waitForIdle()
        after()
        rule.waitForIdle()
        Shots.save(rule.activity, "$name-${palette.key}-claro$suffix")
        dark = true
        rule.waitForIdle()
        Shots.save(rule.activity, "$name-${palette.key}-oscuro$suffix")
    }

    private lateinit var vm: TasksViewModel

    private fun board(
        palette: OrbPaletteChoice, suffix: String = "", rows: List<dev.orb.app.ui.tasks.TaskRow> = mockupRows(), paused: Boolean = true,
        setup: (FakeTasksBackend) -> Unit = {}, after: () -> Unit = {},
    ) {
        Shots.assumeEnabled()
        val b = backend(rows, paused).also(setup)
        vm = TasksViewModel(b, reloadDebounceMs = 0, searchDebounceMs = 0)
        val vm = vm
        twoModes("17-tareas", palette, suffix, after) {
            Column(Modifier.fillMaxSize()) {
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    TasksScreen(vm, ChatsMenu(onMenu = {}, unreadNotices = 2, onNotices = {}), onOpenTask = {})
                }
                OrbBottomBar(tabs, "tasks", {})
            }
        }
    }

    // The three variants of the mockup

    @Test fun pausedGrafito() = board(OrbPaletteChoice.Grafito)
    @Test fun pausedOceano() = board(OrbPaletteChoice.Oceano)
    @Test fun resumed() = board(OrbPaletteChoice.Grafito, "-reanudada", after = { rule.onNodeWithText("Reanudar").performClick() })
    @Test fun empty() = board(OrbPaletteChoice.Grafito, "-vacio", rows = emptyList(), paused = false)

    // What the mockup leaves out

    @Test fun upToDate() = board(OrbPaletteChoice.Grafito, "-todo-al-dia", rows = listOf(task(20, status = "done"), task(21, status = "done", accepted = true)), paused = false)
    @Test fun withoutTheLink() = board(OrbPaletteChoice.Grafito, "-sin-conexion", setup = { b ->
        b.connectionState.value = ConnectionState.Offline(null, null)
        b.listResult = Result.failure(LinkException(LinkError.Offline))
        b.savedFlow.value = TasksData(mockupRows(), paused = true)
    })
    @Test fun loading() = board(OrbPaletteChoice.Grafito, "-cargando", rows = emptyList(), setup = { b -> b.listGate = kotlinx.coroutines.CompletableDeferred() })
    @Test fun failed() = board(OrbPaletteChoice.Grafito, "-error", rows = emptyList(), setup = { b ->
        b.listResult = Result.failure(LinkException(LinkError.Offline))
    })
    @Test fun heldForReview() = board(OrbPaletteChoice.Grafito, "-retenida", rows = mockupRows().drop(1) + held)
    @Test fun chosenChip() = board(OrbPaletteChoice.Grafito, "-chip-en-curso", after = { vm.toggleSection(dev.orb.app.ui.tasks.TaskSection.Running) })
    @Test fun menuWithTheBoardsEntries() {
        Shots.assumeEnabled()
        twoModes("17-tareas", OrbPaletteChoice.Grafito, "-menu") {
            dev.orb.app.ui.menu.MenuSheet(
                dev.orb.app.ui.menu.MenuState(
                    "PC de Dani", dev.orb.app.link.net.ConnectionState.Connecting, unreadChats = 2, inbox = dev.orb.app.ui.menu.InboxMenu(priority = false, canDigest = true),
                    tasks = dev.orb.app.ui.menu.TasksMenu(dev.orb.app.ui.tasks.TaskFilter.Active, canCreate = true, canPause = true),
                ),
                dev.orb.app.ui.menu.MenuActions(), onDismiss = {},
            )
        }
    }
    @Test fun rejectDialog() = board(OrbPaletteChoice.Grafito, "-rechazar", after = {
        rule.onNodeWithText("Rechazar").performClick()
    })
    @Test fun newTask() = board(OrbPaletteChoice.Grafito, "-nueva", after = { vm.openNewTask() })
}

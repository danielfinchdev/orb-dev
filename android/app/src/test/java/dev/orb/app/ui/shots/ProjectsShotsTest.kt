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
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.link.net.PcVersions
import dev.orb.app.ui.chats.ChatKind
import dev.orb.app.ui.chats.ChatsMenu
import dev.orb.app.ui.chats.row
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbBottomBar
import dev.orb.app.ui.kit.OrbTab
import dev.orb.app.ui.projects.FakeProjectsBackend
import dev.orb.app.ui.projects.FinishedProject
import dev.orb.app.ui.projects.ProjectDetailData
import dev.orb.app.ui.projects.ProjectDetailScreen
import dev.orb.app.ui.projects.ProjectDetailViewModel
import dev.orb.app.ui.projects.ProjectGit
import dev.orb.app.ui.projects.ProjectsData
import dev.orb.app.ui.projects.ProjectsScreen
import dev.orb.app.ui.projects.ProjectsViewModel
import dev.orb.app.ui.projects.project
import dev.orb.app.ui.tasks.task
import dev.orb.app.ui.theme.OrbPaletteChoice
import kotlinx.coroutines.CompletableDeferred
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Pictures of the projects (21) and a project's page (22), one per variant of the mockups and per state the mockups
 * leave out: `ORB_SHOTS=1` turns them on.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = Shots.PHONE)
class ProjectsShotsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Before fun still() {
        Settings.Global.putFloat(rule.activity.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
    }

    private val tabs = listOf(OrbTab("chats", "Chats", OrbIcons.Chat, 3), OrbTab("tasks", "Tareas", OrbIcons.Tasks, 1), OrbTab("projects", "Proyectos", OrbIcons.FolderGit2))

    private val mockupGit = mapOf(
        "app-movil" to ProjectGit("dev", 2, null, null), "api-pagos" to ProjectGit("main", 0, null, null),
        "tienda-online" to ProjectGit("main", 0, null, null), "prueba-orb" to ProjectGit("main", 0, null, null),
    )

    private fun mockupProjects() = listOf(
        project("app-movil", "android", active = true, open = 2),
        project("api-pagos", "web"),
        project("tienda-online", "web", open = 1, approve = 1),
        project("prueba-orb", "web"),
    )

    private val finished = listOf(FinishedProject("k1", "prueba-antigua", "web", "2026-10-19T10:00:00Z"))

    private fun backend(rows: List<dev.orb.app.ui.projects.ProjectItem> = mockupProjects()) = FakeProjectsBackend(rows, finished).apply {
        connectionState.value = ConnectionState.Online("http://pc", "PC de Dani", PcVersions(1, 1, "3.8.8"))
        gitResult = Result.success(mockupGit)
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

    private fun list(palette: OrbPaletteChoice, suffix: String = "", b: FakeProjectsBackend = backend(), after: () -> Unit = {}) {
        Shots.assumeEnabled()
        val vm = ProjectsViewModel(b, reloadDebounceMs = 0)
        twoModes("21-proyectos", palette, suffix, after) {
            Column(Modifier.fillMaxSize()) {
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    ProjectsScreen(vm, onOpenProject = {}, menu = ChatsMenu(onMenu = {}, unreadNotices = 2, onNotices = {}))
                }
                OrbBottomBar(tabs, "projects", {})
            }
        }
    }

    // The variants of mockup 21

    @Test fun activeGrafito() = list(OrbPaletteChoice.Grafito)
    @Test fun activeOceano() = list(OrbPaletteChoice.Oceano)
    @Test fun finishedProjects() = list(OrbPaletteChoice.Grafito, "-terminados", after = { rule.onNodeWithText("Terminados").performClick() })
    @Test fun empty() = list(OrbPaletteChoice.Grafito, "-vacio", backend(emptyList()))
    @Test fun newProject() = list(OrbPaletteChoice.Grafito, "-nuevo-proyecto", after = { rule.onNodeWithText("Nuevo").performClick() })
    @Test fun newProjectOceano() = list(OrbPaletteChoice.Oceano, "-nuevo-proyecto", after = { rule.onNodeWithText("Nuevo").performClick() })

    // What the mockup leaves out

    @Test fun newProjectWithAName() = list(OrbPaletteChoice.Grafito, "-nuevo-con-nombre", after = {
        rule.onNodeWithText("Nuevo").performClick()
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Nombre del proyecto").performTextInput("app-web")
        rule.onAllNodesWithText("android").onLast().performClick()
        rule.onNodeWithText("Más opciones").performClick()
    })
    @Test fun optionsOfACard() = list(OrbPaletteChoice.Grafito, "-opciones", after = { rule.onNodeWithText("app-movil").performTouchInput { longClick() } })
    @Test fun withoutTheLink() = list(OrbPaletteChoice.Grafito, "-sin-conexion", FakeProjectsBackend().apply {
        connectionState.value = ConnectionState.Offline(null, null)
        listResult = Result.failure(LinkException(LinkError.Offline))
        savedFlow.value = ProjectsData(mockupProjects(), finished)
    })
    @Test fun loading() = list(OrbPaletteChoice.Grafito, "-cargando", FakeProjectsBackend().apply { listGate = CompletableDeferred() })
    @Test fun failed() = list(OrbPaletteChoice.Grafito, "-error", FakeProjectsBackend().apply { listResult = Result.failure(LinkException(LinkError.Offline)) })
    @Test fun anOlderPc() = list(OrbPaletteChoice.Grafito, "-pc-antiguo", backend().apply { gitReadable = false })

    // Mockup 22

    private val taskRows = listOf(
        task(42, "Ajustar estilos", status = "running", project = "app-movil", agent = "cursor", percent = 60),
        task(43, "Borrar build/ y reinstalar", status = "awaiting_approval", project = "app-movil", agent = "codex"),
        task(40, "Cambiar los colores del pie", status = "done", project = "app-movil", agent = "claude"),
        task(39, "Pasar la lista a Compose", status = "done", project = "app-movil", agent = "claude"),
    )

    private fun detailBackend(
        tasks: List<dev.orb.app.ui.tasks.TaskRow> = taskRows, git: ProjectGit? = ProjectGit("dev", 2, null, null), finishedKey: String? = null,
    ) = FakeProjectsBackend().apply {
        connectionState.value = ConnectionState.Online("http://pc", "PC de Dani", PcVersions(1, 1, "3.8.8"))
        detailResult = Result.success(
            ProjectDetailData(
                listOf(
                    row("1", title = "Versión 2.0 de la app", project = "app-movil", at = "2026-11-19T13:58:00.000Z", agent = null),
                    row("2", kind = ChatKind.Agent, title = "Ajustar estilos con Cursor", project = "app-movil", at = "2026-11-19T13:46:00.000Z", agent = "cursor"),
                ),
                tasks, git, "android", finishedKey, finishedKey?.let { "2026-10-19T10:00:00Z" },
            ),
        )
        logResult = Result.success("### 2026-11-18 21:40 — Claude\nSe ajustaron los estilos del pie.")
    }

    private fun page(palette: OrbPaletteChoice, suffix: String = "", b: FakeProjectsBackend = detailBackend(), after: () -> Unit = {}) {
        Shots.assumeEnabled()
        val vm = ProjectDetailViewModel(b, "app-movil", reloadDebounceMs = 0)
        twoModes("22-proyecto", palette, suffix, after) {
            ProjectDetailScreen(vm, onBack = {}, onOpenChat = {}, onOpenTask = {}, onOpenWhiteboard = {})
        }
    }

    @Test fun pageGrafito() = page(OrbPaletteChoice.Grafito)
    @Test fun pageOceano() = page(OrbPaletteChoice.Oceano)
    @Test fun pageFinished() = page(OrbPaletteChoice.Grafito, "-terminado", detailBackend(emptyList(), null, finishedKey = "k1"))
    @Test fun branchAndChanges() = page(OrbPaletteChoice.Grafito, "-rama-y-cambios", after = { rule.onNodeWithText("Rama y cambios").performScrollTo().performClick() })
    @Test fun branchAndChangesOceano() = page(OrbPaletteChoice.Oceano, "-rama-y-cambios", after = { rule.onNodeWithText("Rama y cambios").performScrollTo().performClick() })
    @Test fun finish() = page(OrbPaletteChoice.Grafito, "-terminar", after = { rule.onNodeWithText("Terminar proyecto").performScrollTo().performClick() })

    // What the mockup leaves out

    @Test fun branchWithoutChangesToAccept() = page(OrbPaletteChoice.Grafito, "-rama-sin-cambios", detailBackend(taskRows.take(2), ProjectGit("main", 0, null, null)), after = {
        rule.onNodeWithText("Rama y cambios").performScrollTo().performClick()
    })
    @Test fun whichTaskChanges() = page(OrbPaletteChoice.Grafito, "-elegir-tarea", after = {
        rule.onNodeWithText("Rama y cambios").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Ver cambios").performClick()
    })
    @Test fun reviewAsk() = page(OrbPaletteChoice.Grafito, "-revision", after = {
        rule.onNodeWithText("Rama y cambios").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Revisión cruzada").performClick()
    })
    @Test fun newTask() = page(OrbPaletteChoice.Grafito, "-nueva-tarea", after = { rule.onNodeWithText("Tarea").performClick() })
    @Test fun projectTasks() = page(OrbPaletteChoice.Grafito, "-tareas", after = { rule.onNodeWithText("Tareas del proyecto").performScrollTo().performClick() })
    @Test fun log() = page(OrbPaletteChoice.Grafito, "-bitacora", after = { rule.onNodeWithText("Bitácora del proyecto").performScrollTo().performClick() })
    @Test fun scrolledDown() = page(OrbPaletteChoice.Grafito, "-contraida", after = { rule.onNodeWithText("Terminar proyecto").performScrollTo() })
    @Test fun withoutTheLinkPage() = page(OrbPaletteChoice.Grafito, "-sin-conexion", detailBackend().apply { connectionState.value = ConnectionState.Offline(null, null) })
    @Test fun loadingPage() = page(OrbPaletteChoice.Grafito, "-cargando", FakeProjectsBackend().apply { detailGate = CompletableDeferred() })
    @Test fun failedPage() = page(OrbPaletteChoice.Grafito, "-error", FakeProjectsBackend().apply { detailResult = Result.failure(LinkException(LinkError.Offline)) })
}

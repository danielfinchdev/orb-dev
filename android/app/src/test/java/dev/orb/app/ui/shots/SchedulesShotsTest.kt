package dev.orb.app.ui.shots

import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.link.net.PcVersions
import dev.orb.app.ui.chats.ChatTime
import dev.orb.app.ui.schedules.FakeSchedulesBackend
import dev.orb.app.ui.schedules.ScheduleItem
import dev.orb.app.ui.schedules.SchedulesScreen
import dev.orb.app.ui.schedules.SchedulesViewModel
import dev.orb.app.ui.schedules.schedule
import dev.orb.app.ui.theme.OrbPaletteChoice
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.TimeZone

/**
 * Pictures of the scheduled-tasks screen (20) with the mockup's own schedules, one per variant of the mockup and per
 * state the mockup leaves out: `ORB_SHOTS=1` turns them on.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = Shots.PHONE)
class SchedulesShotsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Before fun still() {
        Settings.Global.putFloat(rule.activity.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
    }

    private val madrid = TimeZone.getTimeZone("Europe/Madrid")

    // Thursday 12 November 2026, 12:00 in Madrid.
    private val now = ChatTime.parse("2026-11-12T11:00:00.000Z")!!

    private fun mockupRows(): List<ScheduleItem> = listOf(
        schedule(1, "Revisar dependencias", project = "api-pagos", tz = "Europe/Madrid", nextRun = "2026-11-16T08:00:00.000Z"),
        schedule(
            2, "Copia de la bitácora", project = "", every = "daily", whenText = "cada día a las 23:30", atTime = "23:30", weekdays = emptyList(),
            tz = "Europe/Madrid", nextRun = null, lastRun = "2026-11-11T22:30:00.000Z", lastTask = 7,
        ),
        schedule(
            3, "Informe de uso", project = "", whenText = "cada viernes a las 18:00", atTime = "18:00", weekdays = listOf(5),
            tz = "Europe/Madrid", nextRun = "2026-11-20T17:00:00.000Z",
        ),
    )

    private fun backend(rows: List<ScheduleItem>) = FakeSchedulesBackend(rows).apply {
        connectionState.value = ConnectionState.Online("http://pc", "PC de Dani", PcVersions(1, 1, "3.8.8"))
        projectNames = listOf("api-pagos", "app-movil")
        outcomeMap = Result.success(mapOf(7L to "done"))
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

    private fun screen(
        palette: OrbPaletteChoice, suffix: String = "", rows: List<ScheduleItem> = mockupRows(), setup: (FakeSchedulesBackend) -> Unit = {},
        after: () -> Unit = {},
    ) {
        Shots.assumeEnabled()
        val b = backend(rows).also(setup)
        val vm = SchedulesViewModel(b, reloadDebounceMs = 0)
        twoModes("20-programadas", palette, suffix, after) { SchedulesScreen(vm, onBack = {}, clock = { now }, zone = madrid) }
    }

    private fun longPress(title: String) {
        rule.onNodeWithText(title).performTouchInput { longClick() }
    }

    private fun button(text: String) = rule.onNode(hasText(text) and hasClickAction())

    // The variants of the mockup

    @Test fun listGrafito() = screen(OrbPaletteChoice.Grafito)
    @Test fun listOceano() = screen(OrbPaletteChoice.Oceano)
    @Test fun empty() = screen(OrbPaletteChoice.Grafito, "-vacio", rows = emptyList())
    @Test fun longPress() = screen(OrbPaletteChoice.Grafito, "-pulsacion-larga", after = { longPress("Revisar dependencias") })
    @Test fun program() = screen(
        OrbPaletteChoice.Grafito, "-programar",
        after = {
            button("Programar").performClick()
            rule.waitForIdle()
            // The mockup has Tuesday chosen.
            rule.onNode(hasContentDescription("lunes")).performClick()
            rule.onNode(hasContentDescription("martes")).performClick()
        },
    )

    // What the mockup leaves out

    @Test fun moreOptions() = screen(
        OrbPaletteChoice.Grafito, "-mas-opciones",
        after = {
            button("Programar").performClick()
            rule.waitForIdle()
            rule.onNodeWithText("Más opciones").performClick()
        },
    )
    @Test fun edit() = screen(
        OrbPaletteChoice.Grafito, "-editar",
        after = {
            longPress("Revisar dependencias")
            rule.waitForIdle()
            rule.onNodeWithText("Editar").performClick()
        },
    )
    @Test fun pending() = screen(OrbPaletteChoice.Grafito, "-pendiente", rows = mockupRows() + schedule(4, "Limpiar la caché", project = "app-movil", approved = false, nextRun = null, tz = "Europe/Madrid"))
    @Test fun approve() = screen(
        OrbPaletteChoice.Grafito, "-aprobar", rows = mockupRows() + schedule(4, "Limpiar la caché", project = "app-movil", approved = false, nextRun = null, tz = "Europe/Madrid", agent = "claude", model = "sonnet"),
        after = {
            longPress("Limpiar la caché")
            rule.waitForIdle()
            rule.onNodeWithText("Revisar y aprobar…").performClick()
        },
    )
    @Test fun runConfirm() = screen(
        OrbPaletteChoice.Grafito, "-ejecutar",
        after = {
            longPress("Revisar dependencias")
            rule.waitForIdle()
            rule.onNodeWithText("Ejecutar ahora").performClick()
        },
    )
    @Test fun withoutTheLink() = screen(OrbPaletteChoice.Grafito, "-sin-conexion", setup = { b ->
        b.connectionState.value = ConnectionState.Offline(null, null)
        b.listResult = Result.failure(LinkException(LinkError.Offline))
        b.savedItems.value = mockupRows()
    })
    @Test fun loading() = screen(OrbPaletteChoice.Grafito, "-cargando", rows = emptyList(), setup = { b -> b.listGate = kotlinx.coroutines.CompletableDeferred() })
    @Test fun failed() = screen(OrbPaletteChoice.Grafito, "-error", rows = emptyList(), setup = { b -> b.listResult = Result.failure(LinkException(LinkError.Offline)) })
}

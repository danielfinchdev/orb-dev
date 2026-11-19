package dev.orb.app.ui.kit

import android.view.KeyEvent
import android.view.inspector.WindowInspector
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class KitTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private fun show(dark: Boolean = false, content: @androidx.compose.runtime.Composable () -> Unit) {
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark, content) }
        rule.waitForIdle()
    }

    /** Presses the system back on every window, as the system would reach the one that listens (the sheet's window or the activity's dispatcher). */
    private fun pressBack() {
        rule.runOnUiThread {
            for (root in WindowInspector.getGlobalWindowViews().reversed()) {
                root.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK))
                root.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_BACK))
            }
        }
        // The sheet slides out before it asks to be dismissed.
        rule.mainClock.advanceTimeBy(2_000)
        rule.waitForIdle()
    }

    @Test fun projectDotHashMatchesTheMockupFormula() {
        // Values worked out with the formula of android.js: FNV-1a 32 bits, a = h % 360, b = (a + 40 + (h >>> 9) % 80) % 360.
        val expected = mapOf(
            "app-movil" to Triple(350, 33, 50), "api-pagos" to Triple(172, 238, 339), "tienda-online" to Triple(134, 194, 112),
        )
        for ((name, t) in expected) {
            val s = ProjectDotMath.spec(name)
            assertEquals(name, t, Triple(s.hueA, s.hueB, s.angle))
        }
        assertEquals(2884937390L, ProjectDotMath.hash("app-movil"))
    }

    @Test fun switchAnnouncesItsStateAndToggles() {
        var on by mutableStateOf(false)
        show { OrbSwitch(on, { on = it }, label = "Avisos") }
        rule.onNodeWithContentDescription("Avisos").assertIsOff().performClick()
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Avisos").assertIsOn()
        assertTrue(on)
    }

    @Test fun chipAnnouncesSelectionAndShowsItsCount() {
        var picked by mutableStateOf(false)
        show { OrbChip("No leídos", picked, { picked = !picked }, count = 3) }
        rule.onNodeWithText("No leídos").assertIsNotSelected().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("No leídos").assertIsSelected()
        rule.onNodeWithText("3").assertIsDisplayed()
    }

    @Test fun bottomBarMarksTheActiveTabAndShowsNumbers() {
        var sel by mutableStateOf("chats")
        val tabs = listOf(
            OrbTab("chats", "Chats", OrbIcons.Chat, 4), OrbTab("tasks", "Tareas", OrbIcons.Tasks, 2), OrbTab("projects", "Proyectos", OrbIcons.FolderGit2),
        )
        show { OrbBottomBar(tabs, sel, { sel = it.key }) }
        rule.onNodeWithText("Chats").assertIsSelected()
        rule.onNodeWithText("Tareas").assertIsNotSelected()
        rule.onNodeWithText("4").assertIsDisplayed()
        rule.onNodeWithText("2").assertIsDisplayed()
        rule.onNodeWithText("Tareas").performClick()
        rule.waitForIdle()
        assertEquals("tasks", sel)
        rule.onNodeWithText("Tareas").assertIsSelected()
    }

    @Test fun buttonsAndIconButtonsKeepAFingerSizedTouchZone() {
        show {
            Column {
                OrbButton("Aceptar", {}, kind = OrbButtonKind.Primary)
                OrbButton("Menos", {}, small = true)
                OrbIconButton(OrbIcons.Menu, "Menú", {}, badge = "2")
            }
        }
        rule.onNodeWithText("Aceptar").assertHeightIsAtLeast(40.dp)
        rule.onNodeWithContentDescription("Menú").assertHeightIsAtLeast(48.dp)
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "2"))
    }

    @Test fun aFoldingGroupHeaderIsAFingerSizedTouchZone() {
        show {
            Column {
                OrbGroupHeader("api-pagos", project = "api-pagos", count = 2, collapsed = false, onClick = {})
                OrbGroupHeader("Fijados", icon = OrbIcons.Pin)
            }
        }
        rule.onNodeWithText("api-pagos").assertIsDisplayed()
        rule.onNode(SemanticsMatcher.keyIsDefined(androidx.compose.ui.semantics.SemanticsActions.OnClick)).assertHeightIsAtLeast(48.dp)
    }

    @Test fun topBarHasATitleAndALine() {
        var back = 0
        show { OrbTopBar("Programadas", sub = "3 activas", leading = { OrbIconButton(OrbIcons.ArrowLeft, "Volver", { back++ }) }) }
        rule.onNodeWithText("Programadas").assertIsDisplayed()
        rule.onNodeWithText("3 activas").assertIsDisplayed()
        rule.onNodeWithContentDescription("Volver").performClick()
        assertEquals(1, back)
    }

    @Test fun sheetClosesWithTheSystemBack() {
        var open by mutableStateOf(true)
        show { if (open) OrbSheet({ open = false }, title = "Acciones") { OrbSheetItem("Fijar", {}) } }
        rule.onNodeWithText("Acciones").assertIsDisplayed()
        pressBack()
        rule.waitUntil(5_000) { !open }
        assertTrue(!open)
    }

    @Test fun sheetItemsAnnounceTheChosenOne() {
        show { OrbSheet({}) { OrbSheetItem("Una hora", {}, checked = true); OrbSheetItem("Mañana", {}, checked = false) } }
        rule.onNodeWithText("Una hora").assertIsSelected()
        rule.onNodeWithText("Mañana").assertIsNotSelected()
    }

    @Test fun dialogPutsTheMainActionAtTheFarRight() {
        var done = ""
        show { OrbDialog({ done = "dismiss" }, "¿Archivar?", OrbDialogAction("Archivar", { done = "confirm" }), text = "Se puede deshacer.", dismiss = OrbDialogAction("Cancelar", {})) }
        val cancel = rule.onNodeWithText("Cancelar").getUnclippedBoundsInRoot()
        val ok = rule.onNodeWithText("Archivar").getUnclippedBoundsInRoot()
        assertTrue("main action right of the other", ok.left > cancel.left)
        rule.onNodeWithText("Archivar").performClick()
        assertEquals("confirm", done)
    }

    @Test
    @Config(sdk = [35], qualifiers = "w390dp-h844dp")
    fun dialogSitsInTheMiddleOfTheScreenNotAgainstTheTop() {
        show { OrbDialog({}, "Renombrar", OrbDialogAction("Guardar", {}), dismiss = OrbDialogAction("Cancelar", {})) }
        val title = rule.onNodeWithText("Renombrar").getUnclippedBoundsInRoot()
        val buttons = rule.onNodeWithText("Guardar").getUnclippedBoundsInRoot()
        val middle = (title.top + buttons.bottom) / 2
        assertTrue("middle of the dialog at $middle", middle > 380.dp && middle < 460.dp)
    }

    @Test fun dialogIconSitsAboveTheTitleAndADialogWithoutOneIsUnchanged() {
        var withIcon by mutableStateOf(false)
        show { OrbDialog({}, "¿Avisos?", OrbDialogAction("Activar", {}), text = "Texto.", icon = if (withIcon) OrbIcons.Bell else null) }
        val plain = rule.onNodeWithText("¿Avisos?").getUnclippedBoundsInRoot()
        withIcon = true
        rule.waitForIdle()
        val iconed = rule.onNodeWithText("¿Avisos?").getUnclippedBoundsInRoot()
        // The icon and its air add 32 dp above the title; the dialog stays centred, so the title moves down by half of that.
        val moved = (iconed.top - plain.top).value
        assertTrue("title moved by $moved dp", moved in 15f..17f)
        rule.onNodeWithText("Activar").assertIsDisplayed()
    }

    @Test fun bannerShowsItsSentenceInBothKinds() {
        show {
            androidx.compose.foundation.layout.Column {
                OrbBanner("No se reconoció.", OrbIcons.CircleAlert)
                OrbBanner("Caducó.", OrbIcons.Clock, kind = OrbBannerKind.Warning)
            }
        }
        rule.onNodeWithText("No se reconoció.").assertIsDisplayed()
        rule.onNodeWithText("Caducó.").assertIsDisplayed()
    }

    @Test fun dialogClosesWithTheSystemBack() {
        var open by mutableStateOf(true)
        show { if (open) OrbDialog({ open = false }, "Título", OrbDialogAction("Vale", {})) }
        pressBack()
        assertTrue(!open)
    }

    @Test fun snackbarShowsItsActionAndRunsIt() {
        var undone = 0
        show { OrbSnackbar("Chat archivado", actionLabel = "Deshacer", onAction = { undone++ }) }
        rule.onNodeWithText("Chat archivado").assertIsDisplayed()
        rule.onNodeWithText("Deshacer").performClick()
        assertEquals(1, undone)
    }

    @Test fun snackbarHostShowsAMessageWithItsAction() {
        val state = SnackbarHostState()
        var performed = false
        show {
            OrbSnackbarHost(state)
            LaunchedEffect(Unit) {
                performed = state.showSnackbar("Hecho", "Deshacer", duration = SnackbarDuration.Indefinite) == androidx.compose.material3.SnackbarResult.ActionPerformed
            }
        }
        rule.onNodeWithText("Hecho").assertIsDisplayed()
        rule.onNodeWithText("Deshacer").performClick()
        rule.waitForIdle()
        assertTrue(performed)
    }
}

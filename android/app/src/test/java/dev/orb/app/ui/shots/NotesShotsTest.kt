package dev.orb.app.ui.shots

import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onFirst
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.notes.FakeNotesBackend
import dev.orb.app.ui.notes.NotesParser
import dev.orb.app.ui.notes.NotesScreen
import dev.orb.app.ui.notes.NotesTexts
import dev.orb.app.ui.notes.NotesViewModel
import dev.orb.app.ui.theme.OrbPaletteChoice
import kotlinx.serialization.json.Json
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.GregorianCalendar
import java.util.TimeZone

/**
 * Pictures of the notices center (26) with the mockup's own notices, one per variant of the mockup plus the states it
 * leaves out: `ORB_SHOTS=1` turns them on. The notices of Android's own shade (25) are drawn by the system, so they are
 * covered by tests of the notification they build instead (`NewNoticesPosterTest`).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = Shots.PHONE)
class NotesShotsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Before fun still() {
        Settings.Global.putFloat(rule.activity.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
    }

    private val madrid = TimeZone.getTimeZone("Europe/Madrid")

    // Thursday 19 November 2026, 12:00 in Madrid.
    private val now = GregorianCalendar(madrid).apply { clear(); set(2026, 10, 19, 12, 0) }.timeInMillis
    private fun at(day: Int, hour: Int, minute: Int = 0) = GregorianCalendar(madrid).apply { clear(); set(2026, 10, day, hour, minute) }.timeInMillis

    private fun note(raw: String, at: Long) = NotesParser.fromEvent(Json.parseToJsonElement(raw), at)!!

    private fun backend(withNotes: Boolean = true, setup: (FakeNotesBackend) -> Unit = {}) = FakeNotesBackend().apply {
        connectionState.value = ConnectionState.Online("http://pc", "PC de Dani", dev.orb.app.link.net.PcVersions(1, 1, "3.8.8"))
        pcKeepsList = true
        if (withNotes) {
            feed.add(note("""{"key":"task:43","kind":"task","title":"#43 espera tu OK","body":"app-movil","card":{"method":"tasks.approve","task":43}}""", at(19, 11, 59)))
            feed.add(note("""{"key":"done:42","kind":"done","title":"Orb","body":"#42 terminada y revisada","target":{"type":"task","id":42}}""", at(19, 11, 54)))
            feed.add(note("""{"key":"held:39","kind":"held","title":"Orb","body":"Orb paró la #39 · ha eliminado 12 archivos","target":{"type":"task","id":39}}""", at(19, 9)))
            feed.add(note("""{"key":"update:3.8.9","kind":"update","title":"Orb","body":"Orb 3.8.9 disponible en el PC","target":{"type":"version","id":"3.8.9"}}""", at(18, 20)))
            feed.add(note("""{"key":"limit:claude","kind":"limit","title":"Orb","body":"Claude ya tiene límite otra vez","target":{"type":"account","id":"claude"}}""", at(18, 8)))
            // The two that arrived before the first are read already: the mockup shows three unread.
            feed.markRead(listOf(feed.rows.value[3].notice.id, feed.rows.value[4].notice.id))
        }
        setup(this)
    }

    private fun screen(palette: OrbPaletteChoice, suffix: String = "", b: FakeNotesBackend = backend(), after: () -> Unit = {}) {
        Shots.assumeEnabled()
        val vm = NotesViewModel(b)
        var dark by mutableStateOf(false)
        rule.setContent { ShotFrame(palette, dark) { NotesScreen(vm, onBack = {}, onOpen = {}, nowMs = { now }, zone = madrid) } }
        rule.waitForIdle()
        after()
        rule.waitForIdle()
        Shots.save(rule.activity, "26-avisos-${palette.key}-claro$suffix")
        dark = true
        rule.waitForIdle()
        Shots.save(rule.activity, "26-avisos-${palette.key}-oscuro$suffix")
    }

    // The variants of the mockup

    @Test fun listGrafito() = screen(OrbPaletteChoice.Grafito)
    @Test fun listOceano() = screen(OrbPaletteChoice.Oceano)
    @Test fun empty() = screen(OrbPaletteChoice.Grafito, "-vacio", backend(withNotes = false))
    @Test fun dismissed() = screen(OrbPaletteChoice.Grafito, "-descartado") {
        val action = rule.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.CustomActions)).onFirst().fetchSemanticsNode()
            .config[SemanticsActions.CustomActions].first { it.label == NotesTexts.DISMISS }
        rule.runOnUiThread { action.action() }
    }

    // What the mockup leaves out

    @Test fun withoutTheLink() = screen(OrbPaletteChoice.Grafito, "-sin-conexion", backend { it.connectionState.value = ConnectionState.Offline(null, null) })
    @Test fun emptyOfAnOlderPc() = screen(OrbPaletteChoice.Grafito, "-vacio-pc-anterior", backend(withNotes = false) { it.pcKeepsList = false })
}

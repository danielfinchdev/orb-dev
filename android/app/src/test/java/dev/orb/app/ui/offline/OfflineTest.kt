package dev.orb.app.ui.offline

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.data.LastContact
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.PcVersions
import dev.orb.app.ui.theme.MemoryStore
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.ThemeChoice
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

class OfflineTextsTest {
    private val t0 = 1_000_000_000L

    @Test fun relativeTimeInSpanish() {
        assertEquals("hace un momento", OfflineTexts.ago(t0, t0 + 30_000))
        assertEquals("hace 1 min", OfflineTexts.ago(t0, t0 + 60_000))
        assertEquals("hace 59 min", OfflineTexts.ago(t0, t0 + 59 * 60_000))
        assertEquals("hace 3 h", OfflineTexts.ago(t0, t0 + 3 * 3_600_000))
        assertEquals("hace 1 día", OfflineTexts.ago(t0, t0 + 86_400_000))
        assertEquals("hace 2 días", OfflineTexts.ago(t0, t0 + 2 * 86_400_000))
        assertEquals("hace un momento", OfflineTexts.ago(t0, t0 - 5_000))
    }

    @Test fun theLastConnectionAndTheSavedNote() {
        assertEquals("Última conexión hace 5 min", OfflineTexts.lastConnection(t0, t0 + 5 * 60_000))
        assertEquals("Aún no se ha conectado con este PC", OfflineTexts.lastConnection(null, t0))
        assertEquals("Datos guardados de hace 2 h", OfflineTexts.savedNote(t0, t0 + 2 * 3_600_000))
        assertEquals("Datos guardados en el móvil", OfflineTexts.savedNote(null, t0))
    }

    @Test fun theRetryCountdownRoundsUpAndNeverShowsZero() {
        assertEquals("Reintentando en 3 s", OfflineTexts.retryIn(t0 + 3_000, t0))
        assertEquals("Reintentando en 3 s", OfflineTexts.retryIn(t0 + 2_100, t0))
        assertEquals("Reintentando en 30 s", OfflineTexts.retryIn(t0 + 30_000, t0))
        assertEquals("Reintentando…", OfflineTexts.retryIn(t0, t0))
        assertEquals("Reintentando…", OfflineTexts.retryIn(t0 - 1, t0))
        assertEquals("Reintentando…", OfflineTexts.retryIn(null, t0))
    }
}

class LastContactTest {
    private val online = ConnectionState.Online("b", "PC", PcVersions(4, 2, "3.8.4"))

    @Test fun remembersTheMomentOfTheConnectionAndOfTheLastAnswerBeforeADrop() = runTest {
        val store = MemoryStore()
        val lc = LastContact(store)
        lc.track(flowOf(ConnectionState.Connecting, online, ConnectionState.Offline(null, 5_000L)), { 1_000L })
        assertEquals(5_000L, lc.at.value)
        assertEquals(5_000L, LastContact(store).at.value)
    }

    @Test fun anOlderMomentNeverReplacesANewerOne() {
        val lc = LastContact(MemoryStore())
        lc.record(9_000L); lc.record(2_000L)
        assertEquals(9_000L, lc.at.value)
    }

    @Test fun unlinkingForgetsIt() {
        val store = MemoryStore()
        val lc = LastContact(store)
        lc.record(9_000L)
        lc.clear()
        assertNull(lc.at.value)
        assertNull(LastContact(store).at.value)
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class OfflineStripTest {
    @get:Rule val rule = createComposeRule()
    private val now = 10_000_000L
    private val connection = MutableStateFlow<ConnectionState>(ConnectionState.Offline(now + 10_000, now - 5 * 60_000))
    private val contact = MutableStateFlow<Long?>(null)
    private var retries = 0

    private fun show() {
        val info = OfflineInfo(connection, contact, { retries++ }, clock = { now })
        rule.setContent { OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { CompositionLocalProvider(LocalOffline provides info) { OfflineStrip() } } }
        rule.waitForIdle()
    }

    @Test fun showsTheCountdownTheAgeOfTheDataAndRetriesOnTap() {
        show()
        rule.onNodeWithText("Sin conexión con el PC · Reintentando en 10 s").assertIsDisplayed()
        rule.onNodeWithText("Datos guardados de hace 5 min").assertIsDisplayed()
        rule.onNodeWithText("Reintentar ahora").performClick()
        assertEquals(1, retries)
    }

    @Test fun usesTheSavedMomentWhenTheSessionNeverReachedThePc() {
        connection.value = ConnectionState.Offline(null, null)
        contact.value = now - 2 * 3_600_000
        show()
        rule.onNodeWithText("Sin conexión con el PC · Reintentando…").assertIsDisplayed()
        rule.onNodeWithText("Datos guardados de hace 2 h").assertIsDisplayed()
    }

    @Test fun saysConnectingWhileTheLinkIsOpening() {
        connection.value = ConnectionState.Connecting
        show()
        rule.onNodeWithText("Sin conexión con el PC · Conectando…").assertIsDisplayed()
    }
}

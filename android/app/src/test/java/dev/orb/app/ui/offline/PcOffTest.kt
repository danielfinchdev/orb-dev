package dev.orb.app.ui.offline

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.PcVersions
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.TimeZone

class PcDownGateTest {
    private val online = ConnectionState.Online("b", "PC", PcVersions(4, 2, "3.8.8"))

    @Test fun anAppOpenedWithoutTheLinkShowsTheFullScreenOnceItIsOffline() {
        val g = PcDownGate()
        g.onConnection(ConnectionState.Connecting)
        assertNull(g.state.value.full)
        g.onConnection(ConnectionState.Offline(10_000, null))
        assertEquals(DownKind.PcOff, g.state.value.full)
    }

    @Test fun aDropAfterThePcAnsweredIsLeftToTheStrip() {
        val g = PcDownGate()
        g.onConnection(online)
        g.onConnection(ConnectionState.Offline(10_000, 5_000))
        g.onConnection(ConnectionState.Connecting)
        g.onConnection(ConnectionState.Offline(20_000, 5_000))
        assertEquals(PcDownState(), g.state.value)
    }

    @Test fun anAttemptInProgressKeepsTheScreenAndTheLinkComingBackClearsIt() {
        val g = PcDownGate()
        g.onConnection(ConnectionState.Offline(10_000, null))
        g.onConnection(ConnectionState.Connecting)
        assertEquals(DownKind.PcOff, g.state.value.full)
        g.onConnection(online)
        assertEquals(PcDownState(), g.state.value)
    }

    @Test fun savedChatsKeepTheAppUntilTheLinkIsBackAndThenEverythingIsNormal() {
        val g = PcDownGate()
        g.onConnection(ConnectionState.Offline(10_000, null))
        g.openSaved()
        assertEquals(PcDownState(full = null, saved = true), g.state.value)
        g.onConnection(ConnectionState.Connecting)
        g.onConnection(ConnectionState.Offline(30_000, null))
        assertEquals(true, g.state.value.saved)
        g.onConnection(online)
        assertEquals(PcDownState(), g.state.value)
        // Normal again: a later drop is a strip's business.
        g.onConnection(ConnectionState.Offline(40_000, 35_000))
        assertEquals(PcDownState(), g.state.value)
    }

    @Test fun backFromTheReadOnlyAppReturnsToTheScreenThatExplainsIt() {
        val g = PcDownGate()
        g.onConnection(ConnectionState.UpdateApp)
        g.openSaved()
        g.closeSaved()
        assertEquals(DownKind.UpdateApp, g.state.value.full)
        assertEquals(false, g.state.value.saved)
    }

    @Test fun openingSavedChatsWithoutAScreenDoesNothing() {
        val g = PcDownGate()
        g.openSaved()
        assertEquals(PcDownState(), g.state.value)
    }

    @Test fun comingBackWhileStillOfflineKeepsTheCover() {
        val g = PcDownGate()
        g.onConnection(online)
        val old = ConnectionState.Offline(10_000, 5_000)
        g.onConnection(old)
        g.reopened(old)
        assertEquals(DownKind.PcOff, g.state.value.full)
        g.onConnection(old)
        assertEquals(DownKind.PcOff, g.state.value.full)
    }

    @Test fun comingBackWhileStillOfflineFromTheSavedChatsReturnsToTheCover() {
        val g = PcDownGate()
        g.onConnection(ConnectionState.Offline(10_000, 5_000))
        g.openSaved()
        assertTrue(g.state.value.saved)
        g.reopened(ConnectionState.Offline(10_000, 5_000))
        assertEquals(PcDownState(full = DownKind.PcOff), g.state.value)
    }

    @Test fun comingBackOnALiveLinkWhileViewingSavedChatsClearsEverything() {
        val g = PcDownGate()
        g.onConnection(ConnectionState.Offline(10_000, 5_000))
        g.openSaved()
        g.reopened(online)
        assertEquals(PcDownState(), g.state.value)
    }

    @Test fun twoTapsOnUnlinkingDropTheLinkOnce() {
        val g = PcDownGate()
        val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Unconfined)
        val hold = kotlinx.coroutines.CompletableDeferred<Unit>()
        var calls = 0
        g.unlink(scope) { calls++; hold.await() }
        assertTrue(g.state.value.unlinking)
        g.unlink(scope) { calls++ }
        assertEquals(1, calls)
        hold.complete(Unit)
        g.onConnection(ConnectionState.Unlinked)
        assertEquals(PcDownState(), g.state.value)
    }

    @Test fun aNewAttemptAfterReopeningIsNewsEvenWithoutSeeingConnecting() {
        val g = PcDownGate()
        g.reopened(ConnectionState.Offline(10_000, 5_000))
        g.onConnection(ConnectionState.Offline(77_000, 5_000))
        assertEquals(DownKind.PcOff, g.state.value.full)
    }

    @Test fun reopeningOnALiveLinkSettlesIt() {
        val g = PcDownGate()
        g.onConnection(ConnectionState.Offline(10_000, null))
        g.reopened(online)
        assertEquals(PcDownState(), g.state.value)
        g.onConnection(ConnectionState.Offline(20_000, 15_000))
        assertEquals(PcDownState(), g.state.value)
    }

    @Test fun updateStatesTakeOverAtLaunchToo() {
        val g = PcDownGate()
        g.onConnection(ConnectionState.UpdatePc)
        assertEquals(DownKind.UpdatePc, g.state.value.full)
        g.onConnection(ConnectionState.Unlinked)
        assertEquals(PcDownState(), g.state.value)
    }
}

class AbsoluteTimeTest {
    private val utc = TimeZone.getTimeZone("UTC")
    private fun at(y: Int, m: Int, d: Int, h: Int, min: Int) =
        java.util.GregorianCalendar(utc).apply { clear(); set(y, m - 1, d, h, min) }.timeInMillis

    private val now = at(2026, 11, 19, 21, 0)

    @Test fun todayYesterdayAndTheDate() {
        assertEquals("hoy, 19:52", OfflineTexts.absolute(at(2026, 11, 19, 19, 52), now, utc))
        assertEquals("ayer, 08:05", OfflineTexts.absolute(at(2026, 11, 18, 8, 5), now, utc))
        assertEquals("12 nov, 19:52", OfflineTexts.absolute(at(2026, 11, 12, 19, 52), now, utc))
        assertEquals("30 dic 2025, 23:59", OfflineTexts.absolute(at(2025, 12, 30, 23, 59), now, utc))
    }

    @Test fun yesterdayAcrossAMonthEnd() {
        assertEquals("ayer, 22:00", OfflineTexts.absolute(at(2026, 10, 31, 22, 0), at(2026, 11, 1, 9, 0), utc))
    }

    @Test fun theDayFollowsThePhonesZone() {
        val madrid = TimeZone.getTimeZone("Europe/Madrid")
        // 23:30 UTC on the 18th is already 00:30 of the 19th in Madrid (winter, UTC+1).
        assertEquals("hoy, 00:30", OfflineTexts.absolute(at(2026, 11, 18, 23, 30), now, madrid))
        assertEquals("ayer, 23:30", OfflineTexts.absolute(at(2026, 11, 18, 23, 30), now, utc))
    }

    @Test fun withoutARecordItSaysSo() {
        assertEquals("Última conexión: hoy, 19:52.", OfflineTexts.lastConnectionAbsolute(at(2026, 11, 19, 19, 52), now, utc))
        assertEquals("Aún no se ha conectado con este PC.", OfflineTexts.lastConnectionAbsolute(null, now, utc))
        assertEquals("Sin conexión · solo lectura. Última conexión hoy, 19:52.", OfflineTexts.readOnlyBanner(at(2026, 11, 19, 19, 52), now, utc))
        assertTrue(OfflineTexts.readOnlyBanner(null, now, utc).startsWith("Sin conexión · solo lectura."))
    }

    @Test fun theDayTurnsAtLocalMidnight() {
        assertEquals(10 * 60_000L + 1_000, OfflineTexts.untilNextDay(at(2026, 11, 19, 23, 50), utc))
        assertEquals(24 * 3_600_000L + 1_000, OfflineTexts.untilNextDay(at(2026, 11, 19, 0, 0), utc))
        // Madrid is an hour ahead in winter: 23:30 UTC is already 00:30 there, so midnight is 23.5 h away.
        assertEquals(23 * 3_600_000L + 30 * 60_000L + 1_000, OfflineTexts.untilNextDay(at(2026, 11, 18, 23, 30), TimeZone.getTimeZone("Europe/Madrid")))
    }

    @Test fun theCountdownLineRoundsUp() {
        assertEquals("Reintento en 12 s", PcOffTexts.retryIn(now + 12_000, now))
        assertEquals("Reintento en 3 s", PcOffTexts.retryIn(now + 2_100, now))
        assertEquals("Reintentando…", PcOffTexts.retryIn(now, now))
        assertEquals("Reintentando…", PcOffTexts.retryIn(null, now))
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PcOffScreenTest {
    @get:Rule val rule = createComposeRule()
    private val now = 50_000_000L
    private val connection = MutableStateFlow<ConnectionState>(ConnectionState.Offline(now + 12_000, now - 3_600_000))
    private var retries = 0
    private var saved = 0
    private var other = 0

    private fun show(pc: String? = "DanLaptop") {
        val info = OfflineInfo(connection, MutableStateFlow(null), { retries++ }, clock = { now }, pcName = { pc })
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) { PcOffScreen(info, onSeeSaved = { saved++ }, onLinkOther = { other++ }) }
        }
        rule.waitForIdle()
    }

    @Test fun showsTheRealCountdownTheNameAndTheLastConnection() {
        show()
        rule.onNodeWithText("No llego a tu PC").assertIsDisplayed()
        rule.onNodeWithText("Reintento en 12 s").assertIsDisplayed()
        rule.onNode(hasText("DanLaptop está apagado o fuera de tu red.", substring = true)).assertIsDisplayed()
        rule.onNode(hasText("Última conexión: ", substring = true)).assertIsDisplayed()
        rule.onNodeWithText("Fuera de casa: activa Tailscale en el móvil.").assertIsDisplayed()
    }

    @Test fun withoutANameItSaysYourPc() {
        show(pc = null)
        rule.onNode(hasText("Tu PC está apagado o fuera de tu red.", substring = true)).assertIsDisplayed()
    }

    @Test fun nowRetriesForReal() {
        show()
        rule.onNodeWithText("Ahora").performClick()
        assertEquals(1, retries)
    }

    @Test fun anAttemptUnderWayHasNoCountdown() {
        connection.value = ConnectionState.Connecting
        show()
        rule.onNodeWithText("Conectando…").assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText("Ahora").fetchSemanticsNodes().size)
    }

    @Test fun seeSavedChatsEnters() {
        show()
        rule.onNodeWithText("Ver chats guardados").performClick()
        assertEquals(1, saved)
        assertEquals(0, other)
    }

    @Test fun linkingAnotherPcSaysEverythingThatIsErasedAndOnlyActsOnConfirm() {
        show()
        rule.onNodeWithText("Vincular con otro PC").performClick()
        rule.onNodeWithText("¿Vincular con otro PC?").assertIsDisplayed()
        rule.onNode(hasText("el enlace con DanLaptop", substring = true)).assertIsDisplayed()
        rule.onNode(hasText("la llave guardada", substring = true)).assertIsDisplayed()
        rule.onNode(hasText("la copia guardada en el móvil", substring = true)).assertIsDisplayed()
        rule.onNode(hasText("los mensajes sin enviar", substring = true)).assertIsDisplayed()
        assertEquals(0, other)
        rule.onNodeWithText("Cancelar").performClick()
        assertEquals(0, other)
        assertEquals(0, rule.onAllNodesWithText("¿Vincular con otro PC?").fetchSemanticsNodes().size)
        rule.onNodeWithText("Vincular con otro PC").performClick()
        rule.onNodeWithText("Vincular").performClick()
        assertEquals(1, other)
    }

    @Test fun theReadOnlyBarReadsTodayAgainWhenTheDayTurns() {
        val saved = TimeZone.getDefault()
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
        try {
            val seen = java.util.GregorianCalendar(TimeZone.getTimeZone("UTC")).apply { clear(); set(2026, 10, 19, 19, 52) }.timeInMillis
            var clockNow = seen + 4 * 3_600_000L // 23:52
            val info = OfflineInfo(MutableStateFlow(ConnectionState.Offline(null, seen)), MutableStateFlow(seen), {}, clock = { clockNow })
            rule.mainClock.autoAdvance = false
            rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { ReadOnlyBar(info, onBack = {}) } }
            rule.mainClock.advanceTimeByFrame()
            rule.onNode(hasText("hoy, 19:52", substring = true)).assertIsDisplayed()
            clockNow += 30 * 60_000L
            rule.mainClock.advanceTimeBy(30 * 60_000L)
            rule.onNode(hasText("ayer, 19:52", substring = true)).assertIsDisplayed()
        } finally {
            TimeZone.setDefault(saved)
        }
    }
}

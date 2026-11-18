package dev.orb.app.ui.chats

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.OrbPaletteChoice
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.GregorianCalendar

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PendingRowTest {
    @get:Rule val rule = createComposeRule()
    private var retried = 0
    private var discarded = 0

    /** 14:41 on the phone's own clock, the hour the message was written. */
    private val wroteAt = GregorianCalendar().apply { set(2026, 10, 18, 14, 41, 0) }.timeInMillis

    private fun show(state: PendingState, online: Boolean, error: String? = null, link: ConnectionState? = null) {
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                PendingRow(PendingMessage("c1", "¿Lo subes a dev?", state, error, wroteAt), online, { retried++ }, { discarded++ }, connection = link)
            }
        }
        rule.waitForIdle()
    }

    @Test fun aWaitingMessageSaysItIsSentWhenTheConnectionReturnsWithTheHourItWasWritten() {
        show(PendingState.Waiting, online = false, link = ConnectionState.Offline(null, null))
        rule.onNodeWithText("¿Lo subes a dev?").assertIsDisplayed()
        rule.onNodeWithText(ChatTexts.PENDING_WAITING).assertIsDisplayed()
        rule.onNodeWithText("Se enviará al volver").assertIsDisplayed()
        // The hour of writing, not the one of sending.
        rule.onNodeWithText("14:41").assertIsDisplayed()
    }

    @Test fun aSendingMessageSaysSo() {
        show(PendingState.Sending, online = true, link = ONLINE_LINK)
        rule.onNodeWithText(ChatTexts.PENDING_SENDING).assertIsDisplayed()
    }

    @Test fun aWaitingMessageWithTheLinkUpIsBeingSent() {
        show(PendingState.Waiting, online = true, link = ONLINE_LINK)
        rule.onNodeWithText("Enviando…").assertIsDisplayed()
    }

    @Test fun aMessageTheLinkCannotCarryDoesNotPromiseToSend() {
        show(PendingState.Waiting, online = false, link = ConnectionState.UpdatePc)
        rule.onNodeWithText("No saldrá hasta actualizar Orb en el PC").assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText("Se enviará al volver").fetchSemanticsNodes().size)
    }

    @Test fun anUnlinkedPhoneSaysThePendingMessageWillNotLeave() {
        show(PendingState.Waiting, online = false, link = ConnectionState.Unlinked)
        rule.onNodeWithText("No saldrá: el móvil ya no está enlazado").assertIsDisplayed()
    }

    @Test fun aMessageThePcTookHasOneTickAndTheHourItWasWritten() {
        show(PendingState.Arrived, online = true, link = ONLINE_LINK)
        rule.onNodeWithText("¿Lo subes a dev?").assertIsDisplayed()
        rule.onNodeWithContentDescription("14:41, Enviado").assertIsDisplayed()
    }

    @Test fun aFailedMessageIsKeptAndCanBeRetriedOrDiscarded() {
        show(PendingState.Failed, online = true, error = "refused 400", link = ONLINE_LINK)
        rule.onNodeWithText(ChatTexts.pendingFailed("refused 400")).assertIsDisplayed()
        rule.onNodeWithText("No enviado: refused 400").assertIsDisplayed()
        rule.onNodeWithText(ChatTexts.PENDING_KEPT).assertIsDisplayed()
        rule.onNodeWithText("Reintentar").performClick()
        rule.onNodeWithText("Descartar").performClick()
        assertEquals(1, retried)
        assertEquals(1, discarded)
    }

    private companion object {
        val ONLINE_LINK = dev.orb.app.data.ONLINE
    }
}

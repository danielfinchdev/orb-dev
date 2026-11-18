package dev.orb.app.ui.chats

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.OrbPaletteChoice
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PendingRowTest {
    @get:Rule val rule = createComposeRule()
    private var retried = 0
    private var discarded = 0

    private fun show(state: PendingState, online: Boolean, error: String? = null) {
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                PendingRow(PendingMessage("c1", "¿Lo subes a dev?", state, error, 0L), online, { retried++ }, { discarded++ })
            }
        }
        rule.waitForIdle()
    }

    @Test fun aWaitingMessageSaysItLeavesWhenTheConnectionReturns() {
        show(PendingState.Waiting, online = false)
        rule.onNodeWithText("¿Lo subes a dev?").assertIsDisplayed()
        rule.onNodeWithText(ChatTexts.PENDING_WAITING).assertIsDisplayed()
    }

    @Test fun aSendingMessageSaysSo() {
        show(PendingState.Sending, online = true)
        rule.onNodeWithText(ChatTexts.PENDING_SENDING).assertIsDisplayed()
    }

    @Test fun aFailedMessageIsKeptAndCanBeRetriedOrDiscarded() {
        show(PendingState.Failed, online = true, error = "refused 400")
        rule.onNodeWithText(ChatTexts.pendingFailed("refused 400")).assertIsDisplayed()
        rule.onNodeWithText(ChatTexts.PENDING_KEPT).assertIsDisplayed()
        rule.onNodeWithText("Reintentar").performClick()
        rule.onNodeWithText("Descartar").performClick()
        assertEquals(1, retried)
        assertEquals(1, discarded)
    }
}

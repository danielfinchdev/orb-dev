package dev.orb.app.ui.chats

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The notice under a chat when a message turns failed while it is open: once, and without promising a retry. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w390dp-h844dp")
class FailedSendNoticeTest {
    @get:Rule val rule = createComposeRule()

    private fun failed(id: String) = PendingMessage(id, "texto $id", PendingState.Failed, "refused 400", 1)

    @Test fun aMessageTurningFailedSaysSoOnceAndOneAlreadyFailedDoesNot() {
        val b = FakeOrbeChatBackend(listOf(raw(1, "usuario", "Hola")))
        b.queue.value = listOf(failed("a"))
        val vm = OrbeChatViewModel(b, 7, dispatcher = Dispatchers.Unconfined)
        rule.mainClock.autoAdvance = false
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { OrbeChatScreen(vm, onBack = {}, liveRefreshMs = 0) } }
        rule.mainClock.advanceTimeBy(300)
        assertEquals(0, rule.onAllNodesWithText(ChatTexts.SEND_FAILED_SNACK).fetchSemanticsNodes().size)

        b.queue.value = listOf(failed("a"), failed("b"))
        rule.mainClock.advanceTimeBy(300)
        rule.onNodeWithText(ChatTexts.SEND_FAILED_SNACK).assertIsDisplayed()
        assertEquals(0, rule.onAllNodesWithText("Reintentando", substring = true).fetchSemanticsNodes().size)
        // The notice is not asked for again by a redraw of the same failures.
        b.queue.value = listOf(failed("a"), failed("b").copy(error = "refused 500"))
        rule.mainClock.advanceTimeBy(6_000)
        assertEquals(0, rule.onAllNodesWithText(ChatTexts.SEND_FAILED_SNACK).fetchSemanticsNodes().size)
    }
}

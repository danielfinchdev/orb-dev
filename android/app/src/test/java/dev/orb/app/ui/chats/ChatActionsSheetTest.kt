package dev.orb.app.ui.chats

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import java.util.TimeZone
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Screen 10: the sheet of a chat, its three lists, and what each choice asks of the PC. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w390dp-h844dp")
class ChatActionsSheetTest {
    @get:Rule val rule = createComposeRule()

    private val clockMs = 1_000_000L

    private fun open(b: FakeChatsBackend, title: String = "Revisar pasarela") {
        val vm = ChatListViewModel(b, dispatcher = Dispatchers.Unconfined, clock = { clockMs })
        rule.setContent {
            OrbTheme(OrbPaletteChoice.Grafito, dark = false) {
                ChatListScreen(vm, ChatsMenu(onMenu = {}), onOpenChat = {}, onSearch = {}, onNewChat = {})
            }
        }
        rule.waitForIdle()
        rule.onNodeWithText(title).performTouchInput { longClick() }
        rule.waitForIdle()
    }

    private fun top(text: String) = rule.onNodeWithText(text).getBoundsInRoot().top.value

    private val chat = row("2", title = "Revisar pasarela", project = "api-pagos", unread = 1)

    @Test fun theMainListFollowsTheMockupsOrder() {
        val b = FakeChatsBackend(listOf(chat)).apply { trashAvailable = true }
        open(b)
        val order = listOf(
            ChatTexts.PIN, ChatTexts.MARK_READ, ChatTexts.MUTE, ChatTexts.SNOOZE, ChatTexts.MOVE_SECTION, ChatTexts.RENAME,
            ChatTexts.ARCHIVE, ChatTexts.MORE_OPTIONS, ChatTexts.DELETE,
        )
        val tops = order.map { top(it) }
        assertEquals(tops.sorted(), tops)
        // The header says the agent's chat, its project and the mode.
        rule.onNodeWithText("Api-pagos · con Orbe").assertIsDisplayed()
        rule.onNodeWithText(ChatTexts.MUTE_META).assertIsDisplayed()
    }

    private fun muteWith(choice: String, expected: String) {
        val b = FakeChatsBackend(listOf(chat))
        open(b)
        rule.onNodeWithText(ChatTexts.MUTE).performClick(); rule.waitForIdle()
        rule.onNodeWithText(ChatTexts.MUTE_TITLE).assertIsDisplayed()
        rule.onNodeWithText(choice).performClick(); rule.waitForIdle()
        assertEquals(listOf(expected), b.calls)
    }

    @Test fun silencingForAnHourSendsItsEnd() = muteWith(ChatTexts.MUTE_1H, "mute conversation:2 true ${ChatTime.iso(clockMs + 3_600_000L)}")
    @Test fun silencingForEightHoursSendsItsEnd() = muteWith(ChatTexts.MUTE_8H, "mute conversation:2 true ${ChatTime.iso(clockMs + 8 * 3_600_000L)}")
    @Test fun silencingForeverSendsNoEnd() = muteWith(ChatTexts.MUTE_ALWAYS, "mute conversation:2 true null")

    @Test fun aMutedChatOffersToLiftItAndSaysUntilWhen() {
        val until = ChatTime.iso(System.currentTimeMillis() + 2 * 3_600_000L)
        val b = FakeChatsBackend(listOf(chat.copy(muted = true, mutedUntil = until)))
        open(b)
        rule.onNodeWithText(ChatTexts.UNMUTE).assertIsDisplayed()
        assertTrue(rule.onAllNodes(androidx.compose.ui.test.hasText("Hasta", substring = true)).fetchSemanticsNodes().isNotEmpty())
        rule.onNodeWithText(ChatTexts.UNMUTE).performClick(); rule.waitForIdle()
        assertEquals(listOf("mute conversation:2 false null"), b.calls)
    }

    @Test fun anOlderPcOnlyMutesForGood() {
        val b = FakeChatsBackend(listOf(chat)).apply { newPc = false }
        open(b)
        rule.onNodeWithText(ChatTexts.MUTE).performClick(); rule.waitForIdle()
        rule.onNodeWithText(ChatTexts.MUTE_ALWAYS).assertIsDisplayed()
        assertTrue(rule.onAllNodes(androidx.compose.ui.test.hasText(ChatTexts.MUTE_1H)).fetchSemanticsNodes().isEmpty())
    }

    @Test fun snoozeOffersTheThreeMockupChoices() {
        val b = FakeChatsBackend(listOf(chat))
        open(b)
        rule.onNodeWithText(ChatTexts.SNOOZE).performClick(); rule.waitForIdle()
        rule.onNodeWithText(ChatTexts.SNOOZE_TITLE).assertIsDisplayed()
        rule.onNodeWithText(ChatTexts.SNOOZE_1H).assertIsDisplayed()
        rule.onNodeWithText(ChatTexts.SNOOZE_TOMORROW).assertIsDisplayed()
        // «Esta tarde» depends on the real clock of the test machine; its own rule is checked on fixed times below.
        rule.onNodeWithText(ChatTexts.SNOOZE_1H).performClick(); rule.waitForIdle()
        assertEquals(listOf("snooze conversation:2 ${ChatTime.iso(clockMs + 3_600_000L)}"), b.calls)
    }

    @Test fun thisAfternoonIsOfferedOnlyBeforeThree() {
        val tz = TimeZone.getTimeZone("Europe/Madrid")
        fun at(h: Int, m: Int) = java.util.GregorianCalendar(tz).apply { clear(); set(2026, 10, 18, h, m) }.timeInMillis
        assertTrue(ChatTime.afternoonOffered(at(9, 0), tz))
        assertTrue(ChatTime.afternoonOffered(at(14, 59), tz))
        assertFalse(ChatTime.afternoonOffered(at(15, 0), tz))
        assertFalse(ChatTime.afternoonOffered(at(18, 30), tz))
        assertEquals("2026-11-18T15:00:00.000Z", ChatTime.thisAfternoon(at(9, 0), tz))
        assertEquals("2026-11-19T08:00:00.000Z", ChatTime.tomorrowMorning(at(18, 30), tz))
    }

    @Test fun anAppliedSnoozeCanBeLiftedAndSaysWhen() {
        val until = ChatTime.iso(System.currentTimeMillis() + 3 * 3_600_000L)
        val b = FakeChatsBackend(listOf(chat.copy(snoozedUntil = until)))
        open(b)
        rule.onNodeWithText(ChatTexts.SNOOZE).performClick(); rule.waitForIdle()
        rule.onNodeWithText(ChatTexts.UNSNOOZE).performClick(); rule.waitForIdle()
        assertEquals(listOf("snooze conversation:2 null"), b.calls)
    }

    @Test fun aReadChatCanBeMarkedUnread() {
        val b = FakeChatsBackend(listOf(chat.copy(unread = 0)))
        open(b)
        rule.onNodeWithText(ChatTexts.MARK_UNREAD).performClick(); rule.waitForIdle()
        assertEquals(listOf("unread conversation:2"), b.calls)
    }

    @Test fun anUnreadChatCanBeMarkedRead() {
        val b = FakeChatsBackend(listOf(chat))
        open(b)
        rule.onNodeWithText(ChatTexts.MARK_READ).performClick(); rule.waitForIdle()
        assertEquals(listOf("read conversation:2"), b.calls)
    }

    @Test fun markUnreadIsNotOfferedByAnOlderPc() {
        val b = FakeChatsBackend(listOf(chat.copy(unread = 0))).apply { newPc = false }
        open(b)
        assertTrue(rule.onAllNodes(androidx.compose.ui.test.hasText(ChatTexts.MARK_UNREAD)).fetchSemanticsNodes().isEmpty())
    }

    @Test fun movingToASectionListsEveryChoice() {
        val b = FakeChatsBackend(listOf(chat), sections = listOf(ChatSection(7, "Pagos", 0, 0, 0)))
        open(b)
        rule.onNodeWithText(ChatTexts.MOVE_SECTION).performClick(); rule.waitForIdle()
        rule.onNodeWithText(ChatTexts.NO_SECTION).assertIsDisplayed()
        rule.onNodeWithText(ChatTexts.NEW_SECTION).assertIsDisplayed()
        rule.onNodeWithText("Pagos").performClick(); rule.waitForIdle()
        assertEquals(listOf("move conversation:2 7"), b.calls)
    }

    @Test fun deletingLivesUnderMoreOptionsAndAsksBeforeRunning() {
        val b = FakeChatsBackend(listOf(chat)).apply { trashAvailable = true }
        open(b)
        rule.onNodeWithText(ChatTexts.MORE_OPTIONS).assertIsDisplayed()
        rule.onNodeWithText(ChatTexts.DELETE).performClick(); rule.waitForIdle()
        assertTrue("nothing runs before the person accepts", b.calls.isEmpty())
        rule.onNodeWithText(ChatTexts.DELETE_TITLE).assertIsDisplayed()
        rule.onNodeWithText(ChatTexts.DELETE_CONFIRM).performClick(); rule.waitForIdle()
        assertEquals(listOf("trash conversation:2"), b.calls)
    }

    @Test fun withoutTrashThereIsNoMoreOptionsSection() {
        val b = FakeChatsBackend(listOf(chat))
        open(b)
        assertTrue(rule.onAllNodes(androidx.compose.ui.test.hasText(ChatTexts.DELETE)).fetchSemanticsNodes().isEmpty())
    }

    @Test fun renamingAsksForTheTitleInADialog() {
        val b = FakeChatsBackend(listOf(chat))
        open(b)
        rule.onNodeWithText(ChatTexts.RENAME).performClick(); rule.waitForIdle()
        rule.onNodeWithText(ChatTexts.SAVE).assertIsDisplayed()
        // The dialog replaces the sheet instead of standing over it; Cancel brings the actions back.
        rule.onNodeWithText(ChatTexts.ARCHIVE).assertDoesNotExist()
        rule.onNodeWithText(ChatTexts.CANCEL).performClick(); rule.waitForIdle()
        rule.onNodeWithText(ChatTexts.ARCHIVE).assertIsDisplayed()
        assertTrue(b.calls.isEmpty())
    }
}

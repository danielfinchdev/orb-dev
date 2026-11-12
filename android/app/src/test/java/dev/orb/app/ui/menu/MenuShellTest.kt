package dev.orb.app.ui.menu

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.orb.app.ui.chats.FakeChatsBackend
import dev.orb.app.ui.notes.FakeNotesBackend
import dev.orb.app.ui.notes.notice
import dev.orb.app.ui.shell.MainShell
import dev.orb.app.ui.shell.ShellActions
import dev.orb.app.ui.theme.MemoryStore
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.ThemeChoice
import dev.orb.app.ui.theme.ThemePrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class MenuShellTest {
    @get:Rule val rule = createComposeRule()

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    private fun show(notes: FakeNotesBackend?, actions: ShellActions) {
        rule.setContent {
            OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) {
                MainShell(FakeChatsBackend(), ThemePrefs(MemoryStore()), actions, Dispatchers.Unconfined, notes = notes)
            }
        }
        rule.waitForIdle()
    }

    @Test fun theMenuButtonOpensTheSheetAndAnEntryNavigates() {
        var went = ""
        show(null, ShellActions({}, {}, {}, {}, {}, {}, onSchedules = { went = "schedules" }))
        rule.onNodeWithContentDescription("Menú").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Programadas").performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals("schedules", went)
    }

    @Test fun theBellCountsUnreadNoticesAndOpensTheCenter() {
        val notes = FakeNotesBackend()
        notes.feed.add(notice("a"))
        notes.feed.add(notice("b", at = 5))
        var opened = 0
        show(notes, ShellActions({}, {}, {}, {}, {}, {}, onNotices = { opened++ }))
        rule.onNode(hasContentDescription("Avisos, 2 sin leer")).assertIsDisplayed()
        rule.onNode(hasContentDescription("Avisos, 2 sin leer")).performClick()
        assertEquals(1, opened)
    }

    @Test fun withoutANoticesBackendThereIsNoBell() {
        show(null, ShellActions({}, {}, {}, {}, {}, {}))
        rule.onNode(hasContentDescription("Avisos")).assertDoesNotExist()
    }
}


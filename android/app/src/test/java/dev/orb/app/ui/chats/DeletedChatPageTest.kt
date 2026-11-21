package dev.orb.app.ui.chats

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DeletedChatPageTest {
    @get:Rule val rule = createComposeRule()

    private fun show(restore: (() -> Unit)?, back: () -> Unit = {}) {
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { DeletedChatPage(back, restore) } }
        rule.waitForIdle()
    }

    @Test fun saysTheChatIsGoneAndLeadsToTheList() {
        var back = 0
        show(restore = null, back = { back++ })
        rule.onNodeWithText("Este chat ya no existe").assertIsDisplayed()
        rule.onNodeWithText("Se borró en el PC.").assertIsDisplayed()
        // Nothing here moves the person by itself, so the page does not say it will.
        assertEquals(0, rule.onAllNodesWithText("Te llevo", substring = true).fetchSemanticsNodes().size)
        assertEquals(0, rule.onAllNodesWithText(ChatTexts.RESTORE_ASK).fetchSemanticsNodes().size)
        rule.onNodeWithText("Ir a Chats").performClick()
        assertEquals(1, back)
    }

    @Test fun keepsAskingThePcToRestoreAsTheSecondChoice() {
        var back = 0
        var restore = 0
        show(restore = { restore++ }, back = { back++ })
        rule.onNodeWithText("Ir a Chats").assertIsDisplayed()
        rule.onNodeWithText("Pedir al PC que lo restaure").performClick()
        assertEquals(1, restore)
        assertEquals(0, back)
        rule.onNodeWithText("Ir a Chats").performClick()
        assertEquals(1, back)
    }
}

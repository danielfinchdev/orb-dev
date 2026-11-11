package dev.orb.app.ui.chats

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.ThemeChoice
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NewChatScreenTest {
    @get:Rule val rule = createComposeRule()

    private fun screen(b: FakeNewChatBackend, created: MutableList<NewChatCreated> = ArrayList()): NewChatViewModel {
        val vm = NewChatViewModel(b)
        rule.setContent {
            OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { NewChatScreen(vm, onClose = {}, onCreated = { created += it }) }
        }
        rule.waitForIdle()
        return vm
    }

    @Test fun a30PaintsOrbeAgentsProjectAndBrain() {
        screen(FakeNewChatBackend())
        rule.onNodeWithText("Nuevo chat").assertIsDisplayed()
        rule.onNodeWithText("Se crea en el PC").assertIsDisplayed()
        rule.onNodeWithText("¿Con quién quieres hablar?").assertIsDisplayed()
        rule.onNodeWithText("Orbe").assertIsDisplayed()
        rule.onNodeWithText("Recomendado").assertIsDisplayed()
        rule.onNodeWithText("Claude Code").assertIsDisplayed()
        rule.onNodeWithText("Codex").assertIsDisplayed()
        rule.onNodeWithText("Dónde y con qué").assertExists()
        rule.onNodeWithText("Proyecto").assertExists()
        rule.onNodeWithText("tienda-online · activo en el PC").assertExists()
        rule.onNodeWithText("Cerebro").assertExists()
        rule.onNodeWithText("El que usa el PC").assertExists()
        rule.onNodeWithText("Crear el chat en el PC").assertIsNotEnabled()
    }

    @Test fun choosingAnAgentSwitchesTheBrainRowToItsModel() {
        val vm = screen(FakeNewChatBackend())
        rule.onNodeWithText("Claude Code").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Modelo").assertExists()
        assertEquals("claude", vm.state.value.agent)
    }

    @Test fun theBrainSheetListsModelsWithTheRecommendedOne() {
        val vm = screen(FakeNewChatBackend())
        rule.onNodeWithText("Cerebro").performScrollTo().performClick()
        rule.waitForIdle()
        val rowsOfClaude = rule.onAllNodesWithText("Claude Code")
        // The sheet is its own window: its row is the second «Claude Code», after the card behind it.
        assertEquals(2, rowsOfClaude.fetchSemanticsNodes().size)
        rowsOfClaude[1].performClick()
        rule.waitForIdle()
        assertEquals("claude", vm.state.value.brainAgent)
        rule.onNodeWithText("Opus").assertExists()
        assertEquals(2, rule.onAllNodesWithText("Recomendado").fetchSemanticsNodes().size)
        rule.onNodeWithText("Opus").performClick()
        rule.waitForIdle()
        assertEquals("opus", vm.state.value.model)
    }

    @Test fun writingAndCreatingSendsToThePc() {
        val b = FakeNewChatBackend()
        val created = ArrayList<NewChatCreated>()
        screen(b, created)
        rule.onNode(hasSetTextAction()).performTextInput("Haz el carrito")
        rule.onNodeWithText("Crear el chat en el PC").assertIsEnabled().performClick()
        rule.waitForIdle()
        assertEquals(listOf(NewChatCreated("conversation", "41")), created)
    }

    @Test fun withoutTheLinkTheButtonIsDisabledAndSaysWhy() {
        val b = FakeNewChatBackend()
        b.connectionState.value = ConnectionState.Offline(null, null)
        screen(b)
        rule.onNode(hasSetTextAction()).performTextInput("hola")
        rule.onNodeWithText("Sin conexión con el PC").assertIsDisplayed()
        rule.onNodeWithText("Crear el chat en el PC").assertIsNotEnabled()
    }
}

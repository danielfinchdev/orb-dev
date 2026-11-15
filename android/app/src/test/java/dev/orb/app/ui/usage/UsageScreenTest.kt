package dev.orb.app.ui.usage

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.ThemeChoice
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
class UsageScreenTest {
    @get:Rule val rule = createComposeRule()

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    private fun show(b: FakeUsageBackend) {
        val vm = UsageViewModel(b)
        rule.setContent { OrbTheme(ThemeChoice.Orbita, dark = false, dynamic = false) { UsageScreen(vm, onBack = {}, nowMs = { 0L }) } }
        rule.waitForIdle()
    }

    @Test fun showsAccountsWindowsSpendAgentsAndGuide() {
        show(FakeUsageBackend())
        rule.onNodeWithText("Límites de las cuentas").assertIsDisplayed()
        rule.onNodeWithText("Claude · Max").assertIsDisplayed()
        rule.onNodeWithText("Límite de sesión").assertIsDisplayed()
        rule.onNodeWithText("40 %").assertExists()
        for (t in listOf("Gasto", "Instalado", "No instalado", "Modelos por tipo de tarea")) {
            rule.onNode(hasScrollAction()).performScrollToNode(hasText(t))
            rule.onNodeWithText(t).assertIsDisplayed()
        }
    }

    @Test fun updateButtonAsksThePcToRefresh() {
        val b = FakeUsageBackend()
        show(b)
        b.calls.clear()
        rule.onNodeWithText("Actualizar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("refresh", "accounts"), b.calls)
    }

    @Test fun periodChipReadsAnotherPeriod() {
        val b = FakeUsageBackend()
        show(b)
        rule.onNodeWithText("7 días").performClick()
        rule.waitForIdle()
        assertEquals("history 7", b.calls.last())
    }
}

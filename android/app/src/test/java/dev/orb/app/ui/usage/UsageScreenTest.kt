package dev.orb.app.ui.usage

import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.coroutines.CompletableDeferred
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
import java.util.TimeZone

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class UsageScreenTest {
    @get:Rule val rule = createComposeRule()

    @Before fun setUp() = Dispatchers.setMain(Dispatchers.Unconfined)
    @After fun tearDown() = Dispatchers.resetMain()

    private val utc = TimeZone.getTimeZone("UTC")

    // Thursday 12 November 2026, 12:00 UTC: the sample history ends the day before.
    private val now = 1_794_484_800_000L

    private fun show(b: FakeUsageBackend, sheet: UsageSheet? = null) {
        val vm = UsageViewModel(b)
        rule.setContent { OrbTheme(OrbPaletteChoice.Grafito, dark = false) { UsageScreen(vm, onBack = {}, nowMs = { now }, zone = utc, startSheet = sheet) } }
        rule.waitForIdle()
    }

    private fun scrollTo(text: String) = rule.onNode(hasScrollAction()).performScrollToNode(hasText(text))

    private fun hasBar(fraction: Float) = SemanticsMatcher.expectValue(SemanticsProperties.ProgressBarRangeInfo, ProgressBarRangeInfo(fraction, 0f..1f))

    @Test fun showsAccountsBarsLinksAgentsAndTheFootnote() {
        show(FakeUsageBackend())
        rule.onNodeWithText("Uso por cuenta").assertIsDisplayed()
        rule.onNodeWithText("Claude · Max").assertIsDisplayed()
        rule.onNodeWithText("Límite de sesión", substring = true).assertIsDisplayed()
        rule.onNodeWithText("40 %").assertExists()
        for (t in listOf("Historial de uso", "Guía de modelos", "Agentes en tu PC", "Iniciar sesión, cuentas y planes: en el PC.")) {
            scrollTo(t)
            rule.onNodeWithText(t).assertIsDisplayed()
        }
    }

    @Test fun everyBarSaysItsValueToAScreenReader() {
        val b = FakeUsageBackend()
        b.accountList = Result.success(listOf(account("claude", 0.94), account("otra", 0.38).copy(label = "ChatGPT", plan = "Pro")))
        show(b)
        rule.onNode(hasContentDescription("Claude · Max: 94 %") and hasBar(0.94f)).assertExists()
        rule.onNode(hasContentDescription("ChatGPT · Pro: 38 %") and hasBar(0.38f)).assertExists()
    }

    @Test fun headerTellsTheWindowAndWhenItReturnsInThePhonesZone() {
        val b = FakeUsageBackend()
        b.accountList = Result.success(listOf(account("claude", 0.5, resetAt = now + 3 * 3_600_000L)))
        show(b)
        rule.onNodeWithText("Esta ventana de 5 h · vuelve 15:00").assertIsDisplayed()
    }

    @Test fun headerLeavesTheLengthOutWhenThePcDoesNotNameIt() {
        val b = FakeUsageBackend()
        b.accountList = Result.success(listOf(account("claude", 0.5).copy(windows = listOf(UsageWindow("cycle", 0.5, now + 3_600_000L)))))
        show(b)
        rule.onNodeWithText("Esta ventana · vuelve 13:00").assertIsDisplayed()
    }

    @Test fun headerIsAbsentWithoutAResetTime() {
        show(FakeUsageBackend())
        rule.onAllNodesWithText("Esta ventana", substring = true).assertCountEquals(0)
    }

    @Test fun tasksPauseAndAnAccountWithoutLimitsKeepTheirLines() {
        val b = FakeUsageBackend()
        b.accountList = Result.success(
            listOf(
                account("claude", 0.9).copy(used = 3, max = 8, windowHours = 5, cooldownUntil = now + 3_600_000L, cooldownReason = "Uso agotado"),
                account("sin", 0.0).copy(label = "Cursor", plan = null, windows = emptyList()),
            ),
        )
        show(b)
        rule.onNodeWithText("3 de 8").assertExists()
        rule.onNodeWithText("Tareas · ventana de 5 h").assertExists()
        rule.onNodeWithText("En pausa hasta", substring = true).assertExists()
        rule.onNodeWithText("Los límites aparecerán cuando los agentes respondan.").assertExists()
    }

    @Test fun agentsShowOnlyWhatOrbDetectsWithEachState() {
        val b = FakeUsageBackend()
        b.agentList = Result.success(
            listOf(
                AgentInfo("claude", "Claude Code", true, true, "2.1.0", "si"),
                AgentInfo("codex", "Codex", true, true, null, "no"),
                AgentInfo("cursor", "Cursor", true, true, null, null),
                AgentInfo("acp", "Otro agente", true, false, null, "si"),
                AgentInfo("zz", "Sin instalar", false, false, null, null),
            ),
        )
        show(b)
        scrollTo("Sin instalar")
        for (t in listOf("Listo", "Sin sesión", "Sesión sin comprobar", "Desactivado", "No instalado")) rule.onAllNodesWithText(t, substring = false).assertCountAtLeast1()
        rule.onAllNodesWithText("Gemini (ACP)").assertCountEquals(0)
    }

    private fun androidx.compose.ui.test.SemanticsNodeInteractionCollection.assertCountAtLeast1() {
        check(fetchSemanticsNodes().isNotEmpty()) { "no node" }
    }

    @Test fun updateButtonAsksThePcToRefresh() {
        val b = FakeUsageBackend()
        show(b)
        b.calls.clear()
        rule.onNodeWithContentDescription("Actualizar").performClick()
        rule.waitForIdle()
        assertEquals(listOf("refresh", "accounts"), b.calls)
    }

    @Test fun whileUpdatingTheBandSaysSo() {
        val b = FakeUsageBackend()
        show(b)
        b.refreshGate = CompletableDeferred()
        rule.onNodeWithContentDescription("Actualizar").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Actualizando el uso…").assertIsDisplayed()
        rule.onNodeWithContentDescription("Actualizando…").assertIsNotEnabled()
        b.refreshGate!!.complete(Unit)
        rule.waitForIdle()
        rule.onAllNodesWithText("Actualizando el uso…").assertCountEquals(0)
    }

    @Test fun historySheetShowsTheRealSpendPerDayWithoutAnyPercentage() {
        val b = FakeUsageBackend()
        b.accountList = Result.success(emptyList())
        show(b)
        rule.onNodeWithText("Historial de uso").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Gasto por día").assertIsDisplayed()
        rule.onNodeWithText("Ayer").assertIsDisplayed()
        rule.onNodeWithText("$7,50").assertIsDisplayed()
        rule.onNodeWithText("Anteayer").assertIsDisplayed()
        rule.onNodeWithText("$5,00").assertIsDisplayed()
        rule.onAllNodesWithText("%", substring = true).assertCountEquals(0)
        rule.onNode(hasContentDescription("Ayer: $7,50") and hasBar(1f)).assertExists()
        rule.onNode(hasContentDescription("Anteayer: $5,00") and hasBar(5f / 7.5f)).assertExists()
        rule.onNodeWithText("Total de 30 días", substring = true).assertIsDisplayed()
    }

    @Test fun historySheetChangesThePeriod() {
        val b = FakeUsageBackend()
        show(b, UsageSheet.History)
        rule.onNodeWithText("7 días").performClick()
        rule.waitForIdle()
        assertEquals("history 7", b.calls.last())
        rule.onNodeWithText("90 días").performClick()
        rule.waitForIdle()
        assertEquals("history 90", b.calls.last())
    }

    @Test fun historySheetSaysWhenNothingWasSpent() {
        val b = FakeUsageBackend()
        b.historyResult = { Result.success(sampleHistory(it, 0.0).copy(byDay = listOf(DaySpend("2026-11-11", 0.0, 0)))) }
        show(b, UsageSheet.History)
        rule.onNodeWithText("Sin gasto en este periodo.").assertIsDisplayed()
    }

    @Test fun guideSheetListsEveryModelThePcGives() {
        val b = FakeUsageBackend()
        b.guideList = Result.success(
            listOf(
                ModelGuideAgent(
                    "claude", "Claude Code",
                    listOf("light" to listOf("Haiku"), "balanced" to listOf("Sonnet", "Sonnet 4"), "heavy" to listOf("Opus", "Opus 4", "Fable")),
                    listOf(ModelPick("simple", "Haiku", null), ModelPick("normal", "Sonnet", "medium"), ModelPick("complejo", "Opus", "high")),
                ),
            ),
        )
        show(b)
        scrollTo("Guía de modelos")
        rule.onNodeWithText("Guía de modelos").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Qué modelo elegir").assertIsDisplayed()
        rule.onNodeWithText("Para lo complejo · Razonamiento alto").assertIsDisplayed()
        rule.onNodeWithText("Todos los modelos").assertIsDisplayed()
        rule.onNodeWithText("Opus, Opus 4, Fable").assertExists()
        rule.onNodeWithText("Sonnet, Sonnet 4").assertExists()
    }

    @Test fun moreOptionsKeepsTheWholeSpendCard() {
        show(FakeUsageBackend())
        scrollTo("Más opciones")
        rule.onNodeWithText("Más opciones").performClick()
        rule.waitForIdle()
        for (t in listOf("Gasto", "Coste", "Tokens de entrada", "Tokens de salida", "Turnos", "Uso por día", "Por agente")) {
            scrollTo(t)
            rule.onNodeWithText(t).assertIsDisplayed()
        }
    }

    @Test fun periodControlOfMoreOptionsReadsAnotherPeriod() {
        val b = FakeUsageBackend()
        show(b)
        scrollTo("Más opciones")
        rule.onNodeWithText("Más opciones").performClick()
        rule.waitForIdle()
        scrollTo("7 días")
        rule.onNodeWithText("7 días").performClick()
        rule.waitForIdle()
        assertEquals("history 7", b.calls.last())
    }

    @Test fun loadingShowsNoContentYet() {
        val b = FakeUsageBackend()
        b.accountsGate = CompletableDeferred()
        b.unavailable = setOf(ApiMethods.USAGE_HISTORY.name, ApiMethods.AGENTS_STATUS.name, ApiMethods.MODELS_GUIDE.name)
        show(b)
        rule.onAllNodesWithText("Uso por cuenta").assertCountEquals(0)
    }

    @Test fun failureOfEverythingOffersToTryAgain() {
        val b = FakeUsageBackend()
        val boom = Result.failure<Nothing>(IllegalStateException("x"))
        b.accountList = boom
        b.agentList = boom
        b.guideList = boom
        b.historyResult = { boom }
        show(b)
        rule.onNodeWithText("No se pudo cargar el uso desde el PC.").assertIsDisplayed()
        b.calls.clear()
        rule.onNodeWithText("Reintentar").performClick()
        rule.waitForIdle()
        assertEquals(true, b.calls.contains("accounts"))
    }

    @Test fun nothingToShowSaysSo() {
        val b = FakeUsageBackend()
        b.accountList = Result.success(emptyList())
        b.agentList = Result.success(emptyList())
        b.guideList = Result.success(emptyList())
        b.historyResult = { Result.success(sampleHistory(it, 0.0).copy(turns = 0, byDay = emptyList(), byAgent = emptyList())) }
        show(b)
        rule.onNodeWithText("Aún no hay uso que mostrar").assertIsDisplayed()
    }

    @Test fun withoutTheLinkTheSavedUsageStaysAndUpdateIsOff() {
        val b = FakeUsageBackend()
        b.connectionState.value = ConnectionState.Offline(null, null)
        // An unreachable PC answers nothing, so the saved copy is what stays.
        b.accountList = Result.failure(IllegalStateException("offline"))
        b.agentList = Result.failure(IllegalStateException("offline"))
        b.savedUsage.value = SavedUsage(listOf(account("viejo", 0.7)), listOf(AgentInfo("claude", "Claude Code", true, true, null, "si")))
        show(b)
        rule.onNodeWithText("70 %").assertExists()
        rule.onNodeWithContentDescription("Actualizar").assertIsNotEnabled()
    }
}

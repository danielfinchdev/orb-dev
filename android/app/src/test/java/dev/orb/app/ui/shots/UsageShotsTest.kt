package dev.orb.app.ui.shots

import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.PcVersions
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.usage.AgentInfo
import dev.orb.app.ui.usage.AgentSpend
import dev.orb.app.ui.usage.DaySpend
import dev.orb.app.ui.usage.FakeUsageBackend
import dev.orb.app.ui.usage.ModelGuideAgent
import dev.orb.app.ui.usage.ModelPick
import dev.orb.app.ui.usage.SavedUsage
import dev.orb.app.ui.usage.UsageAccount
import dev.orb.app.ui.usage.UsageHistory
import dev.orb.app.ui.usage.UsageScreen
import dev.orb.app.ui.usage.UsageSheet
import dev.orb.app.ui.usage.UsageViewModel
import dev.orb.app.ui.usage.UsageWindow
import kotlinx.coroutines.CompletableDeferred
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.GregorianCalendar
import java.util.TimeZone

/**
 * Pictures of «Uso y agentes» (27): the four variants of the mockup (usage, updating, model guide, history) and the
 * states it leaves out. `ORB_SHOTS=1` turns them on.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = Shots.PHONE)
class UsageShotsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Before fun still() {
        Settings.Global.putFloat(rule.activity.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
    }

    private val madrid = TimeZone.getTimeZone("Europe/Madrid")

    // Thursday 19 November 2026, 12:00 in Madrid.
    private val now = GregorianCalendar(madrid).apply { clear(); set(2026, 10, 19, 12, 0) }.timeInMillis
    private val threeOClock = GregorianCalendar(madrid).apply { clear(); set(2026, 10, 19, 15, 0) }.timeInMillis

    private fun account(id: String, agent: String, label: String, plan: String, utilization: Double, resetAt: Long? = null) = UsageAccount(
        account = id, agent = agent, label = label, plan = plan, windows = listOf(UsageWindow("five_hour", utilization, resetAt)),
        used = null, max = null, cooldownUntil = null, cooldownReason = null,
    )

    private fun backend(setup: (FakeUsageBackend) -> Unit = {}) = FakeUsageBackend().apply {
        connectionState.value = ConnectionState.Online("http://pc", "PC de Dani", PcVersions(1, 1, "3.8.8"))
        accountList = Result.success(
            listOf(
                account("claude", "claude", "Claude", "Max", 0.94, threeOClock),
                account("codex", "codex", "ChatGPT", "Pro", 0.38),
                account("cursor", "cursor", "Cursor", "Pro", 0.12),
            ),
        )
        agentList = Result.success(
            listOf(
                AgentInfo("claude", "Claude Code", true, true, "2.1.0", "si"),
                AgentInfo("codex", "Codex", true, true, "0.9.1", "si"),
                AgentInfo("cursor", "Cursor", true, true, null, "no"),
            ),
        )
        historyResult = { days ->
            Result.success(
                UsageHistory(
                    days = days, usd = 11.7, tokensIn = 2_400_000, tokensOut = 61_000, turns = 148,
                    byDay = listOf(DaySpend("2026-11-17", 2.6, 310_000), DaySpend("2026-11-18", 3.9, 520_000), DaySpend("2026-11-19", 5.2, 780_000)),
                    byAgent = listOf(AgentSpend("claude", 8.1, 1_900_000), AgentSpend("codex", 3.6, 560_000)),
                ),
            )
        }
        guideList = Result.success(
            listOf(
                ModelGuideAgent(
                    "claude", "Claude Code",
                    listOf("light" to listOf("Haiku"), "balanced" to listOf("Sonnet"), "heavy" to listOf("Opus")),
                    listOf(ModelPick("simple", "Haiku", "low"), ModelPick("normal", "Sonnet", "medium"), ModelPick("complejo", "Opus", "high")),
                ),
            ),
        )
        setup(this)
    }

    private fun screen(
        palette: OrbPaletteChoice, suffix: String = "", b: FakeUsageBackend = backend(), sheet: UsageSheet? = null, after: () -> Unit = {},
    ) {
        Shots.assumeEnabled()
        val vm = UsageViewModel(b)
        var dark by mutableStateOf(false)
        rule.setContent { ShotFrame(palette, dark) { UsageScreen(vm, onBack = {}, nowMs = { now }, zone = madrid, startSheet = sheet) } }
        rule.waitForIdle()
        after()
        rule.waitForIdle()
        Shots.save(rule.activity, "27-uso-${palette.key}-claro$suffix")
        dark = true
        rule.waitForIdle()
        Shots.save(rule.activity, "27-uso-${palette.key}-oscuro$suffix")
    }

    // The variants of the mockup

    @Test fun usageGrafito() = screen(OrbPaletteChoice.Grafito)
    @Test fun usageOceano() = screen(OrbPaletteChoice.Oceano)
    @Test fun updating() = screen(OrbPaletteChoice.Grafito, "-refresca", backend { it.refreshGate = CompletableDeferred() }) {
        rule.onNodeWithContentDescription("Actualizar").performClick()
    }
    @Test fun guide() = screen(OrbPaletteChoice.Grafito, "-guia", sheet = UsageSheet.Guide)
    @Test fun history() = screen(OrbPaletteChoice.Grafito, "-historial", sheet = UsageSheet.History)

    // What the mockup leaves out

    @Test fun guideWithMoreModels() = screen(
        OrbPaletteChoice.Grafito, "-guia-completa",
        backend {
            it.guideList = Result.success(
                listOf(
                    ModelGuideAgent(
                        "claude", "Claude Code",
                        listOf("light" to listOf("Haiku"), "balanced" to listOf("Sonnet", "Sonnet 4"), "heavy" to listOf("Opus", "Opus 4", "Fable")),
                        listOf(ModelPick("simple", "Haiku", "low"), ModelPick("normal", "Sonnet", "medium"), ModelPick("complejo", "Opus", "high")),
                    ),
                ),
            )
        },
        UsageSheet.Guide,
    )
    @Test fun withoutTheLink() = screen(
        OrbPaletteChoice.Grafito, "-sin-conexion",
        backend {
            val saved = SavedUsage(it.accountList.getOrThrow(), it.agentList.getOrThrow())
            it.connectionState.value = ConnectionState.Offline(null, null)
            it.accountList = Result.failure(IllegalStateException("offline"))
            it.agentList = Result.failure(IllegalStateException("offline"))
            it.savedUsage.value = saved
        },
    )
    @Test fun empty() = screen(
        OrbPaletteChoice.Grafito, "-vacio",
        backend {
            it.accountList = Result.success(emptyList())
            it.agentList = Result.success(emptyList())
            it.guideList = Result.success(emptyList())
            it.historyResult = { d -> Result.success(UsageHistory(d, 0.0, 0, 0, 0, emptyList(), emptyList())) }
        },
    )
    @Test fun failed() = screen(
        OrbPaletteChoice.Grafito, "-error",
        backend {
            val boom = Result.failure<Nothing>(IllegalStateException("x"))
            it.accountList = boom
            it.agentList = boom
            it.guideList = boom
            it.historyResult = { boom }
        },
    )
    @Test fun loading() = screen(
        OrbPaletteChoice.Grafito, "-cargando",
        backend {
            it.accountsGate = CompletableDeferred()
            it.unavailable = setOf("usage.history", "agents.status", "models.guide")
        },
    )
}

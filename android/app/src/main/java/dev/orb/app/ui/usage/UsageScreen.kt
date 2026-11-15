package dev.orb.app.ui.usage

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.chats.Message
import dev.orb.app.ui.shell.ScreenBar
import dev.orb.app.ui.offline.OfflineStrip
import dev.orb.app.ui.theme.OrbTheme
import java.text.DateFormat
import java.util.Date

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UsageScreen(vm: UsageViewModel, onBack: () -> Unit, modifier: Modifier = Modifier, nowMs: () -> Long = System::currentTimeMillis) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.refresh() }

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            ScreenBar(UsageTexts.TITLE, onBack, UsageTexts.BACK) {
                if (state.canUsage) TextButton(onClick = vm::update, enabled = state.online && !state.updating) {
                    Text(if (state.updating) UsageTexts.UPDATING else UsageTexts.UPDATE)
                }
            }
            if (!state.online && state.loaded) {
                OfflineStrip()
            }
            PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.weight(1f).fillMaxWidth()) {
                when {
                    state.allFailed -> Message(UsageTexts.LOAD_ERROR, action = UsageTexts.RETRY, onAction = vm::refresh)
                    !state.loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    else -> Body(state, vm::setDays, nowMs)
                }
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(16.dp))
    }
}

@Composable
private fun Body(state: UsageState, onDays: (Int) -> Unit, nowMs: () -> Long) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (state.canUsage) {
            item { Heading(UsageTexts.LIMITS) }
            val accounts = state.accounts.data.orEmpty()
            if (accounts.isEmpty()) item { Hint(UsageTexts.NO_ACCOUNTS) }
            for (a in accounts) item(key = "acc:" + a.account) { AccountCard(a, nowMs()) }
        }
        if (state.canHistory) {
            item { Heading(UsageTexts.SPEND) }
            item { SpendCard(state, onDays) }
        }
        if (state.canAgents) {
            item { Heading(UsageTexts.AGENTS) }
            val agents = state.agents.data.orEmpty()
            for (a in agents) item(key = "agent:" + a.id) { AgentRow(a) }
        }
        if (state.canGuide) {
            val guide = state.guide.data.orEmpty()
            if (guide.isNotEmpty()) {
                item { Heading(UsageTexts.GUIDE) }
                item { Hint(UsageTexts.GUIDE_HINT) }
                for (g in guide) item(key = "guide:" + g.id) { GuideCard(g) }
            }
        }
    }
}

@Composable
private fun Heading(text: String) = Text(text, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 4.dp))

@Composable
private fun Hint(text: String) = Text(text, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2)

@Composable
private fun Card(content: @Composable () -> Unit) {
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
    }
}

/** A plain horizontal bar; [fraction] is 0..1. Turns to the warning colour when the window is nearly spent. */
@Composable
fun UsageBar(fraction: Float, modifier: Modifier = Modifier) {
    val f = fraction.coerceIn(0f, 1f)
    LinearProgressIndicator(
        progress = { f }, modifier = modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)),
        color = if (f >= 0.9f) OrbTheme.colors.warn else MaterialTheme.colorScheme.primary,
        trackColor = MaterialTheme.colorScheme.surfaceContainerHighest,
    )
}

@Composable
private fun AccountCard(a: UsageAccount, now: Long) {
    Card {
        Text(
            listOfNotNull(a.label, a.plan).joinToString(" · "), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold,
        )
        val until = a.cooldownUntil
        if (until != null && until > now) {
            Text(
                UsageTexts.paused(DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(until)), a.cooldownReason),
                style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.warn,
            )
        }
        if (a.windows.isEmpty()) {
            val max = a.max
            if (max != null && max > 0) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(UsageTexts.TASKS_USED, style = MaterialTheme.typography.bodyMedium)
                    Text(UsageTexts.tasksOf(a.used ?: 0, max), style = MaterialTheme.typography.bodyMedium)
                }
                UsageBar((a.used ?: 0).toFloat() / max)
            } else Hint(UsageTexts.NO_LIMITS)
        }
        for (w in a.windows) {
            val pct = Math.round(w.utilization * 100).toInt()
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(UsageTexts.windowLabel(w.window), style = MaterialTheme.typography.bodyMedium)
                Text("$pct %", style = MaterialTheme.typography.bodyMedium)
            }
            UsageBar(w.utilization.toFloat())
            val reset = UsageTexts.resetText(w.resetAt, now)
            if (reset.isNotEmpty()) Text(reset, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2)
        }
    }
}

@Composable
private fun SpendCard(state: UsageState, onDays: (Int) -> Unit) {
    Card {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (d in listOf(7, 30, 90)) FilterChip(selected = state.days == d, onClick = { onDays(d) }, label = { Text(UsageTexts.days(d)) })
        }
        val h = state.history.data
        when {
            h == null && state.history.failed -> Hint(UsageTexts.SPEND_ERROR)
            h == null -> Unit
            h.turns == 0 && h.usd == 0.0 -> Hint(UsageTexts.EMPTY_SPEND)
            else -> {
                Stat(UsageTexts.COST, UsageTexts.money(h.usd))
                Stat(UsageTexts.TOKENS_IN, UsageTexts.tokens(h.tokensIn))
                Stat(UsageTexts.TOKENS_OUT, UsageTexts.tokens(h.tokensOut))
                Stat(UsageTexts.TURNS, h.turns.toString())
                Text(UsageTexts.BY_DAY, style = MaterialTheme.typography.labelMedium, color = OrbTheme.colors.text2)
                DayBars(h.byDay)
                if (h.byAgent.isNotEmpty()) {
                    Text(UsageTexts.BY_AGENT, style = MaterialTheme.typography.labelMedium, color = OrbTheme.colors.text2)
                    val top = h.byAgent.maxOf { it.usd }.takeIf { it > 0 } ?: 1.0
                    for (a in h.byAgent) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(a.agent, style = MaterialTheme.typography.bodyMedium)
                            Text(UsageTexts.money(a.usd), style = MaterialTheme.typography.bodyMedium)
                        }
                        UsageBar((a.usd / top).toFloat())
                    }
                }
            }
        }
    }
}

@Composable
private fun Stat(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = OrbTheme.colors.text2)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
    }
}

/** One thin column per day, as tall as that day's cost (its tokens when nothing was priced). */
@Composable
private fun DayBars(days: List<DaySpend>) {
    val byCost = days.any { it.usd > 0 }
    fun value(d: DaySpend) = if (byCost) d.usd else d.tokens.toDouble()
    val top = days.maxOfOrNull(::value)?.takeIf { it > 0 } ?: 1.0
    Row(Modifier.fillMaxWidth().height(64.dp), horizontalArrangement = Arrangement.spacedBy(1.dp), verticalAlignment = Alignment.Bottom) {
        for (d in days) {
            Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.BottomCenter) {
                Box(
                    Modifier.fillMaxWidth().fillMaxHeight(((value(d) / top).toFloat()).coerceIn(0.03f, 1f))
                        .clip(RoundedCornerShape(2.dp)).background(MaterialTheme.colorScheme.primary.copy(alpha = if (value(d) > 0) 1f else 0.2f)),
                )
            }
        }
    }
}

@Composable
private fun AgentRow(a: AgentInfo) {
    Card {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(a.label, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(
                if (a.installed) UsageTexts.INSTALLED else UsageTexts.NOT_INSTALLED,
                style = MaterialTheme.typography.labelMedium, color = if (a.installed) MaterialTheme.colorScheme.primary else OrbTheme.colors.text3,
            )
        }
        val detail = listOfNotNull(
            a.version?.takeIf { it.isNotBlank() },
            if (a.installed) when (a.login) { "si" -> UsageTexts.LOGGED_IN; "no" -> UsageTexts.NO_LOGIN; else -> UsageTexts.UNKNOWN_LOGIN } else null,
            UsageTexts.OFF.takeIf { a.installed && !a.enabled },
        )
        if (detail.isNotEmpty()) Hint(detail.joinToString(" · "))
    }
}

@Composable
private fun GuideCard(g: ModelGuideAgent) {
    Card {
        Text(g.label, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        for (p in g.picks) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(UsageTexts.levelLabel(p.level), style = MaterialTheme.typography.bodyMedium, color = OrbTheme.colors.text2)
                Text(
                    listOfNotNull(p.label, p.reasoning?.let(UsageTexts::reasoning)).joinToString(" · "),
                    style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold,
                )
            }
        }
        for ((tier, names) in g.tiers) {
            Text(UsageTexts.tierLabel(tier), style = MaterialTheme.typography.labelMedium, color = OrbTheme.colors.text2)
            Text(names.joinToString(", "), style = MaterialTheme.typography.bodySmall)
        }
    }
}

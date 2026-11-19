package dev.orb.app.ui.usage

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.AgentMark
import dev.orb.app.ui.kit.OrbBadge
import dev.orb.app.ui.kit.OrbBadgeKind
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbCard
import dev.orb.app.ui.kit.OrbEmpty
import dev.orb.app.ui.kit.OrbGroupHeader
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbNote
import dev.orb.app.ui.kit.OrbProgress
import dev.orb.app.ui.kit.OrbRow
import dev.orb.app.ui.kit.OrbSegmented
import dev.orb.app.ui.kit.OrbSettingRow
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbSheetLabel
import dev.orb.app.ui.kit.OrbSnackbarHost
import dev.orb.app.ui.kit.OrbSpinner
import dev.orb.app.ui.kit.OrbSubtitle
import dev.orb.app.ui.kit.OrbTopBar
import dev.orb.app.ui.offline.OfflineStrip
import java.text.DateFormat
import java.util.Date
import java.util.TimeZone

/** The two sheets the screen opens from its rows. */
enum class UsageSheet { History, Guide }

private val Periods = listOf(7, 30, 90)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UsageScreen(
    vm: UsageViewModel, onBack: () -> Unit, modifier: Modifier = Modifier, nowMs: () -> Long = System::currentTimeMillis,
    zone: TimeZone = TimeZone.getDefault(), startSheet: UsageSheet? = null,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    var sheet by remember { mutableStateOf(startSheet) }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.refresh() }

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            OrbTopBar(
                UsageTexts.TITLE, sub = UsageTexts.windowHeader(state.accounts.data.orEmpty(), nowMs(), zone), sideWidth = 56.dp,
                leading = { OrbIconButton(OrbIcons.ArrowLeft, UsageTexts.BACK, onBack) },
                actions = {
                    if (state.canUsage) {
                        OrbIconButton(
                            OrbIcons.RefreshCw, if (state.updating) UsageTexts.UPDATING else UsageTexts.UPDATE, vm::update,
                            enabled = state.online && !state.updating,
                        )
                    }
                },
            )
            if (!state.online && state.loaded) OfflineStrip()
            PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.weight(1f).fillMaxWidth()) {
                when {
                    state.allFailed -> Centered {
                        OrbEmpty(
                            UsageTexts.LOAD_ERROR, icon = OrbIcons.CircleAlert,
                            actions = { OrbButton(UsageTexts.RETRY, vm::refresh) },
                        )
                    }
                    !state.loaded -> Centered { OrbSpinner(size = 24.dp) }
                    state.isEmpty -> Centered { OrbEmpty(UsageTexts.EMPTY, text = UsageTexts.EMPTY_HINT, icon = OrbIcons.Gauge) }
                    else -> Body(state, vm::setDays, nowMs, zone) { sheet = it }
                }
            }
        }
        OrbSnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(16.dp))
    }
    when (sheet) {
        UsageSheet.History -> HistorySheet(state, nowMs(), zone, vm::setDays) { sheet = null }
        UsageSheet.Guide -> GuideSheet(state.guide.data.orEmpty()) { sheet = null }
        null -> Unit
    }
}

/** A column that scrolls, so pulling down still refreshes when there is nothing to list. */
@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), contentAlignment = Alignment.Center) { content() }
}

@Composable
private fun Body(state: UsageState, onDays: (Int) -> Unit, nowMs: () -> Long, zone: TimeZone, open: (UsageSheet) -> Unit) {
    var more by rememberSaveable { mutableStateOf(false) }
    val guide = state.guide.data.orEmpty()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        if (state.updating) item(key = "updating") { UpdatingBand() } else item(key = "gap") { Box(Modifier.height(8.dp)) }
        if (state.canUsage) {
            item(key = "h:accounts") { OrbGroupHeader(UsageTexts.ACCOUNTS) }
            val accounts = state.accounts.data.orEmpty()
            if (accounts.isEmpty()) item(key = "no-accounts") { OrbNote(UsageTexts.NO_ACCOUNTS, Modifier.padding(horizontal = 16.dp)) }
            else item(key = "accounts") {
                OrbCard(Modifier.padding(horizontal = 16.dp)) {
                    val now = nowMs()
                    accounts.forEachIndexed { i, a -> AccountRows(a, now, first = i == 0, zone = zone) }
                }
            }
        }
        if (state.canHistory || guide.isNotEmpty()) item(key = "links") {
            OrbCard(Modifier.padding(horizontal = 16.dp).padding(top = 8.dp)) {
                if (state.canHistory) OrbSettingRow(
                    UsageTexts.HISTORY, subtitle = UsageTexts.HISTORY_HINT, divider = false, onClick = { open(UsageSheet.History) },
                    trailing = { Chevron() },
                )
                if (guide.isNotEmpty()) OrbSettingRow(
                    UsageTexts.GUIDE_ROW, subtitle = UsageTexts.GUIDE_ROW_HINT, divider = state.canHistory, onClick = { open(UsageSheet.Guide) },
                    trailing = { Chevron() },
                )
            }
        }
        if (state.canAgents) {
            item(key = "h:agents") { OrbGroupHeader(UsageTexts.AGENTS_ON_PC) }
            val agents = state.agents.data.orEmpty()
            if (agents.isEmpty()) item(key = "no-agents") { OrbNote(UsageTexts.NO_AGENTS, Modifier.padding(horizontal = 16.dp)) }
            else item(key = "agents") {
                OrbCard(Modifier.padding(horizontal = 16.dp)) {
                    for (a in agents) AgentLine(a)
                }
            }
        }
        item(key = "footnote") { OrbNote(UsageTexts.FOOTNOTE, Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp)) }
        if (state.canHistory) {
            item(key = "more") { FoldRow(more) { more = !more } }
            if (more) item(key = "spend") { OrbCard(Modifier.padding(horizontal = 16.dp)) { SpendDetails(state, onDays) } }
        }
    }
}

@Composable
private fun Chevron() = Icon(OrbIcons.ChevronRight, null, Modifier.size(20.dp), tint = OrbKit.faintForeground)

/** `u:refresca`: the agents are being asked for their plan again. */
@Composable
private fun UpdatingBand() {
    Row(
        Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OrbSpinner()
        Text(UsageTexts.UPDATING_BAND, color = OrbKit.mutedForeground, fontSize = 12.sp, lineHeight = 16.sp)
    }
}

/** «Más opciones»: the quiet row that folds what the mockup does not draw. */
@Composable
private fun FoldRow(open: Boolean, onToggle: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = 56.dp).clickable(role = Role.Button, onClick = onToggle)
            .semantics { stateDescription = if (open) UsageTexts.EXPANDED else UsageTexts.COLLAPSED }.padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(if (open) OrbIcons.ChevronUp else OrbIcons.ChevronDown, null, Modifier.size(20.dp), tint = OrbKit.mutedForeground)
        Text(UsageTexts.MORE_OPTIONS, Modifier.weight(1f), color = OrbKit.mutedForeground, fontSize = 15.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium)
    }
}

/**
 * One line of the card of accounts (`.setting` with a bar): a title, the bar under it with its detail, and the figure
 * at the end. Amber from 85 %. A row without [fraction] has no bar (the PC gave no limit to draw).
 */
@Composable
private fun UsageRow(
    title: String, fraction: Float?, value: String?, divider: Boolean, bold: Boolean = true,
    details: List<Pair<String, Boolean>> = emptyList(),
) {
    val warn = fraction != null && UsageTexts.nearLimit(fraction.toDouble())
    if (divider) Box(Modifier.fillMaxWidth().height(1.dp).background(OrbKit.border))
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = 56.dp).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                title, color = if (bold) OrbKit.foreground else OrbKit.mutedForeground, fontSize = 15.sp, lineHeight = 20.sp,
                fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            if (fraction != null) {
                OrbProgress(
                    fraction, Modifier.padding(top = 6.dp, bottom = 2.dp), warn = warn,
                    description = UsageTexts.barLabel(title, value.orEmpty()),
                )
            }
            for ((text, alert) in details) {
                Text(text, color = if (alert) OrbKit.warningInk else OrbKit.mutedForeground, fontSize = 12.sp, lineHeight = 16.sp)
            }
        }
        if (value != null) {
            Text(value, color = if (warn) OrbKit.warningInk else OrbKit.foreground, fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

/** An account's windows, each with its bar; the tasks count of the PC's own window follows when it counts them. */
@Composable
private fun AccountRows(a: UsageAccount, now: Long, first: Boolean, zone: TimeZone) {
    val title = listOfNotNull(a.label, a.plan).joinToString(" · ")
    val pause = a.cooldownUntil?.takeIf { it > now }?.let {
        UsageTexts.paused(DateFormat.getTimeInstance(DateFormat.SHORT).apply { timeZone = zone }.format(Date(it)), a.cooldownReason) to true
    }
    val max = a.max?.takeIf { it > 0 }
    // Only the very first row of the card has no line above it.
    var rows = if (first) 0 else 1
    fun line() = (rows++ > 0)
    for ((i, w) in a.windows.withIndex()) {
        val reset = UsageTexts.resetText(w.resetAt, now)
        val details = buildList {
            if (i == 0) add(listOf(UsageTexts.windowLabel(w.window), reset).filter { it.isNotEmpty() }.joinToString(" · ") to false)
            else if (reset.isNotEmpty()) add(reset to false)
            if (i == 0 && pause != null) add(pause)
        }
        UsageRow(
            if (i == 0) title else UsageTexts.windowLabel(w.window), w.utilization.toFloat(), UsageTexts.percentText(w.utilization), line(),
            bold = i == 0, details = details,
        )
    }
    if (max != null) {
        val used = a.used ?: 0
        UsageRow(
            if (a.windows.isEmpty()) title else UsageTexts.TASKS_USED, used.toFloat() / max, UsageTexts.tasksOf(used, max), line(),
            bold = a.windows.isEmpty(),
            details = listOfNotNull(UsageTexts.tasksWindow(a.windowHours) to false, pause.takeIf { a.windows.isEmpty() }),
        )
    } else if (a.windows.isEmpty()) {
        UsageRow(title, null, null, line(), details = listOfNotNull(UsageTexts.NO_LIMITS to false, pause))
    }
}

/** What an agent's row says at its end, and how loud: «Listo» only when it is installed, on and signed in. */
internal fun agentBadge(a: AgentInfo): Pair<String, OrbBadgeKind> = when {
    !a.installed -> UsageTexts.NOT_INSTALLED to OrbBadgeKind.Neutral
    !a.enabled -> UsageTexts.OFF to OrbBadgeKind.Neutral
    a.login == "si" -> UsageTexts.READY to OrbBadgeKind.Ok
    a.login == "no" -> UsageTexts.NO_LOGIN to OrbBadgeKind.Warn
    else -> UsageTexts.UNKNOWN_LOGIN to OrbBadgeKind.Neutral
}

@Composable
private fun AgentLine(a: AgentInfo) {
    val (text, kind) = agentBadge(a)
    val sub = if (!a.installed) null else listOfNotNull(
        when (a.login) { "si" -> UsageTexts.LOGGED_IN; "no" -> UsageTexts.NO_LOGIN; else -> UsageTexts.UNKNOWN_LOGIN },
        a.version?.takeIf { it.isNotBlank() },
    ).joinToString(" · ")
    OrbRow(
        a.label, lead = { AgentMark(a.id) }, subtitle = if (sub == null) null else ({ OrbSubtitle(sub) }),
        badge = { OrbBadge(text, kind = kind) },
        modifier = Modifier.defaultMinSize(minHeight = 64.dp),
    )
}

// ---------------------------------------------------------------- «Gasto»: what the PC spent, by day and by agent

/** The full «Gasto» card under «Más opciones»: cost, tokens, turns, the days as columns and each agent's share. */
@Composable
private fun SpendDetails(state: UsageState, onDays: (Int) -> Unit) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(UsageTexts.SPEND, color = OrbKit.foreground, fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium)
        PeriodPicker(state.days, onDays)
        val h = state.history.data
        when {
            h == null && state.history.failed -> Note(UsageTexts.SPEND_ERROR)
            h == null -> OrbSpinner()
            h.turns == 0 && h.usd == 0.0 -> Note(UsageTexts.EMPTY_SPEND)
            else -> {
                Stat(UsageTexts.COST, UsageTexts.money(h.usd))
                Stat(UsageTexts.TOKENS_IN, UsageTexts.tokens(h.tokensIn))
                Stat(UsageTexts.TOKENS_OUT, UsageTexts.tokens(h.tokensOut))
                Stat(UsageTexts.TURNS, h.turns.toString())
                Note(UsageTexts.BY_DAY)
                DayColumns(h.byDay)
                if (h.byAgent.isNotEmpty()) {
                    Note(UsageTexts.BY_AGENT)
                    val top = h.byAgent.maxOf { it.usd }.takeIf { it > 0 } ?: 1.0
                    for (a in h.byAgent) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Stat(a.agent, UsageTexts.money(a.usd))
                            OrbProgress((a.usd / top).toFloat(), description = UsageTexts.barLabel(a.agent, UsageTexts.money(a.usd)))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PeriodPicker(days: Int, onDays: (Int) -> Unit) {
    OrbSegmented(Periods.map(UsageTexts::days), Periods.indexOf(days).coerceAtLeast(0), { onDays(Periods[it]) }, stretch = true)
}

@Composable
private fun Note(text: String) = Text(text, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp)

@Composable
private fun Stat(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp)
        Text(value, color = OrbKit.foreground, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** One thin column per day, as tall as that day's cost (its tokens when nothing was priced). */
@Composable
private fun DayColumns(days: List<DaySpend>) {
    val priced = days.any { it.usd > 0 }
    fun value(d: DaySpend) = if (priced) d.usd else d.tokens.toDouble()
    val top = days.maxOfOrNull(::value)?.takeIf { it > 0 } ?: 1.0
    Row(Modifier.fillMaxWidth().height(64.dp), horizontalArrangement = Arrangement.spacedBy(1.dp), verticalAlignment = Alignment.Bottom) {
        for (d in days) {
            Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.BottomCenter) {
                Box(
                    Modifier.fillMaxWidth().fillMaxHeight((value(d) / top).toFloat().coerceIn(0.03f, 1f)).clip(RoundedCornerShape(2.dp))
                        .background(if (value(d) > 0) OrbKit.primaryText else OrbKit.muted),
                )
            }
        }
    }
}

// ---------------------------------------------------------------- the sheets

/**
 * «Historial de uso»: what the PC spent each day, newest first, with a bar as long as that day's spend against the
 * busiest day of the period. The PC gives money and tokens per day, never a share of a plan, so that is what it shows.
 */
@Composable
private fun HistorySheet(state: UsageState, now: Long, zone: TimeZone, onDays: (Int) -> Unit, onDismiss: () -> Unit) {
    OrbSheet(onDismiss = onDismiss, title = UsageTexts.HISTORY, closeLabel = UsageTexts.CLOSE) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            PeriodPicker(state.days, onDays)
            val h = state.history.data
            when {
                h == null && state.history.failed -> Note(UsageTexts.SPEND_ERROR)
                h == null -> Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { OrbSpinner(size = 20.dp) }
                else -> {
                    val rows = UsageTexts.historyRows(h.byDay, now, zone)
                    if (rows.isEmpty()) Note(UsageTexts.NO_DAY_SPEND)
                    else {
                        Text(UsageTexts.SPEND_PER_DAY, color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp)
                        for (r in rows) {
                            Column {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text(r.label, color = OrbKit.mutedForeground, fontSize = 12.sp, lineHeight = 16.sp)
                                    Text(r.value, color = OrbKit.mutedForeground, fontSize = 12.sp, lineHeight = 16.sp)
                                }
                                OrbProgress(r.fraction, Modifier.padding(top = 6.dp), description = UsageTexts.barLabel(r.label, r.value))
                            }
                        }
                        OrbNote(UsageTexts.periodTotal(state.days, UsageTexts.money(h.usd), UsageTexts.tokens(h.tokensIn + h.tokensOut)))
                    }
                }
            }
        }
    }
}

/** «Guía de modelos»: what Orb picks for a hard, a usual and a simple job, then every model the agent has by kind. */
@Composable
private fun GuideSheet(guide: List<ModelGuideAgent>, onDismiss: () -> Unit) {
    OrbSheet(onDismiss = onDismiss, title = UsageTexts.GUIDE_ROW, closeLabel = UsageTexts.CLOSE) {
        OrbSheetLabel(UsageTexts.GUIDE_PICKS)
        for (g in guide) {
            if (guide.size > 1) Text(g.label, Modifier.padding(horizontal = 20.dp, vertical = 6.dp), color = OrbKit.foreground, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium)
            for (p in g.picks.sortedBy { UsageParser.Levels.indexOf(it.level) }.reversed()) {
                GuideLine(
                    levelIcon(p.level), p.label,
                    listOfNotNull(UsageTexts.levelLabel(p.level), p.reasoning?.let(UsageTexts::reasoning)).joinToString(" · "),
                )
            }
            // The kinds only say more when they hold a model the three picks above do not already name.
            if (g.tiers.flatMap { it.second }.any { name -> g.picks.none { it.label == name } }) {
                OrbSheetLabel(UsageTexts.GUIDE_ALL)
                for ((tier, names) in g.tiers.reversed()) GuideLine(tierIcon(tier), names.joinToString(", "), UsageTexts.tierLabel(tier))
            }
        }
        OrbNote(UsageTexts.GUIDE_HINT, Modifier.padding(horizontal = 20.dp, vertical = 10.dp))
    }
}

private fun levelIcon(level: String): ImageVector = when (level) {
    "complejo" -> OrbIcons.Brain
    "normal" -> OrbIcons.Zap
    else -> OrbIcons.Search
}

private fun tierIcon(tier: String): ImageVector = when (tier) {
    "heavy" -> OrbIcons.Brain
    "balanced" -> OrbIcons.Zap
    else -> OrbIcons.Search
}

/** `.it` with two lines: a mark, the model and what it is for. */
@Composable
private fun GuideLine(icon: ImageVector, title: String, hint: String) {
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = 52.dp).padding(horizontal = 20.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Icon(icon, null, Modifier.size(20.dp), tint = OrbKit.mutedForeground)
        Column(Modifier.weight(1f)) {
            Text(title, color = OrbKit.foreground, fontSize = 15.sp, lineHeight = 22.sp)
            Text(hint, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp)
        }
    }
}

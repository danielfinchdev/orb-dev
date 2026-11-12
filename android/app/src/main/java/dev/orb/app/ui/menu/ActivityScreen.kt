package dev.orb.app.ui.menu

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.chats.ChatTime
import dev.orb.app.ui.chats.Message
import dev.orb.app.ui.shell.ScreenBar
import dev.orb.app.ui.offline.OfflineStrip
import dev.orb.app.ui.theme.OrbTheme

/** «Memorias y actividad»: the PC's recent events and its logbooks, read only. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActivityScreen(vm: ActivityViewModel, onBack: () -> Unit, modifier: Modifier = Modifier, nowMs: () -> Long = System::currentTimeMillis) {
    val state by vm.state.collectAsStateWithLifecycle()
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.refresh() }
    val open = state.log
    BackHandler(enabled = open != null) { vm.closeLog() }

    Column(modifier.fillMaxSize()) {
        ScreenBar(open?.name ?: MenuTexts.ACTIVITY, if (open != null) vm::closeLog else onBack, MenuTexts.BACK)
        if (open != null) {
            LogText(open)
            return@Column
        }
        if (state.canActivity && state.canLogs) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(state.tab == ActivityTab.Activity, { vm.setTab(ActivityTab.Activity) }, { Text(MenuTexts.TAB_ACTIVITY) })
                FilterChip(state.tab == ActivityTab.Logs, { vm.setTab(ActivityTab.Logs) }, { Text(MenuTexts.TAB_LOGS) })
            }
        }
        if (!state.online && (state.events != null || state.logs != null)) {
            OfflineStrip()
        }
        PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.weight(1f).fillMaxWidth()) {
            if (state.tab == ActivityTab.Activity) Events(state, vm::refresh, nowMs) else Logs(state, vm::refresh, vm::openLog)
        }
    }
}

@Composable
private fun Events(state: ActivityState, onRetry: () -> Unit, nowMs: () -> Long) {
    val events = state.events
    when {
        events == null && state.eventsFailed -> Message(MenuTexts.LOAD_ERROR, action = MenuTexts.RETRY, onAction = onRetry)
        events == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        events.isEmpty() -> Message(MenuTexts.EMPTY_ACTIVITY)
        else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(events, key = { it.id }) { e ->
                Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(MenuTexts.kind(e.kind), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                            Text(ChatTime.short(e.at, nowMs()), style = MaterialTheme.typography.labelSmall, color = OrbTheme.colors.text3)
                        }
                        val where = listOfNotNull(e.actor.takeIf { it.isNotBlank() }, e.taskTitle?.let { "#${e.taskId} $it" }).joinToString(" · ")
                        if (where.isNotEmpty()) Text(where, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (e.detail.isNotBlank()) Text(e.detail, style = MaterialTheme.typography.bodySmall, maxLines = 4, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

@Composable
private fun Logs(state: ActivityState, onRetry: () -> Unit, onOpen: (LogInfo) -> Unit) {
    val logs = state.logs
    when {
        logs == null && state.logsFailed -> Message(MenuTexts.LOAD_ERROR, action = MenuTexts.RETRY, onAction = onRetry)
        logs == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        logs.isEmpty() -> Message(MenuTexts.EMPTY_LOGS)
        else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(logs, key = { it.name }) { l ->
                Surface(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).clickable { onOpen(l) },
                    shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow,
                ) {
                    Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Text(l.name, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(MenuTexts.logSize(l.size), style = MaterialTheme.typography.labelMedium, color = OrbTheme.colors.text3)
                    }
                }
            }
        }
    }
}

@Composable
private fun LogText(log: OpenLog) {
    when {
        log.text != null -> Text(
            log.text, Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
        )
        log.failed != null -> Message(log.failed)
        else -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
    }
}

package dev.orb.app.ui.schedules

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbBadge
import dev.orb.app.ui.kit.OrbBadgeKind
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbEmpty
import dev.orb.app.ui.kit.OrbFab
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbNote
import dev.orb.app.ui.kit.OrbRow
import dev.orb.app.ui.kit.OrbSnackbarHost
import dev.orb.app.ui.kit.OrbSpinner
import dev.orb.app.ui.kit.OrbSwitch
import dev.orb.app.ui.kit.OrbTopBar
import dev.orb.app.ui.offline.OfflineStrip
import java.util.TimeZone

/**
 * Screen 20, «Programadas»: the schedules of the PC, each with when it runs next and how the last run went. A long press
 * on a row (or its «⋯») opens the sheet of what can be done with it; everything runs on the PC.
 * [clock] and [zone] are the phone's own and only change in a test.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SchedulesScreen(
    vm: SchedulesViewModel, onBack: () -> Unit, modifier: Modifier = Modifier,
    clock: () -> Long = System::currentTimeMillis, zone: TimeZone = TimeZone.getDefault(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    var menuFor by rememberSaveable { mutableStateOf<Long?>(null) }
    var running by rememberSaveable { mutableStateOf<Long?>(null) }
    var disabling by rememberSaveable { mutableStateOf<Long?>(null) }
    val enabled = state.online && !state.busy
    val now = remember(state.items) { clock() }

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            OrbTopBar(
                SchedulesTexts.TITLE, sub = if (state.loaded) SchedulesTexts.count(state.items.size) else null, sideWidth = 56.dp,
                leading = { OrbIconButton(OrbIcons.ArrowLeft, SchedulesTexts.BACK, onBack) },
            )
            if (!state.online && state.loaded) OfflineStrip()
            PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.weight(1f).fillMaxWidth()) {
                when {
                    !state.loaded && state.loadFailed -> Centered {
                        OrbEmpty(
                            SchedulesTexts.LOAD_ERROR, icon = OrbIcons.CalendarClock,
                            actions = { OrbButton(SchedulesTexts.RETRY, vm::refresh) },
                        )
                    }
                    !state.loaded -> Centered { OrbSpinner(size = 28.dp) }
                    state.items.isEmpty() -> Centered {
                        OrbEmpty(
                            SchedulesTexts.EMPTY, text = SchedulesTexts.EMPTY_HINT, icon = OrbIcons.CalendarClock,
                            actions = if (state.canCreate) ({ OrbButton(SchedulesTexts.NEW, vm::openNew, kind = OrbButtonKind.Primary, enabled = enabled) }) else null,
                        )
                    }
                    else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 8.dp, bottom = 110.dp)) {
                        items(state.items, key = { it.id }) { s ->
                            ScheduleRow(
                                s, state, enabled, now, zone,
                                onMenu = { menuFor = s.id },
                                onToggle = { on -> if (on) vm.setEnabled(s, true) else disabling = s.id },
                            )
                        }
                        item { OrbNote(SchedulesTexts.ROWS_HINT, Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) }
                    }
                }
            }
        }
        if (state.canCreate && state.loaded && state.items.isNotEmpty()) {
            OrbFab(SchedulesTexts.NEW, OrbIcons.Plus, vm::openNew, Modifier.align(Alignment.BottomEnd).padding(16.dp), lifted = snackbar.currentSnackbarData != null)
        }
        OrbSnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(16.dp))
    }

    state.items.firstOrNull { it.id == menuFor }?.let { s ->
        ScheduleActionsSheet(
            s, canRun = state.canRun, canUpdate = state.canUpdate, enabled = enabled,
            onRun = { menuFor = null; running = s.id },
            onEdit = { menuFor = null; vm.openEdit(s) },
            onToggle = { menuFor = null; if (s.enabled) disabling = s.id else vm.setEnabled(s, true) },
            onApprove = { menuFor = null; vm.openApproval(s) },
            onDismiss = { menuFor = null },
        )
    } ?: run { if (menuFor != null) menuFor = null }

    state.items.firstOrNull { it.id == running }?.let { s ->
        OrbDialog(
            onDismiss = { running = null }, title = SchedulesTexts.RUN_TITLE, text = SchedulesTexts.runBody(s.title),
            confirm = OrbDialogAction(SchedulesTexts.RUN_NOW, { running = null; vm.run(s) }),
            dismiss = OrbDialogAction(SchedulesTexts.CANCEL, { running = null }),
        )
    } ?: run { if (running != null) running = null }

    state.items.firstOrNull { it.id == disabling }?.let { s ->
        OrbDialog(
            onDismiss = { disabling = null }, title = SchedulesTexts.DISABLE_TITLE, text = SchedulesTexts.disableBody(s.title),
            confirm = OrbDialogAction(SchedulesTexts.DISABLE_CONFIRM, { disabling = null; vm.setEnabled(s, false) }),
            dismiss = OrbDialogAction(SchedulesTexts.CANCEL, { disabling = null }),
        )
    } ?: run { if (disabling != null) disabling = null }

    state.approval?.let { a ->
        ScheduleApprovalDialog(a, enabled = state.online && !state.busy, phone = zone, onApprove = vm::confirmApproval, onDismiss = vm::closeApproval)
    }

    state.form?.let { f -> ScheduleSheet(f, state.pcFields, vm::create, vm::saveEdit, vm::closeForm) }
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) { content() }
}

@Composable
private fun ScheduleRow(
    s: ScheduleItem, state: SchedulesState, enabled: Boolean, now: Long, zone: TimeZone, onMenu: () -> Unit, onToggle: (Boolean) -> Unit,
) {
    val needsApproval = !s.approved
    val project = s.project.takeIf { it.isNotBlank() }
    val first = listOfNotNull(SchedulesTexts.whenLine(s), project).joinToString(" · ")
    // A schedule waiting for approval, or paused, has no next run to promise.
    val next = if (s.enabled && !needsApproval) ScheduleStamps.next(s, now, zone) else null
    val last = ScheduleStamps.last(s, ScheduleStamps.outcome(s.lastTask?.let(state.outcomes::get)), now, zone)
    val badges = listOfNotNull(
        (SchedulesTexts.AWAITING to OrbBadgeKind.Warn).takeIf { needsApproval },
        (SchedulesTexts.READONLY_BADGE to OrbBadgeKind.Neutral).takeIf { s.readonly },
        (SchedulesTexts.PAUSED to OrbBadgeKind.Neutral).takeIf { !s.enabled && !needsApproval },
    )
    val hasMenu = state.canUpdate || state.canRun
    OrbRow(
        title = s.title,
        // The long press is also an action a screen reader offers, named for what it does.
        modifier = Modifier.semantics { onLongClick(SchedulesTexts.ROW_ACTIONS) { if (hasMenu) onMenu(); hasMenu } },
        lead = { Icon(OrbIcons.CalendarClock, null, Modifier.size(20.dp), tint = OrbKit.mutedForeground) },
        subtitle = {
            Column(Modifier.weight(1f)) {
                Line(first)
                next?.let { Line(it) }
                last?.let { Line(it) }
            }
        },
        actions = if (badges.isEmpty()) null else ({ for ((text, kind) in badges) OrbBadge(text, kind = kind) }),
        badge = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (hasMenu) OrbIconButton(OrbIcons.MoreVertical, "${SchedulesTexts.MORE}: ${s.title}", onMenu)
                if (state.canUpdate) OrbSwitch(
                    s.enabled, onToggle, label = "${SchedulesTexts.SWITCH}: ${s.title}", enabled = enabled && !needsApproval,
                )
            }
        },
        onClick = if (hasMenu) onMenu else null,
        onLongClick = if (hasMenu) onMenu else null,
    )
}

@Composable
private fun Line(text: String) {
    Text(text, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

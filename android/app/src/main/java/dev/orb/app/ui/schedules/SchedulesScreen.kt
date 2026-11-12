package dev.orb.app.ui.schedules

import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.chats.Message
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.shell.ScreenBar
import dev.orb.app.ui.theme.OrbTheme

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SchedulesScreen(vm: SchedulesViewModel, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    var running by rememberSaveable { mutableStateOf<Long?>(null) }
    var disabling by rememberSaveable { mutableStateOf<Long?>(null) }
    val enabled = state.online && !state.busy

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            ScreenBar(SchedulesTexts.TITLE, onBack, SchedulesTexts.BACK)
            if (!state.online && state.loaded) {
                Text(
                    SchedulesTexts.OFFLINE_STRIP, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                    style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.warn,
                )
            }
            Text(
                SchedulesTexts.META, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2,
            )
            PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.weight(1f).fillMaxWidth()) {
                when {
                    !state.loaded && state.loadFailed -> Message(SchedulesTexts.LOAD_ERROR, action = SchedulesTexts.RETRY, onAction = vm::refresh)
                    !state.loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    state.items.isEmpty() -> Message(SchedulesTexts.EMPTY, SchedulesTexts.EMPTY_HINT)
                    else -> LazyColumn(
                        Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(state.items, key = { it.id }) { s ->
                            ScheduleCard(
                                s, state, enabled,
                                onToggle = { on -> if (on) vm.setEnabled(s, true) else disabling = s.id },
                                onEdit = { vm.openEdit(s) }, onRun = { running = s.id }, onApprove = { vm.approve(s) },
                            )
                        }
                    }
                }
            }
        }
        if (state.canCreate) {
            ExtendedFloatingActionButton(
                onClick = vm::openNew,
                icon = { Icon(OrbIcons.Plus, null) },
                text = { Text(SchedulesTexts.NEW, fontWeight = FontWeight.SemiBold) },
                modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
                containerColor = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
            )
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(16.dp))
    }

    state.items.firstOrNull { it.id == running }?.let { s ->
        AlertDialog(
            onDismissRequest = { running = null },
            title = { Text(SchedulesTexts.RUN_TITLE) },
            text = { Text(SchedulesTexts.runBody(s.title)) },
            confirmButton = { TextButton(onClick = { running = null; vm.run(s) }) { Text(SchedulesTexts.RUN_NOW) } },
            dismissButton = { TextButton(onClick = { running = null }) { Text(SchedulesTexts.CANCEL) } },
        )
    } ?: run { if (running != null) running = null }

    state.items.firstOrNull { it.id == disabling }?.let { s ->
        AlertDialog(
            onDismissRequest = { disabling = null },
            title = { Text(SchedulesTexts.DISABLE_TITLE) },
            text = { Text(SchedulesTexts.disableBody(s.title)) },
            confirmButton = { TextButton(onClick = { disabling = null; vm.setEnabled(s, false) }) { Text(SchedulesTexts.DISABLE_CONFIRM) } },
            dismissButton = { TextButton(onClick = { disabling = null }) { Text(SchedulesTexts.CANCEL) } },
        )
    } ?: run { if (disabling != null) disabling = null }

    state.form?.let { f ->
        val editing = f.editing
        if (editing != null) EditDialog(f, editing, vm::saveEdit, vm::closeForm)
        else NewDialog(f, vm::create, vm::closeForm)
    }
}

@Composable
private fun ScheduleCard(
    s: ScheduleItem, state: SchedulesState, enabled: Boolean,
    onToggle: (Boolean) -> Unit, onEdit: () -> Unit, onRun: () -> Unit, onApprove: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    val needsApproval = !s.approved
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.padding(start = 16.dp, end = 4.dp, top = 10.dp, bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    s.title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                if (state.canUpdate) Switch(checked = s.enabled, onCheckedChange = onToggle, enabled = enabled && !needsApproval)
                if (state.canUpdate || state.canRun) Box {
                    IconButton(onClick = { menu = true }) { Icon(OrbIcons.MoreVertical, SchedulesTexts.MORE) }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        if (state.canUpdate) DropdownMenuItem(text = { Text(SchedulesTexts.EDIT) }, enabled = enabled, onClick = { menu = false; onEdit() })
                        if (state.canRun) DropdownMenuItem(text = { Text(SchedulesTexts.RUN_NOW) }, enabled = enabled && !needsApproval, onClick = { menu = false; onRun() })
                        if (state.canUpdate && needsApproval) DropdownMenuItem(text = { Text(SchedulesTexts.APPROVE) }, enabled = enabled, onClick = { menu = false; onApprove() })
                    }
                }
            }
            Text(
                SchedulesTexts.nextLine(s.whenText, s.project, s.nextRun.takeIf { s.enabled }),
                style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2,
            )
            val badges = listOfNotNull(
                SchedulesTexts.AWAITING.takeIf { needsApproval },
                SchedulesTexts.READONLY_BADGE.takeIf { s.readonly },
                SchedulesTexts.PAUSED.takeIf { !s.enabled && !needsApproval },
            )
            if (badges.isNotEmpty()) Text(
                badges.joinToString(" · "), style = MaterialTheme.typography.labelMedium,
                color = if (needsApproval) OrbTheme.colors.warn else OrbTheme.colors.text3,
            )
        }
    }
}

@Composable
private fun EditDialog(f: ScheduleForm, s: ScheduleItem, onSave: (String, String) -> Unit, onDismiss: () -> Unit) {
    var title by rememberSaveable(s.id) { mutableStateOf(s.title) }
    var what by rememberSaveable(s.id) { mutableStateOf(s.description) }
    AlertDialog(
        onDismissRequest = { if (!f.saving) onDismiss() },
        title = { Text(SchedulesTexts.EDIT_TITLE) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(title, { title = it }, Modifier.fillMaxWidth(), singleLine = true, label = { Text(SchedulesTexts.FIELD_TITLE) })
                OutlinedTextField(what, { what = it }, Modifier.fillMaxWidth(), minLines = 3, maxLines = 8, label = { Text(SchedulesTexts.FIELD_WHAT) })
                f.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(title, what) }, enabled = !f.saving && title.isNotBlank() && what.isNotBlank()) { Text(SchedulesTexts.EDIT_OK) }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !f.saving) { Text(SchedulesTexts.CANCEL) } },
    )
}

@Composable
private fun NewDialog(f: ScheduleForm, onCreate: (NewSchedule) -> Unit, onDismiss: () -> Unit) {
    var project by rememberSaveable { mutableStateOf<String?>(null) }
    var title by rememberSaveable { mutableStateOf("") }
    var what by rememberSaveable { mutableStateOf("") }
    var every by rememberSaveable { mutableStateOf("daily") }
    var time by rememberSaveable { mutableStateOf("09:00") }
    var dateTime by rememberSaveable { mutableStateOf("") }
    var hours by rememberSaveable { mutableStateOf("6") }
    var days by rememberSaveable { mutableStateOf(listOf(1)) }
    var readonly by rememberSaveable { mutableStateOf(false) }
    var sameChat by rememberSaveable { mutableStateOf(false) }
    val chosen = project ?: f.projects.firstOrNull()
    val at = when (every) { "once" -> dateTime.trim(); "every_hours", "hourly" -> "00:00"; else -> time.trim() }
    val ready = !f.saving && chosen != null && title.isNotBlank() && what.isNotBlank() && at.isNotEmpty()

    AlertDialog(
        onDismissRequest = { if (!f.saving) onDismiss() },
        title = { Text(SchedulesTexts.NEW_TITLE) },
        text = {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(SchedulesTexts.NEW_DESC, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2)
                if (f.projects.isEmpty()) Text(SchedulesTexts.NO_PROJECT, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.warn)
                Label(SchedulesTexts.FIELD_PROJECT)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (p in f.projects) FilterChip(selected = chosen == p, onClick = { project = p }, label = { Text(p) })
                }
                OutlinedTextField(title, { title = it }, Modifier.fillMaxWidth(), singleLine = true, label = { Text(SchedulesTexts.FIELD_TITLE) }, placeholder = { Text(SchedulesTexts.FIELD_TITLE_PH) })
                OutlinedTextField(
                    what, { what = it }, Modifier.fillMaxWidth(), minLines = 3, maxLines = 6,
                    label = { Text(SchedulesTexts.FIELD_WHAT) }, supportingText = { Text(SchedulesTexts.FIELD_WHAT_HINT) },
                )
                Label(SchedulesTexts.FIELD_FREQUENCY)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (e in ScheduleEvery) FilterChip(selected = every == e, onClick = { every = e }, label = { Text(SchedulesTexts.everyLabel(e)) })
                }
                when (every) {
                    "once" -> OutlinedTextField(dateTime, { dateTime = it }, Modifier.fillMaxWidth(), singleLine = true, label = { Text(SchedulesTexts.FIELD_DATETIME) })
                    "every_hours" -> OutlinedTextField(
                        hours, { hours = it.filter(Char::isDigit).take(3) }, Modifier.fillMaxWidth(), singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), label = { Text(SchedulesTexts.FIELD_HOURS) },
                    )
                    "daily", "weekly" -> OutlinedTextField(time, { time = it }, Modifier.fillMaxWidth(), singleLine = true, label = { Text(SchedulesTexts.FIELD_TIME) })
                }
                if (every == "weekly") {
                    Label(SchedulesTexts.FIELD_DAYS)
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        SchedulesTexts.DAYS.forEachIndexed { d, name ->
                            FilterChip(selected = d in days, onClick = { days = if (d in days) days - d else days + d }, label = { Text(name) })
                        }
                    }
                }
                CheckRow(SchedulesTexts.FIELD_READONLY, readonly) { readonly = it }
                CheckRow(SchedulesTexts.FIELD_SAME_CHAT, sameChat) { sameChat = it }
                f.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    onCreate(
                        NewSchedule(
                            project = chosen.orEmpty(), title = title, description = what, every = every, atTime = at,
                            weekdays = if (every == "weekly") days.sorted().ifEmpty { listOf(1) } else emptyList(),
                            hours = (hours.toIntOrNull() ?: 6).coerceIn(1, 168), readonly = readonly, sameChat = sameChat,
                        ),
                    )
                },
                enabled = ready,
            ) { Text(SchedulesTexts.NEW_OK) }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !f.saving) { Text(SchedulesTexts.CANCEL) } },
    )
}

@Composable
private fun Label(text: String) = Text(text, style = MaterialTheme.typography.labelMedium, color = OrbTheme.colors.text2)

@Composable
private fun CheckRow(text: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked, onChange)
        Text(text, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
    }
}

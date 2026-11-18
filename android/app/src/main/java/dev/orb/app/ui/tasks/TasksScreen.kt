package dev.orb.app.ui.tasks

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import dev.orb.app.ui.kit.OrbFab
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import dev.orb.app.ui.kit.OrbSnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.chats.ChatTexts
import dev.orb.app.ui.chats.Message
import dev.orb.app.ui.chats.SearchTask
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.offline.OfflineStrip
import dev.orb.app.ui.theme.OrbTheme

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TasksScreen(vm: TasksViewModel, onOpenTask: (Long) -> Unit, modifier: Modifier = Modifier) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    // Back from a task, from another app or from the lock screen: the board is read again.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.refresh() }

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            if (state.searching) SearchBar(state.query, vm::setQuery, vm::closeSearch) else TasksAppBar(vm::openSearch)
            if (!state.online && state.loaded) {
                OfflineStrip()
            }
            if (state.searching) {
                SearchBody(state, onOpenTask)
            } else {
                if (state.paused && state.canPause) PausedBanner(state.waitingPaused, state.queueBusy, state.online) { vm.setPaused(false) }
                FilterChips(state, vm::setFilter)
                PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.weight(1f).fillMaxWidth()) {
                    Body(state, onOpenTask, onRetry = vm::refresh, onPause = { vm.setPaused(true) })
                }
            }
        }
        if (state.canCreate && !state.searching) {
            OrbFab(TaskTexts.NEW_TASK, OrbIcons.Plus, vm::openNewTask, Modifier.align(Alignment.BottomEnd).padding(16.dp), lifted = snackbar.currentSnackbarData != null)
        }
        OrbSnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(16.dp))
    }

    state.newTask?.let { NewTaskDialog(it, onCreate = vm::createTask, onDismiss = vm::closeNewTask) }
}

@Composable
private fun TasksAppBar(onSearch: () -> Unit) {
    Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(TaskTexts.TITLE, Modifier.weight(1f).padding(start = 16.dp).semantics { heading() }, style = MaterialTheme.typography.titleLarge)
        IconButton(onClick = onSearch) { Icon(OrbIcons.Search, TaskTexts.SEARCH, tint = OrbTheme.colors.text2) }
    }
}

@Composable
private fun SearchBar(query: String, onQuery: (String) -> Unit, onClose: () -> Unit) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onClose) { Icon(OrbIcons.ArrowLeft, TaskTexts.CLOSE_SEARCH, tint = OrbTheme.colors.text2) }
        OutlinedTextField(
            query, onQuery, Modifier.weight(1f).focusRequester(focus).padding(end = 12.dp), singleLine = true,
            placeholder = { Text(TaskTexts.SEARCH_HINT) },
        )
    }
}

@Composable
private fun SearchBody(state: TasksState, onOpen: (Long) -> Unit) {
    val results = state.results
    when {
        results == null -> Unit
        results.isEmpty() -> Message(TaskTexts.NO_RESULTS)
        else -> LazyColumn(Modifier.fillMaxSize()) {
            items(results, key = { it.id }) { r -> SearchRow(r, onOpen) }
        }
    }
}

@Composable
private fun SearchRow(r: SearchTask, onOpen: (Long) -> Unit) {
    Column(Modifier.fillMaxWidth().clickable { onOpen(r.id) }.padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text("#${r.id} ${r.title}", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(
            listOfNotNull(TaskTexts.status(r.status), r.project).joinToString(" · "),
            style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2,
        )
        r.snippet?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text3, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun PausedBanner(waiting: Int, busy: Boolean, online: Boolean, onResume: () -> Unit) {
    Surface(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), shape = RoundedCornerShape(16.dp), color = OrbTheme.colors.warnSoft,
    ) {
        Row(Modifier.padding(start = 16.dp, end = 8.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(OrbIcons.Clock, null, Modifier.size(18.dp), tint = OrbTheme.colors.warn)
            Text(TaskTexts.pausedBanner(waiting), Modifier.weight(1f).padding(start = 8.dp), style = MaterialTheme.typography.bodyMedium)
            TextButton(onClick = onResume, enabled = online && !busy) { Text(TaskTexts.RESUME) }
        }
    }
}

@Composable
private fun FilterChips(state: TasksState, onFilter: (TaskFilter) -> Unit) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Chip(TaskTexts.FILTER_ALL, null, state.filter == TaskFilter.All) { onFilter(TaskFilter.All) }
        Chip(TaskTexts.FILTER_QUEUED, state.queued.takeIf { it > 0 }, state.filter == TaskFilter.Queued) { onFilter(TaskFilter.Queued) }
        Chip(TaskTexts.FILTER_APPROVE, state.approve.takeIf { it > 0 }, state.filter == TaskFilter.Approve) { onFilter(TaskFilter.Approve) }
        Chip(TaskTexts.FILTER_RUNNING, state.running.takeIf { it > 0 }, state.filter == TaskFilter.Running) { onFilter(TaskFilter.Running) }
        Chip(TaskTexts.FILTER_PROBLEMS, state.problems.takeIf { it > 0 }, state.filter == TaskFilter.Problems) { onFilter(TaskFilter.Problems) }
        Chip(TaskTexts.FILTER_DONE, null, state.filter == TaskFilter.Done) { onFilter(TaskFilter.Done) }
    }
}

@Composable
private fun Chip(label: String, count: Int?, selected: Boolean, onClick: () -> Unit) {
    FilterChip(
        selected = selected, onClick = onClick,
        label = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(label)
                if (count != null) Text(count.toString(), color = OrbTheme.colors.text3)
            }
        },
        leadingIcon = if (selected) ({ Icon(OrbIcons.Check, null, Modifier.size(18.dp)) }) else null,
    )
}

@Composable
private fun Body(state: TasksState, onOpen: (Long) -> Unit, onRetry: () -> Unit, onPause: () -> Unit) {
    when {
        !state.loaded && state.loadFailed -> Message(TaskTexts.LOAD_ERROR, action = TaskTexts.RETRY, onAction = onRetry)
        !state.loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        state.total == 0 -> Message(TaskTexts.EMPTY, TaskTexts.EMPTY_HINT)
        state.tasks.isEmpty() -> Message(TaskTexts.EMPTY_FILTER)
        else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 88.dp)) {
            if (!state.paused && state.canPause && state.queued > 0) item(key = "pause", contentType = "pause") {
                TextButton(onClick = onPause, enabled = state.online && !state.queueBusy, modifier = Modifier.padding(horizontal = 8.dp)) { Text(TaskTexts.PAUSE) }
            }
            items(state.tasks, key = { it.id }, contentType = { "task" }) { t -> TaskItem(t, state.paused, onOpen) }
        }
    }
}

@Composable
private fun TaskItem(t: TaskRow, queuePaused: Boolean, onOpen: (Long) -> Unit) {
    Column(
        Modifier.fillMaxWidth().clickable { onOpen(t.id) }.padding(horizontal = 16.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("#${t.id} ${t.title}", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            TaskStatusPill(t)
        }
        val sub = taskSubtitle(t)
        if (sub.isNotEmpty()) Text(sub, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        when {
            t.held != null -> Text(TaskTexts.heldLine(t.held.reasons, null), style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.warn, maxLines = 2, overflow = TextOverflow.Ellipsis)
            // The reason a queued task waits is the line the person looks for.
            t.status == "queued" && (t.waiting != null || queuePaused) ->
                Text(TaskTexts.waitText(t.waiting), style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2, maxLines = 2, overflow = TextOverflow.Ellipsis)
            t.running -> TaskProgress(t)
        }
    }
}

@Composable
private fun NewTaskDialog(state: NewTaskState, onCreate: (String, String, String) -> Unit, onDismiss: () -> Unit) {
    var project by rememberSaveable { mutableStateOf<String?>(null) }
    var title by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }
    val chosen = project ?: state.projects.firstOrNull()
    AlertDialog(
        onDismissRequest = { if (!state.saving) onDismiss() },
        title = { Text(TaskTexts.NEW_TASK) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                when {
                    state.loading -> Text(TaskTexts.NEW_TASK_LOADING, color = OrbTheme.colors.text2)
                    state.projects.isEmpty() -> Text(TaskTexts.NEW_TASK_NO_PROJECTS, color = OrbTheme.colors.text2)
                    else -> Box {
                        OutlinedButton(onClick = { menu = true }, modifier = Modifier.fillMaxWidth()) {
                            Text("${TaskTexts.NEW_TASK_PROJECT}: ${chosen.orEmpty()}", Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Icon(OrbIcons.ChevronDown, null)
                        }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            state.projects.forEach { p -> DropdownMenuItem(text = { Text(p) }, onClick = { project = p; menu = false }) }
                        }
                    }
                }
                OutlinedTextField(title, { title = it }, Modifier.fillMaxWidth(), singleLine = true, label = { Text(TaskTexts.NEW_TASK_TITLE) })
                OutlinedTextField(description, { description = it }, Modifier.fillMaxWidth(), minLines = 3, maxLines = 6, label = { Text(TaskTexts.NEW_TASK_DESCRIPTION) })
                state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { chosen?.let { onCreate(it, title, description) } },
                enabled = !state.saving && chosen != null && title.isNotBlank() && description.isNotBlank(),
            ) { Text(TaskTexts.NEW_TASK_CREATE) }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !state.saving) { Text(ChatTexts.CANCEL) } },
    )
}

package dev.orb.app.ui.tasks

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.chats.ChatTexts
import dev.orb.app.ui.chats.ChatsMenu
import dev.orb.app.ui.chats.Message
import dev.orb.app.ui.chats.SearchTask
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbCard
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbGroupHeader
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbRow
import dev.orb.app.ui.kit.OrbSearchField
import dev.orb.app.ui.kit.OrbSettingRow
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbSheetDivider
import dev.orb.app.ui.kit.OrbSheetItem
import dev.orb.app.ui.kit.OrbSheetLabel
import dev.orb.app.ui.kit.OrbSnackbarHost
import dev.orb.app.ui.kit.OrbSpinner
import dev.orb.app.ui.kit.OrbTopBar
import dev.orb.app.ui.notes.NotesTexts
import dev.orb.app.ui.offline.LocalOffline
import dev.orb.app.ui.offline.OfflineStrip
import dev.orb.app.ui.offline.OfflineTexts
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * The task board (screen 17): the queue's state under the title, the ☰ menu and the bell like the other main screens, and
 * the tasks in four numbered sections. What the mockup does not draw (search, new task, pausing the queue and what
 * the board shows) lives in the «⋯» menu.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TasksScreen(vm: TasksViewModel, menu: ChatsMenu, onOpenTask: (Long) -> Unit, modifier: Modifier = Modifier) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    LaunchedEffect(vm) {
        // «Cola reanudada · Deshacer»: the way back is one tap, and it does not offer another one.
        vm.queueChanges.collect { paused ->
            val r = snackbar.showSnackbar(
                if (paused) TaskTexts.QUEUE_PAUSED else TaskTexts.QUEUE_RESUMED, actionLabel = TaskTexts.UNDO, duration = SnackbarDuration.Long,
            )
            if (r == SnackbarResult.ActionPerformed) vm.setPaused(!paused, offerUndo = false)
        }
    }
    // Back from a task, from another app or from the lock screen: the board is read again.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.refresh() }
    var more by rememberSaveable { mutableStateOf(false) }
    var rejectFor by rememberSaveable { mutableStateOf<Long?>(null) }
    BackHandler(enabled = state.searching) { vm.closeSearch() }

    Column(modifier.fillMaxSize()) {
        if (state.searching) SearchBar(state.query, vm::setQuery, vm::closeSearch) else TasksBar(state, menu) { more = true }
        if (!state.online && state.loaded) OfflineStrip()
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (state.searching) {
                SearchBody(state, onOpenTask)
            } else {
                PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.fillMaxSize()) {
                    Body(state, onOpenTask, onRetry = vm::refresh, onResume = { vm.setPaused(false) }, onShowAll = { vm.setFilter(TaskFilter.All) }, onReject = { rejectFor = it.id })
                }
            }
            OrbSnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(16.dp))
        }
    }

    if (more) MoreSheet(state, vm, onDismiss = { more = false })
    state.newTask?.let { NewTaskDialog(it, onCreate = vm::createTask, onDismiss = vm::closeNewTask) }

    val doomed = rejectFor
    if (doomed != null) {
        val row = remember(doomed, state.groups) { state.groups.firstNotNullOfOrNull { g -> g.rows.firstOrNull { it.id == doomed } } }
        if (row == null) rejectFor = null else OrbDialog(
            { rejectFor = null }, TaskTexts.rejectAsk(row.id), OrbDialogAction(TaskTexts.REJECT_CONFIRM, { rejectFor = null; vm.reject(row.id) }, danger = true),
            text = TaskTexts.rejectBodyFor(row.id, row.title), dismiss = OrbDialogAction(ChatTexts.CANCEL, { rejectFor = null }),
        )
    }
}

@Composable
private fun TasksBar(state: TasksState, menu: ChatsMenu, onMore: () -> Unit) {
    val sub = if (state.loaded) TaskTexts.queueLine(state.paused, state.running, state.queued) else ChatTexts.linkLine(state.connection)
    OrbTopBar(
        title = TaskTexts.TITLE, sub = sub,
        leading = { OrbIconButton(OrbIcons.Menu, ChatTexts.MENU, menu.onMenu) },
        actions = {
            menu.onNotices?.let { open ->
                val n = menu.unreadNotices
                OrbIconButton(
                    OrbIcons.Bell, if (n > 0) NotesTexts.unreadDescription(n) else NotesTexts.BELL, open,
                    badge = n.takeIf { it > 0 }?.let { if (it > 99) "99+" else it.toString() },
                )
            }
            OrbIconButton(OrbIcons.MoreVertical, TaskTexts.MORE, onMore)
        },
    )
}

/** Everything the board offers that the mockup does not draw, in one sheet. */
@Composable
private fun MoreSheet(state: TasksState, vm: TasksViewModel, onDismiss: () -> Unit) {
    OrbSheet(onDismiss) {
        OrbSheetItem(TaskTexts.SEARCH, { onDismiss(); vm.openSearch() }, icon = OrbIcons.Search)
        if (state.canCreate) OrbSheetItem(TaskTexts.NEW_TASK, { onDismiss(); vm.openNewTask() }, icon = OrbIcons.Plus)
        if (state.canPause) {
            OrbSheetItem(
                if (state.paused) TaskTexts.RESUME_QUEUE else TaskTexts.PAUSE, { onDismiss(); vm.setPaused(!state.paused) },
                icon = if (state.paused) OrbIcons.Play else OrbIcons.Pause, enabled = state.online && !state.queueBusy,
            )
        }
        OrbSheetDivider()
        OrbSheetLabel(TaskTexts.VIEW_LABEL)
        OrbSheetItem(TaskTexts.VIEW_ACTIVE, { onDismiss(); vm.setFilter(TaskFilter.Active) }, checked = state.filter == TaskFilter.Active)
        OrbSheetItem(TaskTexts.VIEW_ALL, { onDismiss(); vm.setFilter(TaskFilter.All) }, checked = state.filter == TaskFilter.All)
        OrbSheetItem(TaskTexts.VIEW_DONE, { onDismiss(); vm.setFilter(TaskFilter.Done) }, checked = state.filter == TaskFilter.Done, meta = state.done.takeIf { it > 0 }?.toString())
    }
}

@Composable
private fun SearchBar(query: String, onQuery: (String) -> Unit, onClose: () -> Unit) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Row(Modifier.fillMaxWidth().height(56.dp).padding(start = 4.dp, end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        OrbIconButton(OrbIcons.ArrowLeft, TaskTexts.CLOSE_SEARCH, onClose)
        OrbSearchField(query, onQuery, TaskTexts.SEARCH_HINT, Modifier.weight(1f), focus = focus, onClear = { onQuery("") })
    }
}

@Composable
private fun SearchBody(state: TasksState, onOpen: (Long) -> Unit) {
    val results = state.results
    when {
        results == null -> Unit
        results.isEmpty() -> Message(TaskTexts.NO_RESULTS, icon = OrbIcons.SearchX)
        else -> LazyColumn(Modifier.fillMaxSize()) {
            items(results, key = { it.id }) { r -> SearchRow(r, onOpen) }
        }
    }
}

@Composable
private fun SearchRow(r: SearchTask, onOpen: (Long) -> Unit) {
    OrbRow(
        "#${r.id} ${r.title}", onClick = { onOpen(r.id) },
        lead = { androidx.compose.material3.Icon(OrbIcons.Tasks, null, Modifier.size(16.dp), tint = OrbKit.mutedForeground) },
        subtitle = {
            Column {
                Text(
                    listOfNotNull(TaskTexts.status(r.status), r.project).joinToString(" · "), color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                r.snippet?.takeIf { it.isNotBlank() }?.let {
                    Text(it, color = OrbKit.faintForeground, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        },
    )
}

@Composable
private fun Body(
    state: TasksState, onOpen: (Long) -> Unit, onRetry: () -> Unit, onResume: () -> Unit, onShowAll: () -> Unit, onReject: (TaskRow) -> Unit,
) {
    val live = state.groups.sumOf { g -> if (g.section == TaskSection.Done) 0 else g.rows.size }
    when {
        !state.loaded && state.loadFailed -> Message(TaskTexts.LOAD_ERROR, action = TaskTexts.RETRY, onAction = onRetry, icon = OrbIcons.CircleAlert)
        !state.loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (state.online || state.refreshing) OrbSpinner(size = 28.dp) else NoPcYet()
        }
        state.total == 0 -> Message(TaskTexts.EMPTY, TaskTexts.EMPTY_HINT, icon = OrbIcons.Tasks)
        state.filter == TaskFilter.Done && state.done == 0 -> Message(TaskTexts.EMPTY_DONE, icon = OrbIcons.Tasks)
        state.filter == TaskFilter.Active && live == 0 -> Message(TaskTexts.ALL_CLEAR, TaskTexts.ALL_CLEAR_HINT, action = TaskTexts.SHOW_ALL, onAction = onShowAll, icon = OrbIcons.CircleCheck)
        else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 88.dp)) {
            if (state.paused && state.canPause) item(key = "paused", contentType = "paused") {
                PausedCard(state.queued, state.queueBusy || !state.online, onResume, Modifier.animateItem())
            }
            for (g in state.groups) {
                item(key = "h-${g.section.name}", contentType = "header") { OrbGroupHeader(g.section.title(), Modifier.animateItem(), count = g.rows.size) }
                items(g.rows, key = { it.id }, contentType = { "task" }) { t ->
                    TaskRowItem(
                        t, state.paused, canReject = state.canReject, online = state.online, rejecting = t.id in state.rejecting,
                        onOpen = { onOpen(t.id) }, onReject = { onReject(t) }, modifier = Modifier.animateItem(),
                    )
                }
            }
        }
    }
}

/** The card at the top while the queue is paused: what is waiting and the way to start it again. */
@Composable
private fun PausedCard(waiting: Int, disabled: Boolean, onResume: () -> Unit, modifier: Modifier = Modifier) {
    Box(modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp)) {
        OrbCard {
            OrbSettingRow(
                TaskTexts.PAUSED_TITLE, subtitle = waiting.takeIf { it > 0 }?.let(TaskTexts::waitingCount), divider = false,
                trailing = { OrbButton(TaskTexts.RESUME, onResume, small = true, kind = OrbButtonKind.Primary, enabled = !disabled) },
            )
        }
    }
}

/** The PC cannot be reached and nothing was saved yet, so there is nothing to read: say so and offer to try again. */
@Composable
private fun NoPcYet() {
    val info = LocalOffline.current
    val seen by (info?.lastContact ?: remember { MutableStateFlow<Long?>(null) }).collectAsStateWithLifecycle()
    val body = OfflineTexts.NO_PC_BODY + "\n" + OfflineTexts.NOTHING_SAVED + (seen?.let { "\n" + OfflineTexts.lastConnection(it, System.currentTimeMillis()) } ?: "")
    Message(OfflineTexts.NO_PC_TITLE, body, action = if (info != null) OfflineTexts.RETRY_NOW else null, onAction = info?.retryNow)
}

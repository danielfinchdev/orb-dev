package dev.orb.app.ui.chats

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
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import dev.orb.app.ui.kit.OrbFab
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import dev.orb.app.ui.kit.OrbSnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.AlertDialog
import dev.orb.app.link.api.ConfirmAction
import dev.orb.app.link.api.Confirmed
import dev.orb.app.link.api.UserConfirmation
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.notes.NotesBell
import dev.orb.app.ui.offline.LocalOffline
import dev.orb.app.ui.offline.OfflineStrip
import dev.orb.app.ui.offline.OfflineTexts
import kotlinx.coroutines.flow.MutableStateFlow
import dev.orb.app.ui.theme.OrbTheme

/** What the Chats bar offers: the ☰ menu (a sheet the shell shows) and, when the notices center exists, its bell. */
class ChatsMenu(val onMenu: () -> Unit, val unreadNotices: Int = 0, val onNotices: (() -> Unit)? = null)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatListScreen(
    vm: ChatListViewModel,
    menu: ChatsMenu,
    onOpenChat: (ChatRef) -> Unit,
    onSearch: () -> Unit,
    onNewChat: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    LaunchedEffect(vm) {
        vm.undoOffers.collect { ref ->
            val r = snackbar.showSnackbar(ChatTexts.DELETED_SNACK, actionLabel = ChatTexts.UNDO, duration = SnackbarDuration.Long)
            if (r == SnackbarResult.ActionPerformed) vm.undoDelete(ref)
        }
    }
    var deleting by rememberSaveable { mutableStateOf<String?>(null) }
    var actionsFor by rememberSaveable { mutableStateOf<String?>(null) }
    val actions = remember(vm) {
        ChatActions(
            onPin = vm::togglePin, onMarkRead = vm::markRead, onMute = vm::toggleMute, onSnooze = vm::snooze,
            onMove = vm::moveToSection, onMoveToNew = vm::moveToNewSection, onRename = vm::rename, onArchive = vm::archive,
            onDelete = null,
        )
    }

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            ChatsAppBar(menu, onSearch)
            if (!state.online && state.loaded) OfflineStrip()
            FilterChips(state, vm::setFilter, vm::setOrder)
            PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.weight(1f).fillMaxWidth()) {
                ListBody(state, onOpenChat, onLongPress = { actionsFor = it.key }, onRetry = vm::refresh, onCloseDigest = vm::closeDigest, onReorder = vm::reorder)
            }
        }
        OrbFab(ChatTexts.NEW_CHAT, OrbIcons.SquarePen, onNewChat, Modifier.align(Alignment.BottomEnd).padding(16.dp), lifted = snackbar.currentSnackbarData != null)
        OrbSnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(16.dp))
    }

    val doomed = deleting
    if (doomed != null) {
        val row = remember(doomed, state.entries) { state.entries.firstNotNullOfOrNull { (it as? RowEntry)?.row?.takeIf { r -> r.key == doomed } } }
        if (row == null) deleting = null else DeleteChatDialog(
            row.title, onDismiss = { deleting = null },
            onConfirm = {
                deleting = null
                // The only place a deletion token is made: the person has just accepted this dialog.
                @OptIn(UserConfirmation::class)
                val token = Confirmed(if (row.kind == ChatKind.Orbe) ConfirmAction.TrashConversation else ConfirmAction.TrashSession, row.id)
                vm.delete(row, token)
            },
        )
    }

    val key = actionsFor
    if (key != null) {
        val row = remember(key, state.entries) { state.entries.firstNotNullOfOrNull { (it as? RowEntry)?.row?.takeIf { r -> r.key == key } } }
        if (row == null) {
            actionsFor = null
        } else {
            val withDelete = remember(actions, row.kind, vm) {
                if (vm.canDelete(row.kind)) ChatActions(
                    actions.onPin, actions.onMarkRead, actions.onMute, actions.onSnooze, actions.onMove, actions.onMoveToNew,
                    actions.onRename, actions.onArchive, onDelete = { deleting = it.key },
                ) else actions
            }
            ChatActionsSheet(row, state.sections, state.online, withDelete, onDismiss = { actionsFor = null })
        }
    }
}

@Composable
private fun ChatsAppBar(menu: ChatsMenu, onSearch: () -> Unit) {
    Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = menu.onMenu) { Icon(OrbIcons.Menu, ChatTexts.MENU, tint = OrbTheme.colors.text2) }
        Text(
            ChatTexts.TAB_CHATS, Modifier.weight(1f).padding(start = 4.dp).semantics { heading() },
            style = MaterialTheme.typography.titleLarge,
        )
        menu.onNotices?.let { NotesBell(menu.unreadNotices, it) }
        IconButton(onClick = onSearch) { Icon(OrbIcons.Search, ChatTexts.SEARCH, tint = OrbTheme.colors.text2) }
    }
}

@Composable
private fun FilterChips(state: ChatListState, onFilter: (ChatFilter) -> Unit, onOrder: (ChatOrder) -> Unit) {
    val texts = remember { InboxTexts.current() }
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Chip(ChatTexts.FILTER_ALL, null, state.filter == ChatFilter.All) { onFilter(ChatFilter.All) }
        Chip(ChatTexts.FILTER_UNREAD, state.unreadChats.takeIf { it > 0 }, state.filter == ChatFilter.Unread) { onFilter(ChatFilter.Unread) }
        Chip(ChatTexts.FILTER_WORKING, state.workingChats.takeIf { it > 0 }, state.filter == ChatFilter.Working) { onFilter(ChatFilter.Working) }
        Chip(ChatTexts.FILTER_DIRECT, null, state.filter == ChatFilter.Direct) { onFilter(ChatFilter.Direct) }
        // An order, not a filter: it changes how the rows are laid out, not which ones show.
        Chip(texts.priority, null, state.order == ChatOrder.Priority) { onOrder(if (state.order == ChatOrder.Priority) ChatOrder.Recent else ChatOrder.Priority) }
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
private fun ListBody(
    state: ChatListState, onOpen: (ChatRef) -> Unit, onLongPress: (ChatRow) -> Unit, onRetry: () -> Unit,
    onCloseDigest: () -> Unit, onReorder: () -> Unit,
) {
    when {
        !state.loaded && state.loadFailed -> Message(ChatTexts.LOAD_ERROR, action = ChatTexts.RETRY, onAction = onRetry)
        !state.loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (state.online || state.refreshing) CircularProgressIndicator() else NoPcYet()
        }
        state.total == 0 -> Message(ChatTexts.EMPTY_TITLE, ChatTexts.EMPTY_BODY)
        state.entries.isEmpty() -> Message(ChatTexts.EMPTY_FILTER)
        else -> {
            // The clock is read when the list is composed; rows do not repaint just because a minute went by.
            val now = remember(state.entries) { System.currentTimeMillis() }
            val list = rememberLazyListState()
            val texts = remember { InboxTexts.current() }
            LazyColumn(Modifier.fillMaxSize(), list, contentPadding = PaddingValues(bottom = 96.dp)) {
                state.digest?.let { d -> item(key = "digest", contentType = "digest") { DigestCard(d, texts, onCloseDigest, Modifier.animateItem()) } }
                if (state.order == ChatOrder.Priority) item(key = "reorder", contentType = "reorder") {
                    TextButton(onClick = onReorder, Modifier.padding(horizontal = 8.dp)) {
                        Text(texts.reorder, style = MaterialTheme.typography.labelLarge, color = OrbTheme.colors.text2)
                    }
                }
                items(state.entries, key = { it.key }, contentType = { it.contentType }) { entry ->
                    when (entry) {
                        is HeaderEntry -> SectionHeader(entry, Modifier.animateItem())
                        is RowEntry -> {
                            val row = entry.row
                            ChatRowItem(
                                row, ChatTime.short(row.at, now),
                                onClick = { onOpen(row.ref) }, onLongClick = { onLongPress(row) },
                                modifier = Modifier.animateItem(),
                            )
                        }
                    }
                }
            }
        }
    }
}

/** The summary of the day: what the PC registered yesterday. A line with nothing behind it is not drawn. */
@Composable
internal fun DigestCard(d: DayDigest, texts: InboxTexts, onClose: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainer,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(Modifier.padding(start = 16.dp, top = 8.dp, end = 4.dp, bottom = 12.dp).testTag("day-digest")) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    texts.digestTitle, Modifier.weight(1f).semantics { heading() },
                    style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold,
                )
                Text(d.day, style = MaterialTheme.typography.labelSmall, color = OrbTheme.colors.text3)
                IconButton(onClick = onClose, Modifier.testTag("day-digest-close")) {
                    Icon(OrbIcons.Close, texts.digestClose, Modifier.size(18.dp), tint = OrbTheme.colors.text2)
                }
            }
            Column(Modifier.padding(end = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (line in d.lines) {
                    Column(Modifier.testTag("day-digest-${line.key}")) {
                        Text(line.text, style = MaterialTheme.typography.bodyMedium)
                        for (item in line.items) {
                            Text(
                                "· $item", Modifier.padding(start = 4.dp, top = 2.dp), style = MaterialTheme.typography.bodySmall,
                                color = OrbTheme.colors.text2, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionHeader(h: HeaderEntry, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().padding(start = 16.dp, end = 24.dp, top = 16.dp, bottom = 4.dp).semantics { heading() },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (h.pin) Icon(OrbIcons.Pin, null, Modifier.size(14.dp), tint = OrbTheme.colors.text2)
        Text(h.title, style = MaterialTheme.typography.titleSmall, color = OrbTheme.colors.text2)
    }
}

@Composable
fun Message(title: String, body: String? = null, action: String? = null, onAction: (() -> Unit)? = null) {
    Column(
        Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        if (body != null) Text(body, Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodyMedium, color = OrbTheme.colors.text2, textAlign = TextAlign.Center)
        if (action != null && onAction != null) TextButton(onClick = onAction, modifier = Modifier.padding(top = 8.dp)) { Text(action) }
    }
}

/** The PC runs the deletion; the chat can be brought back right after from the «Deshacer» notice. */
@Composable
internal fun DeleteChatDialog(title: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(OrbIcons.Trash, null, tint = MaterialTheme.colorScheme.error) },
        title = { Text(ChatTexts.DELETE_TITLE) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(ChatTexts.deleteBody(title), style = MaterialTheme.typography.bodyMedium)
                Text(ChatTexts.DELETE_NOTE, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2)
            }
        },
        confirmButton = { TextButton(onClick = onConfirm) { Text(ChatTexts.DELETE_CONFIRM, color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(ChatTexts.CANCEL) } },
    )
}

/** The PC cannot be reached and nothing was saved yet, so there is nothing to read: say so and offer to try again. */
@Composable
private fun NoPcYet() {
    val info = LocalOffline.current
    val seen by (info?.lastContact ?: remember { MutableStateFlow<Long?>(null) }).collectAsStateWithLifecycle()
    val body = OfflineTexts.NO_PC_BODY + "\n" + OfflineTexts.NOTHING_SAVED + (seen?.let { "\n" + OfflineTexts.lastConnection(it, System.currentTimeMillis()) } ?: "")
    Message(OfflineTexts.NO_PC_TITLE, body, action = if (info != null) OfflineTexts.RETRY_NOW else null, onAction = info?.retryNow)
}

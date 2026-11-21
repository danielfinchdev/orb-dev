package dev.orb.app.ui.chats

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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.link.api.ConfirmAction
import dev.orb.app.link.api.Confirmed
import dev.orb.app.link.api.UserConfirmation
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbCard
import dev.orb.app.ui.kit.OrbChip
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbEmpty
import dev.orb.app.ui.kit.OrbFab
import dev.orb.app.ui.kit.OrbGroupHeader
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbNote
import dev.orb.app.ui.kit.OrbSearchButton
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbSheetItem
import dev.orb.app.ui.kit.OrbSnackbarHost
import dev.orb.app.ui.kit.OrbSpinner
import dev.orb.app.ui.kit.OrbTopBar
import dev.orb.app.ui.kit.OrbWordmark
import dev.orb.app.ui.notes.NotesTexts
import dev.orb.app.ui.offline.LocalOffline
import dev.orb.app.ui.offline.OfflineStrip
import dev.orb.app.ui.offline.OfflineTexts
import dev.orb.app.ui.offline.ReadOnlyHeader
import dev.orb.app.ui.offline.ReadOnlyMode
import androidx.compose.material3.Text
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * What the Chats bar offers: the ☰ menu (a sheet the shell shows, which also holds the list's ordering and the day summary)
 * and, when the notices center exists, its bell.
 */
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
    // Set while the app shows only what the phone holds: the list drops everything that needs the PC.
    readOnly: ReadOnlyMode? = null,
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
    LaunchedEffect(vm) {
        vm.archiveOffers.collect { ref ->
            val r = snackbar.showSnackbar(ChatTexts.ARCHIVED_SNACK, actionLabel = ChatTexts.UNDO, duration = SnackbarDuration.Long)
            if (r == SnackbarResult.ActionPerformed) vm.unarchive(ref)
        }
    }
    var deleting by rememberSaveable { mutableStateOf<String?>(null) }
    var actionsFor by rememberSaveable { mutableStateOf<String?>(null) }
    val actions = remember(vm) {
        ChatActions(
            onPin = vm::togglePin, onMarkRead = vm::markRead, onMute = vm::mute, onSnooze = vm::snooze,
            onMove = vm::moveToSection, onMoveToNew = vm::moveToNewSection, onRename = vm::rename, onArchive = vm::archive,
            onDelete = null, onMarkUnread = if (vm.canMarkUnread()) ({ r: ChatRow -> vm.markUnread(r); Unit }) else null, timedMute = vm.canMarkUnread(),
        )
    }

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            if (readOnly != null) {
                ReadOnlyHeader(readOnly)
            } else {
                ChatsTopBar(menu, ChatTexts.linkLine(state.connection))
                if (!state.online && state.loaded) OfflineStrip()
                OrbSearchButton(ChatTexts.SEARCH, onSearch, Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp))
                ChatFilters(state, vm::setFilter)
            }
            PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.weight(1f).fillMaxWidth()) {
                ListBody(
                    state, onOpenChat, selected = actionsFor, onLongPress = { if (readOnly == null) actionsFor = it.key }, readOnly = readOnly != null, onRetry = vm::refresh, onCloseDigest = vm::closeDigest,
                    onReorder = vm::reorder, onToggleGroup = vm::toggleGroup, onShowAll = { vm.setFilter(ChatFilter.All) },
                    onMarkRead = vm::markRead, onArchive = vm::archive, onRestore = { vm.unarchive(it.ref) },
                )
            }
        }
        if (readOnly == null) OrbFab(ChatTexts.NEW_CHAT, OrbIcons.SquarePen, onNewChat, Modifier.align(Alignment.BottomEnd).padding(16.dp), lifted = snackbar.currentSnackbarData != null)
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
                if (vm.canDelete(row.kind)) actions.withDelete { deleting = it.key } else actions
            }
            ChatActionsSheet(row, state.sections, state.online, withDelete, onDismiss = { actionsFor = null })
        }
    }
}

@Composable
private fun ChatsTopBar(menu: ChatsMenu, sub: String) {
    OrbTopBar(
        title = ChatTexts.TAB_CHATS, sub = sub, center = { OrbWordmark() },
        leading = { OrbIconButton(OrbIcons.Menu, ChatTexts.MENU, menu.onMenu) },
        actions = {
            menu.onNotices?.let { open ->
                val n = menu.unreadNotices
                OrbIconButton(
                    OrbIcons.Bell, if (n > 0) NotesTexts.unreadDescription(n) else NotesTexts.BELL, open,
                    badge = n.takeIf { it > 0 }?.let { if (it > 99) "99+" else it.toString() },
                )
            }
        },
    )
}

@Composable
private fun ChatFilters(state: ChatListState, onFilter: (ChatFilter) -> Unit) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        OrbChip(ChatTexts.FILTER_ALL, state.filter == ChatFilter.All, { onFilter(ChatFilter.All) })
        OrbChip(ChatTexts.FILTER_UNREAD, state.filter == ChatFilter.Unread, { onFilter(ChatFilter.Unread) }, count = state.unreadChats.takeIf { it > 0 })
        OrbChip(ChatTexts.FILTER_WORKING, state.filter == ChatFilter.Working, { onFilter(ChatFilter.Working) }, count = state.workingChats.takeIf { it > 0 })
        OrbChip(ChatTexts.FILTER_DIRECT, state.filter == ChatFilter.Direct, { onFilter(ChatFilter.Direct) })
    }
}

@Composable
private fun ListBody(
    state: ChatListState, onOpen: (ChatRef) -> Unit, selected: String?, onLongPress: (ChatRow) -> Unit, readOnly: Boolean, onRetry: () -> Unit,
    onCloseDigest: () -> Unit, onReorder: () -> Unit, onToggleGroup: (String) -> Unit, onShowAll: () -> Unit,
    onMarkRead: (ChatRow) -> Boolean, onArchive: (ChatRow) -> Boolean, onRestore: (ChatRow) -> Boolean,
) {
    when {
        !state.loaded && state.loadFailed -> Message(ChatTexts.LOAD_ERROR, action = ChatTexts.RETRY, onAction = onRetry)
        !state.loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (state.online || state.refreshing) OrbSpinner(size = 28.dp) else NoPcYet()
        }
        state.total == 0 && state.doneChats == 0 -> Message(ChatTexts.EMPTY_TITLE, ChatTexts.EMPTY_BODY, icon = OrbIcons.Chat)
        state.entries.isEmpty() -> Message(ChatTexts.EMPTY_FILTER, icon = OrbIcons.Search, action = ChatTexts.SHOW_ALL, onAction = onShowAll)
        else -> {
            // The clock is read when the list is composed; rows do not repaint just because a minute went by.
            val now = remember(state.entries) { System.currentTimeMillis() }
            val list = rememberLazyListState()
            LazyColumn(Modifier.fillMaxSize(), list, contentPadding = PaddingValues(bottom = 110.dp)) {
                state.digest?.let { d -> item(key = "digest", contentType = "digest") { DigestCard(d, onCloseDigest, Modifier.animateItem()) } }
                if (state.order == ChatOrder.Priority) item(key = "priority", contentType = "priority") {
                    OrbNote(InboxTexts.current().priorityHint, Modifier.padding(horizontal = 16.dp, vertical = 8.dp).animateItem())
                }
                items(state.entries, key = { it.key }, contentType = { it.contentType }) { entry ->
                    when (entry) {
                        is HeaderEntry -> GroupHeader(entry, onToggleGroup, Modifier.animateItem())
                        is RowEntry -> {
                            val row = entry.row
                            ChatRowItem(
                                row, ChatTime.listTime(row.at, now),
                                onClick = { onOpen(row.ref) }, onLongClick = { onLongPress(row) },
                                modifier = Modifier.animateItem(), selected = row.key == selected,
                                onMarkRead = if (readOnly) null else ({ onMarkRead(row) }),
                                // A finished chat is brought back from the same gesture instead of archived again.
                                onArchive = if (row.done || readOnly) null else ({ onArchive(row) }),
                                onRestore = if (row.done && !readOnly) ({ onRestore(row) }) else null,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun GroupHeader(h: HeaderEntry, onToggle: (String) -> Unit, modifier: Modifier = Modifier) {
    OrbGroupHeader(
        h.title,
        // «Fijados» does not fold: no arrow, no tap, nothing to announce
        if (h.kind == HeaderKind.Pinned) modifier else modifier.semantics { stateDescription = if (h.collapsed) ChatTexts.FOLDED else ChatTexts.UNFOLDED },
        icon = if (h.kind == HeaderKind.Pinned) OrbIcons.Pin else null,
        project = h.title.takeIf { h.kind == HeaderKind.Project },
        noProject = h.kind == HeaderKind.NoProject,
        count = h.count.takeIf { h.kind == HeaderKind.Project || h.kind == HeaderKind.Section },
        collapsed = h.collapsed.takeIf { h.kind != HeaderKind.Pinned }, chevronAtEnd = h.kind == HeaderKind.Done,
        onClick = if (h.kind == HeaderKind.Pinned) null else ({ onToggle(h.key) }),
    )
}

/** The summary of the day: what the PC registered yesterday. A line with nothing behind it is not drawn. */
@Composable
internal fun DigestCard(d: DayDigest, onClose: () -> Unit, modifier: Modifier = Modifier) {
    val texts = remember { InboxTexts.current() }
    OrbCard(modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
        Column(Modifier.padding(start = 16.dp, top = 8.dp, end = 4.dp, bottom = 12.dp).testTag("day-digest")) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    texts.digestTitle, Modifier.weight(1f).semantics { heading() }, color = OrbKit.foreground,
                    fontSize = 15.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold,
                )
                Text(d.day, color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp)
                OrbIconButton(OrbIcons.Close, texts.digestClose, onClose, Modifier.testTag("day-digest-close"))
            }
            Column(Modifier.padding(end = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (line in d.lines) {
                    Column(Modifier.testTag("day-digest-${line.key}")) {
                        Text(line.text, color = OrbKit.foreground, fontSize = 14.5.sp, lineHeight = 21.sp)
                        for (item in line.items) {
                            Text(
                                "· $item", Modifier.padding(start = 4.dp, top = 2.dp), color = OrbKit.mutedForeground,
                                fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** A centred title with an optional line and button, for the states that have no list (empty, error, no PC). */
@Composable
fun Message(
    title: String, body: String? = null, action: String? = null, onAction: (() -> Unit)? = null,
    icon: androidx.compose.ui.graphics.vector.ImageVector? = null,
) {
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        OrbEmpty(
            title, text = body, icon = icon,
            actions = if (action != null && onAction != null) ({ OrbButton(action, onAction) }) else null,
        )
    }
}

/** The PC runs the deletion; the chat can be brought back right after from the «Deshacer» notice. */
@Composable
internal fun DeleteChatDialog(title: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    OrbDialog(
        onDismiss, ChatTexts.DELETE_TITLE, OrbDialogAction(ChatTexts.DELETE_CONFIRM, onConfirm),
        text = ChatTexts.deleteBody(title), dismiss = OrbDialogAction(ChatTexts.CANCEL, onDismiss),
        content = { OrbNote(ChatTexts.DELETE_NOTE) },
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

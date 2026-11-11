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
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.theme.OrbTheme

/** Where the menu of the Chats bar leads; the shell wires each to its screen. */
class ChatsMenu(val pcLabel: String, val onAppearance: () -> Unit, val onLinkTest: () -> Unit, val onUnlink: () -> Unit)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatListScreen(
    vm: ChatListViewModel,
    menu: ChatsMenu,
    onOpenChat: (ChatRef) -> Unit,
    onSearch: () -> Unit,
    onNewChat: () -> Unit,
    onDelete: (ChatRef) -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    var actionsFor by rememberSaveable { mutableStateOf<String?>(null) }
    val actions = remember(vm, onDelete) {
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
            FilterChips(state, vm::setFilter)
            PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.weight(1f).fillMaxWidth()) {
                ListBody(state, onOpenChat, onLongPress = { actionsFor = it.key }, onRetry = vm::refresh)
            }
        }
        ExtendedFloatingActionButton(
            onClick = onNewChat,
            icon = { Icon(OrbIcons.Plus, null) },
            text = { Text(ChatTexts.NEW_CHAT, fontWeight = FontWeight.SemiBold) },
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        )
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(16.dp))
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
                    actions.onRename, actions.onArchive, onDelete = { onDelete(it.ref) },
                ) else actions
            }
            ChatActionsSheet(row, state.sections, state.online, withDelete, onDismiss = { actionsFor = null })
        }
    }
}

@Composable
private fun ChatsAppBar(menu: ChatsMenu, onSearch: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box {
            IconButton(onClick = { open = true }) { Icon(OrbIcons.Menu, ChatTexts.MENU, tint = OrbTheme.colors.text2) }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                Text(menu.pcLabel, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.bodyMedium, color = OrbTheme.colors.text2)
                DropdownMenuItem(text = { Text(ChatTexts.MENU_APPEARANCE) }, leadingIcon = { Icon(OrbIcons.Palette, null) }, onClick = { open = false; menu.onAppearance() })
                DropdownMenuItem(text = { Text(ChatTexts.MENU_LINK_TEST) }, leadingIcon = { Icon(OrbIcons.Activity, null) }, onClick = { open = false; menu.onLinkTest() })
                DropdownMenuItem(text = { Text(ChatTexts.MENU_UNLINK) }, leadingIcon = { Icon(OrbIcons.LogOut, null) }, onClick = { open = false; menu.onUnlink() })
            }
        }
        Text(
            ChatTexts.TAB_CHATS, Modifier.weight(1f).padding(start = 4.dp).semantics { heading() },
            style = MaterialTheme.typography.titleLarge,
        )
        IconButton(onClick = onSearch) { Icon(OrbIcons.Search, ChatTexts.SEARCH, tint = OrbTheme.colors.text2) }
    }
}

@Composable
private fun OfflineStrip() {
    Text(
        ChatTexts.OFFLINE_STRIP, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.warn,
    )
}

@Composable
private fun FilterChips(state: ChatListState, onFilter: (ChatFilter) -> Unit) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Chip(ChatTexts.FILTER_ALL, null, state.filter == ChatFilter.All) { onFilter(ChatFilter.All) }
        Chip(ChatTexts.FILTER_UNREAD, state.unreadChats.takeIf { it > 0 }, state.filter == ChatFilter.Unread) { onFilter(ChatFilter.Unread) }
        Chip(ChatTexts.FILTER_WORKING, state.workingChats.takeIf { it > 0 }, state.filter == ChatFilter.Working) { onFilter(ChatFilter.Working) }
        Chip(ChatTexts.FILTER_DIRECT, null, state.filter == ChatFilter.Direct) { onFilter(ChatFilter.Direct) }
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
private fun ListBody(state: ChatListState, onOpen: (ChatRef) -> Unit, onLongPress: (ChatRow) -> Unit, onRetry: () -> Unit) {
    when {
        !state.loaded && state.loadFailed -> Message(ChatTexts.LOAD_ERROR, action = ChatTexts.RETRY, onAction = onRetry)
        !state.loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (state.online || state.refreshing) CircularProgressIndicator() else Message(ChatTexts.NEEDS_PC, ChatTexts.NEEDS_PC_HINT)
        }
        state.total == 0 -> Message(ChatTexts.EMPTY_TITLE, ChatTexts.EMPTY_BODY)
        state.entries.isEmpty() -> Message(ChatTexts.EMPTY_FILTER)
        else -> {
            // The clock is read when the list is composed; rows do not repaint just because a minute went by.
            val now = remember(state.entries) { System.currentTimeMillis() }
            val list = rememberLazyListState()
            LazyColumn(Modifier.fillMaxSize(), list, contentPadding = PaddingValues(bottom = 96.dp)) {
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

@Composable
private fun SectionHeader(h: HeaderEntry, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().padding(start = 16.dp, end = 24.dp, top = 16.dp, bottom = 4.dp).semantics { heading() },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (h.pin) Icon(OrbIcons.Pin, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.secondary)
        Text(h.title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.secondary)
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

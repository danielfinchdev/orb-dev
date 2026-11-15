package dev.orb.app.ui.notes

import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.chats.ChatTime
import dev.orb.app.ui.chats.Message
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.shell.ScreenBar
import dev.orb.app.ui.offline.OfflineStrip
import dev.orb.app.ui.theme.OrbTheme

/** The bell of a top bar: it shows how many notices are unread and opens the center. */
@Composable
fun NotesBell(unread: Int, onClick: () -> Unit, modifier: Modifier = Modifier) {
    IconButton(onClick = onClick, modifier = modifier.semantics { contentDescription = NotesTexts.unreadDescription(unread).takeIf { unread > 0 } ?: NotesTexts.BELL }) {
        if (unread > 0) {
            BadgedBox(badge = { Badge { Text(if (unread > 99) "99+" else unread.toString()) } }) { Icon(OrbIcons.Bell, null, tint = OrbTheme.colors.text2) }
        } else Icon(OrbIcons.Bell, null, tint = OrbTheme.colors.text2)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotesScreen(
    vm: NotesViewModel, onBack: () -> Unit, onOpen: (NoticeTarget) -> Unit, modifier: Modifier = Modifier,
    nowMs: () -> Long = System::currentTimeMillis,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.refresh() }

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            ScreenBar(NotesTexts.TITLE, onBack, NotesTexts.BACK) {
                TextButton(onClick = vm::markAllRead, enabled = state.unread > 0 && !state.markingAll) { Text(NotesTexts.MARK_ALL) }
            }
            if (!state.online) {
                OfflineStrip()
            }
            PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.weight(1f).fillMaxWidth()) {
                if (state.rows.isEmpty()) Message(NotesTexts.EMPTY, NotesTexts.EMPTY_HINT) else LazyColumn(
                    Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(state.rows, key = { it.notice.id }) { row ->
                        NoticeItem(row, nowMs()) {
                            vm.open(row.notice)
                            row.notice.target?.let(onOpen)
                        }
                    }
                }
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(16.dp))
    }
}

@Composable
private fun NoticeItem(row: NoticeRow, now: Long, onClick: () -> Unit) {
    val n = row.notice
    Surface(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).clickable(onClick = onClick),
        shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow,
    ) {
        Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
            // The dot of an unread notice; a read one keeps the space so the titles line up.
            Box(Modifier.padding(top = 6.dp).size(8.dp)) {
                if (row.unread) Surface(Modifier.size(8.dp), shape = CircleShape, color = MaterialTheme.colorScheme.primary) {}
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                    Text(
                        n.title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall,
                        fontWeight = if (row.unread) FontWeight.Bold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    Text(ChatTime.short(ChatTime.iso(n.at), now), style = MaterialTheme.typography.labelSmall, color = OrbTheme.colors.text3)
                }
                if (n.body.isNotBlank()) Text(n.body, style = MaterialTheme.typography.bodyMedium, color = OrbTheme.colors.text2, maxLines = 3, overflow = TextOverflow.Ellipsis)
                Text(NotesTexts.kind(n.kind), style = MaterialTheme.typography.labelSmall, color = OrbTheme.colors.text3)
            }
        }
    }
}

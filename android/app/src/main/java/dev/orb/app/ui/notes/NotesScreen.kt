package dev.orb.app.ui.notes

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.chats.ChatTime
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbEmpty
import dev.orb.app.ui.kit.OrbGroupHeader
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbNote
import dev.orb.app.ui.kit.OrbRow
import dev.orb.app.ui.kit.OrbSnackbarHost
import dev.orb.app.ui.kit.OrbSubtitle
import dev.orb.app.ui.kit.OrbSwipeAction
import dev.orb.app.ui.kit.OrbSwipeRow
import dev.orb.app.ui.kit.OrbTopBar
import dev.orb.app.ui.kit.OrbUnread
import dev.orb.app.ui.offline.OfflineStrip
import java.util.TimeZone

/** One line of the list: a heading of a day or a notice. */
private sealed interface Line {
    data class Heading(val day: NoticeDay) : Line
    data class Item(val row: NoticeRow) : Line
}

private fun lines(rows: List<NoticeRow>, now: Long, tz: TimeZone): List<Line> {
    val out = ArrayList<Line>()
    var last: NoticeDay? = null
    for (r in rows) {
        val day = NoticeDays.of(r.notice.at, now, tz)
        if (day != last) { out += Line.Heading(day); last = day }
        out += Line.Item(r)
    }
    return out
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotesScreen(
    vm: NotesViewModel, onBack: () -> Unit, onOpen: (NoticeTarget) -> Unit, modifier: Modifier = Modifier,
    nowMs: () -> Long = System::currentTimeMillis, zone: TimeZone = TimeZone.getDefault(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    LaunchedEffect(vm) {
        vm.dismissOffers.collect { id ->
            if (snackbar.showSnackbar(NotesTexts.DISMISSED, actionLabel = NotesTexts.UNDO, duration = SnackbarDuration.Long) == SnackbarResult.ActionPerformed) vm.undoDismiss(id)
        }
    }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.refresh() }
    val now = remember(state.rows) { nowMs() }

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            OrbTopBar(
                NotesTexts.TITLE, sub = NotesTexts.unreadLine(state.unread).takeIf { state.unread > 0 },
                leading = { OrbIconButton(OrbIcons.ArrowLeft, NotesTexts.BACK, onBack) },
                actions = {
                    OrbButton(
                        NotesTexts.MARK_ALL, vm::markAllRead, kind = OrbButtonKind.Ghost, small = true,
                        enabled = state.unread > 0 && !state.markingAll,
                    )
                },
            )
            if (!state.online) OfflineStrip(asBanner = true)
            PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.weight(1f).fillMaxWidth()) {
                if (state.rows.isEmpty()) {
                    // Under the header, as the mockup draws it, not in the middle of the screen.
                    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Top, horizontalAlignment = Alignment.CenterHorizontally) {
                        if (state.pcKeepsList) OrbEmpty(NotesTexts.EMPTY_CLEAR, text = NotesTexts.EMPTY_CLEAR_HINT, icon = OrbIcons.Bell)
                        else OrbEmpty(NotesTexts.EMPTY, text = NotesTexts.EMPTY_HINT, icon = OrbIcons.Bell)
                    }
                } else {
                    val all = remember(state.rows, now) { lines(state.rows, now, zone) }
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
                        items(all, key = { if (it is Line.Heading) "day:${it.day}" else (it as Line.Item).row.notice.id }) { line ->
                            when (line) {
                                is Line.Heading -> OrbGroupHeader(NotesTexts.day(line.day))
                                is Line.Item -> NoticeItem(line.row, now, onDismiss = { vm.dismiss(line.row.notice) }) {
                                    vm.open(line.row.notice)
                                    line.row.notice.target?.let(onOpen)
                                }
                            }
                        }
                        item(key = "hint") { OrbNote(NotesTexts.FOOTNOTE, Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) }
                    }
                }
            }
        }
        OrbSnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(16.dp))
    }
}

/** The mark of a row: a small line icon by what the notice is about. */
private fun iconOf(kind: String): ImageVector = when (kind) {
    NoticeKinds.TASK -> OrbIcons.Hand
    NoticeKinds.APPROVAL -> OrbIcons.ShieldCheck
    NoticeKinds.DONE -> OrbIcons.CircleCheck
    NoticeKinds.HELD -> OrbIcons.ShieldAlert
    NoticeKinds.UPDATE -> OrbIcons.Download
    NoticeKinds.LIMIT -> OrbIcons.Gauge
    else -> OrbIcons.Bot
}

@Composable
private fun NoticeItem(row: NoticeRow, now: Long, onDismiss: () -> Unit, onClick: () -> Unit) {
    val n = row.notice
    val (title, sub) = NotesTexts.lines(n)
    val item: @Composable () -> Unit = {
        OrbRow(
            title, Modifier.semantics(mergeDescendants = true) { if (row.unread) stateDescription = NotesTexts.UNREAD },
            lead = { Icon(iconOf(n.kind), null, Modifier.size(16.dp), tint = OrbKit.mutedForeground) },
            subtitle = sub?.let { s -> { OrbSubtitle(s) } },
            time = ChatTime.short(ChatTime.iso(n.at), now),
            badge = if (row.unread) ({ OrbUnread(1, soft = true) }) else null,
            unread = row.unread, onClick = onClick, centerBadge = true,
        )
    }
    // A permission request that still waits is the PC's own state: it leaves when it is answered, never by a swipe.
    if (n.kind == NoticeKinds.APPROVAL) item() else OrbSwipeRow(
        end = OrbSwipeAction(
            NotesTexts.DISMISS, OrbIcons.BellOff, onTrigger = { onDismiss(); true }, leaves = true,
            container = { OrbKit.muted }, content = { OrbKit.foreground },
        ),
    ) { item() }
}

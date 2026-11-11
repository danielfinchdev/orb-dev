package dev.orb.app.ui.chats

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.theme.OrbMotion
import dev.orb.app.ui.theme.OrbTheme

/** The direct conversation with an agent (A05, A34). A remote control: it shows what the PC says and asks it for things. */
@Composable
fun DirectChatScreen(
    vm: DirectChatViewModel,
    onBack: () -> Unit,
    onOpenChat: (String) -> Unit,
    modifier: Modifier = Modifier,
    nowMs: () -> Long = System::currentTimeMillis,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    LaunchedEffect(vm) {
        vm.effects.collect { fx ->
            when (fx) {
                is DirectEffect.Open -> onOpenChat(fx.id)
                DirectEffect.Leave -> onBack()
            }
        }
    }
    var stick by remember { mutableStateOf(true) }
    var renaming by remember { mutableStateOf(false) }
    val actions = remember(vm) { DirectActions(vm::decide, vm::retrySend, vm::discard, vm::resume) }

    Box(modifier.fillMaxSize().imePadding()) {
        Column(Modifier.fillMaxSize()) {
            DirectTopBar(
                state, onBack,
                MenuActions(vm::fork, vm::compact, vm::stop, vm::resume, vm::settle, { renaming = true }, vm::archive),
            )
            AnimatedVisibility(!state.online && state.loaded && !state.deleted, enter = fadeIn() + slideInVertically { -it / 2 }, exit = fadeOut()) {
                OfflineStrip()
            }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    state.deleted -> DeletedDirect(onBack)
                    !state.loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    else -> DirectList(vm, state, actions, nowMs, stick, onStick = { stick = it })
                }
            }
            if (!state.deleted) {
                QueueTray(state.queue, state.online, vm::editQueued, vm::removeQueued, vm::moveQueued)
                val choices = remember(state.busy, state.canSteer, vm) {
                    if (!state.busy) emptyList()
                    else listOfNotNull(
                        if (state.canSteer) ComposerChoice(ChatTexts.STEER) { stick = true; vm.send(it, SendMode.Steer) } else null,
                        ComposerChoice(ChatTexts.QUEUE_IT) { stick = true; vm.send(it, SendMode.Queue) },
                    )
                }
                Composer(
                    online = state.online, busy = state.busy, mode = null, canSetMode = false,
                    onSend = { stick = true; vm.send(it) }, onStop = vm::stop, onMode = {},
                    placeholder = ChatTexts.directField(state.agentName), busyChoices = choices,
                    leading = { AgentChip(state.agent, state.model ?: state.agentName) },
                )
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = 96.dp, start = 16.dp, end = 16.dp))
    }
    if (renaming) TextDialog(
        ChatTexts.RENAME_TITLE, ChatTexts.TITLE_FIELD, state.title, ChatTexts.SAVE,
        onDismiss = { renaming = false }, onConfirm = { vm.rename(it); renaming = false },
    )
}

private class MenuActions(
    val fork: () -> Unit, val compact: () -> Unit, val stop: () -> Unit, val resume: () -> Unit,
    val settle: () -> Unit, val rename: () -> Unit, val archive: () -> Unit,
)

@Composable
private fun DirectTopBar(state: DirectChatState, onBack: () -> Unit, menu: MenuActions) {
    var open by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(OrbIcons.ArrowLeft, ChatTexts.BACK, tint = OrbTheme.colors.text2) }
        AgentAvatar(state.agent, 36.dp)
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(
                state.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Medium, maxLines = 1,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() },
            )
            Text(
                listOfNotNull(
                    "${state.project ?: ChatTexts.NO_PROJECT} ${ChatTexts.IN_THE_PC}", state.permission?.let(ChatTexts::permissionName)?.takeIf { it.isNotEmpty() },
                ).joinToString(" · "),
                color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        if (!state.deleted) Box {
            IconButton(onClick = { open = true }) { Icon(OrbIcons.MoreVertical, ChatTexts.MORE, tint = OrbTheme.colors.text2) }
            DropdownMenu(open, onDismissRequest = { open = false }) {
                val on = state.online
                MenuRow(ChatTexts.FORK, on && !state.busy, menu.fork) { open = false }
                if (state.canCompact) MenuRow(ChatTexts.compactContext(state.contextPercent), on && !state.busy, menu.compact) { open = false }
                if (state.busy) MenuRow(ChatTexts.INTERRUPT, on, menu.stop) { open = false }
                if (state.stalled) MenuRow(ChatTexts.RESUME, on, menu.resume) { open = false }
                if (!state.settled) MenuRow(ChatTexts.SETTLE, on, menu.settle) { open = false }
                MenuRow(ChatTexts.RENAME, on, menu.rename) { open = false }
                MenuRow(ChatTexts.ARCHIVE, on, menu.archive) { open = false }
                if (!on) Text(ChatTexts.NEEDS_PC, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/** A34: the PC cannot be reached. What is shown was saved on the phone; what is written waits to leave. */
@Composable
private fun OfflineStrip() {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)
            .background(OrbTheme.colors.warnSoft, androidx.compose.foundation.shape.RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 10.dp),
    ) {
        Text(ChatTexts.ORBE_OFFLINE_TITLE, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Text(ChatTexts.ORBE_OFFLINE_BODY, color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodySmall)
    }
}

/** A28: the PC says the conversation is gone. */
@Composable
private fun DeletedDirect(onBack: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(OrbIcons.Trash, null, Modifier.size(40.dp), tint = OrbTheme.colors.text3)
        Text(ChatTexts.DELETED_TITLE, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        Text(ChatTexts.DELETED_BODY, color = OrbTheme.colors.text2, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyMedium)
        androidx.compose.material3.Button(onClick = onBack) { Text(ChatTexts.BACK_TO_CHATS) }
    }
}

/** The agent and model chip the composer shows where the permission pill sits in an Orbe chat. */
@Composable
private fun AgentChip(agent: String?, label: String?) {
    Row(Modifier.height(32.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        AgentAvatar(agent, 20.dp)
        if (label != null) Text(label, color = OrbTheme.colors.text2, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun DirectList(
    vm: DirectChatViewModel, state: DirectChatState, actions: DirectActions, nowMs: () -> Long, stick: Boolean, onStick: (Boolean) -> Unit,
) {
    val listState = rememberLazyListState()
    val items = state.items
    val now = remember(items.size) { nowMs() }
    var unseen by remember { mutableStateOf(false) }
    val newest = items.lastOrNull()?.key

    // The person scrolling decides whether the list follows the new text; the list growing by itself does not.
    LaunchedEffect(listState) {
        snapshotFlow { listState.isScrollInProgress to listState.canScrollForward }.collect { (moving, forward) ->
            if (moving) { onStick(!forward); if (!forward) unseen = false }
        }
    }
    val followEnd by rememberUpdatedState(stick)
    LaunchedEffect(listState) {
        snapshotFlow {
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()
            Triple(last?.key, last?.size, listState.layoutInfo.totalItemsCount)
        }.collect { if (it.first != null && followEnd) listState.toEnd() }
    }
    LaunchedEffect(newest, state.busy) { if (!stick) unseen = true }
    LaunchedEffect(listState) {
        snapshotFlow { listState.firstVisibleItemIndex }.collect { if (it == 0) vm.loadOlder() }
    }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            state = listState, modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (state.loadingOlder) item(key = "older", contentType = "older") {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) }
            }
            if (items.isEmpty() && !state.busy) item(key = "empty", contentType = "empty") {
                Text(ChatTexts.emptyDirect(state.agentName), Modifier.fillMaxWidth().padding(vertical = 48.dp), color = OrbTheme.colors.text2, textAlign = TextAlign.Center)
            }
            items(items, key = { it.key }, contentType = { it.contentType }) { item ->
                val enter = Modifier.animateItem(
                    fadeInSpec = tween(OrbMotion.Medium, easing = OrbMotion.EaseOut),
                    placementSpec = tween(OrbMotion.Medium, easing = OrbMotion.EaseStd),
                    fadeOutSpec = tween(OrbMotion.Fast),
                )
                DirectRow(item, state, now, actions, enter)
            }
            if (state.busy) item(key = "live", contentType = "live") {
                val live by vm.liveText.collectAsStateWithLifecycle()
                AgentLiveBubble(
                    state.agent, state.activity, state.queue.size, text = { live.text }, nowMs = nowMs,
                    modifier = Modifier.animateItem(fadeInSpec = tween(OrbMotion.Medium), fadeOutSpec = tween(OrbMotion.Fast)),
                )
            }
            if (state.stalled) item(key = "stalled", contentType = "stalled") {
                StalledCard(state.limited, state.online, actions.resume, Modifier.animateItem())
            }
        }
        AnimatedVisibility(
            !stick && unseen, Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp),
            enter = fadeIn(tween(OrbMotion.Short)) + scaleIn(tween(OrbMotion.Short)), exit = fadeOut(tween(OrbMotion.Fast)) + scaleOut(tween(OrbMotion.Fast)),
        ) {
            ExtendedFloatingActionButton(
                onClick = { onStick(true); unseen = false },
                icon = { Icon(OrbIcons.ArrowDown, null) }, text = { Text(ChatTexts.NEW_BELOW) },
                modifier = Modifier.semantics { contentDescription = ChatTexts.NEW_BELOW_DESC },
                containerColor = MaterialTheme.colorScheme.primaryContainer, contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
            )
        }
    }
}

@Composable
private fun MenuRow(text: String, enabled: Boolean, run: () -> Unit, close: () -> Unit) {
    DropdownMenuItem(text = { Text(text) }, enabled = enabled, onClick = { close(); run() })
}

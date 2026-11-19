package dev.orb.app.ui.chats

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.connectionText
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbComposerLabel
import dev.orb.app.ui.kit.OrbContextBar
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbFab
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbSheetDivider
import dev.orb.app.ui.kit.OrbSheetInfo
import dev.orb.app.ui.kit.OrbSheetItem
import dev.orb.app.ui.kit.OrbSheetLabel
import dev.orb.app.ui.kit.OrbSnackbarHost
import dev.orb.app.ui.kit.OrbSpinner
import dev.orb.app.ui.kit.OrbTopBar
import dev.orb.app.ui.offline.ConnectionBand
import dev.orb.app.ui.theme.OrbMotion
import dev.orb.app.ui.theme.OrbTheme

/** The direct conversation with an agent. A remote control: it shows what the PC says and asks it for things. */
@Composable
fun DirectChatScreen(
    vm: DirectChatViewModel,
    onBack: () -> Unit,
    onOpenChat: (String) -> Unit,
    modifier: Modifier = Modifier,
    nowMs: () -> Long = System::currentTimeMillis,
    /** What «@» offers in the box; null where the PC cannot expand mentions. */
    mentions: MentionSource? = null,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val forkAsk by vm.fork.collectAsStateWithLifecycle()
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
    var sheet by rememberSaveable { mutableStateOf(false) }
    var compactAsk by rememberSaveable { mutableStateOf(false) }
    var editingId by rememberSaveable { mutableStateOf<Long?>(null) }
    val actions = remember(vm) { DirectActions(vm::decide, vm::retrySend, vm::discard, vm::resume, vm::askFork, vm::fork) }
    val editing = state.queue.firstOrNull { it.id == editingId }
    // The message being edited left the queue (the PC took it): the box goes back to what it was.
    LaunchedEffect(editing == null) { if (editing == null) editingId = null }

    Box(modifier.fillMaxSize().imePadding()) {
        Column(Modifier.fillMaxSize()) {
            DirectTopBar(state, onBack, onMenu = { sheet = true })
            if (state.loaded && !state.deleted) ConnectionBand(state.connection)
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    state.deleted -> DeletedChatPage(onBack, if (state.canRestore) vm::restore else null)
                    !state.loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { OrbSpinner(size = 28.dp) }
                    else -> DirectList(vm, state, actions, nowMs, stick, onStick = { stick = it }, editingId = editingId, onEditQueued = { editingId = it.id })
                }
            }
            if (!state.deleted) {
                val choices = remember(state.busy, state.canSteer, vm) {
                    if (!state.busy) emptyList()
                    else listOfNotNull(
                        if (state.canSteer) ComposerChoice(ChatTexts.STEER) { stick = true; vm.send(it, SendMode.Steer) } else null,
                        ComposerChoice(ChatTexts.QUEUE_IT) { stick = true; vm.send(it, SendMode.Queue) },
                    )
                }
                // «/compact» asks the same question as the menu's «Compactar»; the agent must be able to and idle.
                val commands = remember(state.canCompact, state.online, state.busy) {
                    if (state.canCompact && state.online && !state.busy) listOf(ComposerCommand(ChatTexts.COMPACT_COMMAND, ChatTexts.COMPACT_COMMAND_HINT, OrbIcons.Minimize2) { compactAsk = true }) else emptyList()
                }
                Composer(
                    online = state.online, busy = state.busy, mode = null, canSetMode = false,
                    onSend = { stick = true; vm.send(it) }, onStop = vm::stop, onMode = {},
                    placeholder = when {
                        state.stalled -> DirectTexts.STALLED_PLACEHOLDER
                        state.busy -> DirectTexts.WORKING_PLACEHOLDER
                        else -> ChatTexts.directField(state.agentName)
                    },
                    busyChoices = choices,
                    leading = { PermissionLabel(state) },
                    attach = vm.attach, mic = true,
                    mentions = mentions, commands = commands,
                    above = { text, clear ->
                        if (editing != null) QueueEditBar(
                            canSave = text.isNotBlank() && state.online,
                            onSave = { vm.editQueued(editing, text); clear(); editingId = null },
                            onCancel = { clear(); editingId = null },
                        ) else ContextLine(state, onFork = vm::fork, onCompact = { compactAsk = true })
                    },
                    seed = editing?.let { ComposerSeed(it.id, it.text) },
                    sendOverride = editing?.let { q -> { t: String -> vm.editQueued(q, t); editingId = null } },
                )
            }
        }
        // Floats over the box with some air, as the mockup's `.snack`.
        OrbSnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = 128.dp, start = 16.dp, end = 16.dp))
    }
    if (sheet) ChatSheet(
        state, onDismiss = { sheet = false },
        MenuActions(
            { sheet = false; vm.fork() }, { sheet = false; compactAsk = true }, { sheet = false; vm.stop() }, { sheet = false; vm.resume() },
            { sheet = false; vm.settle() }, { sheet = false; renaming = true }, { sheet = false; vm.archive() },
        ),
    )
    if (compactAsk) OrbDialog(
        onDismiss = { compactAsk = false }, title = DirectTexts.COMPACT_ASK_TITLE, text = DirectTexts.compactAskBody(state.agentName),
        confirm = OrbDialogAction(DirectTexts.COMPACT_CONFIRM, { compactAsk = false; vm.compact() }),
        dismiss = OrbDialogAction(ChatTexts.CANCEL, { compactAsk = false }),
    )
    forkAsk?.let { ask ->
        OrbSheet(onDismiss = vm::dismissFork, title = DirectTexts.MESSAGE_SHEET) {
            when (ask.can) {
                null -> OrbSheetInfo(DirectTexts.FORK_ASKING, OrbIcons.GitFork)
                true -> OrbSheetItem(DirectTexts.FORK_HERE, vm::forkFromAsked, icon = OrbIcons.GitFork)
                false -> {
                    OrbSheetItem(DirectTexts.FORK_HERE, {}, icon = OrbIcons.GitFork, enabled = false)
                    if (ask.why != null) OrbSheetLabel(ask.why)
                }
            }
            if (ask.can != false) OrbSheetLabel(DirectTexts.FORK_FROM_NOTE)
        }
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

/** The useful line under the name: agent, project and what it is doing; with no link, what is wrong with it. */
internal fun directHeaderLine(state: DirectChatState): String = when (state.connection) {
    is ConnectionState.Online -> DirectTexts.infoLine(
        state.agentName ?: ChatTexts.AGENT_FALLBACK, state.project,
        if (state.busy) DirectTexts.STATE_WORKING else state.permission?.let(ChatTexts::permissionName),
    )
    is ConnectionState.Offline, is ConnectionState.Connecting -> ChatTexts.STATE_RECONNECTING
    else -> connectionText(state.connection)
}

@Composable
private fun DirectTopBar(state: DirectChatState, onBack: () -> Unit, onMenu: () -> Unit) {
    OrbTopBar(
        state.title, sub = directHeaderLine(state), sideWidth = 56.dp,
        subColor = if (state.online) OrbKit.mutedForeground else OrbKit.destructive,
        leading = { OrbIconButton(OrbIcons.ArrowLeft, ChatTexts.BACK, onBack) },
        actions = { if (!state.deleted) OrbIconButton(OrbIcons.MoreVertical, DirectTexts.MORE_BUTTON, onMenu) },
    )
}

/** «Chat con Claude»: what can be done to the whole conversation, and under «Más opciones» what only the PC's chat has. */
@Composable
private fun ChatSheet(state: DirectChatState, onDismiss: () -> Unit, menu: MenuActions) {
    var more by rememberSaveable { mutableStateOf(false) }
    val on = state.online
    OrbSheet(onDismiss = onDismiss, title = DirectTexts.sheetTitle(state.agentName)) {
        if (!on) OrbSheetLabel(DirectTexts.NEEDS_PC_SHEET)
        OrbSheetItem(
            DirectTexts.FORK_HERE, menu.fork, icon = OrbIcons.GitFork, enabled = on && !state.busy, meta = if (state.busy) DirectTexts.WHY_WORKING else null,
        )
        OrbSheetItem(
            DirectTexts.COMPACT, menu.compact, icon = OrbIcons.Minimize2, enabled = on && !state.busy && state.canCompact,
            meta = when { !state.canCompact -> DirectTexts.WHY_AGENT; state.busy -> DirectTexts.WHY_WORKING; else -> state.contextPercent?.let { "$it %" } },
        )
        OrbSheetItem(DirectTexts.RESUME, menu.resume, icon = OrbIcons.History, enabled = on && state.stalled, meta = if (state.stalled) null else DirectTexts.WHY_NOT_STALLED)
        OrbSheetItem(DirectTexts.SETTLE, menu.settle, icon = OrbIcons.CircleCheck, enabled = on && !state.settled, meta = if (state.settled) DirectTexts.WHY_SETTLED else null)
        OrbSheetItem(
            DirectTexts.STOP, menu.stop, icon = OrbIcons.Square, danger = true, enabled = on && state.busy, meta = if (state.busy) null else DirectTexts.WHY_NOT_WORKING,
        )
        OrbSheetDivider()
        OrbSheetLabel(DirectTexts.ONLY_ON_PC)
        OrbSheetItem(DirectTexts.MORE_OPTIONS, { more = !more }, chevron = true)
        if (more) {
            OrbSheetItem(ChatTexts.RENAME, menu.rename, icon = OrbIcons.Pencil, enabled = on)
            OrbSheetItem(ChatTexts.ARCHIVE, menu.archive, icon = OrbIcons.Archive, enabled = on)
            state.model?.let { OrbSheetInfo(DirectTexts.MODEL, OrbIcons.Brain, meta = it) }
            state.permission?.let(ChatTexts::permissionName)?.takeIf { it.isNotEmpty() }?.let { OrbSheetInfo(DirectTexts.PERMISSIONS, OrbIcons.ShieldCheck, meta = it) }
        }
    }
}

/** The permission the agent works with, in the box's bottom row; where it cannot be said, the agent's name. */
@Composable
private fun PermissionLabel(state: DirectChatState) {
    val name = state.permission?.let(ChatTexts::permissionName)?.takeIf { it.isNotEmpty() } ?: (state.agentName ?: ChatTexts.AGENT_FALLBACK)
    val icon = when (state.permission) {
        "leer" -> OrbIcons.Eye; "editar" -> OrbIcons.FilePen; "auto" -> OrbIcons.ShieldCheck; "total" -> OrbIcons.ShieldAlert; else -> null
    }
    OrbComposerLabel(name, icon = icon, description = "${DirectTexts.PERMISSION_LABEL}: $name")
}

/** `.ctxbar`: how full the agent's context is and, at its end, what can be done about it. */
@Composable
private fun ContextLine(state: DirectChatState, onFork: () -> Unit, onCompact: () -> Unit) {
    val percent = state.contextPercent ?: return
    // Copying and compacting both need the agent to be idle; while it works the action is shown but off.
    val compact = state.busy && state.canCompact
    OrbContextBar(
        DirectTexts.context(percent),
        action = if (compact) DirectTexts.CONTEXT_COMPACT else DirectTexts.CONTEXT_FORK,
        actionIcon = if (compact) OrbIcons.Minimize2 else OrbIcons.GitFork,
        onAction = if (compact) onCompact else onFork, enabled = state.online && !state.busy,
    )
}

/** `.ctxbar` while a queued message is edited in the box: what is going on, «Cancelar» and «Guardar». */
@Composable
private fun QueueEditBar(canSave: Boolean, onSave: () -> Unit, onCancel: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(start = 18.dp, end = 10.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(DirectTexts.QUEUE_EDIT_BAR, Modifier.weight(1f), color = OrbKit.mutedForeground, style = MaterialTheme.typography.labelMedium)
        OrbButton(ChatTexts.CANCEL, onCancel, kind = OrbButtonKind.Ghost, small = true)
        OrbButton(ChatTexts.QUEUED_SAVE, onSave, kind = OrbButtonKind.Primary, small = true, enabled = canSave)
    }
}

@Composable
private fun DirectList(
    vm: DirectChatViewModel, state: DirectChatState, actions: DirectActions, nowMs: () -> Long, stick: Boolean, onStick: (Boolean) -> Unit,
    editingId: Long?, onEditQueued: (QueuedMsg) -> Unit,
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
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (state.loadingOlder) item(key = "older", contentType = "older") {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { OrbSpinner(size = 20.dp) }
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
                    state.agent, state.agentName ?: ChatTexts.AGENT_FALLBACK, state.activity, text = { live.text },
                    modifier = Modifier.animateItem(fadeInSpec = tween(OrbMotion.Medium), fadeOutSpec = tween(OrbMotion.Fast)),
                )
            }
            if (state.stalled) item(key = "stalled", contentType = "stalled") {
                StalledCard(
                    state.limited, state.online, actions.resume, Modifier.animateItem(),
                    canForkFrom = state.canForkFrom, onFork = actions.fork, forkEnabled = state.online && !state.busy,
                )
            }
            if (state.queue.isNotEmpty()) item(key = "queue", contentType = "queue") {
                QueueCard(state.queue, state.online, editingId, onEditQueued, vm::removeQueued, vm::moveQueued, Modifier.animateItem())
            }
        }
        AnimatedVisibility(
            !stick && unseen, Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp),
            enter = fadeIn(tween(OrbMotion.Short)) + scaleIn(tween(OrbMotion.Short)), exit = fadeOut(tween(OrbMotion.Fast)) + scaleOut(tween(OrbMotion.Fast)),
        ) {
            OrbFab(ChatTexts.NEW_BELOW, OrbIcons.ArrowDown, { onStick(true); unseen = false }, Modifier.semantics { contentDescription = ChatTexts.NEW_BELOW_DESC })
        }
    }
}

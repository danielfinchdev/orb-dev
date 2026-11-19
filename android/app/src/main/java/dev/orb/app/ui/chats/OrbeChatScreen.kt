package dev.orb.app.ui.chats

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.connectionText
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbComposerFrame
import dev.orb.app.ui.kit.OrbComposerIcon
import dev.orb.app.ui.kit.OrbComposerLabel
import dev.orb.app.ui.kit.OrbFab
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbSendButton
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbSegmented
import dev.orb.app.ui.kit.OrbSheetInfo
import dev.orb.app.ui.kit.OrbSheetItem
import dev.orb.app.ui.kit.OrbSheetLabel
import dev.orb.app.ui.kit.OrbSnackbarHost
import dev.orb.app.ui.kit.OrbTopBar
import dev.orb.app.ui.offline.ConnectionBand
import dev.orb.app.ui.theme.OrbMotion
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.coroutines.delay

/**
 * The conversation with Orbe. A remote control: it shows what the PC says and sends what the person asks for.
 * [liveRefreshMs] is how often the running tasks are asked for again while something is running (0 = only on events).
 * [onOpenTask] and [onOpenChanges] go to the task's own screen and to its changes: from a card, from «Ver» after an undo and
 * when a card cannot show what it asks to approve.
 */
@Composable
fun OrbeChatScreen(
    vm: OrbeChatViewModel,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    nowMs: () -> Long = System::currentTimeMillis,
    liveRefreshMs: Long = 4_000L,
    onOpenTask: (Long) -> Unit = {},
    onOpenChanges: (Long) -> Unit = {},
    /** What «@» offers in the box; null where the PC cannot expand mentions. */
    mentions: MentionSource? = null,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val liveInfo by vm.liveInfo.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    val openTask by rememberUpdatedState(onOpenTask)
    LaunchedEffect(vm) { vm.openTask.collect { openTask(it) } }
    LaunchedEffect(vm) {
        vm.undone.collect { id ->
            if (snackbar.showSnackbar(ChatTexts.TASK_UNDONE_SNACK, actionLabel = ChatTexts.TASK_SEE) == SnackbarResult.ActionPerformed) openTask(id)
        }
    }
    var stick by remember { mutableStateOf(true) }
    val draft = remember(vm) { AnswerDraft() }
    var rejectAsk by rememberSaveable { mutableStateOf<Long?>(null) }
    val actions = remember(vm) {
        CardActions(
            vm::answer, vm::accept, vm::decideRequest, { rejectAsk = it }, vm::watchTask,
            vm::acceptTask, vm::askUndo, onOpenChanges, { openTask(it) },
        )
    }
    // While a task runs (or the assistant may be starting one) its card is kept fresh; events cover the rest.
    val tracking = state.online && (liveInfo?.busy == true || state.liveTasks.isNotEmpty())
    LaunchedEffect(tracking, liveRefreshMs) {
        if (tracking && liveRefreshMs > 0) while (true) { vm.refreshLive(); delay(liveRefreshMs) }
    }

    Box(modifier.fillMaxSize().imePadding()) {
        Column(Modifier.fillMaxSize()) {
            ChatTopBar(state, liveInfo, onBack, onCompact = vm::compact, onMode = vm::setMode)
            if (state.loaded && !state.deleted) ConnectionBand(state.connection)
            // Under the header only where an OK is being asked, as in the mockup; everywhere else the mode is in «⋯».
            if (state.canSetMode && !state.deleted && state.asksForOk) ModeSelector(state.mode, vm::setMode)
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    state.deleted -> DeletedChat(onBack, if (state.canRestore) vm::restore else null)
                    !state.loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    else -> MessageList(vm, state, liveInfo, actions, draft, nowMs, stick, onStick = { stick = it })
                }
            }
            if (!state.deleted) {
                // Same as «Compactar» of the menu, which asks nothing; it needs the PC, so it is not offered without the link.
                val commands = remember(state.canCompact, state.online, vm) {
                    if (state.canCompact && state.online) listOf(ComposerCommand(ChatTexts.COMPACT_COMMAND, ChatTexts.COMPACT_COMMAND_HINT, OrbIcons.Minimize2, vm::compact)) else emptyList()
                }
                val queue = if (state.canEditQueue) QueueActions(
                    state.queue, state.queueEditor, onOpen = { vm.openQueued(it.id) }, onClose = vm::closeQueued, onSave = vm::saveQueued,
                    onRemove = { vm.removeQueued(it.id) },
                ) else null
                ChatQueueBar(liveInfo?.queued ?: 0, queue = queue)
                // A pending question is answered from the box once the person picks several options or asks to write their own.
                val pendingQuestions = state.items.mapNotNull { (it as? ChatItem.Msg)?.message }.filter { (it.card as? MsgCard.Question)?.pending == true }
                val asked = pendingQuestions.firstOrNull { it.id == draft.question }
                LaunchedEffect(asked == null) { if (asked == null) draft.reset() }
                val askerName = asked?.let { questionAsker(it, state).second }
                val answer = if (asked != null && askerName != null && draft.active) ComposerAnswer(
                    placeholder = ChatTexts.answerField(askerName), hasPicks = draft.picked.isNotEmpty(), enabled = state.online && asked.id !in state.busyCards,
                    onSend = { text ->
                        actions.answer(asked, if (text.isBlank()) draft.picked.toList() else emptyList(), text.takeIf { it.isNotBlank() }, false)
                        draft.reset()
                    },
                ) else null
                Composer(
                    online = state.online, busy = liveInfo?.busy == true, mode = state.mode, canSetMode = state.canSetMode,
                    onSend = { stick = true; vm.send(it) }, onStop = vm::stop,
                    attach = vm.attach, brain = state.brain?.label ?: ChatTexts.BRAIN_UNKNOWN, mic = true,
                    mentions = mentions, commands = commands, answer = answer,
                    above = if (answer != null && askerName != null) ({ _, clear -> AnswerBar(askerName, onCancel = { draft.reset(); clear() }) }) else null,
                )
            }
        }
        // Floats over the box with some air, as the mockup's `.snack`.
        OrbSnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = 128.dp, start = 16.dp, end = 16.dp))
    }
    state.approval?.let { ApprovalDialog(it, onConfirm = vm::confirmApproval, onDismiss = vm::dismissApproval) }
    rejectAsk?.let { task ->
        OrbDialog(
            onDismiss = { rejectAsk = null }, title = ChatTexts.rejectAskTitle(task), text = ChatTexts.rejectAskBody(state.taskInfo[task]?.title),
            confirm = OrbDialogAction(ChatTexts.REJECT_CONFIRM, { rejectAsk = null; vm.rejectTask(task) }, danger = true),
            dismiss = OrbDialogAction(ChatTexts.REJECT_BACK, { rejectAsk = null }),
        )
    }
    state.undoAsk?.let { ask ->
        OrbDialog(
            onDismiss = vm::dismissUndo, title = ChatTexts.undoAskTitle(ask.task), text = ChatTexts.undoAskBody(ask.files),
            confirm = OrbDialogAction(ChatTexts.UNDO_CONFIRM, vm::confirmUndo),
            dismiss = OrbDialogAction(ChatTexts.CANCEL, vm::dismissUndo),
        )
    }
}

/** `.segm` under the header with its sentence: how the PC treats what needs an OK (`permissions.setMode`). */
@Composable
private fun ModeSelector(mode: String?, onMode: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 2.dp, bottom = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        OrbSegmented(
            listOf(ChatTexts.MODE_AUTO, ChatTexts.MODE_ASK), selected = when (mode) { "auto" -> 0; "preguntar" -> 1; else -> -1 },
            onSelect = { onMode(if (it == 0) "auto" else "preguntar") }, track = true,
            modifier = Modifier.semantics { contentDescription = ChatTexts.MODE_SELECTOR },
        )
        val note = when (mode) { "auto" -> ChatTexts.MODE_NOTE_AUTO; "preguntar" -> ChatTexts.MODE_NOTE_ASK; else -> null }
        if (note != null) Text(note, color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp)
    }
}

/** The useful line under the name: the project and what Orbe is doing; with no link, what is wrong with it. */
internal fun headerLine(state: OrbeChatState, live: LiveInfo?): String = when {
    state.connection is ConnectionState.Online ->
        ChatTexts.chatLine(state.project, if (live?.busy == true) ChatTexts.STATE_WORKING else if (live?.waiting == true) ChatTexts.STATE_WAITING else ChatTexts.STATE_IDLE)
    state.connection is ConnectionState.Offline || state.connection is ConnectionState.Connecting -> ChatTexts.STATE_RECONNECTING
    else -> connectionText(state.connection)
}

@Composable
private fun ChatTopBar(state: OrbeChatState, live: LiveInfo?, onBack: () -> Unit, onCompact: () -> Unit, onMode: (String) -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    OrbTopBar(
        state.title, sub = headerLine(state, live), sideWidth = 56.dp,
        subColor = if (state.online) OrbKit.mutedForeground else OrbKit.destructive,
        leading = { OrbIconButton(OrbIcons.ArrowLeft, ChatTexts.BACK, onBack) },
        actions = { if ((state.canCompact || state.canSetMode) && !state.deleted) OrbIconButton(OrbIcons.MoreVertical, ChatTexts.MORE, { open = true }) },
    )
    if (open) {
        OrbSheet(onDismiss = { open = false }) {
            if (state.canCompact) {
                if (state.online) OrbSheetItem(ChatTexts.COMPACT, onClick = { open = false; onCompact() }, icon = OrbIcons.FoldVertical)
                else OrbSheetInfo(ChatTexts.COMPACT, OrbIcons.FoldVertical, meta = ChatTexts.NEEDS_PC)
            }
            if (state.canSetMode) {
                OrbSheetLabel(ChatTexts.MODE_SELECTOR)
                if (state.online) ModeSelector(state.mode, onMode) else OrbSheetInfo(ChatTexts.MODE_SELECTOR, OrbIcons.ShieldCheck, meta = ChatTexts.NEEDS_PC)
            }
            state.brain?.label?.let { OrbSheetInfo(ChatTexts.BRAIN_DESC, OrbIcons.Brain, meta = it) }
        }
    }
}

/** The PC says the conversation is gone. */
@Composable
private fun DeletedChat(onBack: () -> Unit, onRestore: (() -> Unit)?) {
    Column(
        Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(OrbIcons.Trash, null, Modifier.size(40.dp), tint = OrbTheme.colors.text3)
        Text(ChatTexts.DELETED_TITLE, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        Text(ChatTexts.DELETED_BODY, color = OrbTheme.colors.text2, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyMedium)
        if (onRestore != null) Button(onClick = onRestore) { Text(ChatTexts.RESTORE_ASK) }
        if (onRestore != null) TextButton(onClick = onBack) { Text(ChatTexts.BACK_TO_CHATS) }
        else Button(onClick = onBack) { Text(ChatTexts.BACK_TO_CHATS) }
    }
}

@Composable
private fun MessageList(
    vm: OrbeChatViewModel, state: OrbeChatState, liveInfo: LiveInfo?, actions: CardActions, draft: AnswerDraft, nowMs: () -> Long,
    stick: Boolean, onStick: (Boolean) -> Unit,
) {
    val listState = rememberLazyListState()
    val items = state.items
    val now = remember(items.size) { nowMs() }
    var unseen by remember { mutableStateOf(false) }
    val newest = items.lastOrNull()?.key
    val hasLive = liveInfo != null

    // The person scrolling decides whether the list follows the new text; the list growing by itself does not.
    LaunchedEffect(listState) {
        snapshotFlow { listState.isScrollInProgress to listState.canScrollForward }.collect { (moving, forward) ->
            if (moving) { onStick(!forward); if (!forward) unseen = false }
        }
    }
    val followEnd by rememberUpdatedState(stick)
    // Follow the end while the last row grows (streaming) or a new one arrives, only if the person is at the bottom.
    LaunchedEffect(listState) {
        snapshotFlow {
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()
            Triple(last?.key, last?.size, listState.layoutInfo.totalItemsCount)
        }.collect { if (it.first != null && followEnd) listState.toEnd() }
    }
    LaunchedEffect(newest, hasLive) { if (!stick) unseen = true }
    LaunchedEffect(listState) {
        snapshotFlow { listState.firstVisibleItemIndex }.collect { if (it == 0) vm.loadOlder() }
    }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            state = listState, modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (state.loadingOlder) item(key = "older", contentType = "older") {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) }
            }
            if (items.isEmpty() && !hasLive && state.liveTasks.isEmpty()) item(key = "empty", contentType = "empty") {
                Text(ChatTexts.EMPTY_CHAT, Modifier.fillMaxWidth().padding(vertical = 48.dp), color = OrbTheme.colors.text2, textAlign = TextAlign.Center)
            }
            items(items, key = { it.key }, contentType = { it.contentType }) { item ->
                val enter = Modifier.animateItem(
                    fadeInSpec = tween(OrbMotion.Medium, easing = OrbMotion.EaseOut),
                    placementSpec = tween(OrbMotion.Medium, easing = OrbMotion.EaseStd),
                    fadeOutSpec = tween(OrbMotion.Fast),
                )
                when (item) {
                    is ChatItem.Msg -> MessageRow(item, state, now, actions, enter, draft)
                    is ChatItem.Waiting -> PendingRow(
                        item.pending, state.online, { vm.retrySend(item.pending.clientId) }, { vm.discard(item.pending.clientId) }, enter,
                        connection = state.connection,
                    )
                }
            }
            items(state.liveTasks, key = { "t:${it.id}" }, contentType = { "task-live" }) { t ->
                LiveTaskCard(t, Modifier.animateItem(fadeInSpec = tween(OrbMotion.Medium), fadeOutSpec = tween(OrbMotion.Fast)))
            }
            if (liveInfo != null) item(key = "live", contentType = "live") {
                val live by vm.liveText.collectAsStateWithLifecycle()
                LiveBubble(liveInfo, text = { live.text }, modifier = Modifier.animateItem(fadeInSpec = tween(OrbMotion.Medium), fadeOutSpec = tween(OrbMotion.Fast)))
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


internal suspend fun LazyListState.toEnd() {
    val last = layoutInfo.totalItemsCount - 1
    if (last < 0) return
    scrollToItem(last)
    // A last row taller than the screen is shown from its top by the line above; this brings its end into view.
    scrollBy(100_000f)
}

/** An OK is being asked in this thread: a task waits for it or an agent's question is still open. */
internal val OrbeChatState.asksForOk: Boolean
    get() = items.any { item ->
        val card = (item as? ChatItem.Msg)?.message?.card
        card is MsgCard.TaskAttention || (card is MsgCard.Question && card.pending)
    }

/** `.ctxbar` over the box while it answers a question: whom it answers and a way back to ordinary messages. */
@Composable
private fun AnswerBar(name: String, onCancel: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(start = 18.dp, end = 10.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(ChatTexts.answeringBar(name), Modifier.weight(1f), color = OrbKit.mutedForeground, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 1)
        OrbButton(ChatTexts.CANCEL, onCancel, kind = OrbButtonKind.Ghost, small = true)
    }
}

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
import dev.orb.app.ui.kit.OrbSheetChoice
import dev.orb.app.ui.kit.OrbSheetInfo
import dev.orb.app.ui.kit.OrbSheetItem
import dev.orb.app.ui.kit.OrbSnackbarHost
import dev.orb.app.ui.kit.OrbTopBar
import dev.orb.app.ui.offline.ConnectionBand
import dev.orb.app.ui.theme.OrbMotion
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.coroutines.delay

/**
 * The conversation with Orbe. A remote control: it shows what the PC says and sends what the person asks for.
 * [liveRefreshMs] is how often the running tasks are asked for again while something is running (0 = only on events).
 * [queued], [onEditQueued] and [onRemoveQueued] are for a PC that lists the queued messages: the bar then quotes the first
 * one and offers to edit it; until then it only counts them.
 */
@Composable
fun OrbeChatScreen(
    vm: OrbeChatViewModel,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    nowMs: () -> Long = System::currentTimeMillis,
    liveRefreshMs: Long = 4_000L,
    queued: List<QueuedMsg> = emptyList(),
    onEditQueued: ((QueuedMsg, String) -> Unit)? = null,
    onRemoveQueued: ((QueuedMsg) -> Unit)? = null,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val liveInfo by vm.liveInfo.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    var stick by remember { mutableStateOf(true) }
    val actions = remember(vm) {
        CardActions(vm::answer, vm::accept, vm::decideRequest, vm::askApproval, vm::rejectTask, vm::watchTask)
    }
    // While a task runs (or the assistant may be starting one) its card is kept fresh; events cover the rest.
    val tracking = state.online && (liveInfo?.busy == true || state.liveTasks.isNotEmpty())
    LaunchedEffect(tracking, liveRefreshMs) {
        if (tracking && liveRefreshMs > 0) while (true) { vm.refreshLive(); delay(liveRefreshMs) }
    }

    Box(modifier.fillMaxSize().imePadding()) {
        Column(Modifier.fillMaxSize()) {
            ChatTopBar(state, liveInfo, onBack, onCompact = vm::compact)
            if (state.loaded && !state.deleted) ConnectionBand(state.connection)
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    state.deleted -> DeletedChat(onBack, if (state.canRestore) vm::restore else null)
                    !state.loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    else -> MessageList(vm, state, liveInfo, actions, nowMs, stick, onStick = { stick = it })
                }
            }
            if (!state.deleted) {
                ChatQueueBar(liveInfo?.queued ?: 0, items = queued, onEdit = onEditQueued, onRemove = onRemoveQueued)
                Composer(
                    online = state.online, busy = liveInfo?.busy == true, mode = state.mode, canSetMode = state.canSetMode,
                    onSend = { stick = true; vm.send(it) }, onStop = vm::stop, onMode = vm::setMode,
                    attach = vm.attach, brain = state.brain?.label ?: ChatTexts.BRAIN_UNKNOWN, mic = true,
                )
            }
        }
        OrbSnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = 96.dp, start = 16.dp, end = 16.dp))
    }
    state.approval?.let { ApprovalDialog(it, onConfirm = vm::confirmApproval, onDismiss = vm::dismissApproval) }
}

/** The useful line under the name: the project and what Orbe is doing; with no link, what is wrong with it. */
internal fun headerLine(state: OrbeChatState, live: LiveInfo?): String = when {
    state.connection is ConnectionState.Online ->
        ChatTexts.chatLine(state.project, if (live?.busy == true) ChatTexts.STATE_WORKING else if (live?.waiting == true) ChatTexts.STATE_WAITING else ChatTexts.STATE_IDLE)
    state.connection is ConnectionState.Offline || state.connection is ConnectionState.Connecting -> ChatTexts.STATE_RECONNECTING
    else -> connectionText(state.connection)
}

@Composable
private fun ChatTopBar(state: OrbeChatState, live: LiveInfo?, onBack: () -> Unit, onCompact: () -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    OrbTopBar(
        state.title, sub = headerLine(state, live), sideWidth = 56.dp,
        subColor = if (state.online) OrbKit.mutedForeground else OrbKit.destructive,
        leading = { OrbIconButton(OrbIcons.ArrowLeft, ChatTexts.BACK, onBack) },
        actions = { if (state.canCompact && !state.deleted) OrbIconButton(OrbIcons.MoreVertical, ChatTexts.MORE, { open = true }) },
    )
    if (open) {
        OrbSheet(onDismiss = { open = false }) {
            if (state.online) OrbSheetItem(ChatTexts.COMPACT, onClick = { open = false; onCompact() }, icon = OrbIcons.FoldVertical)
            else OrbSheetInfo(ChatTexts.COMPACT, OrbIcons.FoldVertical, meta = ChatTexts.NEEDS_PC)
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
    vm: OrbeChatViewModel, state: OrbeChatState, liveInfo: LiveInfo?, actions: CardActions, nowMs: () -> Long,
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
                    is ChatItem.Msg -> MessageRow(item, state, now, actions, enter)
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
                LiveBubble(liveInfo, text = { live.text }, nowMs = nowMs, modifier = Modifier.animateItem(fadeInSpec = tween(OrbMotion.Medium), fadeOutSpec = tween(OrbMotion.Fast)))
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

// ---------- Composer ----------

/** One way to send a message while the agent works. */
class ComposerChoice(val label: String, val send: (String) -> Unit)

/**
 * The writing box (`.mcomp`): the text on top and, below, «+», the permission label (or [leading]), the brain label,
 * the microphone and the round send/stop button. [brain] null hides the brain label; [mic] draws the microphone,
 * switched off because dictation is not there yet.
 */
@Composable
internal fun Composer(
    online: Boolean, busy: Boolean, mode: String?, canSetMode: Boolean,
    onSend: (String) -> Unit, onStop: () -> Unit, onMode: (String) -> Unit,
    placeholder: String = ChatTexts.MESSAGE_FIELD,
    /** While the agent works and there is text: the ways to send it («Corregir», «Encolar»); the first is the send button's. */
    busyChoices: List<ComposerChoice> = emptyList(),
    /** Replaces the permission label (a direct chat shows its agent and model instead). */
    leading: (@Composable () -> Unit)? = null,
    /** The pictures and files of this message; null hides «+» (where nothing can be attached). */
    attach: dev.orb.app.attach.AttachController? = null,
    brain: String? = null,
    mic: Boolean = false,
) {
    var text by rememberSaveable { mutableStateOf("") }
    val attached = attach?.items?.collectAsState()?.value.orEmpty()
    val attachNotice = attach?.notice?.collectAsState()?.value
    var problem by remember { mutableStateOf<String?>(null) }
    var sheet by remember { mutableStateOf(false) }
    val launchers = if (attach != null) dev.orb.app.ui.attach.rememberAttachLaunchers(attach) { problem = it } else null
    // Sending waits for every upload: a message that left before them would reach the PC without its files.
    val attachOk = attached.all { it.state == dev.orb.app.attach.AttachState.Ready }
    val canSend = text.isNotBlank() && attachOk
    if (sheet && attach != null && launchers != null) {
        dev.orb.app.ui.attach.AttachSheet(attach.currentPolicy, launchers, onDismiss = { sheet = false })
    }
    OrbComposerFrame {
        if (attach != null) {
            dev.orb.app.ui.attach.AttachStrip(attached, attachNotice ?: problem, attach::remove, attach::retry, Modifier.padding(end = 8.dp))
        }
        Box(Modifier.fillMaxWidth().heightIn(min = 22.dp, max = 160.dp).padding(end = 4.dp), contentAlignment = Alignment.CenterStart) {
            BasicTextField(
                text, { text = it }, Modifier.fillMaxWidth().semantics { contentDescription = placeholder },
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = OrbKit.foreground, fontSize = 15.sp, lineHeight = 22.sp),
                cursorBrush = SolidColor(OrbKit.foreground), maxLines = 8,
                keyboardOptions = KeyboardOptions(capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Sentences),
            )
            if (text.isEmpty()) Text(placeholder, color = OrbKit.faintForeground, fontSize = 15.sp, lineHeight = 22.sp)
        }
        AnimatedVisibility(
            busy && canSend && busyChoices.isNotEmpty(),
            enter = fadeIn(tween(OrbMotion.Short)) + expandVertically(OrbMotion.standard(OrbMotion.Short)),
            exit = fadeOut(tween(OrbMotion.Fast)) + shrinkVertically(OrbMotion.standard(OrbMotion.Fast)),
        ) {
            Row(Modifier.padding(top = 2.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (choice in busyChoices) {
                    OrbButton(choice.label, { val t = text; text = ""; choice.send(t) }, small = true)
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (attach != null) OrbComposerIcon(OrbIcons.Plus, dev.orb.app.attach.AttachTexts.ADD, { problem = null; sheet = true })
            if (leading != null) leading() else if (canSetMode) ModePill(mode, onMode)
            if (brain != null) OrbComposerLabel(brain, description = "${ChatTexts.BRAIN_DESC}: $brain")
            Box(Modifier.weight(1f))
            if (mic) OrbComposerIcon(OrbIcons.Mic, ChatTexts.MIC_SOON, {}, enabled = false)
            // Parar only when there is nothing to send: with text, the message goes to the PC's queue behind the turn.
            OrbSendButton(
                stop = busy && !canSend, enabled = canSend, sendLabel = ChatTexts.SEND, stopLabel = ChatTexts.STOP,
                onClick = {
                    if (busy && !canSend) onStop() else {
                        val t = text; text = ""
                        if (busy && busyChoices.isNotEmpty()) busyChoices.first().send(t) else onSend(t)
                    }
                },
            )
        }
    }
}

/** «Auto» / «Preguntar»: the PC's way of treating what needs a permission; tapping it opens the choice. */
@Composable
internal fun ModePill(mode: String?, onMode: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val label = when (mode) { "auto" -> ChatTexts.MODE_AUTO; "preguntar" -> ChatTexts.MODE_ASK; else -> ChatTexts.MODE_UNKNOWN }
    OrbComposerLabel(label, icon = OrbIcons.ShieldCheck, onClick = { open = true })
    if (open) {
        OrbSheet(onDismiss = { open = false }, title = ChatTexts.MODE_MENU) {
            OrbSheetChoice(ChatTexts.MODE_AUTO, ChatTexts.MODE_AUTO_HINT, OrbIcons.Shield, selected = mode == "auto", onClick = { open = false; onMode("auto") })
            OrbSheetChoice(ChatTexts.MODE_ASK, ChatTexts.MODE_ASK_HINT, OrbIcons.ShieldCheck, selected = mode == "preguntar", onClick = { open = false; onMode("preguntar") })
        }
    }
}

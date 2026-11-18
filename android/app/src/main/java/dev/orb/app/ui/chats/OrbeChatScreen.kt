package dev.orb.app.ui.chats

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.core.tween
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
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

/** The conversation with Orbe. A remote control: it shows what the PC says and sends what the person asks for. */
@Composable
fun OrbeChatScreen(
    vm: OrbeChatViewModel,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    nowMs: () -> Long = System::currentTimeMillis,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val liveInfo by vm.liveInfo.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    var stick by remember { mutableStateOf(true) }
    val actions = remember(vm) {
        CardActions(vm::answer, vm::accept, vm::decideRequest, vm::askApproval, vm::rejectTask, vm::watchTask)
    }

    Box(modifier.fillMaxSize().imePadding()) {
        Column(Modifier.fillMaxSize()) {
            ChatTopBar(state, onBack, onCompact = vm::compact)
            AnimatedVisibility(!state.online && state.loaded && !state.deleted, enter = fadeIn() + slideInVertically { -it / 2 }, exit = fadeOut()) { OfflineBanner() }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    state.deleted -> DeletedChat(onBack, if (state.canRestore) vm::restore else null)
                    !state.loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    else -> MessageList(vm, state, liveInfo, actions, nowMs, stick, onStick = { stick = it })
                }
            }
            if (!state.deleted) {
                Composer(
                    online = state.online, busy = liveInfo?.busy == true, mode = state.mode, canSetMode = state.canSetMode,
                    onSend = { stick = true; vm.send(it) }, onStop = vm::stop, onMode = vm::setMode,
                    attach = vm.attach,
                )
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = 96.dp, start = 16.dp, end = 16.dp))
    }
    state.approval?.let { ApprovalDialog(it, onConfirm = vm::confirmApproval, onDismiss = vm::dismissApproval) }
}

@Composable
private fun ChatTopBar(state: OrbeChatState, onBack: () -> Unit, onCompact: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(OrbIcons.ArrowLeft, ChatTexts.BACK, tint = OrbTheme.colors.text2) }
        Column(Modifier.weight(1f).padding(start = 4.dp)) {
            Text(
                state.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Medium, maxLines = 1,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() },
            )
            Text(
                state.project?.let { "$it · Orbe" } ?: "Orbe", color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodySmall,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        if (state.canCompact && !state.deleted) {
            Box {
                IconButton(onClick = { open = true }) { Icon(OrbIcons.MoreVertical, ChatTexts.MORE, tint = OrbTheme.colors.text2) }
                DropdownMenu(open, onDismissRequest = { open = false }) {
                    DropdownMenuItem(
                        text = { Text(ChatTexts.COMPACT) }, enabled = state.online,
                        onClick = { open = false; onCompact() },
                    )
                    if (!state.online) Text(ChatTexts.NEEDS_PC, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun OfflineBanner() {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).clip(RoundedCornerShape(12.dp))
            .background(OrbTheme.colors.warnSoft).padding(horizontal = 14.dp, vertical = 10.dp),
    ) {
        Text(ChatTexts.ORBE_OFFLINE_TITLE, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Text(ChatTexts.ORBE_OFFLINE_BODY, color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodySmall)
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
        if (onRestore != null) androidx.compose.material3.TextButton(onClick = onBack) { Text(ChatTexts.BACK_TO_CHATS) }
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
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            if (state.loadingOlder) item(key = "older", contentType = "older") {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) }
            }
            if (items.isEmpty() && !hasLive) item(key = "empty", contentType = "empty") {
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
                    is ChatItem.Waiting -> PendingRow(item.pending, state.online, { vm.retrySend(item.pending.clientId) }, { vm.discard(item.pending.clientId) }, enter)
                }
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
            ExtendedFloatingActionButton(
                onClick = { onStick(true); unseen = false },
                icon = { Icon(OrbIcons.ArrowDown, null) }, text = { Text(ChatTexts.NEW_BELOW) },
                modifier = Modifier.semantics { contentDescription = ChatTexts.NEW_BELOW_DESC },
                containerColor = MaterialTheme.colorScheme.primaryContainer, contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
            )
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

@Composable
internal fun Composer(
    online: Boolean, busy: Boolean, mode: String?, canSetMode: Boolean,
    onSend: (String) -> Unit, onStop: () -> Unit, onMode: (String) -> Unit,
    placeholder: String = ChatTexts.MESSAGE_FIELD,
    /** While the agent works and there is text: the ways to send it («Corregir», «Encolar»); the first is the send button's. */
    busyChoices: List<ComposerChoice> = emptyList(),
    /** Replaces the permission-mode pill (a direct chat shows its agent and model instead). */
    leading: (@Composable () -> Unit)? = null,
    /** The pictures and files of this message; null hides «+» (where nothing can be attached). */
    attach: dev.orb.app.attach.AttachController? = null,
) {
    var text by rememberSaveable { mutableStateOf("") }
    val attached = attach?.items?.collectAsState()?.value.orEmpty()
    val attachNotice = attach?.notice?.collectAsState()?.value
    var problem by remember { mutableStateOf<String?>(null) }
    var sheet by remember { mutableStateOf(false) }
    val launchers = if (attach != null) dev.orb.app.ui.attach.rememberAttachLaunchers(attach) { problem = it } else null
    // Sending waits for every upload: a message that left before them would reach the PC without its files.
    val attachOk = attached.all { it.state == dev.orb.app.attach.AttachState.Ready }
    val scheme = MaterialTheme.colorScheme
    val shape = RoundedCornerShape(24.dp)
    val body: @Composable () -> Unit = {
        Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 6.dp)) {
            if (attach != null) {
                dev.orb.app.ui.attach.AttachStrip(attached, attachNotice ?: problem, attach::remove, attach::retry, Modifier.padding(end = 8.dp))
            }
            Box(Modifier.fillMaxWidth().heightIn(min = 40.dp, max = 160.dp).padding(end = 8.dp, top = 4.dp), contentAlignment = Alignment.CenterStart) {
                BasicTextField(
                    text, { text = it }, Modifier.fillMaxWidth().semantics { contentDescription = placeholder },
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = scheme.onSurface),
                    cursorBrush = SolidColor(scheme.primary), maxLines = 8,
                    keyboardOptions = KeyboardOptions(capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Sentences),
                )
                if (text.isEmpty()) Text(placeholder, color = OrbTheme.colors.text3, style = MaterialTheme.typography.bodyLarge)
            }
            val canSend = text.isNotBlank() && attachOk
            AnimatedVisibility(
                busy && canSend && busyChoices.isNotEmpty(),
                enter = fadeIn(tween(OrbMotion.Short)) + expandVertically(OrbMotion.standard(OrbMotion.Short)),
                exit = fadeOut(tween(OrbMotion.Fast)) + shrinkVertically(OrbMotion.standard(OrbMotion.Fast)),
            ) {
                Row(Modifier.padding(top = 4.dp, bottom = 2.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (choice in busyChoices) {
                        Box(
                            Modifier.height(32.dp).clip(RoundedCornerShape(16.dp)).border(BorderStroke(1.dp, scheme.outlineVariant), RoundedCornerShape(16.dp))
                                .clickable { val t = text; text = ""; choice.send(t) }.padding(horizontal = 14.dp),
                            contentAlignment = Alignment.Center,
                        ) { Text(choice.label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Medium, color = scheme.primary) }
                    }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (attach != null) {
                    IconButton(
                        onClick = { problem = null; sheet = true }, modifier = Modifier.size(36.dp),
                    ) { Icon(OrbIcons.Plus, dev.orb.app.attach.AttachTexts.ADD, Modifier.size(20.dp), tint = OrbTheme.colors.text2) }
                }
                if (leading != null) leading() else if (canSetMode) ModePill(mode, onMode)
                Box(Modifier.weight(1f))
                // Parar only when there is nothing to send: with text, the message goes to the PC's queue behind the turn.
                AnimatedContent(
                    targetState = busy && !canSend, label = "send-stop",
                    transitionSpec = { (fadeIn(tween(OrbMotion.Short)) + scaleIn(tween(OrbMotion.Short), 0.8f)) togetherWith (fadeOut(tween(OrbMotion.Fast)) + scaleOut(tween(OrbMotion.Fast), 0.8f)) },
                ) { stopping ->
                    if (stopping) {
                        IconButton(
                            onClick = onStop, modifier = Modifier.size(44.dp).clip(CircleShape).background(scheme.onSurface),
                        ) { Icon(OrbIcons.Square, ChatTexts.STOP, Modifier.size(16.dp), tint = scheme.surface) }
                    } else {
                        IconButton(
                            onClick = {
                                val t = text; text = ""
                                if (busy && busyChoices.isNotEmpty()) busyChoices.first().send(t) else onSend(t)
                            },
                            enabled = canSend,
                            modifier = Modifier.size(44.dp).clip(CircleShape).background(if (canSend) scheme.primary else scheme.surfaceContainerHighest),
                        ) { Icon(OrbIcons.Send, ChatTexts.SEND, Modifier.size(18.dp), tint = if (canSend) scheme.onPrimary else OrbTheme.colors.text3) }
                    }
                }
            }
        }
    }
    if (sheet && attach != null && launchers != null) {
        dev.orb.app.ui.attach.AttachSheet(attach.currentPolicy, launchers, onDismiss = { sheet = false })
    }
    Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
        Box(
            Modifier.fillMaxWidth().clip(shape).background(scheme.surfaceContainerLow).border(BorderStroke(1.dp, scheme.outlineVariant), shape),
        ) { body() }
    }
}

/** «Auto» / «Preguntar», the PC's way of treating what needs a permission. */
@Composable
internal fun ModePill(mode: String?, onMode: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val label = when (mode) { "auto" -> ChatTexts.MODE_AUTO; "preguntar" -> ChatTexts.MODE_ASK; else -> ChatTexts.MODE_MENU }
    Box {
        Row(
            Modifier.height(32.dp).clip(RoundedCornerShape(10.dp)).clickable { open = true }.padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(OrbIcons.Shield, null, Modifier.size(16.dp), tint = OrbTheme.colors.text2)
            Text(label, color = OrbTheme.colors.text2, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Medium)
            Icon(OrbIcons.ChevronDown, null, Modifier.size(14.dp), tint = OrbTheme.colors.text3)
        }
        DropdownMenu(open, onDismissRequest = { open = false }) {
            Text(ChatTexts.MODE_MENU, Modifier.padding(horizontal = 16.dp, vertical = 6.dp), color = OrbTheme.colors.text2, style = MaterialTheme.typography.labelMedium)
            for ((value, name, hint) in listOf(
                Triple("auto", ChatTexts.MODE_AUTO, ChatTexts.MODE_AUTO_HINT), Triple("preguntar", ChatTexts.MODE_ASK, ChatTexts.MODE_ASK_HINT),
            )) {
                DropdownMenuItem(
                    text = { Column { Text(name, fontWeight = FontWeight.Medium); Text(hint, color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodySmall) } },
                    trailingIcon = { if (mode == value) Icon(OrbIcons.Check, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary) },
                    onClick = { open = false; onMode(value) },
                )
            }
        }
    }
}


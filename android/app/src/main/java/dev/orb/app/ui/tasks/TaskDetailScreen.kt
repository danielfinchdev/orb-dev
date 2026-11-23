package dev.orb.app.ui.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.chats.ChatTexts
import dev.orb.app.ui.chats.ChatTime
import dev.orb.app.ui.chats.Message
import dev.orb.app.ui.chats.agentName
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbBadge
import dev.orb.app.ui.kit.OrbBadgeKind
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbCard
import dev.orb.app.ui.kit.OrbChip
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbProgress
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbSheetItem
import dev.orb.app.ui.kit.OrbSheetLabel
import dev.orb.app.ui.kit.OrbSnackbarHost
import dev.orb.app.ui.kit.OrbSpinner
import dev.orb.app.ui.kit.OrbTopBar
import dev.orb.app.ui.offline.NeedsPcNote
import dev.orb.app.ui.offline.OfflineStrip

private enum class Ask { Cancel, Undo, Reassign, Followup, LaunchAnyway, Reject, Review, Menu, History, Subtasks, Depends }

/**
 * One task (screen 18): the reason it waits first, with the way out; then what it did and what the person can decide; the
 * data; and «Cancelar tarea · Reasignar · Seguir» fixed at the bottom. The history, the subtasks, what it depends on,
 * «Revisar tarea» and, for a held task, «Deshacer» are in the «⋮» menu.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TaskDetailScreen(
    vm: TaskDetailViewModel,
    onBack: () -> Unit,
    onOpenTask: (Long) -> Unit,
    onOpenChanges: (Long) -> Unit,
    modifier: Modifier = Modifier,
    nowMs: () -> Long = System::currentTimeMillis,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.refresh() }
    var ask by rememberSaveable { mutableStateOf<Ask?>(null) }
    // A decision waits for the read an event of the PC asked for: until then the screen may show what the PC has left behind.
    val enabled = state.online && !state.busy && !state.reloading
    val d = state.detail

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            OrbTopBar(
                title = d?.let { "#${it.id} ${it.row.title}" } ?: "#${vm.id}", sub = d?.row?.let(::taskSubtitle)?.takeIf { it.isNotEmpty() }, sideWidth = 56.dp,
                leading = { OrbIconButton(OrbIcons.ArrowLeft, TaskTexts.BACK, onBack) },
                actions = { if (d != null) OrbIconButton(OrbIcons.MoreVertical, TaskTexts.ACTIONS, { ask = Ask.Menu }) },
            )
            if (!state.online && d != null) OfflineStrip()
            when {
                d == null && state.loading -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { OrbSpinner(size = 28.dp) }
                d == null -> Box(Modifier.weight(1f)) { Message(state.error ?: TaskTexts.DETAIL_ERROR, action = TaskTexts.RETRY, onAction = vm::refresh, icon = OrbIcons.CircleAlert) }
                else -> {
                    Column(
                        Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(top = 8.dp, bottom = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Header(d, nowMs())
                        if (!state.online && state.actions.isNotEmpty()) NeedsPcNote()
                        WhyWaits(d, state.actions, enabled, onOther = { ask = Ask.Reassign; vm.loadAgents() }, onLaunch = { ask = Ask.LaunchAnyway })
                        Held(d, state.actions, enabled, onChanges = { onOpenChanges(d.id) }, onAccept = vm::accept)
                        Stopped(d, state.actions, enabled, onOther = { ask = Ask.Reassign; vm.loadAgents() }, onRetry = vm::retry)
                        Approval(d, state.actions, enabled, onApprove = { vm.approve(true, d.previewHash) }, onReject = { vm.askReject(); ask = Ask.Reject })
                        // While an OK is asked, the card above shows the description with the rest of what the OK covers.
                        if (d.description.isNotBlank() && TaskAction.Approve !in state.actions) {
                            TaskCard(TaskTexts.WHAT_TO_DO) { BodyText(d.description) }
                        }
                        Outcome(d, state.actions, onChanges = { onOpenChanges(d.id) })
                        PartialJoinCard(d, state.actions, enabled, onUndo = vm::undoJoin, onRetry = vm::retryJoin)
                        if (d.row.undone) TaskCard(TaskTexts.UNDONE) { BodyText(TaskTexts.UNDONE_NOTE, OrbKit.mutedForeground) }
                        Details(d, state.actions)
                    }
                    ActionBar(d, state.actions, enabled, onCancel = { ask = Ask.Cancel }, onReassign = { ask = Ask.Reassign; vm.loadAgents() }, onFollowup = { ask = Ask.Followup })
                }
            }
        }
        OrbSnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(start = 12.dp, end = 12.dp, bottom = if (d != null && hasBar(d, state.actions)) 76.dp else 16.dp))
    }

    val close = { ask = null }
    when (ask) {
        Ask.Cancel -> OrbDialog(
            close, TaskTexts.cancelAsk(vm.id), OrbDialogAction(TaskTexts.CANCEL_CONFIRM, { ask = null; vm.cancel() }),
            text = if (d?.row?.running == true) TaskTexts.CANCEL_RUNNING else TaskTexts.CANCEL_QUEUED_BODY, dismiss = OrbDialogAction(TaskTexts.CANCEL_BACK, close),
        )
        Ask.Undo -> OrbDialog(
            close, TaskTexts.UNDO_TASK_TITLE, OrbDialogAction(TaskTexts.UNDO, { ask = null; vm.undo() }),
            text = TaskTexts.UNDO_HELD_BODY, dismiss = OrbDialogAction(TaskTexts.DISMISS, close),
        )
        Ask.LaunchAnyway -> OrbDialog(
            close, TaskTexts.LAUNCH_ASK, OrbDialogAction(TaskTexts.LAUNCH_CONFIRM, { ask = null; vm.launchAnyway() }),
            text = TaskTexts.LAUNCH_BODY, dismiss = OrbDialogAction(TaskTexts.CANCEL_BACK, close),
        )
        Ask.Reject -> OrbDialog(
            close, TaskTexts.REJECT_ASK, OrbDialogAction(TaskTexts.REJECT_CONFIRM, { ask = null; vm.approve(false) }),
            text = TaskTexts.REJECT_BODY, dismiss = OrbDialogAction(TaskTexts.CANCEL_BACK, close),
        )
        Ask.Review -> OrbDialog(
            close, TaskTexts.REVIEW_TASK_ASK, OrbDialogAction(TaskTexts.REVIEW_TASK_CONFIRM, { ask = null; vm.review() }),
            text = TaskTexts.REVIEW_TASK_BODY, dismiss = OrbDialogAction(TaskTexts.DISMISS, close),
        )
        Ask.Reassign -> ReassignSheet(state.agents, d?.row?.agent, d?.reasoning, onDismiss = close, onOk = { a, r -> ask = null; vm.reassign(a, r) })
        Ask.Followup -> FollowupSheet(onDismiss = close, onSend = { ask = null; vm.followup(it) })
        Ask.Menu -> if (d != null) OrbSheet(close, title = "#${d.id}") {
            OrbSheetItem(TaskTexts.HISTORY, { ask = Ask.History }, icon = OrbIcons.History, meta = d.events.size.toString(), chevron = true)
            if (d.children.isNotEmpty()) OrbSheetItem(TaskTexts.SUBTASKS, { ask = Ask.Subtasks }, icon = OrbIcons.GitFork, meta = d.children.size.toString(), chevron = true)
            if (d.dependencies.isNotEmpty()) OrbSheetItem(TaskTexts.DEPENDS_ON, { ask = Ask.Depends }, icon = OrbIcons.Link, meta = d.dependencies.size.toString(), chevron = true)
            // Undoing a held task keeps its own confirmation: the dialog reads the task again and acts on the point of return it saw.
            if (TaskAction.UndoHeld in state.actions) OrbSheetItem(TaskTexts.UNDO, { vm.askUndo(); ask = Ask.Undo }, icon = OrbIcons.Undo, enabled = enabled)
            if (TaskAction.Review in state.actions) OrbSheetItem(TaskTexts.REVIEW, { ask = Ask.Review }, icon = OrbIcons.ShieldCheck, enabled = enabled)
        }
        Ask.History -> if (d != null) OrbSheet(close, title = "${TaskTexts.HISTORY} (${d.events.size})") { History(d, nowMs()) }
        Ask.Subtasks -> if (d != null) OrbSheet(close, title = TaskTexts.SUBTASKS) { Links(d.children) { ask = null; onOpenTask(it) } }
        Ask.Depends -> if (d != null) OrbSheet(close, title = TaskTexts.DEPENDS_ON) { Links(d.dependencies) { ask = null; onOpenTask(it) } }
        null -> Unit
    }
}

/** The actions the fixed bar draws; the snackbar rises above it only when it is there. */
private val BAR = setOf(TaskAction.Cancel, TaskAction.Reassign, TaskAction.Followup)

/** True when the fixed bar is on the screen: a held or stopped task always has it. */
private fun hasBar(d: TaskDetail, actions: Set<TaskAction>) = d.row.held != null || d.row.problem || actions.any { it in BAR }

/** The state, when and by whom it was made and, while it runs, how far it is. */
@Composable
private fun Header(d: TaskDetail, nowMs: Long) {
    val r = d.row
    val state = when {
        r.held != null -> TaskTexts.HELD_BADGE
        else -> TaskTexts.status(r.status)
    }
    val ago = TaskLines.ago(r.createdAt, nowMs)
    val text = if (ago != null) TaskTexts.createdLine(state, ago, d.createdBy?.takeIf { it.isNotBlank() }?.let(TaskTexts::creator)) else state
    val kind = when {
        r.held != null || r.problem -> OrbBadgeKind.Err
        r.status == "awaiting_approval" || r.status == "queued" || r.status == "pending" -> OrbBadgeKind.Warn
        r.status == "running" -> OrbBadgeKind.Info
        r.status == "done" -> OrbBadgeKind.Ok
        else -> OrbBadgeKind.Neutral
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OrbBadge(text, kind = kind)
        if (r.running) {
            r.percent?.let { OrbProgress(it.coerceIn(0, 100) / 100f) }
            r.note?.takeIf { it.isNotBlank() }?.let { Text(it, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1) }
        }
    }
}

/** `.lcard.pad`: a title with its mark and what goes under it. */
@Composable
private fun TaskCard(title: String, icon: ImageVector? = null, tone: Color? = null, content: @Composable ColumnScope.() -> Unit) {
    OrbCard {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (icon != null) androidx.compose.material3.Icon(icon, null, Modifier.width(16.dp).height(16.dp), tint = tone ?: OrbKit.mutedForeground)
                Text(title, color = OrbKit.foreground, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium)
            }
            content()
        }
    }
}

@Composable
private fun BodyText(text: String, color: Color = OrbKit.foreground) = Text(CodeSpans.of(text), color = color, fontSize = 14.5.sp, lineHeight = 21.sp)

/** The right-aligned, wrapping row of a card's buttons. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Buttons(content: @Composable () -> Unit) {
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalArrangement = Arrangement.spacedBy(4.dp)) { content() }
}

/** «¿Por qué espera?»: the reason in plain words, and the two ways out. */
@Composable
private fun WhyWaits(d: TaskDetail, actions: Set<TaskAction>, enabled: Boolean, onOther: () -> Unit, onLaunch: () -> Unit) {
    val r = d.row
    if (r.status != "queued") return
    val w = r.waiting
    val clock = TaskLines.clock(w?.until)
    val icon = when (w?.kind) { "notice" -> OrbIcons.Gauge; "folder" -> OrbIcons.FolderLock; else -> OrbIcons.Clock }
    TaskCard(TaskTexts.WHY_WAITS, icon) {
        val bold = SpanStyle(fontWeight = FontWeight.SemiBold)
        val body = buildAnnotatedString {
            when {
                w?.kind == "notice" && w.account != null && clock != null -> {
                    append(TaskTexts.waitLimit(w.account, w.percent)); append(" "); append(TaskTexts.WAIT_BACK_AT)
                    withStyle(bold) { append(clock) }
                    append(TaskTexts.WAIT_LAUNCHES)
                }
                w?.kind == "notice" -> append(TaskTexts.waitText(w))
                w?.kind == "paused" -> append(TaskTexts.WAIT_PAUSED_NOTE)
                w?.kind == "manual" -> append(TaskTexts.WAIT_MANUAL_NOTE)
                w?.kind == "folder" -> { append(TaskTexts.waitFolder(w.by)); append(". "); append(TaskTexts.WAIT_FOLDER_NOTE) }
                w?.kind == "deps" && w.on.isNotEmpty() -> { append(TaskTexts.waitsFor(w.on)); append(". "); append(TaskTexts.waitDeps(w.on.any { it.held })) }
                else -> append(TaskTexts.WAIT_TURN_NOTE)
            }
        }
        Text(body, color = OrbKit.foreground, fontSize = 14.5.sp, lineHeight = 21.sp)
        if (TaskAction.Reassign in actions || TaskAction.LaunchAnyway in actions) Buttons {
            if (TaskAction.Reassign in actions) OrbButton(TaskTexts.WAIT_ANOTHER, onOther, enabled = enabled)
            if (TaskAction.LaunchAnyway in actions) OrbButton(TaskTexts.LAUNCH_ANYWAY, onLaunch, kind = OrbButtonKind.Primary, enabled = enabled)
        }
    }
}

/** «Retenida para revisión»: why Orb stopped the task, and what can be done with the work. */
@Composable
private fun Held(d: TaskDetail, actions: Set<TaskAction>, enabled: Boolean, onChanges: () -> Unit, onAccept: () -> Unit) {
    val held = d.row.held ?: return
    TaskCard(TaskTexts.HELD_TITLE, OrbIcons.ShieldAlert, OrbKit.destructive) {
        BodyText(TaskTexts.heldBody(held.reasons, held.folder))
        if (actions.any { it == TaskAction.SeeChanges || it == TaskAction.AcceptHeld }) Buttons {
            if (TaskAction.SeeChanges in actions) OrbButton(TaskTexts.SEE_CHANGES, onChanges)
            if (TaskAction.AcceptHeld in actions) OrbButton(TaskTexts.ACCEPT, onAccept, kind = OrbButtonKind.Primary, enabled = enabled)
        }
    }
}

/** A task that did not finish: what happened, and to try again or hand it to someone else. */
@Composable
private fun Stopped(d: TaskDetail, actions: Set<TaskAction>, enabled: Boolean, onOther: () -> Unit, onRetry: () -> Unit) {
    val r = d.row
    if (!r.problem && r.status != "cancelled") return
    val clock = TaskLines.clock(r.limitedUntil)
    val (title, body) = when (r.status) {
        "blocked" -> TaskTexts.BLOCKED_TITLE to TaskTexts.BLOCKED_BODY
        "cancelled" -> TaskTexts.CANCELLED_TITLE to TaskTexts.CANCELLED_BODY
        "limited" -> TaskTexts.LIMITED to TaskTexts.limitedBody(clock)
        else -> TaskTexts.FAILED_TITLE to TaskTexts.FAILED_BODY
    }
    TaskCard(title, OrbIcons.CircleAlert, OrbKit.destructive) {
        BodyText(body)
        if (TaskAction.Reassign in actions || TaskAction.Retry in actions) Buttons {
            if (TaskAction.Reassign in actions) OrbButton(TaskTexts.WAIT_ANOTHER, onOther, enabled = enabled)
            if (TaskAction.Retry in actions) OrbButton(TaskTexts.RETRY_TASK, onRetry, kind = OrbButtonKind.Primary, enabled = enabled)
        }
    }
}

/** A hand join left half-done: say so, and offer to undo what it wrote or to try again. */
@Composable
private fun PartialJoinCard(d: TaskDetail, actions: Set<TaskAction>, enabled: Boolean, onUndo: () -> Unit, onRetry: () -> Unit) {
    val join = d.partialJoin ?: return
    TaskCard(TaskTexts.JOIN_TITLE, OrbIcons.CircleAlert, OrbKit.warning) {
        BodyText(if (join.wrote) TaskTexts.JOIN_BODY else TaskTexts.JOIN_BODY_CLEAN)
        if (TaskAction.UndoJoin in actions || TaskAction.RetryJoin in actions) Buttons {
            if (TaskAction.UndoJoin in actions) OrbButton(TaskTexts.JOIN_UNDO, onUndo, enabled = enabled)
            if (TaskAction.RetryJoin in actions) OrbButton(TaskTexts.JOIN_RETRY, onRetry, kind = OrbButtonKind.Primary, enabled = enabled)
        }
    }
}

/** «Espera tu OK»: everything the OK covers, all of it, then «Rechazar» and «Aprobar». */
@Composable
private fun Approval(d: TaskDetail, actions: Set<TaskAction>, enabled: Boolean, onApprove: () -> Unit, onReject: () -> Unit) {
    if (TaskAction.Approve !in actions) return
    TaskCard(TaskTexts.APPROVE_TITLE, OrbIcons.Hand, OrbKit.warning) {
        // The same facts as the chat's card and dialog, all of them: what the OK covers is what is read here.
        d.facts?.let { dev.orb.app.ui.chats.ApprovalFacts(it) }
            // A PC that sent no facts still shows the brief it is asked to approve.
            ?: BodyText(d.description)
        Buttons {
            OrbButton(TaskTexts.REJECT, onReject, enabled = enabled)
            OrbButton(TaskTexts.APPROVE, onApprove, kind = OrbButtonKind.Primary, enabled = enabled)
        }
    }
}

/** What the task answered, with the way to its changes; a held task has that in its own card. */
@Composable
private fun Outcome(d: TaskDetail, actions: Set<TaskAction>, onChanges: () -> Unit) {
    val result = d.row.result?.takeIf { it.isNotBlank() }
    val changes = TaskAction.SeeChanges in actions && d.row.held == null
    if (result == null && !changes) return
    TaskCard(if (result != null) TaskTexts.RESULT else TaskTexts.CHANGES_CARD) {
        BodyText(result ?: TaskTexts.CHANGES_CARD_BODY)
        if (changes) Buttons { OrbButton(TaskTexts.SEE_CHANGES, onChanges) }
    }
}

@Composable
private fun Details(d: TaskDetail, actions: Set<TaskAction>) {
    val review = d.review
    // What an OK covers is read in the approval card; without that card (no facts, or nothing to approve) the three are here.
    val waits = d.row.status == "awaiting_approval"
    val covered = waits && TaskAction.Approve in actions && d.facts != null
    var more by rememberSaveable { mutableStateOf(false) }
    val agent = agentName(d.row.agent)
    val model = (d.modelLabel ?: d.row.model)?.takeIf { it.isNotBlank() }
    val reasoning = d.reasoning?.takeIf { it.isNotBlank() }?.let(TaskTexts::reasoning)
    val technical = listOfNotNull(
        agent?.let { TaskTexts.AGENT to it }.takeIf { !waits },
        model?.let { TaskTexts.MODEL to it }.takeIf { !waits },
        reasoning?.let { TaskTexts.REASONING to it }.takeIf { !waits },
        d.branch?.takeIf { it.isNotBlank() }?.let { TaskTexts.BRANCH to it },
        d.accountLabel?.takeIf { it.isNotBlank() }?.let { TaskTexts.ACCOUNT to it },
        (TaskTexts.READ_ONLY to TaskTexts.YES).takeIf { d.row.readonly },
    )
    TaskCard(TaskTexts.DETAILS) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Fact(TaskTexts.FOLDER, TaskLines.folderLabel(d.mode == "aislada", d.row.project, d.folder))
            if (waits && !covered) {
                agent?.let { Fact(TaskTexts.AGENT, it) }
                model?.let { Fact(TaskTexts.MODEL, it) }
                reasoning?.let { Fact(TaskTexts.REASONING, it) }
            }
            if (review != null) Fact(TaskTexts.REVIEW_ROW, TaskTexts.reviewLine(review, d.row.agent))
            Fact(TaskTexts.DEPENDS_ON, if (d.dependencies.isEmpty()) TaskTexts.NO_DEPENDENCY else d.dependencies.joinToString(", ") { "#${it.id}" })
            Fact(TaskTexts.SCHEDULED, if (d.row.scheduleId != null) TaskTexts.YES else TaskTexts.NO)
            if (technical.isNotEmpty()) {
                MoreToggle(more) { more = !more }
                if (more) for ((k, v) in technical) Fact(k, v)
            }
        }
    }
}

/** The quiet «Más opciones» line that folds the technical facts of a task. */
@Composable
private fun MoreToggle(open: Boolean, onToggle: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().minimumInteractiveComponentSize().clickable(role = Role.Button, onClick = onToggle)
            .semantics { stateDescription = if (open) TaskTexts.EXPANDED else TaskTexts.COLLAPSED },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(TaskTexts.MORE_OPTIONS_TASK, Modifier.weight(1f), color = OrbKit.mutedForeground, fontSize = 14.5.sp, lineHeight = 21.sp)
        androidx.compose.material3.Icon(if (open) OrbIcons.ChevronUp else OrbIcons.ChevronDown, null, Modifier.width(18.dp).height(18.dp), tint = OrbKit.mutedForeground)
    }
}

/** A row of `.kv-m`: the name in muted grey and its value. */
@Composable
private fun Fact(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(label, Modifier.width(112.dp), color = OrbKit.mutedForeground, fontSize = 14.5.sp, lineHeight = 21.sp)
        Text(value, Modifier.weight(1f), color = OrbKit.foreground, fontSize = 14.5.sp, lineHeight = 21.sp)
    }
}

/**
 * `.actbar`: «Cancelar tarea» at the left, «Reasignar» and «Seguir» at the right. A held or stopped task draws all three, the
 * ones its state does not allow switched off and saying why to a screen reader; any other task draws only what is allowed.
 */
@Composable
private fun ActionBar(d: TaskDetail, actions: Set<TaskAction>, enabled: Boolean, onCancel: () -> Unit, onReassign: () -> Unit, onFollowup: () -> Unit) {
    val full = d.row.held != null || d.row.problem
    if (!full && actions.none { it in BAR }) return
    @Composable
    fun Slot(a: TaskAction, label: String, onClick: () -> Unit, kind: OrbButtonKind) {
        val reason = TaskActions.barReason(a, d, actions)
        if (reason != null && !full) return
        OrbButton(
            label, onClick, if (reason != null) Modifier.semantics { stateDescription = reason } else Modifier,
            kind = kind, enabled = enabled && reason == null,
        )
    }
    Column(Modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(OrbKit.border))
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Slot(TaskAction.Cancel, TaskTexts.CANCEL_CONFIRM, onCancel, OrbButtonKind.Danger)
            Box(Modifier.weight(1f))
            Slot(TaskAction.Reassign, TaskTexts.REASSIGN, onReassign, OrbButtonKind.Secondary)
            Slot(TaskAction.Followup, TaskTexts.FOLLOWUP, onFollowup, OrbButtonKind.Secondary)
        }
    }
}

/** The task's own history, newest first. */
@Composable
private fun History(d: TaskDetail, nowMs: Long) {
    if (d.events.isEmpty()) Text(TaskTexts.HISTORY_EMPTY, Modifier.padding(horizontal = 20.dp, vertical = 12.dp), color = OrbKit.mutedForeground, fontSize = 14.sp, lineHeight = 20.sp)
    for (e in d.events.asReversed()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(ChatTime.short(e.at, nowMs), Modifier.width(52.dp), color = OrbKit.faintForeground, fontSize = 13.sp, lineHeight = 18.sp)
            Text(e.detail.ifBlank { e.kind.orEmpty() }, Modifier.weight(1f), color = OrbKit.foreground, fontSize = 14.sp, lineHeight = 20.sp)
        }
    }
}

@Composable
private fun Links(links: List<TaskLink>, onOpen: (Long) -> Unit) {
    for (l in links) OrbSheetItem("#${l.id} ${l.title} · ${TaskTexts.status(l.status)}", { onOpen(l.id) }, icon = OrbIcons.Tasks)
}

/** `dlg:reasignar`: the agents the PC offers with their account and model, then «Más opciones» (the reasoning). */
@Composable
private fun ReassignSheet(agents: List<AgentChoice>?, current: String?, reasoning: String?, onDismiss: () -> Unit, onOk: (String, String) -> Unit) {
    var agent by rememberSaveable { mutableStateOf(current?.takeIf { it.isNotBlank() } ?: "any") }
    var level by rememberSaveable { mutableStateOf(reasoning?.takeIf { it.isNotBlank() } ?: "medium") }
    // A task already at a level outside the standard list keeps it selectable, so it is not lowered silently.
    val levels = if (reasoning != null && reasoning !in TaskReasoning && reasoning.isNotBlank()) TaskReasoning + reasoning else TaskReasoning
    val options = listOf(AgentChoice("any", TaskTexts.REASSIGN_AUTO)) + agents.orEmpty()
    OrbSheet(onDismiss, title = TaskTexts.REASSIGN_SHEET) {
        if (agents == null) Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { OrbSpinner(size = 24.dp) }
        for (o in options) {
            val on = agent == o.id
            OrbSheetItem(
                listOfNotNull(o.label, o.detail).joinToString(" · "), { agent = o.id },
                checked = on, meta = if (o.id == (current ?: "any")) TaskTexts.REASSIGN_CURRENT else null,
            )
        }
        OrbSheetLabel(TaskTexts.MORE_OPTIONS_TASK)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(TaskTexts.REASSIGN_REASONING, Modifier.align(Alignment.CenterVertically).padding(end = 6.dp), color = OrbKit.mutedForeground, fontSize = 14.sp)
            for (r in levels) OrbChip(TaskTexts.reasoning(r), selected = level == r, onClick = { level = r })
        }
        SheetBar(TaskTexts.REASSIGN_OK, enabled = agents != null, onDismiss = onDismiss, onOk = { onOk(agent, level) })
    }
}

/** `dlg:seguir`: a field for what is missing, and «Enviar». */
@Composable
private fun FollowupSheet(onDismiss: () -> Unit, onSend: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    OrbSheet(onDismiss, title = TaskTexts.FOLLOWUP_SHEET) {
        Box(Modifier.imePadding().padding(horizontal = 16.dp, vertical = 4.dp)) { TextArea(text, { text = it }, TaskTexts.FOLLOWUP_PLACEHOLDER, soft = true) }
        SheetBar(TaskTexts.FOLLOWUP_SEND, enabled = text.isNotBlank(), onDismiss = onDismiss, onOk = { onSend(text) })
    }
}

/** The `.actbar` inside a sheet: «Cancelar» and the main action. */
@Composable
private fun SheetBar(ok: String, enabled: Boolean, onDismiss: () -> Unit, onOk: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
        OrbButton(ChatTexts.CANCEL, onDismiss, kind = OrbButtonKind.Ghost)
        OrbButton(ok, onOk, kind = OrbButtonKind.Primary, enabled = enabled)
    }
}

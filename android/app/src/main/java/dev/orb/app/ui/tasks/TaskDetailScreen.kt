package dev.orb.app.ui.tasks

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import dev.orb.app.ui.kit.OrbSnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
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
import dev.orb.app.ui.offline.NeedsPcNote
import dev.orb.app.ui.offline.OfflineStrip
import dev.orb.app.ui.theme.OrbTheme

private enum class Ask { Cancel, Undo, Reassign, Followup, LaunchAnyway, Reject }

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
    val enabled = state.online && !state.busy

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(OrbIcons.ArrowLeft, TaskTexts.BACK, tint = OrbTheme.colors.text2) }
                Text(
                    state.detail?.let { "#${it.id} ${it.row.title}" } ?: "#${vm.id}", Modifier.weight(1f).semantics { heading() },
                    style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
            }
            if (!state.online && state.detail != null) OfflineStrip()
            val d = state.detail
            when {
                d == null && state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                d == null -> Message(state.error ?: TaskTexts.DETAIL_ERROR, action = TaskTexts.RETRY, onAction = vm::refresh)
                else -> Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
                    Header(d, nowMs())
                    if (!state.online && state.actions.isNotEmpty()) NeedsPcNote(Modifier.padding(top = 8.dp))
                    Decisions(d, state.actions, enabled, vm, onAskUndo = { ask = Ask.Undo }, onAskReject = { ask = Ask.Reject })
                    WhyWaits(d, state.actions, enabled) { ask = Ask.LaunchAnyway }
                    if (d.description.isNotBlank()) {
                        SectionLabel(TaskTexts.WHAT_TO_DO)
                        Text(d.description, style = MaterialTheme.typography.bodyMedium)
                    }
                    d.row.result?.takeIf { it.isNotBlank() }?.let {
                        SectionLabel(TaskTexts.RESULT)
                        Text(it, style = MaterialTheme.typography.bodyMedium)
                    }
                    if (d.row.undone) {
                        SectionLabel(TaskTexts.UNDONE)
                        Text(TaskTexts.UNDONE_NOTE, style = MaterialTheme.typography.bodyMedium, color = OrbTheme.colors.text2)
                    }
                    Details(d)
                    Links(TaskTexts.DEPENDS_ON, d.dependencies, onOpenTask)
                    Links(TaskTexts.SUBTASKS, d.children, onOpenTask)
                    History(d, nowMs())
                    FlowRow(Modifier.fillMaxWidth().padding(top = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (TaskAction.SeeChanges in state.actions) OutlinedButton(onClick = { onOpenChanges(d.id) }) { Text(TaskTexts.SEE_CHANGES) }
                        if (TaskAction.Retry in state.actions) OutlinedButton(onClick = vm::retry, enabled = enabled) { Text(TaskTexts.RETRY_TASK) }
                        if (TaskAction.Reassign in state.actions) OutlinedButton(onClick = { ask = Ask.Reassign; vm.loadAgents() }, enabled = enabled) { Text(TaskTexts.REASSIGN) }
                        if (TaskAction.Followup in state.actions) OutlinedButton(onClick = { ask = Ask.Followup }, enabled = enabled) { Text(TaskTexts.FOLLOWUP) }
                        if (TaskAction.Review in state.actions) OutlinedButton(onClick = vm::review, enabled = enabled) { Text(TaskTexts.REVIEW) }
                        if (TaskAction.Cancel in state.actions) {
                            TextButton(onClick = { ask = Ask.Cancel }, enabled = enabled) { Text(TaskTexts.CANCEL_TASK, color = MaterialTheme.colorScheme.error) }
                        }
                    }
                }
            }
        }
        OrbSnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(16.dp))
    }

    when (ask) {
        Ask.Cancel -> AlertDialog(
            onDismissRequest = { ask = null },
            title = { Text(TaskTexts.CANCEL_ASK) },
            text = { if (state.detail?.row?.running == true) Text(TaskTexts.CANCEL_RUNNING) },
            confirmButton = { TextButton(onClick = { ask = null; vm.cancel() }) { Text(TaskTexts.CANCEL_CONFIRM, color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { ask = null }) { Text(TaskTexts.CANCEL_BACK) } },
        )
        Ask.Undo -> AlertDialog(
            onDismissRequest = { ask = null },
            title = { Text(TaskTexts.UNDO_TASK_TITLE) },
            text = { Text(TaskTexts.UNDO_TASK_BODY) },
            confirmButton = { TextButton(onClick = { ask = null; vm.undo() }) { Text(TaskTexts.UNDO, color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { ask = null }) { Text(TaskTexts.DISMISS) } },
        )
        Ask.LaunchAnyway -> AlertDialog(
            onDismissRequest = { ask = null },
            title = { Text(TaskTexts.LAUNCH_ASK) },
            text = { Text(TaskTexts.LAUNCH_BODY) },
            confirmButton = { TextButton(onClick = { ask = null; vm.launchAnyway() }) { Text(TaskTexts.LAUNCH_CONFIRM) } },
            dismissButton = { TextButton(onClick = { ask = null }) { Text(TaskTexts.CANCEL_BACK) } },
        )
        Ask.Reject -> AlertDialog(
            onDismissRequest = { ask = null },
            title = { Text(TaskTexts.REJECT_ASK) },
            text = { Text(TaskTexts.REJECT_BODY) },
            confirmButton = { TextButton(onClick = { ask = null; vm.approve(false) }) { Text(TaskTexts.REJECT_CONFIRM, color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { ask = null }) { Text(TaskTexts.CANCEL_BACK) } },
        )
        Ask.Reassign -> ReassignDialog(state.agents, state.detail?.row?.agent, state.detail?.reasoning, onDismiss = { ask = null }, onOk = { a, r -> ask = null; vm.reassign(a, r) })
        Ask.Followup -> FollowupDialog(onDismiss = { ask = null }, onSend = { ask = null; vm.followup(it) })
        null -> Unit
    }
}

@Composable
private fun Header(d: TaskDetail, nowMs: Long) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            TaskStatusPill(d.row)
            val sub = taskSubtitle(d.row)
            if (sub.isNotEmpty()) Text(sub, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        val created = ChatTime.short(d.row.createdAt, nowMs)
        if (created.isNotEmpty()) {
            Text(
                "${TaskTexts.CREATED} $created" + (d.createdBy?.takeIf { it.isNotBlank() }?.let(TaskTexts::createdBy) ?: ""),
                style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text3,
            )
        }
        TaskProgress(d.row)
    }
}

/** The cards that need the person: a task waiting for the OK and one held for review. */
@Composable
private fun Decisions(d: TaskDetail, actions: Set<TaskAction>, enabled: Boolean, vm: TaskDetailViewModel, onAskUndo: () -> Unit, onAskReject: () -> Unit) {
    val held = d.row.held
    if (held != null) {
        Card(OrbTheme.colors.warnSoft) {
            Text(TaskTexts.heldLine(held.reasons, held.folder), style = MaterialTheme.typography.bodyMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (TaskAction.AcceptHeld in actions) Button(onClick = vm::accept, enabled = enabled) { Text(TaskTexts.ACCEPT) }
                if (TaskAction.UndoHeld in actions) OutlinedButton(onClick = onAskUndo, enabled = enabled) { Text(TaskTexts.UNDO) }
            }
        }
    }
    if (TaskAction.Approve in actions) {
        Card(OrbTheme.colors.warnSoft) {
            Text(TaskTexts.status("awaiting_approval"), style = MaterialTheme.typography.titleSmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { vm.approve(true) }, enabled = enabled) { Text(TaskTexts.APPROVE) }
                OutlinedButton(onClick = onAskReject, enabled = enabled) { Text(TaskTexts.REJECT) }
            }
        }
    }
}

@Composable
private fun Card(color: androidx.compose.ui.graphics.Color, content: @Composable () -> Unit) {
    Surface(Modifier.fillMaxWidth().padding(top = 12.dp), shape = RoundedCornerShape(16.dp), color = color) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { content() }
    }
}

@Composable
private fun WhyWaits(d: TaskDetail, actions: Set<TaskAction>, enabled: Boolean, onLaunch: () -> Unit) {
    val r = d.row
    if (r.status != "queued") return
    SectionLabel(TaskTexts.WHY_WAITS)
    Text(TaskTexts.waitText(r.waiting), style = MaterialTheme.typography.bodyMedium)
    when (r.waiting?.kind) {
        "paused" -> Text(TaskTexts.WAIT_PAUSED_NOTE, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2)
        "manual" -> Text(TaskTexts.WAIT_MANUAL_NOTE, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2)
    }
    if (TaskAction.LaunchAnyway in actions) {
        OutlinedButton(onClick = onLaunch, enabled = enabled, modifier = Modifier.padding(top = 8.dp)) { Text(TaskTexts.LAUNCH_ANYWAY) }
    }
}

@Composable
private fun Details(d: TaskDetail) {
    SectionLabel(TaskTexts.DETAILS)
    d.folder?.takeIf { it.isNotBlank() }?.let { LabelValue(TaskTexts.FOLDER, it) }
    LabelValue(TaskTexts.MODE, if (d.mode == "aislada") TaskTexts.FOLDER_ISOLATED else TaskTexts.FOLDER_SHARED)
    d.branch?.takeIf { it.isNotBlank() }?.let { LabelValue(TaskTexts.BRANCH, it) }
    dev.orb.app.ui.chats.agentName(d.row.agent)?.let { LabelValue(TaskTexts.AGENT, it) }
    (d.modelLabel ?: d.row.model)?.takeIf { it.isNotBlank() }?.let { LabelValue(TaskTexts.MODEL, it) }
    d.reasoning?.takeIf { it.isNotBlank() }?.let { LabelValue(TaskTexts.REASONING, TaskTexts.reasoning(it)) }
    d.accountLabel?.takeIf { it.isNotBlank() }?.let { LabelValue(TaskTexts.ACCOUNT, it) }
    if (d.row.readonly) LabelValue(TaskTexts.READ_ONLY, TaskTexts.YES)
}

@Composable
private fun Links(title: String, links: List<TaskLink>, onOpen: (Long) -> Unit) {
    if (links.isEmpty()) return
    SectionLabel(title)
    for (l in links) {
        Text(
            "#${l.id} ${l.title} · ${TaskTexts.status(l.status)}",
            Modifier.fillMaxWidth().clickable { onOpen(l.id) }.padding(vertical = 8.dp), style = MaterialTheme.typography.bodyMedium,
        )
    }
}

@Composable
private fun History(d: TaskDetail, nowMs: Long) {
    if (d.events.isEmpty()) return
    var all by rememberSaveable { mutableStateOf(false) }
    SectionLabel("${TaskTexts.HISTORY} (${d.events.size})")
    // Newest first, and a short list until the person asks for more.
    val shown = d.events.asReversed().let { if (all) it else it.take(8) }
    for (e in shown) {
        Row(Modifier.padding(vertical = 3.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(ChatTime.short(e.at, nowMs), Modifier.size(width = 52.dp, height = 20.dp), style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text3)
            Text(e.detail.ifBlank { e.kind.orEmpty() }, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
    }
    if (!all && d.events.size > shown.size) TextButton(onClick = { all = true }) { Text(TaskTexts.SEE_ALL) }
}

@Composable
private fun ReassignDialog(agents: List<AgentChoice>?, current: String?, reasoning: String?, onDismiss: () -> Unit, onOk: (String, String) -> Unit) {
    var agent by rememberSaveable { mutableStateOf(current?.takeIf { it.isNotBlank() } ?: "any") }
    var level by rememberSaveable { mutableStateOf(reasoning?.takeIf { it.isNotBlank() } ?: "medium") }
    // A task already at a level outside the standard list keeps it selectable, so it is not lowered silently.
    val levels = if (reasoning != null && reasoning !in TaskReasoning && reasoning.isNotBlank()) TaskReasoning + reasoning else TaskReasoning
    val options = listOf(AgentChoice("any", TaskTexts.REASSIGN_AUTO)) + agents.orEmpty()
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(TaskTexts.REASSIGN_TITLE) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text(TaskTexts.REASSIGN_AGENT, style = MaterialTheme.typography.labelLarge)
                if (agents == null) CircularProgressIndicator(Modifier.padding(8.dp).size(24.dp))
                for (o in options) {
                    Row(
                        Modifier.fillMaxWidth().selectable(agent == o.id, onClick = { agent = o.id }, role = Role.RadioButton),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = agent == o.id, onClick = null)
                        Text(o.label, Modifier.padding(start = 12.dp, top = 10.dp, bottom = 10.dp))
                    }
                }
                Text(TaskTexts.REASSIGN_REASONING, Modifier.padding(top = 12.dp), style = MaterialTheme.typography.labelLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (r in levels) FilterChip(selected = level == r, onClick = { level = r }, label = { Text(TaskTexts.reasoning(r)) })
                }
            }
        },
        confirmButton = { TextButton(onClick = { onOk(agent, level) }, enabled = agents != null) { Text(TaskTexts.REASSIGN_OK) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(TaskTexts.DISMISS) } },
    )
}

@Composable
private fun FollowupDialog(onDismiss: () -> Unit, onSend: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(TaskTexts.FOLLOWUP_TITLE) },
        text = { OutlinedTextField(text, { text = it }, Modifier.fillMaxWidth(), minLines = 3, maxLines = 6, label = { Text(TaskTexts.FOLLOWUP_HINT) }) },
        confirmButton = { TextButton(onClick = { onSend(text) }, enabled = text.isNotBlank()) { Text(TaskTexts.FOLLOWUP_SEND) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(TaskTexts.DISMISS) } },
    )
}

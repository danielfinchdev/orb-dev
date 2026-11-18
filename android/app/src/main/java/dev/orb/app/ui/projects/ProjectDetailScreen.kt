package dev.orb.app.ui.projects

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import dev.orb.app.ui.kit.OrbSnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.chats.ChatRef
import dev.orb.app.ui.chats.ChatRow
import dev.orb.app.ui.chats.Message
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.tasks.SectionLabel
import dev.orb.app.ui.tasks.TaskRow
import dev.orb.app.ui.tasks.TaskStatusPill
import dev.orb.app.ui.offline.OfflineStrip
import dev.orb.app.ui.theme.OrbTheme

/** Most rows a section lists; the rest stay in the Chats and Tareas tabs. */
private const val SECTION_LIMIT = 15

@Composable
fun ProjectDetailScreen(
    vm: ProjectDetailViewModel,
    onBack: () -> Unit,
    onOpenChat: (ChatRef) -> Unit,
    onOpenTask: (Long) -> Unit,
    modifier: Modifier = Modifier,
    onOpenPrs: (String) -> Unit = {},
    /** Null hides the row: the Pizarra is not available. */
    onOpenWhiteboard: ((String) -> Unit)? = null,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.refresh() }
    LaunchedEffect(state.finished) { if (state.finished) onBack() }
    var confirmFinish by rememberSaveable { mutableStateOf(false) }
    var confirmReview by rememberSaveable { mutableStateOf<String?>(null) }
    val enabled = state.online && !state.busy

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(OrbIcons.ArrowLeft, ProjectTexts.BACK, tint = OrbTheme.colors.text2) }
                Text(
                    state.name, Modifier.weight(1f).semantics { heading() },
                    style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            when {
                !state.loaded && state.loadFailed -> Message(ProjectTexts.DETAIL_ERROR, action = ProjectTexts.RETRY, onAction = vm::refresh)
                !state.loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                else -> Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
                    if (!state.online) {
                        OfflineStrip()
                    }
                    Section(ProjectTexts.SECTION_CHATS)
                    if (state.chats.isEmpty()) Empty(ProjectTexts.NO_CHATS)
                    state.chats.take(SECTION_LIMIT).forEach { ChatItem(it, onOpenChat) }
                    Section(ProjectTexts.SECTION_TASKS)
                    if (state.tasks.isEmpty()) Empty(ProjectTexts.NO_TASKS)
                    state.tasks.take(SECTION_LIMIT).forEach { TaskItem(it, onOpenTask) }
                    Section(ProjectTexts.SECTION_MORE)
                    ActionRow(OrbIcons.ListOrdered, ProjectTexts.BRANCH, ProjectTexts.branchValue(state.git), enabled = true, onClick = null)
                    if (onOpenWhiteboard != null && state.canWhiteboard) ActionRow(OrbIcons.PenTool, ProjectTexts.WHITEBOARD, null, enabled = state.online) { onOpenWhiteboard(state.name) }
                    if (state.canPrs) ActionRow(OrbIcons.ChevronRight, ProjectTexts.PRS, null, enabled = true) { onOpenPrs(state.name) }
                    if (state.canReview) ActionRow(OrbIcons.Check, ProjectTexts.REVIEW, null, enabled) { confirmReview = "review" }
                    if (state.canSecurityReview) ActionRow(OrbIcons.Shield, ProjectTexts.SECURITY_REVIEW, null, enabled) { confirmReview = "security" }
                    if (state.canLog) ActionRow(OrbIcons.Archive, ProjectTexts.LOG, null, enabled = true, onClick = vm::openLog)
                    if (state.canFinish) ActionRow(OrbIcons.CheckCheck, ProjectTexts.FINISH, null, enabled) { confirmFinish = true }
                }
            }
        }
        OrbSnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(16.dp))
    }

    confirmReview?.let { kind ->
        AlertDialog(
            onDismissRequest = { confirmReview = null },
            title = { Text(if (kind == "security") ProjectTexts.SECURITY_ASK else ProjectTexts.REVIEW_ASK) },
            text = { Text(ProjectTexts.REVIEW_BODY) },
            confirmButton = {
                TextButton(onClick = { confirmReview = null; if (kind == "security") vm.securityReview() else vm.review() }) { Text(ProjectTexts.REVIEW_CONFIRM) }
            },
            dismissButton = { TextButton(onClick = { confirmReview = null }) { Text(ProjectTexts.CANCEL) } },
        )
    }
    if (confirmFinish) AlertDialog(
        onDismissRequest = { confirmFinish = false },
        title = { Text(ProjectTexts.FINISH_ASK) },
        text = { Text(ProjectTexts.FINISH_BODY) },
        confirmButton = { TextButton(onClick = { confirmFinish = false; vm.finish() }) { Text(ProjectTexts.FINISH_CONFIRM, color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = { confirmFinish = false }) { Text(ProjectTexts.CANCEL) } },
    )
    state.log?.let { LogDialog(it, onDismiss = vm::closeLog, onRetry = vm::openLog) }
}

@Composable
private fun Section(text: String) = SectionLabel(text, Modifier.padding(horizontal = 16.dp))

@Composable
private fun Empty(text: String) =
    Text(text, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.bodyMedium, color = OrbTheme.colors.text3)

@Composable
private fun ChatItem(c: ChatRow, onOpen: (ChatRef) -> Unit) {
    Column(Modifier.fillMaxWidth().clickable { onOpen(c.ref) }.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(c.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        c.lastText?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun TaskItem(t: TaskRow, onOpen: (Long) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable { onOpen(t.id) }.padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("#${t.id} ${t.title}", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        TaskStatusPill(t)
    }
}

@Composable
private fun ActionRow(icon: ImageVector, label: String, value: String?, enabled: Boolean, onClick: (() -> Unit)?) {
    val base = Modifier.fillMaxWidth()
    Row(
        (if (onClick != null && enabled) base.clickable(onClick = onClick) else base).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(icon, null, Modifier.size(22.dp), tint = if (enabled) OrbTheme.colors.text2 else OrbTheme.colors.text3)
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, color = if (enabled) MaterialTheme.colorScheme.onSurface else OrbTheme.colors.text3)
        if (value != null) Text(value, style = MaterialTheme.typography.bodyMedium, color = OrbTheme.colors.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun LogDialog(log: LogState, onDismiss: () -> Unit, onRetry: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(ProjectTexts.LOG) },
        text = {
            when {
                log.loading -> Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                log.error != null -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(log.error, color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = onRetry) { Text(ProjectTexts.RETRY) }
                }
                else -> Column(Modifier.verticalScroll(rememberScrollState())) {
                    Text(
                        log.text?.takeIf { it.isNotBlank() } ?: ProjectTexts.LOG_EMPTY,
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(ProjectTexts.CLOSE) } },
    )
}

package dev.orb.app.ui.projects

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.chats.ChatRef
import dev.orb.app.ui.chats.ChatRowItem
import dev.orb.app.ui.chats.ChatTime
import dev.orb.app.ui.chats.Message
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbCard
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbGroupHeader
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbNote
import dev.orb.app.ui.kit.OrbRow
import dev.orb.app.ui.kit.OrbSettingRow
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbSheetItem
import dev.orb.app.ui.kit.OrbSnackbarHost
import dev.orb.app.ui.kit.OrbSpinner
import dev.orb.app.ui.kit.OrbTopBar
import dev.orb.app.ui.kit.ProjectDot
import dev.orb.app.ui.kit.ProjectDotSize
import dev.orb.app.ui.offline.OfflineStrip
import dev.orb.app.ui.tasks.NewTaskDialog
import dev.orb.app.ui.tasks.TaskRow
import dev.orb.app.ui.tasks.TaskStatusPill
import kotlinx.coroutines.launch

/** Most rows a list in this page shows; the rest stay in the Chats and Tareas tabs. */
private const val SECTION_LIMIT = 15

/** How far the page scrolls before the large header has gone: it fades and rises with the content, drawn on the GPU. */
private const val COLLAPSE_PX = 140f

/**
 * A project's page (screen 22). The bar stays on top with the name and a useful line; the large header (dot, name, what its
 * tasks are doing) and the buttons scroll away under it. What the mockup does not draw (pull requests, the review, the tasks
 * list) sits under «Más del proyecto» at the end.
 */
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
    /** Opens the new-chat sheet with this project chosen. */
    onNewChat: (String) -> Unit = {},
    /** Opens the changes of one task. */
    onOpenChanges: (Long) -> Unit = {},
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.refresh() }
    LaunchedEffect(state.finished) { if (state.finished) onBack() }
    var confirmFinish by rememberSaveable { mutableStateOf(false) }
    var confirmReview by rememberSaveable { mutableStateOf<String?>(null) }
    var branchOpen by rememberSaveable { mutableStateOf(false) }
    var pickChanges by rememberSaveable { mutableStateOf(false) }
    var tasksOpen by rememberSaveable { mutableStateOf(false) }
    val enabled = state.online && !state.busy
    val scroll = rememberScrollState()
    val scrolled by remember { derivedStateOf { scroll.value > 8 } }
    var moreAt by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            OrbTopBar(
                title = state.name, sub = if (state.archived) ProjectTexts.FINISHED_TITLE else ProjectTexts.barLine(state.category, state.git), line = scrolled,
                leading = { OrbIconButton(OrbIcons.ArrowLeft, ProjectTexts.BACK, onBack) },
                actions = { OrbIconButton(OrbIcons.MoreVertical, ProjectTexts.MORE, { scope.launch { scroll.animateScrollTo(moreAt) } }) },
            )
            when {
                !state.loaded && state.loadFailed -> Message(ProjectTexts.DETAIL_ERROR, action = ProjectTexts.RETRY, onAction = vm::refresh, icon = OrbIcons.CircleAlert)
                !state.loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { OrbSpinner(size = 28.dp) }
                else -> Column(Modifier.weight(1f).verticalScroll(scroll)) {
                    if (!state.online) {
                        OfflineStrip()
                    }
                    Header(state) { scroll.value }
                    if (state.archived) {
                        Box(Modifier.padding(horizontal = 16.dp).padding(top = 12.dp)) {
                            OrbCard {
                                OrbSettingRow(
                                    ProjectTexts.FINISHED_TITLE, subtitle = ProjectTexts.FINISHED_HINT, divider = false,
                                    trailing = if (state.canReopen) ({ OrbButton(ProjectTexts.REOPEN, vm::reopen, small = true, kind = OrbButtonKind.Primary, enabled = enabled) }) else null,
                                )
                            }
                        }
                    } else {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                            if (state.canNewTask) OrbButton(ProjectTexts.TASK, vm::openNewTask, icon = OrbIcons.Tasks, enabled = state.online)
                            OrbButton(ProjectTexts.NEW_CHAT, { onNewChat(state.name) }, kind = OrbButtonKind.Primary, icon = OrbIcons.SquarePen)
                        }
                    }
                    OrbGroupHeader(ProjectTexts.SECTION_CHATS, count = state.chats.size)
                    if (state.chats.isEmpty()) Empty(ProjectTexts.NO_CHATS)
                    val now = System.currentTimeMillis()
                    state.chats.take(SECTION_LIMIT).forEach { c ->
                        ChatRowItem(c, ChatTime.listTime(c.at, now), onClick = { onOpenChat(c.ref) }, onLongClick = {})
                    }
                    OrbGroupHeader(ProjectTexts.SECTION_MORE, Modifier.onGloballyPositioned { moreAt = it.positionInParent().y.toInt() })
                    if (!state.archived) MoreRow(OrbIcons.GitBranch, ProjectTexts.BRANCH, meta = ProjectTexts.branchMeta(state.git) ?: ProjectTexts.NO_GIT) { branchOpen = true }
                    if (!state.archived && state.canSecurityReview) MoreRow(OrbIcons.ShieldCheck, ProjectTexts.SECURITY_REVIEW, enabled = enabled) { confirmReview = "security" }
                    if (state.canLog) MoreRow(OrbIcons.NotebookText, ProjectTexts.LOG, onClick = vm::openLog)
                    if (onOpenWhiteboard != null && state.canWhiteboard) MoreRow(OrbIcons.Presentation, ProjectTexts.WHITEBOARD, meta = ProjectTexts.WHITEBOARD_META, enabled = state.online) { onOpenWhiteboard(state.name) }
                    if (state.canPrs) MoreRow(OrbIcons.GitPullRequest, ProjectTexts.PRS) { onOpenPrs(state.name) }
                    if (!state.archived && state.canReview) MoreRow(OrbIcons.GitCompare, ProjectTexts.REVIEW, enabled = enabled) { confirmReview = "review" }
                    if (state.tasks.isNotEmpty()) MoreRow(OrbIcons.Tasks, ProjectTexts.TASKS_ROW, meta = state.tasks.size.toString()) { tasksOpen = true }
                    if (!state.archived && state.canFinish) MoreRow(OrbIcons.CircleCheck, ProjectTexts.FINISH, danger = true, enabled = enabled) { confirmFinish = true }
                    Box(Modifier.size(16.dp))
                }
            }
        }
        OrbSnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(16.dp))
    }

    if (branchOpen) BranchSheet(
        state, enabled, onDismiss = { branchOpen = false },
        onReview = { branchOpen = false; confirmReview = "review" }, onSecurity = { branchOpen = false; confirmReview = "security" },
        onChanges = {
            branchOpen = false
            val rows = state.unaccepted
            if (rows.size == 1) onOpenChanges(rows[0].id) else pickChanges = true
        },
    )
    if (pickChanges) OrbSheet(onDismiss = { pickChanges = false }, title = ProjectTexts.PICK_CHANGES) {
        state.unaccepted.take(SECTION_LIMIT).forEach { t -> TaskLine(t) { pickChanges = false; onOpenChanges(t.id) } }
    }
    if (tasksOpen) OrbSheet(onDismiss = { tasksOpen = false }, title = ProjectTexts.TASKS_ROW) {
        state.tasks.take(SECTION_LIMIT).forEach { t -> TaskLine(t) { tasksOpen = false; onOpenTask(t.id) } }
    }
    state.newTask?.let { NewTaskDialog(it, onCreate = vm::createTask, onDismiss = vm::closeNewTask) }

    confirmReview?.let { kind ->
        OrbDialog(
            onDismiss = { confirmReview = null }, title = if (kind == "security") ProjectTexts.SECURITY_ASK else ProjectTexts.REVIEW_ASK,
            confirm = OrbDialogAction(ProjectTexts.REVIEW_CONFIRM, { confirmReview = null; if (kind == "security") vm.securityReview() else vm.review() }),
            text = ProjectTexts.REVIEW_BODY, dismiss = OrbDialogAction(ProjectTexts.CANCEL, { confirmReview = null }),
        )
    }
    if (confirmFinish) OrbDialog(
        onDismiss = { confirmFinish = false }, title = ProjectTexts.finishAsk(state.name),
        confirm = OrbDialogAction(ProjectTexts.FINISH_CONFIRM, { confirmFinish = false; vm.finish() }, danger = true),
        text = ProjectTexts.FINISH_BODY, dismiss = OrbDialogAction(ProjectTexts.CANCEL, { confirmFinish = false }),
    )
    state.log?.let { LogSheet(it, onDismiss = vm::closeLog, onRetry = vm::openLog) }
}

/** The large header: the dot, the name and what the tasks are doing. It fades and rises as the page scrolls, without recomposing. */
@Composable
private fun Header(state: ProjectDetailState, scrollOf: () -> Int) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 8.dp).graphicsLayer {
            val f = (scrollOf() / COLLAPSE_PX).coerceIn(0f, 1f)
            alpha = 1f - f
            translationY = scrollOf() * 0.4f
        },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        ProjectDot(state.name, size = ProjectDotSize.Large)
        Column(Modifier.weight(1f)) {
            Text(
                state.name, Modifier.semantics { heading() }, color = OrbKit.foreground, fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text(
                if (state.archived) ProjectTexts.finishedOn(state.finishedAt) else ProjectTexts.headerLine(state.openTasks),
                color = OrbKit.faintForeground, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun Empty(text: String) = OrbNote(text, Modifier.padding(horizontal = 16.dp, vertical = 4.dp))

/** A row of «Más del proyecto» (`.mrow` at 56 dp): the icon, the name and a quiet remark at the end; [danger] paints it destructive. */
@Composable
private fun MoreRow(icon: ImageVector, title: String, meta: String? = null, danger: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    val tone = if (danger) OrbKit.destructive else OrbKit.foreground
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = 56.dp).alpha(if (enabled) 1f else 0.45f).clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, null, Modifier.size(20.dp), tint = if (danger) OrbKit.destructive else OrbKit.mutedForeground)
        Text(title, Modifier.weight(1f), color = tone, fontSize = 15.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (meta != null) Text(meta, color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun TaskLine(t: TaskRow, onClick: () -> Unit) {
    OrbRow(
        "#${t.id} ${t.title}", onClick = onClick, lead = { Icon(OrbIcons.Tasks, null, Modifier.size(16.dp), tint = OrbKit.mutedForeground) },
        badge = { TaskStatusPill(t) },
    )
}

/** «Rama y cambios»: what git says and what the tasks say, each under its own name, and what can be done from there. */
@Composable
private fun BranchSheet(
    state: ProjectDetailState, enabled: Boolean, onDismiss: () -> Unit, onReview: () -> Unit, onSecurity: () -> Unit, onChanges: () -> Unit,
) {
    val git = state.git
    val waiting = state.unaccepted.size
    OrbSheet(onDismiss = onDismiss, title = ProjectTexts.BRANCH) {
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Fact(OrbIcons.GitBranch, ProjectTexts.BRANCH_NAME, if (git == null) ProjectTexts.NO_GIT else git.branch ?: ProjectTexts.DETACHED_HEAD)
            git?.changes?.let { Fact(OrbIcons.GitCompare, ProjectTexts.BRANCH_CHANGES, ProjectTexts.uncommitted(it)) }
            git?.ahead?.takeIf { it > 0 }?.let { Fact(OrbIcons.ArrowUp, ProjectTexts.BRANCH_AHEAD, ProjectTexts.ahead(it)) }
            Fact(OrbIcons.Tasks, ProjectTexts.BRANCH_TASKS, ProjectTexts.unaccepted(waiting))
            if ((git?.changes ?: 0) > 0) OrbNote(ProjectTexts.SEE_IN_PC)
        }
        if (state.canReview) OrbSheetItem(ProjectTexts.CROSS_REVIEW, onReview, icon = OrbIcons.GitCompare, enabled = enabled)
        if (state.canSecurityReview) OrbSheetItem(ProjectTexts.SECURITY_REVIEW, onSecurity, icon = OrbIcons.ShieldCheck, enabled = enabled)
        OrbSheetItem(
            ProjectTexts.SEE_CHANGES, onChanges, icon = OrbIcons.Tasks, enabled = waiting > 0,
            meta = if (waiting == 0) ProjectTexts.NO_TASK_CHANGES else null,
        )
    }
}

@Composable
private fun Fact(icon: ImageVector, label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.Top) {
        Row(Modifier.width(112.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(icon, null, Modifier.size(16.dp), tint = OrbKit.mutedForeground)
            Text(label, color = OrbKit.mutedForeground, fontSize = 14.5.sp, lineHeight = 21.sp)
        }
        Text(value, Modifier.weight(1f), color = OrbKit.foreground, fontSize = 14.5.sp, lineHeight = 21.sp)
    }
}

@Composable
private fun LogSheet(log: LogState, onDismiss: () -> Unit, onRetry: () -> Unit) {
    OrbSheet(onDismiss = onDismiss, title = ProjectTexts.LOG, showClose = true, closeLabel = ProjectTexts.CLOSE) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            when {
                log.loading -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { OrbSpinner(size = 28.dp) }
                log.error != null -> {
                    Text(log.error, color = OrbKit.destructive, fontSize = 14.sp, lineHeight = 20.sp)
                    OrbButton(ProjectTexts.RETRY, onRetry)
                }
                else -> Text(
                    log.text?.takeIf { it.isNotBlank() } ?: ProjectTexts.LOG_EMPTY, color = OrbKit.foreground,
                    fontSize = 12.5.sp, lineHeight = 18.sp, fontFamily = FontFamily.Monospace,
                )
            }
        }
    }
}

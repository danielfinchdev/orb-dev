package dev.orb.app.ui.projects

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.link.api.ConfirmAction
import dev.orb.app.link.api.Confirmed
import dev.orb.app.link.api.UserConfirmation
import dev.orb.app.ui.chats.Message
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbNote
import dev.orb.app.ui.kit.OrbRow
import dev.orb.app.ui.kit.OrbSnackbarHost
import dev.orb.app.ui.kit.OrbSpinner
import dev.orb.app.ui.kit.OrbSubtitle
import dev.orb.app.ui.kit.OrbTopBar
import dev.orb.app.ui.offline.NeedsPcNote

/** The header of the pull request screens: the back arrow and one line of title. */
@Composable
private fun PrBar(title: String, onBack: () -> Unit) {
    OrbTopBar(title = title, leading = { OrbIconButton(OrbIcons.ArrowLeft, ProjectTexts.BACK, onBack) })
}

@Composable
private fun Label(text: String) {
    Text(text, Modifier.padding(top = 16.dp, bottom = 4.dp), color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp)
}

@Composable
private fun Fact(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(label, Modifier.weight(0.4f), color = OrbKit.mutedForeground, fontSize = 14.5.sp, lineHeight = 21.sp)
        Text(value, Modifier.weight(0.6f), color = OrbKit.foreground, fontSize = 14.5.sp, lineHeight = 21.sp)
    }
}

@Composable
fun PrListScreen(vm: PrListViewModel, onBack: () -> Unit, onOpenPr: (Int) -> Unit, modifier: Modifier = Modifier) {
    val state by vm.state.collectAsStateWithLifecycle()
    Column(modifier.fillMaxSize()) {
        PrBar("${ProjectTexts.PRS_TITLE} · ${vm.name}", onBack)
        when {
            state.loading && state.prs.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { OrbSpinner(size = 28.dp) }
            state.error != null && state.prs.isEmpty() -> Message(ProjectTexts.PRS_ERROR, state.error, ProjectTexts.RETRY, vm::refresh, icon = OrbIcons.CircleAlert)
            state.prs.isEmpty() -> Message(ProjectTexts.PRS_EMPTY, icon = OrbIcons.GitPullRequest)
            else -> LazyColumn(Modifier.fillMaxSize()) {
                items(state.prs, key = { it.number }) { pr ->
                    OrbRow(
                        "#${pr.number} ${pr.title}", onClick = { onOpenPr(pr.number) },
                        lead = { Icon(OrbIcons.GitPullRequest, null, Modifier.size(16.dp), tint = OrbKit.mutedForeground) },
                        subtitle = { OrbSubtitle(listOfNotNull(pr.head, ProjectTexts.PR_DRAFT.takeIf { pr.draft }, pr.author).joinToString(" · ")) },
                    )
                }
            }
        }
    }
}

@Composable
fun PrDetailScreen(vm: PrDetailViewModel, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    var confirming by rememberSaveable { mutableStateOf(false) }
    val pr = state.pr
    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            PrBar(pr?.let { "#${it.number} ${it.title}" } ?: "#${vm.number}", onBack)
            when {
                pr == null && state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { OrbSpinner(size = 28.dp) }
                pr == null -> Message(ProjectTexts.PR_ERROR, state.error, ProjectTexts.RETRY, vm::refresh, icon = OrbIcons.CircleAlert)
                else -> Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
                    state.error?.let { Text(it, Modifier.padding(bottom = 8.dp), color = OrbKit.destructive, fontSize = 13.sp, lineHeight = 18.sp) }
                    Fact(ProjectTexts.PR_STATE, ProjectTexts.prState(pr))
                    Fact(ProjectTexts.PR_BRANCH, listOfNotNull(pr.head, pr.base).joinToString(" → "))
                    pr.author?.takeIf { it.isNotBlank() }?.let { Fact(ProjectTexts.PR_AUTHOR, it) }
                    Fact(ProjectTexts.PR_CHANGES, ProjectTexts.changes(pr))
                    ProjectTexts.reviewDecision(pr.reviewDecision)?.let { Fact(ProjectTexts.PR_REVIEW, it) }
                    if (pr.open) ProjectTexts.mergeable(pr.mergeable)?.let { Fact(ProjectTexts.PR_MERGE_STATE, it) }
                    Label(ProjectTexts.PR_CHECKS)
                    Text(ProjectTexts.checksSummary(pr.checks), color = OrbKit.foreground, fontSize = 14.5.sp, lineHeight = 21.sp)
                    pr.checks.forEach { c ->
                        Text(
                            "${if (c.passed) "✓" else if (c.failed) "✗" else "…"} ${c.name}", Modifier.padding(top = 2.dp),
                            color = if (c.failed) OrbKit.destructive else OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp,
                        )
                    }
                    if (pr.body.isNotBlank()) {
                        Label(ProjectTexts.PR_DESCRIPTION)
                        Text(pr.body, color = OrbKit.foreground, fontSize = 14.5.sp, lineHeight = 21.sp)
                    }
                    if (state.needsPcUpdate) {
                        OrbNote(ProjectTexts.PR_MERGE_UPDATE_PC, Modifier.padding(top = 16.dp))
                    }
                    // Only an open pull request the PC can merge offers the button; a merged or closed one never does.
                    if (state.canMerge) {
                        if (!state.online) NeedsPcNote(Modifier.padding(top = 12.dp))
                        OrbButton(ProjectTexts.PR_MERGE, { confirming = true }, Modifier.padding(top = 20.dp), kind = OrbButtonKind.Primary, enabled = state.online && !state.merging)
                    }
                }
            }
        }
        OrbSnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(16.dp))
    }

    val target = pr
    if (confirming && target != null && state.canMerge) MergeDialog(
        target, vm.name, busy = state.merging, onDismiss = { confirming = false },
        onConfirm = { method ->
            confirming = false
            // The only place a merge token is made: the person has just accepted this dialog, which names the pull request and the method.
            @OptIn(UserConfirmation::class)
            val token = Confirmed(ConfirmAction.MergePr, "${vm.name}#${target.number}")
            vm.merge(method, token)
        },
    )
}

@Composable
private fun MergeDialog(pr: PrDetail, project: String, busy: Boolean, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var method by rememberSaveable { mutableStateOf(MergeMethods.first()) }
    OrbDialog(
        onDismiss = onDismiss, title = ProjectTexts.PR_MERGE_ASK,
        confirm = OrbDialogAction(ProjectTexts.PR_MERGE, { onConfirm(method) }, enabled = !busy),
        dismiss = OrbDialogAction(ProjectTexts.CANCEL, onDismiss),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("$project · #${pr.number} ${pr.title}", color = OrbKit.foreground, fontSize = 14.5.sp, lineHeight = 21.sp, fontWeight = FontWeight.SemiBold)
            Text(listOfNotNull(pr.head, pr.base).joinToString(" → "), color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp)
            Text(ProjectTexts.PR_MERGE_METHOD, Modifier.padding(top = 4.dp), color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp)
            for (m in MergeMethods) {
                Row(
                    Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).selectable(selected = method == m, onClick = { method = m }, role = Role.RadioButton),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(if (method == m) OrbIcons.CircleCheck else OrbIcons.Circle, null, Modifier.size(20.dp), tint = if (method == m) OrbKit.foreground else OrbKit.mutedForeground)
                    Text(ProjectTexts.mergeMethod(m), color = OrbKit.foreground, fontSize = 14.5.sp, lineHeight = 21.sp)
                }
            }
            OrbNote(ProjectTexts.PR_MERGE_NOTE)
        }
    }
}

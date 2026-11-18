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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.RadioButton
import dev.orb.app.ui.kit.OrbSnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.TextButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.link.api.ConfirmAction
import dev.orb.app.link.api.Confirmed
import dev.orb.app.link.api.UserConfirmation
import dev.orb.app.ui.chats.Message
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.tasks.LabelValue
import dev.orb.app.ui.tasks.SectionLabel
import dev.orb.app.ui.offline.NeedsPcNote
import dev.orb.app.ui.theme.OrbTheme

@Composable
private fun PrBar(title: String, onBack: () -> Unit) {
    Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(OrbIcons.ArrowLeft, ProjectTexts.BACK, tint = OrbTheme.colors.text2) }
        Text(
            title, Modifier.weight(1f).semantics { heading() },
            style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
fun PrListScreen(vm: PrListViewModel, onBack: () -> Unit, onOpenPr: (Int) -> Unit, modifier: Modifier = Modifier) {
    val state by vm.state.collectAsStateWithLifecycle()
    Column(modifier.fillMaxSize()) {
        PrBar("${ProjectTexts.PRS_TITLE} · ${vm.name}", onBack)
        when {
            state.loading && state.prs.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            state.error != null && state.prs.isEmpty() -> Message(ProjectTexts.PRS_ERROR, state.error, ProjectTexts.RETRY, vm::refresh)
            state.prs.isEmpty() -> Message(ProjectTexts.PRS_EMPTY)
            else -> LazyColumn(Modifier.fillMaxSize()) {
                items(state.prs, key = { it.number }) { pr ->
                    Column(
                        Modifier.fillMaxWidth().clickable { onOpenPr(pr.number) }.padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Text("#${pr.number} ${pr.title}", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(
                            listOfNotNull(pr.head, ProjectTexts.PR_DRAFT.takeIf { pr.draft }, pr.author).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
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
                pr == null && state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                pr == null -> Message(ProjectTexts.PR_ERROR, state.error, ProjectTexts.RETRY, vm::refresh)
                else -> Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
                    state.error?.let { Text(it, Modifier.padding(bottom = 8.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                    LabelValue(ProjectTexts.PR_STATE, ProjectTexts.prState(pr))
                    LabelValue(ProjectTexts.PR_BRANCH, listOfNotNull(pr.head, pr.base).joinToString(" → "))
                    pr.author?.takeIf { it.isNotBlank() }?.let { LabelValue(ProjectTexts.PR_AUTHOR, it) }
                    LabelValue(ProjectTexts.PR_CHANGES, ProjectTexts.changes(pr))
                    ProjectTexts.reviewDecision(pr.reviewDecision)?.let { LabelValue(ProjectTexts.PR_REVIEW, it) }
                    if (pr.open) ProjectTexts.mergeable(pr.mergeable)?.let { LabelValue(ProjectTexts.PR_MERGE_STATE, it) }
                    SectionLabel(ProjectTexts.PR_CHECKS)
                    Text(ProjectTexts.checksSummary(pr.checks), style = MaterialTheme.typography.bodyMedium)
                    pr.checks.forEach { c ->
                        Text(
                            "${if (c.passed) "✓" else if (c.failed) "✗" else "…"} ${c.name}", Modifier.padding(top = 2.dp),
                            style = MaterialTheme.typography.bodySmall, color = if (c.failed) MaterialTheme.colorScheme.error else OrbTheme.colors.text2,
                        )
                    }
                    if (pr.body.isNotBlank()) {
                        SectionLabel(ProjectTexts.PR_DESCRIPTION)
                        Text(pr.body, style = MaterialTheme.typography.bodyMedium)
                    }
                    if (state.needsPcUpdate) {
                        Text(ProjectTexts.PR_MERGE_UPDATE_PC, Modifier.padding(top = 16.dp), style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2)
                    }
                    // Only an open pull request the PC can merge offers the button; a merged or closed one never does.
                    if (state.canMerge) {
                        if (!state.online) NeedsPcNote(Modifier.padding(top = 12.dp))
                        Button(onClick = { confirming = true }, enabled = state.online && !state.merging, modifier = Modifier.padding(top = 20.dp)) {
                            Text(ProjectTexts.PR_MERGE)
                        }
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
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(ProjectTexts.PR_MERGE_ASK) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("$project · #${pr.number} ${pr.title}", fontWeight = FontWeight.SemiBold)
                Text(listOfNotNull(pr.head, pr.base).joinToString(" → "), style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2)
                Text(ProjectTexts.PR_MERGE_METHOD, Modifier.padding(top = 4.dp), style = MaterialTheme.typography.labelMedium, color = OrbTheme.colors.text2)
                for (m in MergeMethods) {
                    Row(
                        Modifier.fillMaxWidth().selectable(selected = method == m, onClick = { method = m }, role = Role.RadioButton),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = method == m, onClick = null)
                        Text(ProjectTexts.mergeMethod(m), Modifier.padding(start = 8.dp))
                    }
                }
                Text(ProjectTexts.PR_MERGE_NOTE, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2)
            }
        },
        confirmButton = { TextButton(onClick = { onConfirm(method) }, enabled = !busy) { Text(ProjectTexts.PR_MERGE) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(ProjectTexts.CANCEL) } },
    )
}

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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.chats.Message
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.tasks.LabelValue
import dev.orb.app.ui.tasks.SectionLabel
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
    val pr = state.pr
    Column(modifier.fillMaxSize()) {
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
            }
        }
    }
}

package dev.orb.app.ui.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import dev.orb.app.ui.kit.OrbSnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.chats.Message
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.offline.NeedsPcNote
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.coroutines.launch

/** The files a task changed, with each one's diff to swipe through, and «Aprobar» / «Rechazar» within thumb's reach. */
@Composable
fun TaskDiffScreen(vm: TaskDiffViewModel, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    var confirmUndo by rememberSaveable { mutableStateOf(false) }
    val diff = state.diff
    val enabled = state.online && !state.busy

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(OrbIcons.ArrowLeft, TaskTexts.BACK, tint = OrbTheme.colors.text2) }
                Column(Modifier.weight(1f).semantics { heading() }) {
                    Text(TaskTexts.changesOf(state.id), style = MaterialTheme.typography.titleMedium)
                    if (diff != null && diff.files.isNotEmpty()) {
                        Text(TaskTexts.changesSummary(diff.files.size, diff.added, diff.removed), style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2)
                    }
                }
            }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    diff == null && state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    diff == null -> Message(state.error ?: TaskTexts.CHANGES_ERROR, action = TaskTexts.RETRY, onAction = vm::refresh)
                    !diff.available || diff.files.isEmpty() -> Message(TaskTexts.NO_CHANGES, TaskTexts.NO_CHANGES_HINT)
                    else -> Files(diff)
                }
            }
            if (state.canAccept || state.canUndo || state.accepted) {
                if (!state.online) NeedsPcNote(Modifier.padding(horizontal = 16.dp))
                Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                    if (state.accepted) Text(TaskTexts.ALREADY_ACCEPTED, color = OrbTheme.colors.ok, style = MaterialTheme.typography.labelLarge)
                    if (state.canUndo) OutlinedButton(onClick = { vm.askUndo(); confirmUndo = true }, enabled = enabled) { Text(TaskTexts.UNDO) }
                    if (state.canAccept) Button(onClick = vm::accept, enabled = enabled) { Text(TaskTexts.ACCEPT) }
                }
            }
        }
        OrbSnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = 88.dp, start = 16.dp, end = 16.dp))
    }

    if (confirmUndo) {
        AlertDialog(
            onDismissRequest = { confirmUndo = false },
            title = { Text(TaskTexts.UNDO_TASK_TITLE) },
            text = { Text(TaskTexts.UNDO_TASK_BODY) },
            confirmButton = { TextButton(onClick = { confirmUndo = false; vm.undo() }) { Text(TaskTexts.UNDO, color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { confirmUndo = false }) { Text(TaskTexts.DISMISS) } },
        )
    }
}

@Composable
private fun Files(diff: TaskDiff) {
    val pager = rememberPagerState { diff.files.size }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            diff.files.forEachIndexed { i, f ->
                FilterChip(
                    selected = pager.currentPage == i, onClick = { scope.launch { pager.animateScrollToPage(i) } },
                    label = { Text(f.path.substringAfterLast('/') + (if (f.added > 0) " +${f.added}" else "") + (if (f.removed > 0) " −${f.removed}" else "")) },
                )
            }
        }
        if (diff.files.size > 1) Text(TaskTexts.SWIPE_HINT, Modifier.padding(horizontal = 16.dp, vertical = 2.dp), style = MaterialTheme.typography.labelSmall, color = OrbTheme.colors.text3)
        // Only the file on screen is turned into lines, and its list is lazy: a long diff costs what is visible.
        HorizontalPager(pager, Modifier.weight(1f).fillMaxWidth(), key = { diff.files[it].path }) { page ->
            FileDiff(diff.files[page], if (page == diff.files.lastIndex) diff.more else 0)
        }
    }
}

@Composable
private fun FileDiff(file: DiffFile, more: Int) {
    val lines = remember(file) { if (file.binary || file.cut) emptyList() else DiffParser.lines(file.patch) }
    val c = OrbTheme.colors
    Column(Modifier.fillMaxSize()) {
        Text(
            file.path, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), style = MaterialTheme.typography.labelMedium,
            color = c.text2, maxLines = 2, overflow = TextOverflow.Ellipsis, fontFamily = FontFamily.Monospace,
        )
        when {
            file.binary -> Text(TaskTexts.BINARY_FILE, Modifier.padding(16.dp), color = c.text2)
            file.cut -> Text(TaskTexts.TOO_BIG, Modifier.padding(16.dp), color = c.text2)
            // A rename or a mode change has a path but no patch.
            file.patch.isBlank() -> Text(TaskTexts.NO_CONTENT_CHANGES, Modifier.padding(16.dp), color = c.text2)
            else -> LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
                itemsIndexed(lines, key = { i, _ -> i }, contentType = { _, l -> l.kind }) { _, line -> DiffLineRow(line) }
                if (more > 0) item(key = "more") { Text(TaskTexts.moreFiles(more), Modifier.padding(16.dp), color = c.text2, style = MaterialTheme.typography.bodySmall) }
            }
        }
    }
}

@Composable
private fun DiffLineRow(line: DiffLine) {
    val c = OrbTheme.colors
    val scheme = MaterialTheme.colorScheme
    val (bg: Color, fg: Color, mark: String) = when (line.kind) {
        DiffLineKind.Add -> Triple(c.okSoft, scheme.onSurface, "+")
        DiffLineKind.Del -> Triple(c.errSoft, scheme.onSurface, "−")
        DiffLineKind.Hunk -> Triple(scheme.surfaceContainerHigh, c.text2, " ")
        DiffLineKind.Note -> Triple(Color.Transparent, c.text3, " ")
        DiffLineKind.Context -> Triple(Color.Transparent, scheme.onSurface, " ")
    }
    Row(Modifier.fillMaxWidth().background(bg).padding(horizontal = 12.dp, vertical = 1.dp)) {
        Text(if (line.kind == DiffLineKind.Hunk) "" else mark, Modifier.padding(end = 8.dp), fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = if (line.kind == DiffLineKind.Add) c.ok else if (line.kind == DiffLineKind.Del) scheme.error else c.text3)
        Text(line.text.ifEmpty { " " }, Modifier.weight(1f), fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 16.sp, color = fg)
    }
}

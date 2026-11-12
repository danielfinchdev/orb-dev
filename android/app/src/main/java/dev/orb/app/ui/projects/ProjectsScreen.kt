package dev.orb.app.ui.projects

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.chats.Message
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectsScreen(vm: ProjectsViewModel, onOpenProject: (String) -> Unit, modifier: Modifier = Modifier) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    // Back from a project or from another app: the grid is read again.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.refresh() }

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Text(
                ProjectTexts.TITLE, Modifier.fillMaxWidth().height(64.dp).padding(start = 16.dp).semantics { heading() },
                style = MaterialTheme.typography.titleLarge,
            )
            if (!state.online && state.loaded) {
                Text(
                    ProjectTexts.OFFLINE_STRIP, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                    style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.warn,
                )
            }
            FilterRow(state, vm::setFilter)
            PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.weight(1f).fillMaxWidth()) {
                Body(state, onOpenProject, vm::refresh, vm::toggleActive, vm::reopen)
            }
        }
        if (state.canCreate) {
            ExtendedFloatingActionButton(
                onClick = vm::openNewProject,
                icon = { Icon(OrbIcons.Plus, null) },
                text = { Text(ProjectTexts.NEW, fontWeight = FontWeight.SemiBold) },
                modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
                containerColor = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
            )
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(16.dp))
    }

    state.newProject?.let { NewProjectDialog(it, onCreate = vm::createProject, onDismiss = vm::closeNewProject) }
}

@Composable
private fun FilterRow(state: ProjectsState, onFilter: (ProjectFilter) -> Unit) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Chip(ProjectTexts.FILTER_ACTIVE, state.activeCount.takeIf { it > 0 }, state.filter == ProjectFilter.Active) { onFilter(ProjectFilter.Active) }
        for (c in state.categories) Chip(c, null, state.filter == ProjectFilter.Category(c)) { onFilter(ProjectFilter.Category(c)) }
        if (state.canSeeFinished) Chip(ProjectTexts.FILTER_FINISHED, null, state.filter == ProjectFilter.Finished) { onFilter(ProjectFilter.Finished) }
    }
}

@Composable
private fun Chip(label: String, count: Int?, selected: Boolean, onClick: () -> Unit) {
    FilterChip(
        selected = selected, onClick = onClick,
        label = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(label)
                if (count != null) Text(count.toString(), color = OrbTheme.colors.text3)
            }
        },
        leadingIcon = if (selected) ({ Icon(OrbIcons.Check, null, Modifier.size(18.dp)) }) else null,
    )
}

@Composable
private fun Body(
    state: ProjectsState, onOpen: (String) -> Unit, onRetry: () -> Unit,
    onToggleActive: (ProjectItem) -> Unit, onReopen: (FinishedProject) -> Unit,
) {
    val finished = state.filter == ProjectFilter.Finished
    when {
        !state.loaded && state.loadFailed -> Message(ProjectTexts.LOAD_ERROR, action = ProjectTexts.RETRY, onAction = onRetry)
        !state.loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        finished && state.finished.isEmpty() -> Message(ProjectTexts.EMPTY_FINISHED)
        !finished && state.projects.isEmpty() -> Message(ProjectTexts.EMPTY, ProjectTexts.EMPTY_HINT)
        else -> LazyVerticalGrid(
            GridCells.Fixed(2), Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (finished) {
                items(state.finished, key = { "f:" + it.key }, span = { GridItemSpan(2) }) { f ->
                    FinishedCard(f, canReopen = state.canReopen, enabled = state.online && !state.busy, onReopen = { onReopen(f) })
                }
            } else {
                items(state.projects, key = { it.name }) { p ->
                    ProjectCard(p, state.canActivate && state.online && !state.busy, onOpen = { onOpen(p.name) }, onToggleActive = { onToggleActive(p) })
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ProjectCard(p: ProjectItem, canActivate: Boolean, onOpen: () -> Unit, onToggleActive: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Box {
        Surface(
            Modifier.fillMaxWidth().combinedClickable(onClick = onOpen, onLongClick = { if (canActivate) menu = true }),
            shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainerLow,
        ) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                ProjectIcon(p.name, p.icon)
                Text(p.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    listOfNotNull(p.category, ProjectTexts.ACTIVE_BADGE.takeIf { p.active }).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    if (p.open > 0) ProjectTexts.open(p.open) else ProjectTexts.CALM,
                    style = MaterialTheme.typography.labelMedium, color = if (p.open > 0) MaterialTheme.colorScheme.primary else OrbTheme.colors.text3,
                )
            }
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(
                text = { Text(if (p.active) ProjectTexts.CLEAR_ACTIVE else ProjectTexts.MAKE_ACTIVE) },
                onClick = { menu = false; onToggleActive() },
            )
        }
    }
}

@Composable
private fun FinishedCard(f: FinishedProject, canReopen: Boolean, enabled: Boolean, onReopen: () -> Unit) {
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
        Row(Modifier.padding(start = 14.dp, end = 6.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(f.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    listOfNotNull(f.category, ProjectTexts.finishedOn(f.at)).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2,
                )
            }
            if (canReopen) TextButton(onClick = onReopen, enabled = enabled) { Text(ProjectTexts.REOPEN) }
        }
    }
}

/** The project's own icon when the PC sent a bitmap one; otherwise its initials. */
@Composable
fun ProjectIcon(name: String, dataUrl: String?, size: androidx.compose.ui.unit.Dp = 44.dp) {
    val bitmap by produceState<ImageBitmap?>(null, dataUrl) { value = dataUrl?.let { withContext(Dispatchers.Default) { decodeIcon(it) } } }
    val shape = RoundedCornerShape(12.dp)
    val image = bitmap
    if (image != null) {
        Image(image, null, Modifier.size(size).clip(shape), contentScale = androidx.compose.ui.layout.ContentScale.Crop)
    } else {
        Surface(Modifier.size(size), shape = shape, color = MaterialTheme.colorScheme.primaryContainer) {
            Box(contentAlignment = Alignment.Center) {
                Text(initials(name), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimaryContainer)
            }
        }
    }
}

internal fun initials(name: String): String {
    val words = name.split('-', '_', ' ', '.').filter { it.isNotBlank() }
    val letters = if (words.size >= 2) "${words[0].first()}${words[1].first()}" else name.take(2)
    return letters.uppercase()
}

/** Only bitmap icons (png, jpg, webp, gif) decode; an SVG falls back to the initials. */
internal fun decodeIcon(dataUrl: String): ImageBitmap? = runCatching {
    val bytes = Base64.decode(dataUrl.substringAfter("base64,"), Base64.DEFAULT)
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
}.getOrNull()

@Composable
private fun NewProjectDialog(state: NewProjectState, onCreate: (String, String?, String) -> Unit, onDismiss: () -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    var notes by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (!state.saving) onDismiss() },
        title = { Text(ProjectTexts.NEW_TITLE) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), singleLine = true, label = { Text(ProjectTexts.NEW_NAME) })
                Text(ProjectTexts.NEW_CATEGORY, style = MaterialTheme.typography.labelMedium, color = OrbTheme.colors.text2)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (c in ProjectCategories) FilterChip(selected = category == c, onClick = { category = if (category == c) null else c }, label = { Text(c) })
                }
                OutlinedTextField(notes, { notes = it }, Modifier.fillMaxWidth(), minLines = 2, maxLines = 5, label = { Text(ProjectTexts.NEW_NOTES) })
                state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(onClick = { onCreate(name, category, notes) }, enabled = !state.saving && name.isNotBlank()) { Text(ProjectTexts.NEW_CREATE) }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !state.saving) { Text(ProjectTexts.CANCEL) } },
    )
}

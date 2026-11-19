package dev.orb.app.ui.projects

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items as columnItems
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.chats.ChatTexts
import dev.orb.app.ui.chats.ChatsMenu
import dev.orb.app.ui.chats.Message
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbBadge
import dev.orb.app.ui.kit.OrbBadgeKind
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbCard
import dev.orb.app.ui.kit.OrbChip
import dev.orb.app.ui.kit.OrbEmpty
import dev.orb.app.ui.kit.OrbFab
import dev.orb.app.ui.kit.OrbGroupHeader
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbNote
import dev.orb.app.ui.kit.OrbRow
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbSheetInfo
import dev.orb.app.ui.kit.OrbSheetItem
import dev.orb.app.ui.kit.OrbSnackbarHost
import dev.orb.app.ui.kit.OrbSpinner
import dev.orb.app.ui.kit.OrbSubtitle
import dev.orb.app.ui.kit.OrbTextField
import dev.orb.app.ui.kit.OrbTopBar
import dev.orb.app.ui.kit.ProjectDot
import dev.orb.app.ui.kit.ProjectDotSize
import dev.orb.app.ui.notes.NotesTexts
import dev.orb.app.ui.offline.LocalOffline
import dev.orb.app.ui.offline.OfflineStrip
import dev.orb.app.ui.offline.OfflineTexts
import dev.orb.app.ui.tasks.TextArea
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * The projects (screen 21): the header like the other main screens, chips for the lists, and the projects as a two-column
 * grid of cards. «Nuevo» is the neutral floating button. What the mockup does not draw (making a project the active one)
 * lives in the card's long press.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectsScreen(vm: ProjectsViewModel, onOpenProject: (String) -> Unit, modifier: Modifier = Modifier, menu: ChatsMenu = ChatsMenu(onMenu = {})) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    // Back from a project or from another app: the grid is read again.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.refresh() }
    var optionsFor by rememberSaveable { mutableStateOf<String?>(null) }

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            ProjectsBar(state, menu)
            if (!state.online && state.loaded) {
                OfflineStrip()
            }
            FilterRow(state, vm::setFilter)
            PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.weight(1f).fillMaxWidth()) {
                Body(state, onOpenProject, vm::refresh, vm::reopen, onOptions = { optionsFor = it.name }, onNew = vm::openNewProject)
            }
        }
        if (state.canCreate) {
            OrbFab(ProjectTexts.NEW, OrbIcons.Plus, vm::openNewProject, Modifier.align(Alignment.BottomEnd).padding(16.dp), lifted = snackbar.currentSnackbarData != null)
        }
        OrbSnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(16.dp))
    }

    state.newProject?.let { NewProjectSheet(it, state.newCategories, onCreate = vm::createProject, onDismiss = vm::closeNewProject) }

    val chosen = optionsFor
    if (chosen != null) {
        val p = state.projects.firstOrNull { it.name == chosen }
        if (p == null) optionsFor = null else OrbSheet(onDismiss = { optionsFor = null }, title = p.name) {
            if (p.active) OrbSheetInfo(ProjectTexts.ACTIVE_NOTE, OrbIcons.CircleCheck)
            OrbSheetItem(
                if (p.active) ProjectTexts.CLEAR_ACTIVE else ProjectTexts.MAKE_ACTIVE, onClick = { optionsFor = null; vm.toggleActive(p) },
                icon = if (p.active) OrbIcons.Close else OrbIcons.Check,
            )
        }
    }
}

@Composable
private fun ProjectsBar(state: ProjectsState, menu: ChatsMenu) {
    val sub = if (state.loaded) ProjectTexts.activeLine(state.activeCount) else ChatTexts.linkLine(state.connection)
    OrbTopBar(
        title = ProjectTexts.TITLE, sub = sub,
        leading = { OrbIconButton(OrbIcons.Menu, ChatTexts.MENU, menu.onMenu) },
        actions = {
            menu.onNotices?.let { open ->
                val n = menu.unreadNotices
                OrbIconButton(
                    OrbIcons.Bell, if (n > 0) NotesTexts.unreadDescription(n) else NotesTexts.BELL, open,
                    badge = n.takeIf { it > 0 }?.let { if (it > 99) "99+" else it.toString() },
                )
            }
        },
    )
}

@Composable
private fun FilterRow(state: ProjectsState, onFilter: (ProjectFilter) -> Unit) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 2.dp).padding(top = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        OrbChip(ProjectTexts.FILTER_ACTIVE, state.filter == ProjectFilter.Active, { onFilter(ProjectFilter.Active) }, count = state.activeCount.takeIf { it > 0 })
        for (c in state.categories) OrbChip(c, state.filter == ProjectFilter.Category(c), { onFilter(ProjectFilter.Category(c)) })
        if (state.canSeeFinished) OrbChip(ProjectTexts.FILTER_FINISHED, state.filter == ProjectFilter.Finished, { onFilter(ProjectFilter.Finished) })
    }
}

@Composable
private fun Body(
    state: ProjectsState, onOpen: (String) -> Unit, onRetry: () -> Unit, onReopen: (FinishedProject) -> Unit,
    onOptions: (ProjectItem) -> Unit, onNew: () -> Unit,
) {
    val finished = state.filter == ProjectFilter.Finished
    when {
        !state.loaded && state.loadFailed -> Message(ProjectTexts.LOAD_ERROR, action = ProjectTexts.RETRY, onAction = onRetry, icon = OrbIcons.CircleAlert)
        !state.loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (state.online || state.refreshing) OrbSpinner(size = 28.dp) else NoPcYet()
        }
        finished && state.finished.isEmpty() -> Message(ProjectTexts.EMPTY_FINISHED, icon = OrbIcons.FolderGit2)
        !finished && state.projects.isEmpty() -> Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center) {
            OrbEmpty(
                ProjectTexts.EMPTY, text = ProjectTexts.EMPTY_HINT, icon = OrbIcons.FolderGit2,
                actions = if (state.canCreate) ({ OrbButton(ProjectTexts.EMPTY_NEW, onNew, kind = OrbButtonKind.Primary) }) else null,
            )
        }
        finished -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 110.dp)) {
            item(key = "head") { OrbGroupHeader(ProjectTexts.FILTER_FINISHED, count = state.finished.size) }
            columnItems(state.finished, key = { "f:" + it.key }) { f ->
                FinishedRow(f, canReopen = state.canReopen, enabled = state.online && !state.busy, onOpen = { onOpen(f.name) }, onReopen = { onReopen(f) })
            }
        }
        else -> LazyVerticalGrid(
            GridCells.Fixed(2), Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 110.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(state.projects, key = { it.name }) { p ->
                ProjectCard(p, state.canActivate && state.online && !state.busy, onOpen = { onOpen(p.name) }, onOptions = { onOptions(p) })
            }
        }
    }
}

/** A project (`.lcard`): its dot and name, the branch and changes git reports, and one badge for what its tasks are doing. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ProjectCard(p: ProjectItem, canOptions: Boolean, onOpen: () -> Unit, onOptions: () -> Unit) {
    val line = ProjectTexts.gitLine(p.git)
    Box(
        Modifier.clip(androidx.compose.foundation.shape.RoundedCornerShape(12.dp)).combinedClickable(
            onClick = onOpen, onLongClick = if (canOptions) onOptions else null,
            onLongClickLabel = if (p.active) ProjectTexts.CLEAR_ACTIVE else ProjectTexts.MAKE_ACTIVE,
        ).semantics(mergeDescendants = true) { if (p.active) stateDescription = ProjectTexts.ACTIVE_STATE },
    ) {
        OrbCard {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ProjectDot(p.name, size = ProjectDotSize.Normal)
                    Text(p.name, color = OrbKit.foreground, fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (line != null) OrbNote(line, Modifier.fillMaxWidth())
                when {
                    p.approve > 0 -> OrbBadge(ProjectTexts.toApprove(p.approve), kind = OrbBadgeKind.Warn)
                    p.open > 0 -> OrbBadge(ProjectTexts.open(p.open), kind = OrbBadgeKind.Acc)
                    else -> OrbBadge(ProjectTexts.CALM)
                }
            }
        }
    }
}

@Composable
private fun FinishedRow(f: FinishedProject, canReopen: Boolean, enabled: Boolean, onOpen: () -> Unit, onReopen: () -> Unit) {
    OrbRow(
        f.name,
        lead = { ProjectDot(f.name) },
        subtitle = { OrbSubtitle(listOfNotNull(f.category, ProjectTexts.finishedOn(f.at)).joinToString(" · ")) },
        badge = if (canReopen) ({ OrbButton(ProjectTexts.REOPEN, onReopen, small = true, enabled = enabled) }) else null,
        onClick = onOpen,
    )
}

/** The PC cannot be reached and nothing was saved yet, so there is nothing to read: say so and offer to try again. */
@Composable
private fun NoPcYet() {
    val info = LocalOffline.current
    val seen by (info?.lastContact ?: remember { MutableStateFlow<Long?>(null) }).collectAsStateWithLifecycle()
    val body = OfflineTexts.NO_PC_BODY + "\n" + OfflineTexts.NOTHING_SAVED + (seen?.let { "\n" + OfflineTexts.lastConnection(it, System.currentTimeMillis()) } ?: "")
    Message(OfflineTexts.NO_PC_TITLE, body, action = if (info != null) OfflineTexts.RETRY_NOW else null, onAction = info?.retryNow)
}

/**
 * «Nuevo proyecto» (a sheet): the name, the category, the icon row and the notes under «Más opciones». The icon is the dot
 * the name gives the project, shown as it will look; nothing about it is sent, because the PC draws it from the name too.
 */
@Composable
private fun NewProjectSheet(state: NewProjectState, categories: List<String>, onCreate: (String, String?, String) -> Unit, onDismiss: () -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    var notes by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf<String?>(null) }
    var more by rememberSaveable { mutableStateOf(false) }
    val shown = name.trim()
    OrbSheet(
        onDismiss = { if (!state.saving) onDismiss() }, title = ProjectTexts.NEW_TITLE,
        footer = {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                OrbButton(ProjectTexts.CANCEL, onDismiss, kind = OrbButtonKind.Ghost, enabled = !state.saving)
                OrbButton(ProjectTexts.NEW_CREATE, { onCreate(name, category, notes) }, kind = OrbButtonKind.Primary, enabled = !state.saving && shown.isNotEmpty())
            }
        },
    ) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OrbTextField(name, { name = it }, ProjectTexts.NEW_NAME)
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                OrbChip(ProjectTexts.NO_CATEGORY, category == null, { category = null })
                for (c in categories) OrbChip(c, category == c, { category = c })
            }
            Text(ProjectTexts.NEW_ICON, color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp)
            Box(
                Modifier.size(40.dp).clip(CircleShape).border(1.dp, OrbKit.border, CircleShape).semantics { contentDescription = ProjectTexts.iconOf(shown) },
                contentAlignment = Alignment.Center,
            ) { ProjectDot(shown.ifEmpty { null }, size = 24.dp) }
            OrbNote(ProjectTexts.NEW_ICON_NOTE)
            Row(
                Modifier.fillMaxWidth().clickable(onClickLabel = ProjectTexts.NEW_MORE) { more = !more }.padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(OrbIcons.ChevronDown, null, Modifier.size(16.dp).graphicsLayer { rotationZ = if (more) 180f else 0f }, tint = OrbKit.mutedForeground)
                Text(ProjectTexts.NEW_MORE, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp)
            }
            if (more) TextArea(notes, { notes = it }, ProjectTexts.NEW_NOTES)
            state.error?.let { Text(it, color = OrbKit.destructive, fontSize = 13.sp, lineHeight = 18.sp) }
            OrbNote(ProjectTexts.NEW_PC_NOTE)
        }
    }
}

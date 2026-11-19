package dev.orb.app.ui.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.chats.ChatTexts
import dev.orb.app.ui.chats.Message
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbBadge
import dev.orb.app.ui.kit.OrbBadgeKind
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbChip
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbNote
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbSheetItem
import dev.orb.app.ui.kit.OrbSnackbarHost
import dev.orb.app.ui.kit.OrbSpinner
import dev.orb.app.ui.kit.OrbTopBar
import dev.orb.app.ui.offline.NeedsPcNote
import dev.orb.app.ui.projects.ProjectTexts
import kotlinx.coroutines.launch
import kotlin.math.abs

/** What the «⋯» menu asks a question about before doing it. */
private enum class DiffAsk { Review, Security }

/**
 * The files a task changed (screen 19): a chip per file with its +/−, the diff to swipe through and pinch to enlarge, and
 * «Deshacer» / «Aceptar» within thumb's reach. Nothing is offered on a diff that is not of the run the task is at now.
 */
@Composable
fun TaskDiffScreen(vm: TaskDiffViewModel, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    // Coming back from another screen the PC may have run the task again: the diff is read afresh.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.refresh() }
    var confirmUndo by rememberSaveable { mutableStateOf(false) }
    var menuOpen by rememberSaveable { mutableStateOf(false) }
    var ask by rememberSaveable { mutableStateOf<DiffAsk?>(null) }
    val canUndoNow by rememberUpdatedState(state.canUndo)
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    LaunchedEffect(vm) {
        // «Cambios aceptados · Deshacer»: the way back stays one tap away for as long as the notice does.
        vm.accepted.collect {
            val r = snackbar.showSnackbar(TaskTexts.ACCEPTED, actionLabel = TaskTexts.UNDO, duration = SnackbarDuration.Long)
            if (r == SnackbarResult.ActionPerformed && canUndoNow) { vm.askUndo(); confirmUndo = true }
        }
    }
    val diff = state.diff
    val enabled = state.online && !state.busy
    val hasMenu = state.canReview || state.canSecurity || state.canBranch

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            OrbTopBar(
                title = TaskTexts.changesOf(state.id),
                sub = diff?.takeIf { it.available && it.files.isNotEmpty() && !state.notReady }?.let { TaskTexts.changesSummary(it.files.size, it.added, it.removed) },
                sideWidth = 56.dp,
                leading = { OrbIconButton(OrbIcons.ArrowLeft, TaskTexts.BACK, onBack) },
                actions = { if (hasMenu) OrbIconButton(OrbIcons.MoreVertical, TaskTexts.MORE, { menuOpen = true }) },
            )
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    diff == null && state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { OrbSpinner(size = 28.dp) }
                    diff == null -> Message(state.error ?: TaskTexts.CHANGES_ERROR, action = TaskTexts.RETRY, onAction = vm::refresh, icon = OrbIcons.CircleAlert)
                    // Neither the earlier run's diff nor the buttons for it: the next reading says what the task is now.
                    state.notReady -> Message(TaskTexts.NOT_READY, TaskTexts.NOT_READY_HINT, icon = OrbIcons.Clock)
                    !diff.available -> NoDiff(diff)
                    diff.files.isEmpty() -> Message(TaskTexts.NO_CHANGES, if (diff.hidden > 0) TaskTexts.hiddenFiles(diff.hidden) else TaskTexts.NO_CHANGED_FILES, icon = OrbIcons.GitCompare)
                    else -> Files(diff)
                }
            }
            if (state.canAccept || state.canUndo || state.accepted) {
                if (!state.online) NeedsPcNote(Modifier.padding(horizontal = 16.dp))
                ActionBar(state, enabled, onUndo = { vm.askUndo(); confirmUndo = true }, onAccept = vm::accept)
            }
        }
        OrbSnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = 88.dp, start = 12.dp, end = 12.dp))
    }

    if (menuOpen) {
        OrbSheet({ menuOpen = false }, title = TaskTexts.changesOf(state.id)) {
            if (state.canReview) OrbSheetItem(TaskTexts.CHANGES_MENU_REVIEW, { menuOpen = false; ask = DiffAsk.Review }, icon = OrbIcons.GitCompare, meta = state.reviewedBy?.let { dev.orb.app.ui.chats.agentName(it) ?: it })
            if (state.canSecurity) OrbSheetItem(TaskTexts.CHANGES_MENU_SECURITY, { menuOpen = false; ask = DiffAsk.Security }, icon = OrbIcons.ShieldCheck)
            if (state.canBranch) OrbSheetItem(TaskTexts.CHANGES_MENU_BRANCH, { menuOpen = false; vm.showBranch() }, icon = OrbIcons.GitBranch)
        }
    }
    when (ask) {
        DiffAsk.Review -> OrbDialog(
            { ask = null }, TaskTexts.REVIEW_TASK_ASK, OrbDialogAction(TaskTexts.REVIEW_TASK_CONFIRM, { ask = null; vm.review() }),
            text = TaskTexts.REVIEW_TASK_BODY, dismiss = OrbDialogAction(ChatTexts.CANCEL, { ask = null }),
        )
        DiffAsk.Security -> OrbDialog(
            { ask = null }, ProjectTexts.SECURITY_ASK, OrbDialogAction(ProjectTexts.REVIEW_CONFIRM, { ask = null; vm.securityReview() }),
            text = ProjectTexts.REVIEW_BODY, dismiss = OrbDialogAction(ChatTexts.CANCEL, { ask = null }),
        )
        null -> Unit
    }
    if (confirmUndo) {
        // The count is only told when it is the whole of what the task changed: a hidden or unlisted file would make it a promise.
        val shown = diff?.takeIf { it.available && it.files.isNotEmpty() && it.hidden == 0 && it.more == 0 }
        OrbDialog(
            { confirmUndo = false }, TaskTexts.UNDO_TASK_TITLE, OrbDialogAction(TaskTexts.UNDO, { confirmUndo = false; vm.undo() }),
            text = if (shown != null) TaskTexts.undoBodyFiles(shown.files.size) else TaskTexts.UNDO_TASK_BODY,
            dismiss = OrbDialogAction(ChatTexts.CANCEL, { confirmUndo = false }),
        )
    }
}

/** `.actbar`: «Deshacer» then «Aceptar» at the right, a thin line above; once accepted, «Aceptada» takes the place of the second. */
@Composable
private fun ActionBar(state: TaskDiffState, enabled: Boolean, onUndo: () -> Unit, onAccept: () -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(OrbKit.border))
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically,
        ) {
            if (state.accepted) OrbBadge(TaskTexts.ALREADY_ACCEPTED, kind = OrbBadgeKind.Ok)
            if (state.canUndo) OrbButton(TaskTexts.UNDO, onUndo, enabled = enabled)
            if (state.canAccept) OrbButton(TaskTexts.ACCEPT, onAccept, kind = OrbButtonKind.Primary, enabled = enabled)
        }
    }
}

/** The true sentence for each reason the PC gives for having no diff; an older PC gives none and the generic one stays. */
@Composable
private fun NoDiff(diff: TaskDiff) {
    when (diff.reason) {
        "nophoto" -> Message(TaskTexts.NO_PHOTO, TaskTexts.NO_PHOTO_HINT, icon = OrbIcons.History)
        "nogit" -> Message(TaskTexts.NO_GIT, TaskTexts.NO_GIT_HINT, icon = OrbIcons.GitBranch)
        "notdone" -> Message(TaskTexts.NOT_READY, TaskTexts.NOT_READY_HINT, icon = OrbIcons.Clock)
        "gone" -> Message(TaskTexts.REPO_GONE, TaskTexts.REPO_GONE_HINT, icon = OrbIcons.FolderGit2)
        TaskDiff.JOINED_BY_HAND -> Message(TaskTexts.JOINED_BY_HAND, TaskTexts.JOINED_BY_HAND_HINT, icon = OrbIcons.GitCompare)
        TaskDiff.NO_PHOTO_AFTER -> Message(TaskTexts.NO_PHOTO_AFTER, TaskTexts.NO_PHOTO_AFTER_HINT, icon = OrbIcons.History)
        TaskDiff.RESOLVE_ON_PC -> Message(TaskTexts.RESOLVE_ON_PC, TaskTexts.RESOLVE_ON_PC_HINT, icon = OrbIcons.GitCompare)
        TaskDiff.UNKNOWN_RUN -> Message(TaskTexts.UNKNOWN_RUN, TaskTexts.UNKNOWN_RUN_HINT, icon = OrbIcons.History)
        else -> Message(TaskTexts.NO_CHANGES, TaskTexts.NO_CHANGES_HINT, icon = OrbIcons.GitCompare)
    }
}

/** +31 / +9 −7 / nothing: what a file chip says after the name. */
@Composable
private fun FileCounts(f: DiffFile) {
    if (f.added > 0) Text("+${f.added}", color = OrbKit.success, fontSize = 11.sp, lineHeight = 16.sp)
    if (f.removed > 0) Text("−${f.removed}", color = OrbKit.destructive, fontSize = 11.sp, lineHeight = 16.sp)
}

@Composable
private fun Files(diff: TaskDiff) {
    val pager = rememberPagerState { diff.files.size }
    val scope = rememberCoroutineScope()
    val zoom = remember { DiffZoom() }
    // Only these three flips are read while composing; the scale itself is read by the layer.
    val zoomed by remember { derivedStateOf { zoom.scale > DiffZoom.MIN } }
    val canGrow by remember { derivedStateOf { zoom.scale < DiffZoom.MAX } }
    // Each file is read at its own size.
    LaunchedEffect(pager.currentPage) { zoom.reset() }
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            diff.files.forEachIndexed { i, f ->
                OrbChip(
                    f.path.substringAfterLast('/'), selected = pager.currentPage == i, onClick = { scope.launch { pager.animateScrollToPage(i) } },
                    trailing = if (f.added > 0 || f.removed > 0) ({ FileCounts(f) }) else null,
                )
            }
        }
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OrbBadge("+${diff.added}", kind = OrbBadgeKind.Ok)
            OrbBadge("−${diff.removed}", kind = OrbBadgeKind.Err)
            Box(Modifier.weight(1f))
            // The accessible way to enlarge: the pinch has these two buttons and two actions of the diff itself.
            OrbIconButton(OrbIcons.ZoomOut, TaskTexts.ZOOM_OUT, { zoom.step(1f / DiffZoom.STEP) }, enabled = zoomed)
            OrbIconButton(OrbIcons.ZoomIn, TaskTexts.ZOOM_IN, { zoom.step(DiffZoom.STEP) }, enabled = canGrow)
        }
        if (diff.hidden > 0) OrbNote(TaskTexts.hiddenFiles(diff.hidden), Modifier.padding(horizontal = 16.dp, vertical = 2.dp))
        Box(
            Modifier.weight(1f).fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).clipToBounds()
                .onSizeChanged { zoom.size = it }
                .pinchZoom(zoom)
                .semantics {
                    stateDescription = TaskTexts.zoomState((zoom.scale * 100).toInt())
                    customActions = listOf(
                        CustomAccessibilityAction(TaskTexts.ZOOM_IN) { zoom.step(DiffZoom.STEP); true },
                        CustomAccessibilityAction(TaskTexts.ZOOM_OUT) { zoom.step(1f / DiffZoom.STEP); true },
                    )
                },
        ) {
            // The zoom is a layer property: the diff is neither measured nor composed again while the fingers move.
            Box(
                Modifier.fillMaxSize().graphicsLayer {
                    scaleX = zoom.scale; scaleY = zoom.scale; translationX = zoom.tx; translationY = zoom.ty
                    transformOrigin = TransformOrigin(0f, 0f)
                },
            ) {
                // Zoomed in, a one-finger drag pans the diff instead of turning the page; the chips change the file then.
                HorizontalPager(pager, Modifier.fillMaxSize(), userScrollEnabled = !zoomed, key = { diff.files[it].path }) { page ->
                    FileDiff(diff.files[page], if (page == diff.files.lastIndex) diff.more else 0, if (diff.files.size > 1) TaskTexts.SWIPE_PINCH_HINT else TaskTexts.PINCH_HINT)
                }
            }
        }
    }
}

/**
 * The enlargement of the diff: a scale with its limits and where the layer sits, kept so that what is under the fingers stays
 * under them. Read only in the layer block, so a gesture redraws the layer and nothing else.
 */
@Stable
private class DiffZoom {
    var scale by mutableFloatStateOf(MIN)
    var tx by mutableFloatStateOf(0f)
    var ty by mutableFloatStateOf(0f)
    var size by mutableStateOf(IntSize.Zero)

    /** [factor] around [focus] (in the diff's own box), then [pan]; the layer always covers the box. */
    fun transform(factor: Float, focus: Offset, pan: Offset) {
        val next = (scale * factor).coerceIn(MIN, MAX)
        val ratio = next / scale
        tx = clamp(focus.x - (focus.x - tx) * ratio + pan.x, size.width.toFloat(), next)
        ty = clamp(focus.y - (focus.y - ty) * ratio + pan.y, size.height.toFloat(), next)
        scale = next
    }

    /** A step of the buttons: around the middle of the top edge, where a diff starts, so the first lines stay in sight. */
    fun step(factor: Float) = transform(factor, Offset(size.width / 2f, 0f), Offset.Zero)

    fun reset() {
        scale = MIN; tx = 0f; ty = 0f
    }

    private fun clamp(v: Float, extent: Float, s: Float) = v.coerceIn(extent * (1f - s), 0f)

    companion object {
        const val MIN = 1f
        const val MAX = 4f
        const val STEP = 1.5f
    }
}

/**
 * Two fingers enlarge and move the diff; once enlarged, one finger moving sideways moves it too. The events are taken before the
 * pager and the list see them, but only when they are this gesture's: a plain scroll up and down goes on to the list.
 */
private fun Modifier.pinchZoom(zoom: DiffZoom): Modifier = pointerInput(zoom) {
    val slop = viewConfiguration.touchSlop
    awaitEachGesture {
        awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        var travel = Offset.Zero
        var sideways = false
        do {
            val event = awaitPointerEvent(PointerEventPass.Initial)
            val down = event.changes.count { it.pressed }
            if (down >= 2) {
                val factor = event.calculateZoom()
                val pan = event.calculatePan()
                if (factor != 1f || pan != Offset.Zero) {
                    zoom.transform(factor, event.calculateCentroid(useCurrent = true), pan)
                    event.changes.forEach { if (it.positionChanged()) it.consume() }
                }
            } else if (down == 1 && zoom.scale > DiffZoom.MIN) {
                val pan = event.calculatePan()
                travel += pan
                if (!sideways && abs(travel.x) > slop && abs(travel.x) > abs(travel.y)) sideways = true
                if (sideways) {
                    zoom.transform(1f, Offset.Zero, Offset(pan.x, 0f))
                    event.changes.forEach { if (it.positionChanged()) it.consume() }
                }
            }
        } while (event.changes.any { it.pressed })
    }
}

@Composable
private fun FileDiff(file: DiffFile, more: Int, hint: String) {
    val lines = remember(file) { if (file.binary || file.cut) emptyList() else DiffParser.lines(file.patch) }
    val shape = RoundedCornerShape(12.dp)
    val c = OrbKit
    Column(Modifier.fillMaxSize()) {
        // The box shrinks to a short diff and the hint follows it; a long diff fills the page and keeps its own scroll.
        Box(Modifier.fillMaxWidth().weight(1f, fill = false).clip(shape).border(1.dp, OrbKit.border, shape)) {
            when {
                file.binary -> NoLines(file.path, TaskTexts.BINARY_FILE)
                file.cut -> NoLines(file.path, TaskTexts.TOO_BIG)
                // A rename or a mode change has a path but no patch.
                file.patch.isBlank() -> NoLines(file.path, TaskTexts.NO_CONTENT_CHANGES)
                else -> LazyColumn(Modifier.fillMaxWidth()) {
                    itemsIndexed(lines, key = { i, _ -> i }, contentType = { _, l -> l.kind }) { i, line ->
                        // The first hunk's heading carries the file's name, as the mockup's `.hd` does.
                        DiffLineRow(line, if (line.kind == DiffLineKind.Hunk && lines.indexOfFirst { it.kind == DiffLineKind.Hunk } == i) file.path else null)
                    }
                    if (more > 0) item(key = "more") { Text(TaskTexts.moreFiles(more), Modifier.padding(12.dp), color = c.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp) }
                }
            }
        }
        OrbNote(hint, Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 8.dp))
    }
}

/** A file without lines to show: its heading and the reason. */
@Composable
private fun NoLines(path: String, why: String) {
    Column {
        DiffHeading(path)
        Text(why, Modifier.padding(12.dp), color = OrbKit.mutedForeground, fontSize = 14.sp, lineHeight = 20.sp)
    }
}

/** `.hd`: a heading of the diff in the secondary grey, in the mono face. */
@Composable
private fun DiffHeading(text: String) {
    Text(
        text, Modifier.fillMaxWidth().background(OrbKit.secondary).padding(horizontal = 10.dp, vertical = 6.dp), color = OrbKit.mutedForeground,
        fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 17.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun DiffLineRow(line: DiffLine, file: String?) {
    if (line.kind == DiffLineKind.Hunk) {
        DiffHeading(if (file != null) "$file · ${line.text}" else line.text)
        return
    }
    val (bg: Color, mark: String) = when (line.kind) {
        DiffLineKind.Add -> OrbKit.successSoft to "+"
        DiffLineKind.Del -> OrbKit.destructive.copy(alpha = 0.1f) to "−"
        else -> Color.Transparent to " "
    }
    val fg = if (line.kind == DiffLineKind.Note) OrbKit.faintForeground else OrbKit.foreground
    Row(Modifier.fillMaxWidth().background(bg)) {
        Text(
            line.no?.toString().orEmpty(), Modifier.width(34.dp).padding(end = 8.dp), color = OrbKit.faintForeground, fontFamily = FontFamily.Monospace,
            fontSize = 12.sp, lineHeight = 20.sp, textAlign = TextAlign.End, maxLines = 1,
        )
        Text(
            mark, Modifier.padding(end = 6.dp), color = when (line.kind) { DiffLineKind.Add -> OrbKit.success; DiffLineKind.Del -> OrbKit.destructive; else -> OrbKit.faintForeground },
            fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 20.sp,
        )
        Text(line.text.ifEmpty { " " }, Modifier.weight(1f).padding(end = 10.dp), color = fg, fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 20.sp)
    }
}

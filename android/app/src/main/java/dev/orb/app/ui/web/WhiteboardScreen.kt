package dev.orb.app.ui.web

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.shell.ScreenBar
import dev.orb.app.ui.theme.OrbTheme
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * «Pizarra»: Excalidraw in a local web view. The drawing is on the PC, so the page is only opened while the PC answers;
 * every change goes back to it, and leaving waits until it is saved (or the person says to leave without saving).
 */
@Composable
fun WhiteboardScreen(vm: WhiteboardViewModel, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val controller = remember { WebController() }
    val onBackNow by rememberUpdatedState(onBack)
    // The page, the bar and the view model can all ask to leave: the screen is popped once.
    val leaveOnce = remember { OnceAction { onBackNow() } }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    LaunchedEffect(vm) { vm.leave.collect { leaveOnce.run() } }
    LaunchedEffect(vm) {
        vm.pageCommands.collect { c ->
            when (c) {
                PageCommand.Flush -> controller.send(buildJsonObject { put("type", "flush") }.toString())
                PageCommand.Unsent -> controller.send(buildJsonObject { put("type", "unsent") }.toString())
                is PageCommand.Saved -> controller.send(buildJsonObject { put("type", "saved"); put("files", JsonArray(c.files.map(::JsonPrimitive))) }.toString())
            }
        }
    }
    LifecycleEventEffect(Lifecycle.Event.ON_PAUSE) { vm.flushNow() }

    val phase = state.phase
    val ready = phase as? WhiteboardPhase.Ready
    // Whatever the page runs, only these messages reach the app. A page that asks again (it was recreated) gets the latest drawing.
    val bridge = remember(vm) {
        WhiteboardBridge { m ->
            when (m) {
                WhiteboardMessage.Load -> vm.sceneForPage()?.let { controller.send(buildJsonObject { put("type", "scene"); put("scene", it) }.toString()) }
                is WhiteboardMessage.Save -> vm.onSave(m)
                WhiteboardMessage.Close -> vm.requestLeave()
                WhiteboardMessage.Flushed -> vm.onPageFlushed()
                WhiteboardMessage.Rejected -> vm.onRejected()
            }
        }
    }
    // The back arrow asks the page to save everything first; without a page it just leaves.
    // If the page has no orbBack, or does not answer, the arrow still leaves.
    val back: () -> Unit = { if (ready == null) leaveOnce.run() else controller.back { handled -> if (!handled) leaveOnce.run() } }

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            ScreenBar(
                title = ready?.let { "${WhiteboardTexts.TITLE} · ${it.project}" } ?: WhiteboardTexts.TITLE,
                onBack = back, backLabel = WhiteboardTexts.BACK,
                actions = { if (state.projects.size > 1 && phase !is WhiteboardPhase.Choose) ProjectMenu(state.projects, ready?.project, vm::choose) },
            )
            when (phase) {
                WhiteboardPhase.Loading -> Center { CircularProgressIndicator() }
                is WhiteboardPhase.NeedsPc -> Notice(
                    if (phase.unsupported) WhiteboardTexts.UNSUPPORTED else if (phase.error != null) WhiteboardTexts.LOAD_FAILED else WhiteboardTexts.NEEDS_PC,
                    phase.error ?: if (phase.unsupported) WhiteboardTexts.UNSUPPORTED_BODY else WhiteboardTexts.NEEDS_PC_BODY,
                    if (phase.unsupported) null else vm::retry,
                )
                is WhiteboardPhase.Choose -> ChooseProject(phase.projects, vm::choose)
                is WhiteboardPhase.Ready -> {
                    SaveLine(state.save)
                    val background = MaterialTheme.colorScheme.background
                    // One page per project: another project starts a fresh page and never reuses the last one's drawing.
                    androidx.compose.runtime.key(phase.project) {
                        LocalWebView(
                            "whiteboard/index.html", dark = background.luminance() < 0.5f, background = background,
                            bridge = bridge, onBack = leaveOnce::run, controller = controller, onGone = vm::onPageGone, modifier = Modifier.fillMaxWidth().weight(1f),
                        )
                    }
                }
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(16.dp))
    }

    if (state.confirmLeave) AlertDialog(
        onDismissRequest = vm::keepEditing,
        title = { Text(WhiteboardTexts.LEAVE_TITLE) },
        text = { Text(WhiteboardTexts.LEAVE_BODY) },
        confirmButton = { TextButton(onClick = vm::keepEditing) { Text(WhiteboardTexts.STAY) } },
        dismissButton = { TextButton(onClick = vm::leaveWithoutSaving) { Text(WhiteboardTexts.LEAVE, color = MaterialTheme.colorScheme.error) } },
    )
}

@Composable
private fun Center(content: @Composable () -> Unit) = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }

@Composable
private fun SaveLine(status: SaveStatus) {
    val text = when (status) {
        SaveStatus.Saved -> WhiteboardTexts.SAVED
        SaveStatus.Saving -> WhiteboardTexts.SAVING
        SaveStatus.Unsaved -> WhiteboardTexts.UNSAVED
    }
    Text(
        text, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp), style = MaterialTheme.typography.labelMedium,
        color = if (status == SaveStatus.Unsaved) MaterialTheme.colorScheme.error else OrbTheme.colors.text2,
    )
}

@Composable
private fun Notice(title: String, body: String, onRetry: (() -> Unit)?) {
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(OrbIcons.PenTool, null, tint = OrbTheme.colors.text3)
        Text(title, Modifier.padding(top = 12.dp), style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Text(body, Modifier.padding(top = 4.dp), style = MaterialTheme.typography.bodyMedium, color = OrbTheme.colors.text2, textAlign = TextAlign.Center)
        if (onRetry != null) TextButton(onClick = onRetry, Modifier.padding(top = 8.dp)) { Text(WhiteboardTexts.RETRY) }
    }
}

@Composable
private fun ChooseProject(projects: List<String>, onPick: (String) -> Unit) {
    if (projects.isEmpty()) return Notice(WhiteboardTexts.NO_PROJECTS, WhiteboardTexts.NO_PROJECTS_BODY, null)
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Text(WhiteboardTexts.CHOOSE, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.titleMedium)
        Text(WhiteboardTexts.CHOOSE_BODY, Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodyMedium, color = OrbTheme.colors.text2)
        projects.forEach { name ->
            Text(name, Modifier.fillMaxWidth().clickable { onPick(name) }.padding(horizontal = 16.dp, vertical = 14.dp), style = MaterialTheme.typography.bodyLarge)
        }
    }
}

@Composable
private fun ProjectMenu(projects: List<String>, current: String?, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) { Icon(OrbIcons.FolderInput, WhiteboardTexts.CHANGE_PROJECT, tint = OrbTheme.colors.text2) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            projects.forEach { name ->
                DropdownMenuItem(text = { Text(if (name == current) "$name ✓" else name) }, onClick = { open = false; onPick(name) })
            }
        }
    }
}

package dev.orb.app.ui.chats

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.theme.OrbMotion
import dev.orb.app.ui.theme.OrbTheme

private enum class Pick { None, Project, Brain }

/** Choose Orbe or an agent, the project and the brain, write the first line and ask the PC to create the chat. */
@Composable
fun NewChatScreen(vm: NewChatViewModel, onClose: () -> Unit, onCreated: (NewChatCreated) -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { snackbar.showSnackbar(it) } }
    LaunchedEffect(vm) { vm.created.collect(onCreated) }
    var pick by rememberSaveable { mutableStateOf(Pick.None) }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(OrbIcons.Close, ChatTexts.NEW_CHAT_CLOSE, tint = OrbTheme.colors.text2) }
            Column(Modifier.weight(1f).padding(start = 4.dp)) {
                Text(ChatTexts.NEW_CHAT, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
                Text(ChatTexts.NEW_CHAT_SUBTITLE, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2)
            }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(bottom = 8.dp)) {
            SectionHead(ChatTexts.NEW_CHAT_WITH)
            Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp).selectableGroup(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                TargetCard(state.agent == null, ChatTexts.ORBE, ChatTexts.NEW_CHAT_ORBE_HINT, recommended = true, onClick = vm::selectOrbe) { OrbeCircle() }
                for (a in state.options.agents) {
                    TargetCard(state.agent == a.id, a.label, ChatTexts.NEW_CHAT_AGENT_HINT, recommended = false, onClick = { vm.selectAgent(a.id) }) {
                        AgentAvatar(a.id, 40.dp)
                    }
                }
            }
            if (state.optionsStatus == OptionsStatus.Failed) {
                Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(ChatTexts.NEW_CHAT_OPTIONS_FAILED, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.warn)
                    TextButton(onClick = vm::reload) { Text(ChatTexts.RETRY) }
                }
            }
            SectionHead(ChatTexts.NEW_CHAT_WHERE)
            // The summary of the brain follows who is chosen: Orbe has a brain, an agent has its model.
            AnimatedContent(
                state.agent, label = "newChatTarget",
                transitionSpec = { fadeIn(OrbMotion.standard(OrbMotion.Short)) togetherWith fadeOut(OrbMotion.standard(OrbMotion.Fast)) },
            ) { agent ->
                Column {
                    PickRow(ChatTexts.NEW_CHAT_PROJECT, projectLabel(state), OrbIcons.Folder) { pick = Pick.Project }
                    val brainTitle = if (agent == null) ChatTexts.NEW_CHAT_BRAIN else ChatTexts.NEW_CHAT_MODEL
                    PickRow(brainTitle, state.brainLabel ?: if (agent == null) ChatTexts.NEW_CHAT_BRAIN_AUTO else ChatTexts.NEW_CHAT_MODEL_DEFAULT, OrbIcons.Activity) { pick = Pick.Brain }
                }
            }
            Text(
                ChatTexts.NEW_CHAT_NOTE,
                Modifier.padding(horizontal = 16.dp, vertical = 8.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainer).padding(horizontal = 14.dp, vertical = 10.dp),
                style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2,
            )
            SectionHead(ChatTexts.NEW_CHAT_FIRST)
            OutlinedTextField(
                state.text, vm::setText, Modifier.fillMaxWidth().padding(horizontal = 16.dp).heightIn(min = 96.dp),
                placeholder = { Text(ChatTexts.NEW_CHAT_FIRST_HINT) }, enabled = !state.sending,
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Sentences),
            )
        }
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            AnimatedVisibility(!state.online, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
                Text(ChatTexts.NEEDS_PC, style = MaterialTheme.typography.titleSmall, color = OrbTheme.colors.warn)
            }
            Button(onClick = vm::create, enabled = state.canCreate, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
                Text(if (state.sending) ChatTexts.NEW_CHAT_CREATING else ChatTexts.NEW_CHAT_CREATE)
            }
            SnackbarHost(snackbar)
        }
    }

    when (pick) {
        Pick.Project -> ProjectSheet(state, onPick = { vm.pickProject(it); pick = Pick.None }, onDismiss = { pick = Pick.None })
        Pick.Brain -> BrainSheet(state, vm, onDismiss = { pick = Pick.None })
        Pick.None -> Unit
    }
}

private fun projectLabel(s: NewChatState) = when {
    s.project == null -> ChatTexts.NO_PROJECT
    s.project == s.options.activeProject -> "${s.project} · ${ChatTexts.NEW_CHAT_PROJECT_ACTIVE_SHORT}"
    else -> s.project
}

@Composable
private fun SectionHead(text: String) {
    Text(
        text, Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp).semantics { heading() },
        style = MaterialTheme.typography.titleSmall, color = OrbTheme.colors.text2,
    )
}

@Composable
private fun TargetCard(selected: Boolean, title: String, hint: String, recommended: Boolean, onClick: () -> Unit, avatar: @Composable () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    val shape = RoundedCornerShape(16.dp)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(shape)
            .background(if (selected) scheme.primaryContainer else scheme.surface)
            .border(BorderStroke(if (selected) 2.dp else 1.dp, if (selected) scheme.primary else scheme.outlineVariant), shape)
            .selectable(selected, onClick = onClick, role = Role.RadioButton).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        avatar()
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(hint, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2)
        }
        if (recommended) {
            Text(
                ChatTexts.NEW_CHAT_RECOMMENDED, Modifier.clip(RoundedCornerShape(8.dp)).background(scheme.secondaryContainer).padding(horizontal = 8.dp, vertical = 2.dp),
                style = MaterialTheme.typography.labelSmall, color = scheme.onSecondaryContainer,
            )
        }
    }
}

@Composable
private fun PickRow(title: String, value: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(icon, null, Modifier.size(24.dp), tint = OrbTheme.colors.text2)
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(value, style = MaterialTheme.typography.bodyMedium, color = OrbTheme.colors.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Icon(OrbIcons.ChevronRight, null, Modifier.size(20.dp), tint = OrbTheme.colors.text3)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProjectSheet(state: NewChatState, onPick: (String?) -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 16.dp).selectableGroup()) {
            Text(ChatTexts.NEW_CHAT_PROJECT, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.titleMedium)
            for (p in state.options.projects) {
                ChoiceRow(p.name, if (p.name == state.options.activeProject) ChatTexts.NEW_CHAT_PROJECT_ACTIVE else null, state.project == p.name) { onPick(p.name) }
            }
            ChoiceRow(ChatTexts.NO_PROJECT, null, state.project == null) { onPick(null) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BrainSheet(state: NewChatState, vm: NewChatViewModel, onDismiss: () -> Unit) {
    val orbe = state.agent == null
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 16.dp).selectableGroup()) {
            Text(if (orbe) ChatTexts.NEW_CHAT_BRAIN else ChatTexts.NEW_CHAT_MODEL, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.titleMedium)
            if (orbe) {
                ChoiceRow(ChatTexts.NEW_CHAT_BRAIN_AUTO, null, state.brainAgent == null) { vm.clearBrain() }
                for (a in state.options.agents) {
                    ChoiceRow(a.label, null, state.brainAgent == a.id) { vm.pickBrain(a.id, null, null) }
                }
            }
            val agent = state.agentOption
            if (agent != null) {
                Text(ChatTexts.NEW_CHAT_MODEL, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.titleSmall, color = OrbTheme.colors.text2)
                if (!orbe) ChoiceRow(ChatTexts.NEW_CHAT_MODEL_DEFAULT, null, state.model == null) { vm.pickBrain(agent.id, null, null) }
                for (m in agent.models.filter { it.id.isNotEmpty() }) {
                    ChoiceRow(m.label, if (m.recommended) ChatTexts.NEW_CHAT_RECOMMENDED else null, state.model == m.id) { vm.pickBrain(agent.id, m.id, null) }
                }
                val efforts = state.modelOption?.efforts.orEmpty()
                if (efforts.isNotEmpty()) {
                    Text(ChatTexts.NEW_CHAT_EFFORT, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.titleSmall, color = OrbTheme.colors.text2)
                    FlowRow(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (e in efforts) {
                            val on = state.effort == e
                            Box(
                                Modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(20.dp))
                                    .background(if (on) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface)
                                    .border(BorderStroke(1.dp, if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant), RoundedCornerShape(20.dp))
                                    .selectable(on, role = Role.RadioButton, onClick = { vm.pickBrain(agent.id, state.model, if (on) null else e) })
                                    .padding(horizontal = 16.dp),
                                contentAlignment = Alignment.Center,
                            ) { Text(e, style = MaterialTheme.typography.labelLarge) }
                        }
                    }
                }
            }
            TextButton(onClick = onDismiss, Modifier.align(Alignment.End).padding(horizontal = 8.dp)) { Text(ChatTexts.SAVE) }
        }
    }
}

@Composable
private fun ChoiceRow(label: String, tag: String?, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).selectable(selected, role = Role.RadioButton, onClick = onClick).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) {
            if (selected) Icon(OrbIcons.Check, null, tint = MaterialTheme.colorScheme.primary)
        }
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        if (tag != null) Text(tag, style = MaterialTheme.typography.labelMedium, color = OrbTheme.colors.text2)
    }
}

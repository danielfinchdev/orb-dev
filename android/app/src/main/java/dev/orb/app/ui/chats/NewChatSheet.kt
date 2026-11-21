package dev.orb.app.ui.chats

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.AgentMark
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbChip
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbNote
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbSheetChoice
import dev.orb.app.ui.kit.OrbSheetInfo
import dev.orb.app.ui.kit.OrbSheetItem
import dev.orb.app.ui.kit.OrbSheetLabel
import dev.orb.app.ui.kit.OrbSpinner
import dev.orb.app.ui.kit.OrbTextField
import dev.orb.app.ui.kit.ProjectDot
import dev.orb.app.ui.kit.ProjectDotSize

/**
 * «Nuevo chat»: a sheet over the chat list. It only asks the PC for things (nothing is made on the phone): an Orbe chat
 * leaves as a draft that the chat screen opens, a direct chat is created on the PC and opened.
 */
@Composable
fun NewChatSheet(vm: NewChatViewModel, onDismiss: () -> Unit, onOutcome: (NewChatOutcome) -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    var failure by remember { mutableStateOf<String?>(null) }
    var brainOpen by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(vm) { vm.outcome.collect(onOutcome) }
    LaunchedEffect(vm) { vm.messages.collect { failure = it } }

    if (brainOpen) {
        BrainSheet(state, vm, onDone = { brainOpen = false })
    } else {
        OrbSheet(onDismiss = onDismiss, title = ChatTexts.NEW_CHAT) {
            Column(Modifier.selectableGroup()) {
                OrbSheetChoice(ChatTexts.NEW_CHAT_ORBE, ChatTexts.NEW_CHAT_ORBE_HINT, OrbIcons.CircleDot, !state.direct, vm::selectOrbe)
                OrbSheetChoice(ChatTexts.NEW_CHAT_DIRECT, directHint(state), OrbIcons.Bot, state.direct, vm::selectDirect)
            }
            Statuses(state, onRetry = vm::reload)
            if (state.direct && state.optionsStatus == OptionsStatus.Ready) {
                OrbSheetLabel(ChatTexts.NEW_CHAT_AGENT)
                if (state.options.agents.isEmpty()) Notice(ChatTexts.NEW_CHAT_NO_AGENTS, warn = true, icon = OrbIcons.CircleAlert)
                else ChipsRow {
                    for (a in state.options.agents) {
                        OrbChip(a.label, state.agent == a.id, { vm.selectAgent(a.id) }, lead = { AgentMark(a.id, size = 16.dp, description = null) })
                    }
                }
            }
            if (state.direct) {
                OrbSheetLabel(ChatTexts.NEW_CHAT_FOLDER)
                // The phone never picks a folder on the PC: it is the project's, and without a project the agent only reads.
                if (state.project != null) OrbSheetInfo(state.project!!, OrbIcons.Folder, meta = ChatTexts.NEW_CHAT_FOLDER_PROJECT)
                else OrbSheetInfo(ChatTexts.NEW_CHAT_FOLDER_NONE, OrbIcons.Folder, meta = ChatTexts.NEW_CHAT_FOLDER_READ_ONLY)
            }
            OrbSheetLabel(ChatTexts.NEW_CHAT_PROJECT)
            ChipsRow {
                for (p in state.options.projects) {
                    OrbChip(p.name, state.project == p.name, { vm.pickProject(p.name) })
                }
                OrbChip(ChatTexts.NO_PROJECT, state.project == null, { vm.pickProject(null) })
                if (state.canCreateProject) {
                    OrbChip(ChatTexts.NEW_CHAT_NEW_PROJECT, false, vm::openNewProject, lead = { Icon(OrbIcons.Plus, null, Modifier.size(16.dp), tint = OrbKit.mutedForeground) })
                }
            }
            OrbSheetLabel(ChatTexts.NEW_CHAT_BRAIN)
            OrbSheetItem(brainSummary(state), onClick = { brainOpen = true }, icon = OrbIcons.Brain, chevron = true)
            failure?.let { Notice(it, warn = false, icon = OrbIcons.CircleAlert) }
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                OrbButton(ChatTexts.NEW_CHAT_CANCEL, onDismiss, kind = OrbButtonKind.Ghost)
                OrbButton(
                    if (state.starting) ChatTexts.NEW_CHAT_STARTING else ChatTexts.NEW_CHAT_START,
                    { failure = null; vm.start() }, kind = OrbButtonKind.Primary, enabled = state.canStart,
                )
            }
        }
    }
    state.newProject?.let { NewProjectDialog(it, onCreate = vm::createProject, onDismiss = vm::closeNewProject) }
}

/** The line under «Directo con un agente»: only the agents the PC can run are named. */
private fun directHint(s: NewChatState): String {
    val names = s.options.agents.map { it.label }
    return when {
        names.isEmpty() -> ChatTexts.NEW_CHAT_DIRECT_HINT_NONE
        names.size == 1 -> "${names[0]} en una carpeta"
        else -> "${names.dropLast(1).joinToString(", ")} y ${names.last()} en una carpeta"
    }
}

private fun brainSummary(s: NewChatState): String = when {
    !s.direct -> s.brainLabel ?: s.options.pcBrain?.let(::pcBrainText) ?: ChatTexts.NEW_CHAT_BRAIN_AUTO
    s.model == null -> "${s.agentOption?.label ?: ChatTexts.NEW_CHAT_AGENT} · ${ChatTexts.NEW_CHAT_MODEL_DEFAULT}"
    else -> s.brainLabel ?: ChatTexts.NEW_CHAT_MODEL_DEFAULT
}

/** «Claude · Opus · razonamiento alto»: the brain the PC itself starts Orbe chats with, named like a chosen one. */
private fun pcBrainText(b: BrainInfo): String? =
    listOfNotNull(b.agentLabel, b.modelLabel, b.reasoning?.let(::reasoningText)).joinToString(" · ").ifEmpty { null }

/** What the PC is doing about the options and the link, said once under the two choices. */
@Composable
private fun Statuses(s: NewChatState, onRetry: () -> Unit) {
    when {
        !s.online -> Notice(ChatTexts.NEW_CHAT_OFFLINE, warn = true, icon = OrbIcons.WifiOff)
        s.optionsStatus == OptionsStatus.Loading -> Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            OrbSpinner()
            Text(ChatTexts.NEW_CHAT_LOADING, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp)
        }
        s.optionsStatus == OptionsStatus.Failed -> {
            Notice(ChatTexts.NEW_CHAT_OPTIONS_FAILED, warn = true, icon = OrbIcons.CircleAlert)
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.End) { OrbButton(ChatTexts.RETRY, onRetry, small = true) }
        }
        s.optionsStatus == OptionsStatus.Unsupported -> Notice(ChatTexts.NEW_CHAT_OLD_PC, warn = true, icon = OrbIcons.CircleAlert)
    }
}

/** `.banner`: a rounded block with an icon that tells something is wrong ([warn]: the PC or the link) or failed (the error colour). */
@Composable
private fun Notice(text: String, warn: Boolean, icon: ImageVector) {
    val fg = if (warn) OrbKit.warningInk else OrbKit.destructive
    val bg = if (warn) OrbKit.warningSoft else OrbKit.destructive.copy(alpha = 0.12f)
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).clip(RoundedCornerShape(12.dp)).background(bg)
            .padding(horizontal = 14.dp, vertical = 12.dp).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, null, Modifier.padding(top = 3.dp).size(16.dp), tint = fg)
        Text(text, Modifier.weight(1f), color = fg, fontSize = 14.5.sp, lineHeight = 21.sp)
    }
}

@Composable
private fun ChipsRow(content: @Composable () -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 0.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) { content() }
}

/** One line of the «Cerebro» sheet: a brain the PC can really give, with the model and reasoning it stands for. */
private class BrainRow(val agent: AgentOption, val model: ModelOption?, val effort: String?, val text: String)

private val number = Regex("""\d+(?:\.\d+)?""")

private fun versionOf(m: ModelOption): Double = number.find(m.label)?.value?.toDoubleOrNull() ?: number.find(m.id)?.value?.toDoubleOrNull() ?: 0.0

/** The newest model of a family the PC lists (the recommended one first); null when the PC has none, so the row is not offered. */
private fun familyModel(a: AgentOption, family: String): ModelOption? =
    a.models.filter { it.id.isNotEmpty() && "${it.id} ${it.label}".contains(family, ignoreCase = true) }
        .sortedWith(compareByDescending<ModelOption> { it.recommended }.thenByDescending(::versionOf)).firstOrNull()

/** Opus with high reasoning, Sonnet with medium and Haiku as it is; a level the model does not take is left out of the row. */
private fun claudeRows(a: AgentOption): List<BrainRow> = buildList {
    for ((family, level) in listOf("Opus" to "high", "Sonnet" to "medium", "Haiku" to null)) {
        val m = familyModel(a, family) ?: continue
        val effort = level?.takeIf { m.efforts.isEmpty() || it in m.efforts }
        add(BrainRow(a, m, effort, if (effort != null) "$family · ${reasoningText(effort)}" else family))
    }
}

/** «Cerebro»: the usual brains as rows; the finer choices (model, reasoning, the PC's own) wait under «Más opciones». */
@Composable
private fun BrainSheet(s: NewChatState, vm: NewChatViewModel, onDone: () -> Unit) {
    var moreOpen by rememberSaveable { mutableStateOf(false) }
    val ready = s.optionsStatus == OptionsStatus.Ready
    val claude = s.options.agents.firstOrNull { it.id == "claude" }
    val claudeRows = if (ready && claude != null) claudeRows(claude) else emptyList()
    val others = if (ready) listOf("codex", "cursor").mapNotNull { id -> s.options.agents.firstOrNull { it.id == id } } else emptyList()
    val otherRows = others.map { BrainRow(it, null, null, "${it.label} · ${ChatTexts.NEW_CHAT_MODEL_DEFAULT_ROW}") }
    fun chosen(r: BrainRow) = s.brainOwner == r.agent.id && s.model == r.model?.id && s.effort == r.effort
    fun pick(r: BrainRow) {
        if (s.direct && s.agent != r.agent.id) vm.selectAgent(r.agent.id)
        vm.pickBrain(r.agent.id, r.model?.id, r.effort)
    }
    val hasRows = claudeRows.isNotEmpty() || otherRows.isNotEmpty()
    OrbSheet(onDismiss = onDone, title = ChatTexts.NEW_CHAT_BRAIN) {
        Column(Modifier.selectableGroup()) {
            if (claudeRows.isNotEmpty()) {
                OrbSheetLabel(claude!!.label)
                for (r in claudeRows) OrbSheetItem(r.text, onClick = { pick(r) }, icon = OrbIcons.Brain, checked = chosen(r))
            }
            if (otherRows.isNotEmpty()) {
                OrbSheetLabel(others.joinToString(" y ") { it.label })
                for (r in otherRows) OrbSheetItem(r.text, onClick = { pick(r) }, icon = OrbIcons.Brain, checked = chosen(r))
            }
        }
        // Whatever the rows do not say stays reachable here: the PC's own choice, any agent, a model of its own, the level.
        if (hasRows) OrbSheetItem(ChatTexts.MORE_OPTIONS, onClick = { moreOpen = !moreOpen }, icon = if (moreOpen) OrbIcons.ChevronUp else OrbIcons.ChevronDown)
        if (moreOpen || !hasRows) MoreBrainOptions(s, vm, ready)
        OrbSheetLabel(ChatTexts.NEW_CHAT_ACCOUNT)
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp), horizontalArrangement = Arrangement.End) {
            OrbButton(ChatTexts.NEW_CHAT_DONE, onDone, kind = OrbButtonKind.Primary)
        }
    }
}

@Composable
private fun MoreBrainOptions(s: NewChatState, vm: NewChatViewModel, ready: Boolean) {
    val agent = s.agentOption
    if (!s.direct) {
        Column(Modifier.selectableGroup()) {
            OrbSheetItem(ChatTexts.NEW_CHAT_USE_PC_CHOICE, onClick = vm::clearBrain, icon = OrbIcons.Brain, checked = s.brainAgent == null)
            if (ready && s.options.agents.isNotEmpty()) {
                OrbSheetLabel(ChatTexts.NEW_CHAT_BRAIN_AGENT)
                for (a in s.options.agents) {
                    OrbSheetItem(a.label, onClick = { vm.pickBrain(a.id, null, null) }, icon = OrbIcons.Brain, checked = s.brainAgent == a.id)
                }
            }
        }
    }
    if (agent != null) {
        OrbSheetLabel(if (s.direct) agent.label else ChatTexts.NEW_CHAT_MODEL)
        Column(Modifier.selectableGroup()) {
            if (s.direct) OrbSheetItem(ChatTexts.NEW_CHAT_MODEL_DEFAULT, onClick = { vm.pickBrain(agent.id, null, null) }, icon = OrbIcons.Brain, checked = s.model == null)
            for (m in agent.models.filter { it.id.isNotEmpty() }) {
                OrbSheetItem(
                    m.label, onClick = { vm.pickBrain(agent.id, m.id, null) }, icon = OrbIcons.Brain, checked = s.model == m.id,
                    meta = if (m.recommended) ChatTexts.NEW_CHAT_RECOMMENDED else null,
                )
            }
        }
        val efforts = s.modelOption?.efforts.orEmpty()
        if (efforts.isNotEmpty()) {
            OrbSheetLabel(ChatTexts.NEW_CHAT_EFFORT)
            ChipsRow {
                for (e in efforts) OrbChip(e, s.effort == e, { vm.pickBrain(agent.id, s.model, if (s.effort == e) null else e) })
            }
        }
    }
}

/** «Nuevo proyecto»: only a name; the PC makes the project and its folder. */
@Composable
private fun NewProjectDialog(ui: NewProjectUi, onCreate: (String) -> Unit, onDismiss: () -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    OrbDialog(
        onDismiss = onDismiss, title = ChatTexts.NEW_CHAT_PROJECT_TITLE,
        confirm = OrbDialogAction(ChatTexts.NEW_CHAT_PROJECT_CREATE, { onCreate(name) }, enabled = !ui.saving && name.isNotBlank()),
        dismiss = OrbDialogAction(ChatTexts.NEW_CHAT_CANCEL, onDismiss),
    ) {
        OrbTextField(name, { name = it }, ChatTexts.NEW_CHAT_PROJECT_NAME, Modifier, focus, onDone = { if (name.isNotBlank()) onCreate(name) })
        ui.error?.let { Text(it, Modifier.padding(top = 8.dp).semantics { liveRegion = LiveRegionMode.Polite }, color = OrbKit.destructive, fontSize = 12.sp, lineHeight = 16.sp) }
    }
}

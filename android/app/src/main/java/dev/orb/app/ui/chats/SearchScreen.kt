package dev.orb.app.ui.chats

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.AgentMark
import dev.orb.app.ui.kit.OrbBadge
import dev.orb.app.ui.kit.OrbBadgeKind
import dev.orb.app.ui.kit.OrbChip
import dev.orb.app.ui.kit.OrbEmpty
import dev.orb.app.ui.kit.OrbGroupHeader
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbNote
import dev.orb.app.ui.kit.OrbRow
import dev.orb.app.ui.kit.OrbSearchField
import dev.orb.app.ui.kit.OrbSpinner
import dev.orb.app.ui.kit.OrbSubtitle
import dev.orb.app.ui.kit.OrbTopBar
import dev.orb.app.ui.kit.ProjectDot
import dev.orb.app.ui.kit.ProjectDotSize

/** Highlights every occurrence of [q] in [text] (ignoring case). */
fun highlight(text: String, q: String, style: SpanStyle): AnnotatedString = buildAnnotatedString {
    val needle = q.trim()
    if (needle.isEmpty()) { append(text); return@buildAnnotatedString }
    var i = 0
    while (i < text.length) {
        val at = text.indexOf(needle, i, ignoreCase = true)
        if (at < 0) { append(text.substring(i)); break }
        append(text.substring(i, at))
        withStyle(style) { append(text.substring(at, at + needle.length)) }
        i = at + needle.length
    }
}

/** What opening a result does: a chat or a message opens its chat, a task and a project their own screens. */
class SearchTargets(
    val onChat: (ChatRef) -> Unit,
    val onTask: (Long) -> Unit = {},
    val onProject: (String) -> Unit = {},
)

@Composable
fun SearchScreen(
    vm: SearchViewModel, onBack: () -> Unit, onOpenChat: (ChatRef) -> Unit, modifier: Modifier = Modifier,
    onOpenTask: (Long) -> Unit = {}, onOpenProject: (String) -> Unit = {},
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    val targets = remember(onOpenChat, onOpenTask, onOpenProject) { SearchTargets(onOpenChat, onOpenTask, onOpenProject) }
    Column(modifier.fillMaxSize()) {
        OrbTopBar(
            ChatTexts.SEARCH_TITLE, sub = ChatTexts.SEARCH_SUBTITLE, sideWidth = 56.dp,
            leading = { OrbIconButton(OrbIcons.ArrowLeft, ChatTexts.BACK, onBack) },
        )
        OrbSearchField(
            state.query, vm::setQuery, ChatTexts.SEARCH_PLACEHOLDER, Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp),
            focus = focus, onClear = { vm.setQuery("") }, clearLabel = ChatTexts.CLEAR,
        )
        Scopes(state.scope, vm::setScope)
        when (state.phase) {
            SearchPhase.Idle -> OrbEmpty(ChatTexts.SEARCH_HINT_SHORT, text = ChatTexts.SEARCH_HINT_BODY, icon = OrbIcons.Search)
            SearchPhase.Searching -> Column(Modifier.fillMaxWidth().padding(top = 48.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OrbSpinner(size = 28.dp)
                OrbNote(ChatTexts.SEARCHING)
            }
            SearchPhase.Error -> OrbEmpty(ChatTexts.SEARCH_ERROR, icon = OrbIcons.SearchX)
            SearchPhase.Done, SearchPhase.Offline -> Results(state, targets)
        }
    }
}

@Composable
private fun Scopes(selected: SearchScope, onScope: (SearchScope) -> Unit) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        for ((scope, label) in listOf(
            SearchScope.All to ChatTexts.SCOPE_ALL, SearchScope.Chats to ChatTexts.GROUP_CHATS, SearchScope.Messages to ChatTexts.GROUP_MESSAGES,
            SearchScope.Tasks to ChatTexts.GROUP_TASKS, SearchScope.Projects to ChatTexts.GROUP_PROJECTS,
        )) {
            OrbChip(label, selected == scope, { onScope(scope) })
        }
    }
}

@Composable
private fun Results(state: SearchState, go: SearchTargets) {
    val r = state.results
    val show = { s: SearchScope -> state.scope == SearchScope.All || state.scope == s }
    val now = remember(r) { System.currentTimeMillis() }
    val hl = SpanStyle(fontWeight = FontWeight.Bold, color = OrbKit.primaryText)
    Column(Modifier.fillMaxSize()) {
        if (state.phase == SearchPhase.Offline) OrbNote(ChatTexts.SEARCH_OFFLINE, Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
        if (state.count(state.scope) == 0) {
            OrbEmpty(ChatTexts.SEARCH_EMPTY, text = ChatTexts.searchNothing(state.query), icon = OrbIcons.SearchX)
            return
        }
        LazyColumn(Modifier.fillMaxSize()) {
            if (show(SearchScope.Chats) && r.chats.isNotEmpty()) {
                item(key = "h:chats", contentType = "header") { OrbGroupHeader(ChatTexts.GROUP_CHATS) }
                items(r.chats, key = { "c:" + it.key }, contentType = { "chat" }) { row ->
                    OrbRow(
                        row.title, titleStyled = highlight(row.title, state.query, hl),
                        lead = { AgentMark(if (row.direct) row.agent ?: "acp" else "orbe") },
                        subtitle = { ChatSubtitle(row) },
                        time = ChatTime.listTime(row.at, now), onClick = { go.onChat(row.ref) },
                    )
                }
            }
            if (show(SearchScope.Messages) && r.messages.isNotEmpty()) {
                item(key = "h:messages", contentType = "header") { OrbGroupHeader(ChatTexts.GROUP_IN_MESSAGES) }
                items(r.messages, key = { "m:" + it.key }, contentType = { "message" }) { m ->
                    OrbRow(
                        m.chatTitle,
                        lead = { AgentMark(if (m.ref.kind == ChatKind.Agent) m.agent ?: "acp" else "orbe") },
                        subtitle = { OrbSubtitle(highlight("«…" + m.text + "…»", state.query, hl)) },
                        time = ChatTime.listTime(m.at, now), onClick = { go.onChat(m.ref) },
                    )
                }
            }
            if (show(SearchScope.Tasks) && r.tasks.isNotEmpty()) {
                item(key = "h:tasks", contentType = "header") { OrbGroupHeader(ChatTexts.GROUP_TASKS) }
                items(r.tasks, key = { "t:" + it.id }, contentType = { "task" }) { t ->
                    val title = "#${t.id} ${t.title}"
                    OrbRow(
                        title, titleStyled = highlight(title, state.query, hl),
                        lead = { Icon(OrbIcons.Tasks, null, Modifier.size(16.dp), tint = OrbKit.mutedForeground) },
                        subtitle = { (t.project ?: t.snippet)?.let { OrbSubtitle(it) } },
                        badge = t.status?.takeIf { it.isNotBlank() }?.let { st -> { OrbBadge(ChatTexts.taskStatus(st), kind = taskBadge(st)) } },
                        onClick = { go.onTask(t.id) },
                    )
                }
            }
            if (show(SearchScope.Projects) && r.projects.isNotEmpty()) {
                item(key = "h:projects", contentType = "header") { OrbGroupHeader(ChatTexts.GROUP_PROJECTS) }
                items(r.projects, key = { "p:" + it.name }, contentType = { "project" }) { p ->
                    OrbRow(
                        p.name, titleStyled = highlight(p.name, state.query, hl),
                        lead = { ProjectDot(p.name, size = ProjectDotSize.Normal) },
                        subtitle = { OrbSubtitle(ChatTexts.projectLine(p.chats, p.tasks)) },
                        onClick = { go.onProject(p.name) },
                    )
                }
            }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.ChatSubtitle(row: ChatRow) {
    if (row.project != null) {
        ProjectDot(row.project, size = ProjectDotSize.Normal)
        OrbSubtitle(if (row.direct) "${row.project} · con ${agentName(row.agent) ?: "un agente"}" else row.project)
    } else {
        OrbSubtitle(if (row.direct) ChatTexts.withAgent(null, agentName(row.agent)) else ChatTexts.withOrbe(null))
    }
}

private fun taskBadge(status: String) = when (status) {
    "done" -> OrbBadgeKind.Ok
    "failed" -> OrbBadgeKind.Err
    "blocked", "awaiting_approval" -> OrbBadgeKind.Warn
    "running" -> OrbBadgeKind.Acc
    else -> OrbBadgeKind.Neutral
}

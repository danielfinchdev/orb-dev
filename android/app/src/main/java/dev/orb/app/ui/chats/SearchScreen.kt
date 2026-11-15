package dev.orb.app.ui.chats

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.TextStyle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.theme.OrbTheme

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

@Composable
fun SearchScreen(vm: SearchViewModel, onBack: () -> Unit, onOpenChat: (ChatRef) -> Unit, modifier: Modifier = Modifier) {
    val state by vm.state.collectAsStateWithLifecycle()
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Column(modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(OrbIcons.ArrowLeft, ChatTexts.BACK, tint = OrbTheme.colors.text2) }
            SearchField(state.query, vm::setQuery, focus, Modifier.weight(1f))
            if (state.query.isNotEmpty()) IconButton(onClick = { vm.setQuery("") }) { Icon(OrbIcons.Close, ChatTexts.CLEAR, tint = OrbTheme.colors.text2) }
        }
        if (state.phase == SearchPhase.Done || state.phase == SearchPhase.Offline) Scopes(state, vm::setScope)
        when (state.phase) {
            SearchPhase.Idle -> Message(ChatTexts.SEARCH_HINT_SHORT)
            SearchPhase.Searching -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            SearchPhase.Error -> Message(ChatTexts.SEARCH_ERROR)
            SearchPhase.Done, SearchPhase.Offline -> Results(state, onOpenChat)
        }
    }
}

@Composable
private fun SearchField(query: String, onChange: (String) -> Unit, focus: FocusRequester, modifier: Modifier) {
    Row(
        modifier.height(48.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHigh).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.weight(1f)) {
            if (query.isEmpty()) Text(ChatTexts.SEARCH_PLACEHOLDER, color = OrbTheme.colors.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
            BasicTextField(
                value = query, onValueChange = onChange, singleLine = true,
                textStyle = MaterialTheme.typography.bodyLarge.merge(TextStyle(color = MaterialTheme.colorScheme.onSurface)),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(),
                modifier = Modifier.fillMaxWidth().focusRequester(focus),
            )
        }
    }
}

@Composable
private fun Scopes(state: SearchState, onScope: (SearchScope) -> Unit) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        for ((scope, label) in listOf(
            SearchScope.All to ChatTexts.SCOPE_ALL, SearchScope.Chats to ChatTexts.GROUP_CHATS, SearchScope.Messages to ChatTexts.GROUP_MESSAGES,
            SearchScope.Tasks to ChatTexts.GROUP_TASKS, SearchScope.Projects to ChatTexts.GROUP_PROJECTS,
        )) {
            val n = state.count(scope)
            FilterChip(
                selected = state.scope == scope, onClick = { onScope(scope) },
                label = { Text(if (scope == SearchScope.All || n > 0) "$label · $n" else label) },
                leadingIcon = if (state.scope == scope) ({ Icon(OrbIcons.Check, null, Modifier.size(18.dp)) }) else null,
            )
        }
    }
}

@Composable
private fun Results(state: SearchState, onOpen: (ChatRef) -> Unit) {
    val r = state.results
    val show = { s: SearchScope -> state.scope == SearchScope.All || state.scope == s }
    val now = remember(r) { System.currentTimeMillis() }
    val hl = SpanStyle(fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.secondary)
    Column(Modifier.fillMaxSize()) {
        if (state.phase == SearchPhase.Offline) Text(ChatTexts.SEARCH_OFFLINE, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.warn)
        if (state.count(state.scope) == 0) { Message(ChatTexts.SEARCH_EMPTY); return }
        LazyColumn(Modifier.fillMaxSize()) {
            if (show(SearchScope.Chats) && r.chats.isNotEmpty()) {
                item(key = "h:chats", contentType = "header") { Header(ChatTexts.GROUP_CHATS) }
                items(r.chats, key = { "c:" + it.key }, contentType = { "chat" }) { row ->
                    ResultRow(
                        { ChatAvatar(row) }, highlight(row.title, state.query, hl),
                        if (row.direct) ChatTexts.withAgent(row.project, agentName(row.agent)) else ChatTexts.withOrbe(row.project),
                        ChatTime.short(row.at, now), onClick = { onOpen(row.ref) },
                    )
                }
            }
            if (show(SearchScope.Messages) && r.messages.isNotEmpty()) {
                item(key = "h:messages", contentType = "header") { Header(ChatTexts.GROUP_MESSAGES) }
                items(r.messages, key = { "m:" + it.key }, contentType = { "message" }) { m ->
                    val who = when (m.from) { Speaker.User -> ChatTexts.YOU; Speaker.Orbe -> m.fromName ?: ChatTexts.ORBE; else -> m.fromName }
                    ResultRow(
                        { Icon(OrbIcons.Chat, null, Modifier.size(24.dp), tint = OrbTheme.colors.text2) },
                        buildAnnotatedString { if (who != null) append("$who en "); append(m.chatTitle) },
                        null, ChatTime.short(m.at, now), onClick = { onOpen(m.ref) },
                        quote = highlight("«…" + m.text + "…»", state.query, hl),
                    )
                }
            }
            if (show(SearchScope.Tasks) && r.tasks.isNotEmpty()) {
                item(key = "h:tasks", contentType = "header") { Header(ChatTexts.GROUP_TASKS) }
                // Tasks open in a later version of the app; for now they are only listed.
                items(r.tasks, key = { "t:" + it.id }, contentType = { "task" }) { t ->
                    ResultRow(
                        { Icon(OrbIcons.Tasks, null, Modifier.size(24.dp), tint = OrbTheme.colors.text2) },
                        highlight("#${t.id} ${t.title}", state.query, hl), t.snippet ?: t.project, ChatTexts.taskStatus(t.status), onClick = null,
                    )
                }
            }
            if (show(SearchScope.Projects) && r.projects.isNotEmpty()) {
                item(key = "h:projects", contentType = "header") { Header(ChatTexts.GROUP_PROJECTS) }
                items(r.projects, key = { "p:" + it.name }, contentType = { "project" }) { p ->
                    ResultRow(
                        { Box(Modifier.size(40.dp).clip(CircleShape).background(projectColor(p.name)), contentAlignment = Alignment.Center) { Text(projectInitials(p.name), color = androidx.compose.ui.graphics.Color.White, fontWeight = FontWeight.Bold) } },
                        highlight(p.name, state.query, hl), "${ChatTexts.PROJECT_ON_PC} · ${ChatTexts.chatsOf(p.chats)}", null, onClick = null,
                    )
                }
            }
        }
    }
}

@Composable
private fun Header(text: String) {
    Text(text, Modifier.fillMaxWidth().padding(start = 16.dp, end = 24.dp, top = 16.dp, bottom = 4.dp).semantics { heading() }, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.secondary)
}

@Composable
private fun ResultRow(
    leading: @Composable () -> Unit, title: AnnotatedString, subtitle: String?, end: String?, onClick: (() -> Unit)?,
    quote: AnnotatedString? = null,
) {
    Row(
        Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(start = 16.dp, end = 24.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) { leading() }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = OrbTheme.colors.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (quote != null) Text(quote, style = MaterialTheme.typography.bodyMedium, color = OrbTheme.colors.text2, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (end != null) Text(end, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text3)
    }
}

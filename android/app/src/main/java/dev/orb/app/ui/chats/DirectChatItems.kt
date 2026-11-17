package dev.orb.app.ui.chats

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.theme.OrbMotion
import dev.orb.app.ui.theme.OrbTheme

/** What the rows of a direct chat can ask for; wired to the view model by the screen, to a recorder in tests. */
class DirectActions(
    val decide: (DItem.Approval, String) -> Unit,
    val retry: (String) -> Unit,
    val discard: (String) -> Unit,
    val resume: () -> Unit,
)

/** The agent's letter on its colour (Claude C, Codex X, Cursor Cu, Gemini G, ACP A). */
@Composable
fun AgentAvatar(agent: String?, size: Dp = 28.dp) {
    val mark = AgentMarks.of(agent) ?: AgentMarks.of("acp")!!
    Box(Modifier.size(size).clip(CircleShape).background(mark.color), contentAlignment = Alignment.Center) {
        Text(mark.letter, color = Color.White, fontWeight = FontWeight.Bold, fontSize = (size.value * 0.42f).sp)
    }
}

@Composable
fun DirectRow(item: DItem, state: DirectChatState, now: Long, actions: DirectActions, modifier: Modifier = Modifier) {
    when (item) {
        is DItem.User -> UserLine(item, now, modifier)
        is DItem.Assistant -> AssistantLine(item, state.agent, state.agentName, now, modifier)
        is DItem.Reasoning -> ReasoningLine(item, modifier)
        is DItem.Activity -> ActivityCard(item, modifier)
        is DItem.Plan -> PlanCard(item, modifier)
        is DItem.Note -> NoteLine(item.text, modifier)
        is DItem.Failure -> FailureLine(item.text, modifier)
        is DItem.Approval -> AgentApprovalCard(
            item, state.agentName, state.online, item.id in state.busyCards, now, { actions.decide(item, it) }, modifier,
        )
        is DItem.Waiting -> PendingRow(item.pending, state.online, { actions.retry(item.pending.clientId) }, { actions.discard(item.pending.clientId) }, modifier)
    }
}

@Composable
private fun UserLine(m: DItem.User, now: Long, modifier: Modifier) {
    val shown = listOfNotNull(
        m.text.takeIf { it.isNotBlank() },
        // The pictures are on the PC; the phone says they were sent.
        when (m.images) { 0 -> null; 1 -> ChatTexts.IMAGE_ATTACHED; else -> "${m.images} imágenes adjuntas" },
    ).joinToString("\n")
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
        if (m.steer) Text(ChatTexts.STEERED, Modifier.padding(end = 4.dp, bottom = 2.dp), color = OrbTheme.colors.text3, style = MaterialTheme.typography.labelSmall)
        UserBubble(shown, ChatTime.short(m.at, now))
    }
}

@Composable
private fun AssistantLine(m: DItem.Assistant, agent: String?, name: String?, now: Long, modifier: Modifier) {
    val blocks = remember(m.id, m.text) { LightMarkdown.parse(m.text) }
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        AgentAvatar(agent)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            MarkdownBody(blocks)
            val t = ChatTime.short(m.at, now)
            Text(listOfNotNull(name, t.takeIf { it.isNotEmpty() }).joinToString(" · "), color = OrbTheme.colors.text3, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/** The agent's reasoning, folded under «Pensando…». */
@Composable
private fun ReasoningLine(m: DItem.Reasoning, modifier: Modifier) {
    var open by rememberSaveable(m.id) { mutableStateOf(false) }
    Column(modifier.fillMaxWidth().animateContentSize(OrbMotion.standard()).padding(start = 40.dp)) {
        Row(
            Modifier.clip(RoundedCornerShape(8.dp)).clickable { open = !open }.padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(ChatTexts.THINKING_SHOW, color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodyMedium, fontStyle = FontStyle.Italic)
            Icon(if (open) OrbIcons.ChevronUp else OrbIcons.ChevronDown, null, Modifier.size(14.dp), tint = OrbTheme.colors.text3)
        }
        if (open) Text(
            m.text, Modifier.padding(top = 2.dp), color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodyMedium, fontStyle = FontStyle.Italic,
        )
    }
}

/** A run of tool calls as one compact card; each line opens to its input and output. */
@Composable
private fun ActivityCard(a: DItem.Activity, modifier: Modifier) {
    val scheme = MaterialTheme.colorScheme
    Column(
        modifier.fillMaxWidth().padding(start = 40.dp).clip(RoundedCornerShape(12.dp)).background(scheme.surfaceContainerLow)
            .animateContentSize(OrbMotion.standard()),
    ) {
        a.steps.forEachIndexed { i, step ->
            if (i > 0) HorizontalDivider(color = scheme.outlineVariant)
            StepLine(step)
        }
    }
}

@Composable
private fun StepLine(s: ToolStep) {
    var open by rememberSaveable(s.id) { mutableStateOf(false) }
    val scheme = MaterialTheme.colorScheme
    val expandable = s.input.isNotBlank() || !s.output.isNullOrBlank()
    Column(Modifier.fillMaxWidth().animateContentSize(OrbMotion.standard())) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 44.dp).then(if (expandable) Modifier.clickable { open = !open } else Modifier).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                buildAnnotatedString {
                    append(s.verb)
                    if (s.target.isNotEmpty()) {
                        append(" ")
                        withStyle(SpanStyle(fontFamily = FontFamily.Monospace, fontSize = 13.sp, color = OrbTheme.colors.text2)) { append(s.target) }
                    }
                },
                Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium,
                color = if (s.failed) scheme.error else scheme.onSurface,
            )
            if (s.running) Icon(OrbIcons.Loader, null, Modifier.size(14.dp), tint = scheme.primary)
            if (expandable) Icon(if (open) OrbIcons.ChevronUp else OrbIcons.ChevronDown, null, Modifier.size(14.dp), tint = OrbTheme.colors.text3)
        }
        if (open) Column(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (s.input.isNotBlank()) MonoBlock(s.input)
            if (!s.output.isNullOrBlank()) MonoBlock(s.output)
        }
    }
}

@Composable
internal fun MonoBlock(text: String, modifier: Modifier = Modifier) {
    Text(
        text, modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surface).padding(8.dp),
        fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 14, overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun PlanCard(p: DItem.Plan, modifier: Modifier) {
    CardFrame(modifier.padding(start = 40.dp)) {
        Text(ChatTexts.PLAN, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
        if (p.text != null) Text(p.text, color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodyMedium)
        for (s in p.steps) Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(
                if (s.done) OrbIcons.Check else OrbIcons.Clock, null, Modifier.size(16.dp),
                tint = if (s.done) MaterialTheme.colorScheme.primary else OrbTheme.colors.text3,
            )
            Text(s.text, style = MaterialTheme.typography.bodyMedium, color = if (s.done) OrbTheme.colors.text2 else MaterialTheme.colorScheme.onSurface)
        }
    }
}

@Composable
private fun FailureLine(text: String, modifier: Modifier) {
    Text(
        text, modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.45f)).padding(horizontal = 14.dp, vertical = 10.dp),
        color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodyMedium,
    )
}

/** A run that stopped: the PC offers to go on. */
@Composable
fun StalledCard(limited: Boolean, online: Boolean, onResume: () -> Unit, modifier: Modifier = Modifier) {
    CardFrame(modifier, warn = true) {
        Text(if (limited) ChatTexts.STALLED_LIMIT else ChatTexts.STALLED_HALF, style = MaterialTheme.typography.bodyMedium)
        Button(onClick = onResume, enabled = online) { Text(ChatTexts.CONTINUE) }
    }
}

/**
 * The agent asks to do something: tool, reason and what it would run, with «Permitir» / «Permitir siempre aquí» /
 * «Denegar». Once decided it closes into one line with the result.
 */
@Composable
fun AgentApprovalCard(
    a: DItem.Approval, agent: String?, online: Boolean, sending: Boolean, now: Long,
    onDecide: (String) -> Unit, modifier: Modifier = Modifier,
) {
    val kind = ToolText.kindOf(a.tool)
    val who = agent ?: ChatTexts.AGENT_FALLBACK
    var details by rememberSaveable(a.id) { mutableStateOf(false) }
    AnimatedContent(
        a.pending, modifier, label = "approval",
        transitionSpec = { (fadeIn(tween(OrbMotion.Medium)) + slideInVertically(OrbMotion.standard()) { it / 8 }) togetherWith fadeOut(tween(OrbMotion.Fast)) },
    ) { pending ->
        CardFrame(warn = pending) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(OrbIcons.Shield, null, Modifier.size(20.dp), tint = if (pending) OrbTheme.colors.warn else OrbTheme.colors.text2)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    val what = when (kind) {
                        "run" -> if (pending) ChatTexts.WANTS_RUN else ChatTexts.ASKED_RUN
                        "edit" -> if (pending) ChatTexts.WANTS_EDIT else ChatTexts.ASKED_EDIT
                        else -> if (pending) ChatTexts.WANTS_GENERIC else ChatTexts.ASKED_GENERIC
                    }
                    Text("$who $what", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    if (a.reason != null) Text(a.reason, color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodyMedium)
                    if (a.summary != null) Text(a.summary, color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodyMedium)
                }
                val t = ChatTime.short(a.at, now)
                if (pending && t.isNotEmpty()) Text(t, color = OrbTheme.colors.text3, style = MaterialTheme.typography.labelSmall)
            }
            if (a.title.isNotBlank()) MonoBlock(a.title)
            if (!a.input.isNullOrBlank() && a.input != a.title) {
                Text(
                    if (details) ChatTexts.HIDE_DETAILS else ChatTexts.SEE_DETAILS, Modifier.clickable { details = !details },
                    color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium,
                )
                AnimatedVisibility(details, enter = expandVertically(OrbMotion.standard()) + fadeIn(), exit = shrinkVertically(OrbMotion.standard()) + fadeOut()) {
                    MonoBlock(a.input)
                }
            }
            if (pending) {
                if (!online) Text(ChatTexts.NEEDS_PC_TO_ANSWER, color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodySmall)
                val enabled = online && !sending
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    OutlinedButton({ onDecide("deny") }, Modifier.weight(1f), enabled = enabled) { Text(ChatTexts.DENY) }
                    Button({ onDecide("allow") }, Modifier.weight(1f), enabled = enabled) { Text(ChatTexts.PERMIT) }
                }
                OutlinedButton({ onDecide("always") }, Modifier.fillMaxWidth(), enabled = enabled) { Text(ChatTexts.PERMIT_ALWAYS) }
            } else {
                Text(
                    when (a.status) {
                        "allowed", "approved" -> ChatTexts.ALLOWED
                        "always" -> ChatTexts.CLOSED_ALWAYS
                        "denied", "rejected" -> ChatTexts.DENIED
                        "timeout" -> ChatTexts.CLOSED_TIMEOUT
                        else -> ChatTexts.CLOSED_EXPIRED
                    },
                    color = OrbTheme.colors.text2, style = MaterialTheme.typography.labelLarge,
                )
            }
        }
    }
}

/** The agent writing now: its avatar, the text so far (read here, so only this row follows each piece) and what it does. */
@Composable
fun AgentLiveBubble(agent: String?, activity: String?, queued: Int, text: () -> String, nowMs: () -> Long, modifier: Modifier = Modifier) {
    val body = text()
    val blocks = remember(body) { if (body.isEmpty()) emptyList() else LightMarkdown.parse(body) }
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        AgentAvatar(agent)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (blocks.isNotEmpty()) MarkdownBody(blocks)
            ActivityLine(LiveInfo(busy = true, waiting = false, queued = queued, since = null, activity = activity, hasText = body.isNotEmpty()), nowMs)
        }
    }
}

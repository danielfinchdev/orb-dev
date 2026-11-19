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
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbAuthor
import dev.orb.app.ui.kit.OrbBadge
import dev.orb.app.ui.kit.OrbBadgeKind
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbCard
import dev.orb.app.ui.kit.OrbDelivery
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbSpinner
import dev.orb.app.ui.kit.OrbTaskCard
import dev.orb.app.ui.kit.OrbThinking
import dev.orb.app.ui.theme.OrbMotion

/** What the rows of a direct chat can ask for; wired to the view model by the screen, to a recorder in tests. */
class DirectActions(
    val decide: (DItem.Approval, String) -> Unit,
    val retry: (String) -> Unit,
    val discard: (String) -> Unit,
    val resume: () -> Unit,
    /** A long press (or the accessibility action) on a line of text: copy the chat up to it. */
    val forkFrom: (Long) -> Unit = {},
    /** The whole chat, as it is now. */
    val fork: () -> Unit = {},
)

/**
 * The gesture that offers «Bifurcar desde aquí» on a line of text: a long press, and the same as an accessibility action
 * for whoever cannot long-press. Off where the PC cannot copy from a line.
 */
@Composable
private fun Modifier.forkable(id: Long, enabled: Boolean, actions: DirectActions): Modifier {
    if (!enabled) return this
    val run = rememberUpdatedState { actions.forkFrom(id) }
    return this
        .pointerInput(id) { detectTapGestures(onLongPress = { run.value() }) }
        .semantics { customActions = listOf(CustomAccessibilityAction(DirectTexts.FORK_ACTION_DESC) { run.value(); true }) }
}

@Composable
fun DirectRow(item: DItem, state: DirectChatState, now: Long, actions: DirectActions, modifier: Modifier = Modifier) {
    when (item) {
        is DItem.User -> UserLine(item, state, now, actions, modifier)
        is DItem.Assistant -> AssistantLine(item, state, now, actions, modifier)
        is DItem.Reasoning -> ReasoningLine(item, modifier)
        is DItem.Activity -> ActivityCard(item, modifier)
        is DItem.Plan -> PlanCard(item, modifier)
        is DItem.Note -> NoteLine(item.text, modifier)
        is DItem.Failure -> FailureLine(item.text, modifier)
        is DItem.Approval -> AgentApprovalCard(
            item, state.agentName, state.online, item.id in state.busyCards, now, { actions.decide(item, it) }, modifier,
        )
        is DItem.Waiting -> PendingRow(
            item.pending, state.online, { actions.retry(item.pending.clientId) }, { actions.discard(item.pending.clientId) }, modifier,
            connection = state.connection,
        )
    }
}

/** What the person wrote, with the two ticks: a line that came back from the PC is saved there. */
@Composable
private fun UserLine(m: DItem.User, state: DirectChatState, now: Long, actions: DirectActions, modifier: Modifier) {
    val shown = listOfNotNull(
        m.text.takeIf { it.isNotBlank() },
        // The pictures are on the PC; the phone says they were sent.
        when (m.images) { 0 -> null; 1 -> ChatTexts.IMAGE_ATTACHED; else -> "${m.images} imágenes adjuntas" },
    ).joinToString("\n")
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
        UserBubble(shown, ChatTime.short(m.at, now), Modifier.forkable(m.id, state.canForkFrom, actions), delivery = OrbDelivery.Saved)
        if (m.steer) Row(Modifier.padding(top = 4.dp, end = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            OrbBadge(DirectTexts.STEER_SENT, kind = OrbBadgeKind.Acc)
            // «llega al agente en marcha» is only true while that turn is still going
            if (state.busy && m.id == state.lastUserId) Text(DirectTexts.STEER_REACHES.trimStart(), color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 17.sp)
        }
    }
}

/** The agent's text under its mark and name; the long press offers «Bifurcar desde aquí». */
@Composable
private fun AssistantLine(m: DItem.Assistant, state: DirectChatState, now: Long, actions: DirectActions, modifier: Modifier) {
    val blocks = remember(m.id, m.text) { LightMarkdown.parse(m.text) }
    Column(modifier.fillMaxWidth().forkable(m.id, state.canForkFrom, actions), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        OrbAuthor(state.agent, state.agentName ?: ChatTexts.AGENT_FALLBACK, time = ChatTime.short(m.at, now))
        MarkdownBody(blocks)
    }
}

/** The agent's reasoning, folded under «Pensando…». */
@Composable
private fun ReasoningLine(m: DItem.Reasoning, modifier: Modifier) {
    var open by rememberSaveable(m.id) { mutableStateOf(false) }
    Column(modifier.fillMaxWidth().animateContentSize(OrbMotion.standard())) {
        Row(
            Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp)).clickable { open = !open },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(ChatTexts.THINKING_SHOW, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp, fontStyle = FontStyle.Italic)
            Icon(if (open) OrbIcons.ChevronUp else OrbIcons.ChevronDown, null, Modifier.size(14.dp), tint = OrbKit.faintForeground)
        }
        if (open) Text(m.text, Modifier.padding(bottom = 4.dp), color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 19.sp, fontStyle = FontStyle.Italic)
    }
}

/** A run of tool calls as one card (`.mturn`): an icon, what was done and a tick; each line opens to its input and output. */
@Composable
private fun ActivityCard(a: DItem.Activity, modifier: Modifier) {
    OrbCard(modifier.animateContentSize(OrbMotion.standard())) {
        a.steps.forEachIndexed { i, step ->
            if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(OrbKit.border))
            StepLine(step)
        }
    }
}

private fun stepIcon(verb: String): ImageVector = when {
    verb.startsWith("Ejecut") -> OrbIcons.Terminal
    verb.startsWith("Edit") || verb.startsWith("Cre") || verb.startsWith("Borr") -> OrbIcons.FilePen
    verb.startsWith("Ley") -> OrbIcons.Eye
    verb.startsWith("Busc") -> OrbIcons.Search
    else -> OrbIcons.Activity
}

@Composable
private fun StepLine(s: ToolStep) {
    var open by rememberSaveable(s.id) { mutableStateOf(false) }
    val expandable = s.input.isNotBlank() || !s.output.isNullOrBlank()
    Column(Modifier.fillMaxWidth().animateContentSize(OrbMotion.standard())) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp).then(if (expandable) Modifier.clickable { open = !open } else Modifier).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(stepIcon(s.verb), null, Modifier.size(16.dp), tint = if (s.failed) OrbKit.destructive else OrbKit.foreground)
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.Medium)) { append(s.verb) }
                    if (s.target.isNotEmpty()) {
                        append(" ")
                        withStyle(SpanStyle(fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = OrbKit.mutedForeground)) { append(s.target) }
                    }
                },
                Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp, lineHeight = 18.sp,
                color = if (s.failed) OrbKit.destructive else OrbKit.foreground,
            )
            when {
                s.running -> OrbSpinner(size = 12.dp)
                s.failed -> Icon(OrbIcons.CircleX, null, Modifier.size(14.dp), tint = OrbKit.destructive)
                else -> Icon(OrbIcons.Check, null, Modifier.size(14.dp), tint = OrbKit.faintForeground)
            }
            if (expandable) Icon(if (open) OrbIcons.ChevronUp else OrbIcons.ChevronDown, null, Modifier.size(14.dp), tint = OrbKit.faintForeground)
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
        text, modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(OrbKit.secondary).padding(8.dp),
        color = OrbKit.foreground, fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 14, overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun PlanCard(p: DItem.Plan, modifier: Modifier) {
    OrbCard(modifier) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(ChatTexts.PLAN, color = OrbKit.foreground, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium)
            if (p.text != null) Text(p.text, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 19.sp)
            for (s in p.steps) Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (s.done) OrbIcons.Check else OrbIcons.Clock, null, Modifier.size(16.dp), tint = if (s.done) OrbKit.success else OrbKit.faintForeground)
                Text(s.text, color = if (s.done) OrbKit.mutedForeground else OrbKit.foreground, fontSize = 13.5.sp, lineHeight = 19.sp)
            }
        }
    }
}

@Composable
private fun FailureLine(text: String, modifier: Modifier) {
    Text(
        text, modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(OrbKit.destructive.copy(alpha = 0.12f)).padding(horizontal = 14.dp, vertical = 10.dp),
        color = OrbKit.destructive, fontSize = 13.5.sp, lineHeight = 19.sp,
    )
}

/**
 * A run that stopped (`Sesión parada`): the reason, «Reanudar» to go on where it was and «Bifurcar desde aquí» to copy the
 * chat. The second one only offers what the PC can do: from a line, the line is chosen with a long press.
 */
@Composable
fun StalledCard(
    limited: Boolean, online: Boolean, onResume: () -> Unit, modifier: Modifier = Modifier,
    canForkFrom: Boolean = false, onFork: () -> Unit = {}, forkEnabled: Boolean = online,
) {
    OrbCard(modifier) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(OrbIcons.History, null, Modifier.size(16.dp), tint = OrbKit.foreground)
                Text(DirectTexts.STALLED_TITLE, color = OrbKit.foreground, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium)
            }
            Text(
                (if (limited) ChatTexts.STALLED_LIMIT else ChatTexts.STALLED_HALF) + if (canForkFrom) DirectTexts.STALLED_FORK_HINT else DirectTexts.STALLED_RESUME_HINT,
                color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 19.sp,
            )
            if (!online) Text(ChatTexts.NEEDS_PC_TO_ANSWER, color = OrbKit.mutedForeground, fontSize = 12.sp, lineHeight = 16.sp)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                OrbButton(DirectTexts.FORK_HERE, onFork, enabled = forkEnabled)
                OrbButton(ChatTexts.RESUME, onResume, kind = OrbButtonKind.Primary, enabled = online)
            }
        }
    }
}

private fun closedText(status: String) = when (status) {
    "allowed", "approved" -> ChatTexts.ALLOWED
    "always" -> ChatTexts.CLOSED_ALWAYS
    "denied", "rejected" -> ChatTexts.DENIED
    "timeout" -> ChatTexts.CLOSED_TIMEOUT
    else -> ChatTexts.CLOSED_EXPIRED
}

private fun closedKind(status: String) = when (status) {
    "allowed", "approved", "always" -> OrbBadgeKind.Ok
    "denied", "rejected" -> OrbBadgeKind.Err
    else -> OrbBadgeKind.Neutral
}

/**
 * The agent asks to do something (`.mturn` «Permiso»): what it wants to run, why and the exact command, with «Denegar»,
 * «Siempre» and «Permitir». «Siempre» is one tap from the main button, so the card says in one line how far it reaches. Once
 * decided it closes to a badge with the result.
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
        val enabled = online && !sending
        OrbTaskCard(
            title = DirectTexts.PERMISSION_CARD, icon = OrbIcons.ShieldQuestion,
            badge = if (pending) ChatTime.short(a.at, now).ifEmpty { DirectTexts.PENDING_BADGE } else closedText(a.status),
            badgeKind = if (pending) OrbBadgeKind.Warn else closedKind(a.status),
            body = {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (kind == "edit") OrbIcons.FilePen else OrbIcons.Terminal, null, Modifier.size(16.dp), tint = OrbKit.mutedForeground)
                    val what = when (kind) {
                        "run" -> if (pending) ChatTexts.WANTS_RUN else ChatTexts.ASKED_RUN
                        "edit" -> if (pending) ChatTexts.WANTS_EDIT else ChatTexts.ASKED_EDIT
                        else -> if (pending) ChatTexts.WANTS_GENERIC else ChatTexts.ASKED_GENERIC
                    }
                    Text("$who $what", Modifier.weight(1f), color = OrbKit.foreground, fontSize = 13.5.sp, lineHeight = 19.sp)
                }
                if (a.reason != null) Text(a.reason, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp)
                if (a.summary != null) Text(a.summary, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp)
                if (a.title.isNotBlank()) MonoBlock(a.title)
                if (!a.input.isNullOrBlank() && a.input != a.title) {
                    Box(Modifier.heightIn(min = 48.dp).clickable { details = !details }, contentAlignment = Alignment.CenterStart) {
                        Text(
                            if (details) ChatTexts.HIDE_DETAILS else ChatTexts.SEE_DETAILS,
                            color = OrbKit.primaryText, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium,
                        )
                    }
                    AnimatedVisibility(details, enter = expandVertically(OrbMotion.standard()) + fadeIn(), exit = shrinkVertically(OrbMotion.standard()) + fadeOut()) {
                        MonoBlock(a.input)
                    }
                }
                if (pending) {
                    if (!online) Text(ChatTexts.NEEDS_PC_TO_ANSWER, color = OrbKit.mutedForeground, fontSize = 12.sp, lineHeight = 16.sp)
                    Text(DirectTexts.PERMIT_ALWAYS_SCOPE, color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp)
                }
            },
            footer = if (!pending) null else ({
                OrbButton(ChatTexts.DENY, { onDecide("deny") }, small = true, enabled = enabled)
                OrbButton(
                    DirectTexts.PERMIT_ALWAYS_SHORT, { onDecide("always") }, Modifier.semantics { contentDescription = ChatTexts.PERMIT_ALWAYS }, small = true, enabled = enabled,
                )
                OrbButton(ChatTexts.PERMIT, { onDecide("allow") }, kind = OrbButtonKind.Primary, small = true, enabled = enabled)
            }),
        )
    }
}

/** The agent writing now: its mark and the text so far (read here, so only this row follows each piece), then «Pensando…». */
@Composable
fun AgentLiveBubble(agent: String?, name: String, activity: String?, text: () -> String, modifier: Modifier = Modifier) {
    val body = text()
    val blocks = remember(body) { if (body.isEmpty()) emptyList() else LightMarkdown.parse(body) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (blocks.isNotEmpty()) {
            OrbAuthor(agent, name)
            MarkdownBody(blocks, caret = true)
        }
        OrbThinking(activity ?: if (body.isNotEmpty()) ChatTexts.WRITING else ChatTexts.THINKING)
    }
}

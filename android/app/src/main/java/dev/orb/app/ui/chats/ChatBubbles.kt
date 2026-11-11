package dev.orb.app.ui.chats

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.produceState
import kotlinx.coroutines.delay
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.theme.OrbMotion
import dev.orb.app.ui.theme.OrbTheme

// ---------- Markdown ----------

@Composable
private fun spansToText(spans: List<Span>): AnnotatedString {
    val scheme = MaterialTheme.colorScheme
    val link = scheme.primary
    val codeBg = scheme.surfaceContainerHigh
    return remember(spans, link, codeBg) {
        buildAnnotatedString {
            for (s in spans) {
                val style = SpanStyle(
                    fontWeight = if (s.bold) FontWeight.Bold else null,
                    fontStyle = if (s.italic) FontStyle.Italic else null,
                    fontFamily = if (s.code) FontFamily.Monospace else null,
                    fontSize = if (s.code) 13.sp else TextStyle.Default.fontSize,
                    background = if (s.code) codeBg else androidx.compose.ui.graphics.Color.Unspecified,
                )
                if (s.link != null) {
                    withLink(LinkAnnotation.Url(s.link, TextLinkStyles(SpanStyle(color = link, textDecoration = TextDecoration.Underline)))) {
                        withStyle(style) { append(s.text) }
                    }
                } else withStyle(style) { append(s.text) }
            }
        }
    }
}

/** A message body as light Markdown. [blocks] is parsed by the caller so it can be remembered per message. */
@Composable
fun MarkdownBody(blocks: List<MdBlock>, modifier: Modifier = Modifier) {
    val scheme = MaterialTheme.colorScheme
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (b in blocks) when (b) {
            is MdBlock.Paragraph -> Text(spansToText(b.spans), style = MaterialTheme.typography.bodyLarge)
            is MdBlock.Heading -> Text(
                spansToText(b.spans), fontWeight = FontWeight.SemiBold,
                style = if (b.level <= 2) MaterialTheme.typography.titleMedium else MaterialTheme.typography.titleSmall,
            )
            is MdBlock.Item -> Row(Modifier.padding(start = (12 * b.depth).dp)) {
                Text(if (b.number != null) "${b.number}." else "•", Modifier.widthIn(min = 20.dp), color = OrbTheme.colors.text2)
                Text(spansToText(b.spans), style = MaterialTheme.typography.bodyLarge)
            }
            is MdBlock.Quote -> Row(Modifier.fillMaxWidth().padding(start = 2.dp)) {
                Box(Modifier.padding(end = 10.dp).size(3.dp, 20.dp).background(scheme.outline, RoundedCornerShape(2.dp)))
                Text(spansToText(b.spans), style = MaterialTheme.typography.bodyLarge, color = OrbTheme.colors.text2)
            }
            is MdBlock.Code -> CodeBlock(b)
            MdBlock.Rule -> Box(Modifier.fillMaxWidth().size(1.dp).background(scheme.outlineVariant))
        }
    }
}

@Composable
private fun CodeBlock(b: MdBlock.Code) {
    val scheme = MaterialTheme.colorScheme
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(scheme.surfaceContainer)
            .border(BorderStroke(1.dp, scheme.outlineVariant), RoundedCornerShape(10.dp)),
    ) {
        if (b.onlyOnPc) {
            Text(
                ChatTexts.CODE_ON_PC, Modifier.padding(horizontal = 12.dp, vertical = 6.dp), color = scheme.primary,
                style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold,
            )
        }
        Text(
            b.text, Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 10.dp),
            fontFamily = FontFamily.Monospace, fontSize = 12.5.sp, lineHeight = 20.sp, softWrap = false,
        )
    }
}

// ---------- Bubbles ----------

@Composable
private fun OrbeMark() {
    Box(
        Modifier.size(28.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer),
        contentAlignment = Alignment.Center,
    ) { Text("O", color = MaterialTheme.colorScheme.onPrimaryContainer, fontWeight = FontWeight.Bold, fontSize = 13.sp) }
}

private fun timeOf(at: String?, now: Long) = ChatTime.short(at, now)

/** One line of the conversation. Rows are cheap: the parsed Markdown is remembered per message. */
@Composable
fun MessageRow(
    item: ChatItem.Msg, state: OrbeChatState, now: Long, actions: CardActions, modifier: Modifier = Modifier,
) {
    val m = item.message
    when (m.role) {
        MsgRole.User -> UserBubble(m.body, timeOf(m.at, now), modifier)
        MsgRole.Orbe -> OrbeMessage(m, state, now, actions, modifier)
        MsgRole.System -> SystemMessage(m, state, actions, modifier)
    }
}

@Composable
fun UserBubble(text: String, time: String, modifier: Modifier = Modifier, status: @Composable (() -> Unit)? = null) {
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
        Column(
            Modifier.widthIn(max = 300.dp)
                .clip(RoundedCornerShape(16.dp, 16.dp, 4.dp, 16.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh)
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) { Text(text, style = MaterialTheme.typography.bodyLarge) }
        if (status != null) status() else if (time.isNotEmpty()) {
            Text(time, Modifier.padding(top = 2.dp, end = 4.dp), color = OrbTheme.colors.text3, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun OrbeMessage(m: ChatMessage, state: OrbeChatState, now: Long, actions: CardActions, modifier: Modifier) {
    val blocks = remember(m.id, m.body) { LightMarkdown.parse(m.body) }
    val card = m.card
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        OrbeMark()
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (card is MsgCard.Question) {
                QuestionCard(m, card, state.online, m.id in state.busyCards, actions)
            } else {
                MarkdownBody(blocks)
                if (card is MsgCard.Report) ReportCard(m, card, state.online, m.id in state.busyCards, actions)
            }
            val t = timeOf(m.at, now)
            if (t.isNotEmpty()) Text(t, color = OrbTheme.colors.text3, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun SystemMessage(m: ChatMessage, state: OrbeChatState, actions: CardActions, modifier: Modifier) {
    when (val card = m.card) {
        is MsgCard.Permission -> PermissionCard(m, card, state.online, m.id in state.busyCards, actions, modifier)
        is MsgCard.TaskAttention -> TaskCard(m, card.task, state, actions, modifier)
        is MsgCard.TaskEnd -> NoteLine(m.body, modifier, fold = card.result)
        else -> NoteLine(m.body, modifier)
    }
}

/** A centred grey line for what the PC reports about itself (a task started, a task ended…). */
@Composable
fun NoteLine(text: String, modifier: Modifier = Modifier, fold: String? = null) {
    var open by rememberSaveable { mutableStateOf(false) }
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Column(
            Modifier.widthIn(max = 340.dp).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceContainerLow)
                .padding(horizontal = 14.dp, vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(text, color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodyMedium)
            if (fold != null) {
                Text(
                    if (open) ChatTexts.HIDE_DETAILS else ChatTexts.SEE_RESULT, Modifier.clickable { open = !open }.padding(top = 4.dp),
                    color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium,
                )
                AnimatedVisibility(open, enter = expandVertically(OrbMotion.standard()) + fadeIn(), exit = shrinkVertically(OrbMotion.standard()) + fadeOut()) {
                    Text(fold, Modifier.padding(top = 4.dp), color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

// ---------- Messages written on the phone ----------

@Composable
fun PendingRow(p: PendingMessage, online: Boolean, onRetry: () -> Unit, onDiscard: () -> Unit, modifier: Modifier = Modifier) {
    val scheme = MaterialTheme.colorScheme
    UserBubble(
        p.text, "", modifier,
        status = {
            when (p.state) {
                PendingState.Failed -> Column(horizontalAlignment = Alignment.End, modifier = Modifier.padding(top = 4.dp)) {
                    Text(ChatTexts.pendingFailed(p.error), color = scheme.error, style = MaterialTheme.typography.labelMedium)
                    Text(ChatTexts.PENDING_KEPT, color = OrbTheme.colors.text2, style = MaterialTheme.typography.labelSmall)
                    Row {
                        TextButton(onClick = onRetry) { Text(ChatTexts.RETRY) }
                        TextButton(onClick = onDiscard) { Text(ChatTexts.REMOVE) }
                    }
                }
                else -> Row(Modifier.padding(top = 2.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(OrbIcons.Clock, null, Modifier.size(12.dp), tint = OrbTheme.colors.text3)
                    Text(
                        if (!online && p.state == PendingState.Waiting) ChatTexts.PENDING_WAITING else ChatTexts.PENDING_SENDING,
                        Modifier.padding(start = 4.dp), color = OrbTheme.colors.text3, style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
        },
    )
}

// ---------- The answer being written ----------

/**
 * The only part of the list that follows each streamed piece: [text] is read here, in this composable, so the rest of
 * the list is not drawn again while the assistant writes.
 */
@Composable
fun LiveBubble(info: LiveInfo, text: () -> String, nowMs: () -> Long, modifier: Modifier = Modifier) {
    val body = text()
    val blocks = remember(body) { if (body.isEmpty()) emptyList() else LightMarkdown.parse(body) }
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        OrbeMark()
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (blocks.isNotEmpty()) MarkdownBody(blocks)
            if (info.waiting && !info.busy) {
                Text(ChatTexts.WAITING_TURN, color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodyMedium)
            } else {
                ActivityLine(info, nowMs)
            }
        }
    }
}

@Composable
private fun ActivityLine(info: LiveInfo, nowMs: () -> Long) {
    val label = info.activity ?: if (info.hasText) ChatTexts.WRITING else ChatTexts.THINKING
    val pulse = rememberInfiniteTransition(label = "thinking")
    val alpha by pulse.animateFloat(
        0.45f, 1f, infiniteRepeatable(tween(900, easing = OrbMotion.EaseStd), androidx.compose.animation.core.RepeatMode.Reverse), label = "alpha",
    )
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(OrbIcons.Loader, null, Modifier.size(14.dp).alpha(alpha), tint = MaterialTheme.colorScheme.primary)
        AnimatedContent(
            label, transitionSpec = { fadeIn(tween(OrbMotion.Short)) togetherWith fadeOut(tween(OrbMotion.Fast)) }, label = "activity",
            modifier = Modifier.weight(1f, fill = false),
        ) { Text(it, color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodyMedium, maxLines = 1) }
        val since = info.since
        if (since != null) {
            val now by produceState(nowMs()) { while (true) { delay(1000); value = nowMs() } }
            Text(elapsedText(now - since), color = OrbTheme.colors.text3, style = MaterialTheme.typography.labelMedium)
        }
        if (info.queued > 0) Text("· " + ChatTexts.queuedTurns(info.queued), color = OrbTheme.colors.text3, style = MaterialTheme.typography.labelMedium)
    }
}

// ---------- Cards ----------

/** What the cards can ask for; wired to the view model by the screen, to a recorder in tests. */
class CardActions(
    val answer: (ChatMessage, List<String>, String?, Boolean) -> Unit,
    val accept: (ChatMessage) -> Unit,
    val decideRequest: (ChatMessage, String) -> Unit,
    val askApproval: (Long) -> Unit,
    val rejectTask: (Long) -> Unit,
    val watchTask: (Long) -> Unit,
)

@Composable
private fun CardFrame(modifier: Modifier = Modifier, warn: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    val scheme = MaterialTheme.colorScheme
    val c = OrbTheme.colors
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp))
            .background(if (warn) c.warnSoft else scheme.surfaceContainerLow)
            .border(BorderStroke(1.dp, if (warn) c.warn else scheme.outlineVariant), RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp), content = content,
    )
}

/** A35: the agent's question with its options, «Otra respuesta» and «Saltar». Answered, it closes into one line. */
@Composable
fun QuestionCard(m: ChatMessage, q: MsgCard.Question, online: Boolean, sending: Boolean, actions: CardActions) {
    AnimatedContent(
        q.pending, label = "question",
        transitionSpec = { (fadeIn(tween(OrbMotion.Medium)) + slideInVertically(OrbMotion.standard()) { it / 8 }) togetherWith fadeOut(tween(OrbMotion.Fast)) },
    ) { pending ->
        if (pending) OpenQuestion(m, q, online, sending, actions) else ClosedQuestion(q)
    }
}

@Composable
private fun OpenQuestion(m: ChatMessage, q: MsgCard.Question, online: Boolean, sending: Boolean, actions: CardActions) {
    val picked = remember(m.id) { mutableStateListOf<String>() }
    var other by rememberSaveable(m.id) { mutableStateOf("") }
    var typing by rememberSaveable(m.id) { mutableStateOf(false) }
    val limit = if (q.multi) 4 else 1
    val canSend = online && !sending && (picked.isNotEmpty() || other.isNotBlank())
    CardFrame {
        if (!q.header.isNullOrBlank()) Text(q.header, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
        Text(q.question.ifBlank { m.body }, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Text(if (q.multi) ChatTexts.ANSWER_PICK_MANY else ChatTexts.ANSWER_PICK, color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodySmall)
        for (o in q.options) {
            val on = o.label in picked
            Row(
                Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(12.dp))
                    .selectable(on, enabled = online && !sending, role = if (q.multi) Role.Checkbox else Role.RadioButton) {
                        if (q.multi) { if (on) picked.remove(o.label) else if (picked.size < limit) picked.add(o.label) }
                        else { picked.clear(); picked.add(o.label) }
                        if (picked.isNotEmpty()) typing = false
                    }
                    .padding(horizontal = 4.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (q.multi) Checkbox(on, null) else RadioButton(on, null)
                Column(Modifier.padding(start = 8.dp)) {
                    Text(o.label, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                    if (!o.description.isNullOrBlank()) Text(o.description, color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(12.dp))
                .clickable(enabled = online && !sending) { typing = true; if (!q.multi) picked.clear() }.padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(OrbIcons.Pencil, null, Modifier.padding(start = 2.dp).size(20.dp), tint = OrbTheme.colors.text2)
            Text(ChatTexts.ANSWER_OTHER, Modifier.padding(start = 10.dp), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
        }
        AnimatedVisibility(typing || other.isNotBlank(), enter = expandVertically(OrbMotion.standard()) + fadeIn(), exit = shrinkVertically(OrbMotion.standard()) + fadeOut()) {
            BasicTextField(
                other, { other = it.take(2000) }, enabled = online && !sending,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surface)
                    .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 12.dp),
            )
        }
        if (!online) Text(ChatTexts.NEEDS_PC_TO_ANSWER, color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodySmall)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            TextButton(onClick = { actions.answer(m, emptyList(), null, true) }, enabled = online && !sending) { Text(ChatTexts.ANSWER_SKIP) }
            Button(
                onClick = { actions.answer(m, if (other.isBlank()) picked.toList() else emptyList(), other.takeIf { it.isNotBlank() }, false) },
                enabled = canSend,
            ) { Text(ChatTexts.ANSWER_SEND) }
        }
    }
}

@Composable
private fun ClosedQuestion(q: MsgCard.Question) {
    CardFrame {
        Text(q.question, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(OrbIcons.Check, null, Modifier.size(16.dp), tint = OrbTheme.colors.ok)
            val skipped = q.status == "skipped"
            Text(
                if (skipped) ChatTexts.SKIPPED else q.answer?.let { "${ChatTexts.ANSWERED}: $it" } ?: ChatTexts.ANSWERED,
                color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

@Composable
private fun ReportCard(m: ChatMessage, r: MsgCard.Report, online: Boolean, sending: Boolean, actions: CardActions) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        AnimatedContent(r.accepted, label = "report", transitionSpec = { fadeIn(tween(OrbMotion.Medium)) togetherWith fadeOut(tween(OrbMotion.Fast)) }) { accepted ->
            if (accepted) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(OrbIcons.Check, null, Modifier.size(16.dp), tint = OrbTheme.colors.ok)
                    Text(ChatTexts.reportAccepted(r.tasks), color = OrbTheme.colors.ok, style = MaterialTheme.typography.labelLarge)
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(onClick = { actions.accept(m) }, enabled = online && !sending) {
                        Icon(OrbIcons.Check, null, Modifier.size(16.dp)); Text(ChatTexts.ACCEPT_REPORT, Modifier.padding(start = 6.dp))
                    }
                    Text(ChatTexts.reportTasks(r.tasks), color = OrbTheme.colors.text2, style = MaterialTheme.typography.labelMedium)
                }
            }
        }
    }
}

/** An agent asks to run something: «Permitir una vez», «Siempre» or «Denegar» (A04). */
@Composable
private fun PermissionCard(m: ChatMessage, p: MsgCard.Permission, online: Boolean, sending: Boolean, actions: CardActions, modifier: Modifier) {
    val pending = p.status == "pending"
    var details by rememberSaveable(m.id) { mutableStateOf(false) }
    CardFrame(modifier, warn = pending) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(OrbIcons.Shield, null, Modifier.size(20.dp), tint = if (pending) OrbTheme.colors.warn else OrbTheme.colors.text2)
            Text(m.body, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        }
        if (!p.detail.isNullOrBlank()) {
            Text(
                if (details) ChatTexts.HIDE_DETAILS else ChatTexts.SEE_DETAILS, Modifier.clickable { details = !details },
                color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium,
            )
            AnimatedVisibility(details, enter = expandVertically(OrbMotion.standard()) + fadeIn(), exit = shrinkVertically(OrbMotion.standard()) + fadeOut()) {
                Text(
                    p.detail, Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surface).padding(10.dp),
                    fontFamily = FontFamily.Monospace, fontSize = 12.5.sp,
                )
            }
        }
        if (pending) {
            if (!online) Text(ChatTexts.NEEDS_PC_TO_ANSWER, color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
                Button(onClick = { actions.decideRequest(m, "allow") }, enabled = online && !sending) { Text(ChatTexts.ALLOW_ONCE) }
                OutlinedButton(onClick = { actions.decideRequest(m, "always") }, enabled = online && !sending) { Text(ChatTexts.ALLOW_ALWAYS) }
                OutlinedButton(onClick = { actions.decideRequest(m, "deny") }, enabled = online && !sending) { Text(ChatTexts.DENY) }
            }
        } else {
            Text(
                when (p.status) {
                    "allowed", "approved" -> ChatTexts.ALLOWED
                    "always" -> ChatTexts.ALWAYS_ALLOWED
                    "denied", "rejected" -> ChatTexts.DENIED
                    else -> ChatTexts.EXPIRED
                },
                color = OrbTheme.colors.text2, style = MaterialTheme.typography.labelLarge,
            )
        }
    }
}

/** A task that waits for the person's OK: «Aprobar» / «Rechazar», with the task's state read from the PC. */
@Composable
private fun TaskCard(m: ChatMessage, task: Long, state: OrbeChatState, actions: CardActions, modifier: Modifier) {
    androidx.compose.runtime.LaunchedEffect(task) { actions.watchTask(task) }
    val status = state.taskStatus[task]
    val waiting = status == "awaiting_approval"
    CardFrame(modifier, warn = waiting) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(OrbIcons.Tasks, null, Modifier.size(20.dp), tint = if (waiting) OrbTheme.colors.warn else OrbTheme.colors.text2)
            Text(m.body.removePrefix("⚠️").trim(), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        }
        if (waiting) {
            if (!state.online) Text(ChatTexts.NEEDS_PC_TO_ANSWER, color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodySmall)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                OutlinedButton(onClick = { actions.rejectTask(task) }, enabled = state.online) { Text(ChatTexts.REJECT) }
                Button(onClick = { actions.askApproval(task) }, enabled = state.online) { Text(ChatTexts.APPROVE) }
            }
        } else if (status != null) {
            Text(ChatTexts.taskStatus(status), color = OrbTheme.colors.text2, style = MaterialTheme.typography.labelLarge)
        }
    }
}

/** What the PC's own window shows before approving a task: its title, agent, folder and why it waits. */
@Composable
fun ApprovalDialog(ask: ApprovalAsk, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    val d = ask.detail
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("${ChatTexts.APPROVE_TASK_TITLE} #${d.id}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(d.title, fontWeight = FontWeight.SemiBold)
                if (!d.agent.isNullOrBlank()) Text(agentName(d.agent) ?: d.agent, color = OrbTheme.colors.text2)
                if (!d.project.isNullOrBlank()) Text(d.project, fontFamily = FontFamily.Monospace, fontSize = 12.5.sp, color = OrbTheme.colors.text2)
                if (d.reasons.isNotEmpty()) Text(d.reasons.joinToString(", "), color = OrbTheme.colors.text2)
                Text(ChatTexts.ON_PC_NOTE, color = OrbTheme.colors.text3, style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = { TextButton(onClick = onConfirm) { Text(ChatTexts.APPROVE) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(ChatTexts.CANCEL) } },
    )
}


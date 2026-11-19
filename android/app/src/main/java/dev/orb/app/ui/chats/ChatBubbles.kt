package dev.orb.app.ui.chats

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
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
import dev.orb.app.ui.island.IslandBlock
import androidx.compose.ui.graphics.luminance
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
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.ui.text.LinkInteractionListener
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
import androidx.compose.ui.draw.drawWithContent
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
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.kit.OrbAuthor
import dev.orb.app.ui.kit.OrbBadge
import dev.orb.app.ui.kit.OrbBadgeKind
import dev.orb.app.ui.kit.OrbBubble
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbChip
import dev.orb.app.ui.kit.OrbDelivery
import dev.orb.app.ui.kit.OrbDialog
import dev.orb.app.ui.kit.OrbDialogAction
import dev.orb.app.ui.kit.OrbDeliveryMark
import dev.orb.app.ui.kit.OrbIconButton
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbMessageText
import dev.orb.app.ui.kit.OrbNote
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbSheetItem
import dev.orb.app.ui.kit.OrbTaskCard
import dev.orb.app.ui.kit.OrbThinking
import androidx.compose.foundation.layout.fillMaxSize
import dev.orb.app.ui.theme.OrbMotion
import dev.orb.app.ui.theme.OrbTheme

// ---------- Markdown ----------

/** Opens an http, https or mailto link; any failure (no app to handle it, a bad address) is swallowed instead of closing the app. */
internal fun openSafeLink(context: android.content.Context, url: String) {
    val target = safeLink(url) ?: return
    try {
        context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(target)).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: Exception) {
    }
}

/** Where the text of the last block ended up on screen, kept out of state so drawing the cursor never recomposes. */
private class CaretHolder { var layout: androidx.compose.ui.text.TextLayoutResult? = null }

/** The writing cursor of the answer being streamed: a 2 dp bar at the end of the text, drawn over it (no text is added). */
private fun Modifier.endCaret(holder: CaretHolder, ink: androidx.compose.ui.graphics.Color) = drawWithContent {
    drawContent()
    val l = holder.layout ?: return@drawWithContent
    val r = l.getCursorRect(l.layoutInput.text.length)
    drawRect(ink, androidx.compose.ui.geometry.Offset(r.left, r.top), androidx.compose.ui.geometry.Size(2.dp.toPx(), r.height))
}

@Composable
private fun spansToText(spans: List<Span>): AnnotatedString {
    val scheme = MaterialTheme.colorScheme
    val link = scheme.primary
    val codeBg = scheme.surfaceContainerHigh
    val context = androidx.compose.ui.platform.LocalContext.current
    return remember(spans, link, codeBg, context) {
        buildAnnotatedString {
            for (s in spans) {
                val style = SpanStyle(
                    fontWeight = if (s.bold) FontWeight.Bold else null,
                    fontStyle = if (s.italic) FontStyle.Italic else null,
                    fontFamily = if (s.code) FontFamily.Monospace else null,
                    fontSize = if (s.code) 13.sp else TextStyle.Default.fontSize,
                    background = if (s.code) codeBg else androidx.compose.ui.graphics.Color.Unspecified,
                )
                val target = safeLink(s.link)
                if (target != null) {
                    val open = LinkInteractionListener { openSafeLink(context, target) }
                    withLink(LinkAnnotation.Clickable("link", TextLinkStyles(SpanStyle(color = link, textDecoration = TextDecoration.Underline)), open)) {
                        withStyle(style) { append(s.text) }
                    }
                } else withStyle(style) { append(s.text) }
            }
        }
    }
}

/** A message body as light Markdown. [blocks] is parsed by the caller so it can be remembered per message. */
@Composable
fun MarkdownBody(blocks: List<MdBlock>, modifier: Modifier = Modifier, caret: Boolean = false) {
    val scheme = MaterialTheme.colorScheme
    val holder = remember { CaretHolder() }
    // 15 sp on 1.5 lines, the same as the person's own bubble.
    val body = MaterialTheme.typography.bodyLarge.copy(fontSize = 15.sp, lineHeight = 22.5.sp)
    val ink = OrbKit.foreground
    // The cursor sits at the end of the last line of text, whatever block that is.
    val last = if (caret) blocks.indexOfLast { it is MdBlock.Paragraph || it is MdBlock.Heading || it is MdBlock.Item || it is MdBlock.Quote } else -1
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for ((i, b) in blocks.withIndex()) when (b) {
            is MdBlock.Paragraph -> Text(
                spansToText(b.spans), Modifier.then(if (i == last) Modifier.endCaret(holder, ink) else Modifier), style = body,
                onTextLayout = { if (i == last) holder.layout = it },
            )
            is MdBlock.Heading -> Text(
                spansToText(b.spans), Modifier.then(if (i == last) Modifier.endCaret(holder, ink) else Modifier), fontWeight = FontWeight.SemiBold,
                onTextLayout = { if (i == last) holder.layout = it },
                style = if (b.level <= 2) MaterialTheme.typography.titleMedium else MaterialTheme.typography.titleSmall,
            )
            is MdBlock.Item -> Row(Modifier.padding(start = (12 * b.depth).dp)) {
                Text(if (b.number != null) "${b.number}." else "•", Modifier.widthIn(min = 20.dp), color = OrbTheme.colors.text2, style = body)
                Text(
                    spansToText(b.spans), Modifier.then(if (i == last) Modifier.endCaret(holder, ink) else Modifier), style = body,
                    onTextLayout = { if (i == last) holder.layout = it },
                )
            }
            is MdBlock.Quote -> Row(Modifier.fillMaxWidth().padding(start = 2.dp)) {
                Box(Modifier.padding(end = 10.dp).size(3.dp, 20.dp).background(scheme.outline, RoundedCornerShape(2.dp)))
                Text(
                    spansToText(b.spans), Modifier.then(if (i == last) Modifier.endCaret(holder, ink) else Modifier), style = body,
                    color = OrbTheme.colors.text2, onTextLayout = { if (i == last) holder.layout = it },
                )
            }
            is MdBlock.Code -> if (b.rich != null) {
                IslandBlock(b.rich, b.text, dark = scheme.background.luminance() < 0.5f) { CodeBlock(b) }
            } else CodeBlock(b)
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

private fun timeOf(at: String?, now: Long) = ChatTime.short(at, now)

/** One line of the conversation. Rows are cheap: the parsed Markdown is remembered per message. */
@Composable
fun MessageRow(
    item: ChatItem.Msg, state: OrbeChatState, now: Long, actions: CardActions, modifier: Modifier = Modifier,
    draft: AnswerDraft = remember { AnswerDraft() },
) {
    val m = item.message
    when (m.role) {
        // A line that came back from the PC is saved there: two ticks.
        MsgRole.User -> UserBubble(m.body, timeOf(m.at, now), modifier, delivery = OrbDelivery.Saved)
        MsgRole.Orbe -> OrbeMessage(m, state, actions, draft, modifier)
        MsgRole.System -> SystemMessage(m, state, actions, modifier)
    }
}

/**
 * The person's message. With a [delivery] the time and the ticks sit inside the bubble; without one (a conversation
 * that keeps no ticks) the time goes under it. [status] replaces both, for messages that have not arrived.
 */
@Composable
fun UserBubble(
    text: String, time: String, modifier: Modifier = Modifier, delivery: OrbDelivery? = null,
    status: (@Composable ColumnScope.() -> Unit)? = null,
) {
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
        OrbBubble {
            OrbMessageText(text)
            if (delivery != null) OrbDeliveryMark(time, delivery, Modifier.align(Alignment.End).padding(top = 2.dp))
        }
        if (status != null) status() else if (delivery == null && time.isNotEmpty()) OrbNote(time, Modifier.padding(top = 2.dp, end = 4.dp))
    }
}

@Composable
private fun OrbeMessage(m: ChatMessage, state: OrbeChatState, actions: CardActions, draft: AnswerDraft, modifier: Modifier) {
    val blocks = remember(m.id, m.body) { LightMarkdown.parse(m.body) }
    val card = m.card
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (card is MsgCard.Question) QuestionHeader(m, card, state, actions) else OrbAuthor("orbe", "Orbe")
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (card is MsgCard.Question) {
                QuestionCard(m, card, state.online, m.id in state.busyCards, actions, draft)
            } else {
                MarkdownBody(blocks)
                if (card is MsgCard.Report) ReportCard(m, card, state.online, m.id in state.busyCards, actions)
            }
        }
    }
}

@Composable
private fun SystemMessage(m: ChatMessage, state: OrbeChatState, actions: CardActions, modifier: Modifier) {
    when (val card = m.card) {
        is MsgCard.Permission -> PermissionCard(m, card, state.online, m.id in state.busyCards, actions, modifier)
        is MsgCard.TaskAttention -> TaskCard(m, card.task, state, actions, modifier, attention = true)
        // A task with no card of its own in the thread gets one when it ends; otherwise its card already says how it ended.
        is MsgCard.TaskEnd ->
            if (m.task != null && m.task !in state.attentionTasks) TaskCard(m, m.task, state, actions, modifier, result = card.result)
            else NoteLine(m.body, modifier, fold = card.result.ifBlank { null })
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

/**
 * A message that has not been saved by the PC yet. Queued, it says what will happen given the state of the link (it
 * never promises a send that cannot happen); handed over, it carries one tick; refused, it stays here to retry or discard.
 */
@Composable
fun PendingRow(
    p: PendingMessage, online: Boolean, onRetry: () -> Unit, onDiscard: () -> Unit, modifier: Modifier = Modifier,
    connection: ConnectionState? = null,
) {
    val time = remember(p.at) { if (p.at > 0) ChatTime.clock(p.at) else "" }
    if (p.state == PendingState.Arrived) {
        UserBubble(p.text, time, modifier, delivery = OrbDelivery.Arrived)
        return
    }
    UserBubble(
        p.text, time, modifier,
        status = {
            if (p.state == PendingState.Failed) {
                Column(Modifier.padding(top = 4.dp, end = 2.dp), horizontalAlignment = Alignment.End) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Icon(OrbIcons.CircleAlert, null, Modifier.size(14.dp), tint = OrbKit.destructive)
                        Text(ChatTexts.pendingFailed(p.error), color = OrbKit.destructive, fontSize = 12.sp, lineHeight = 16.sp)
                    }
                    Text(ChatTexts.PENDING_KEPT, color = OrbKit.mutedForeground, fontSize = 12.sp, lineHeight = 16.sp)
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        OrbButton(ChatTexts.RETRY, onRetry, small = true)
                        OrbButton(ChatTexts.PENDING_DISCARD, onDiscard, kind = OrbButtonKind.Ghost, small = true)
                    }
                }
            } else {
                val held = !online && p.state == PendingState.Waiting
                Row(Modifier.padding(top = 4.dp, end = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (time.isNotEmpty()) OrbNote(time)
                    OrbBadge(
                        if (held) ChatTexts.pendingLine(connection) else ChatTexts.PENDING_SENDING,
                        kind = if (held) OrbBadgeKind.Warn else OrbBadgeKind.Neutral, icon = OrbIcons.Clock,
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
fun LiveBubble(info: LiveInfo, text: () -> String, modifier: Modifier = Modifier) {
    val body = text()
    val blocks = remember(body) { if (body.isEmpty()) emptyList() else LightMarkdown.parse(body) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (blocks.isNotEmpty()) {
            OrbAuthor("orbe", "Orbe")
            MarkdownBody(blocks, caret = true)
        }
        if (info.waiting && !info.busy) {
            Text(ChatTexts.WAITING_TURN, color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodyMedium)
        } else {
            // The caret already says the text is arriving; the dots are for what is not visible (a tool, the first token).
            if (info.activity != null || !info.hasText) OrbThinking(info.activity ?: ChatTexts.THINKING)
        }
    }
}

// ---------- Cards ----------

/** What the cards can ask for; wired to the view model by the screen, to a recorder in tests. */
class CardActions(
    val answer: (ChatMessage, List<String>, String?, Boolean) -> Unit,
    val accept: (ChatMessage) -> Unit,
    val decideRequest: (ChatMessage, String) -> Unit,
    /** «Rechazar»: the screen confirms before the task is cancelled. */
    val reject: (Long) -> Unit,
    val watchTask: (Long) -> Unit,
    val acceptTask: (Long) -> Unit,
    /** «Deshacer»: the screen confirms before the files of the PC are touched. */
    val undoTask: (Long) -> Unit,
    val openChanges: (Long) -> Unit,
    /** The task's own screen: where a card that cannot show everything sends the person. */
    val openTask: (Long) -> Unit = {},
)

@Composable
internal fun CardFrame(modifier: Modifier = Modifier, warn: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
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

/** Who asks: the agent running the task the question belongs to, else Orbe; never a name the message does not carry. */
internal fun questionAsker(m: ChatMessage, state: OrbeChatState): Pair<String, String> {
    val agent = m.task?.let { state.taskInfo[it] }?.let { it.runner ?: it.agent }?.takeIf { it.isNotBlank() && it != "any" }
    return if (agent == null) "orbe" to "Orbe" else agent to (agentName(agent) ?: agent)
}

/** `.who` of a question: «✳ Claude pregunta» and, while it is open, its «⋯» with what the PC lets the person do besides answering. */
@Composable
private fun QuestionHeader(m: ChatMessage, q: MsgCard.Question, state: OrbeChatState, actions: CardActions) {
    val (agent, name) = questionAsker(m, state)
    var menu by rememberSaveable(m.id) { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        OrbAuthor(agent, ChatTexts.asks(name), Modifier.weight(1f))
        if (q.pending) OrbIconButton(OrbIcons.MoreVertical, ChatTexts.MORE, { menu = true })
    }
    if (menu) OrbSheet(onDismiss = { menu = false }) {
        OrbSheetItem(
            ChatTexts.ANSWER_SKIP, { menu = false; actions.answer(m, emptyList(), null, true) }, icon = OrbIcons.SkipForward,
            enabled = state.online && m.id !in state.busyCards, meta = if (state.online) null else ChatTexts.NEEDS_PC,
        )
    }
}

/** The agent's question and its options as chips. Answered, it closes into one line. */
@Composable
fun QuestionCard(m: ChatMessage, q: MsgCard.Question, online: Boolean, sending: Boolean, actions: CardActions, draft: AnswerDraft = remember { AnswerDraft() }) {
    AnimatedContent(
        q.pending, label = "question",
        transitionSpec = { (fadeIn(tween(OrbMotion.Medium)) + slideInVertically(OrbMotion.standard()) { it / 8 }) togetherWith fadeOut(tween(OrbMotion.Fast)) },
    ) { pending ->
        if (pending) OpenQuestion(m, q, online, sending, actions, draft) else ClosedQuestion(q)
    }
}

/**
 * The question as the mockup draws it: the text and one chip per option, then «Otra respuesta…». A question that takes one
 * answer is answered by tapping its chip; one that takes several, or the person's own words, is answered from the writing box.
 */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun OpenQuestion(m: ChatMessage, q: MsgCard.Question, online: Boolean, sending: Boolean, actions: CardActions, draft: AnswerDraft) {
    val mine = draft.question == m.id
    val limit = if (q.multi) 4 else 1
    val enabled = online && !sending
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (!q.header.isNullOrBlank()) Text(q.header, color = OrbKit.mutedForeground, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium)
        OrbMessageText(q.question.ifBlank { m.body })
        androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (o in q.options) {
                val on = mine && o.label in draft.picked
                OrbChip(o.label, on, {
                    if (!enabled) return@OrbChip
                    if (!q.multi) { actions.answer(m, listOf(o.label), null, false); return@OrbChip }
                    draft.take(m.id)
                    if (on) draft.picked.remove(o.label) else if (draft.picked.size < limit) draft.picked.add(o.label)
                    if (draft.picked.isNotEmpty()) draft.typing = false
                })
            }
            OrbChip(ChatTexts.ANSWER_OTHER_CHIP, mine && draft.typing, {
                if (!enabled) return@OrbChip
                draft.take(m.id)
                draft.typing = !draft.typing
                if (draft.typing) draft.picked.clear()
            })
        }
        // What an option means, for the ones the person has chosen: the chips keep to a word.
        if (mine) for (o in q.options) if (o.label in draft.picked && !o.description.isNullOrBlank()) {
            Text(o.description, color = OrbKit.mutedForeground, fontSize = 12.sp, lineHeight = 16.sp)
        }
        if (q.multi && !mine) Text(ChatTexts.ANSWER_MANY_HINT, color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp)
        if (!online) Text(ChatTexts.NEEDS_PC_TO_ANSWER, color = OrbKit.mutedForeground, fontSize = 12.sp, lineHeight = 16.sp)
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

/** An agent asks to run something: «Denegar», «Permitir» or «Permitir siempre aquí». */
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
            // Same layout as the direct chat: the main action on the right, «always» apart so it is never hit by mistake.
            val enabled = online && !sending
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                OutlinedButton({ actions.decideRequest(m, "deny") }, Modifier.weight(1f).heightIn(min = 48.dp), enabled = enabled) { Text(ChatTexts.DENY) }
                Button({ actions.decideRequest(m, "allow") }, Modifier.weight(1f).heightIn(min = 48.dp), enabled = enabled) { Text(ChatTexts.PERMIT) }
            }
            TextButton({ actions.decideRequest(m, "always") }, Modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = enabled) { Text(ChatTexts.PERMIT_ALWAYS) }
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

/** How a task's card is drawn now: asking for the OK, held for review, folded to one line after the answer, or by its state. */
private enum class TaskCardKind { Waiting, Held, Approved, Rejected, Accepted, Plain, Neutral }

/**
 * A task of the thread, as the PC describes it. Waiting for the OK it shows what is approved (the description, who runs it, the
 * folder and why it asks) and «Aprobar» sends the fingerprint of exactly that; held, it says why Orb stopped it and only offers
 * to look; finished, it counts what it changed and offers «Cambios», «Deshacer» and «Aceptar» where the PC allows them.
 * [attention] is a card the PC raised for a task that needs the person; without data any other card is neutral.
 */
@Composable
private fun TaskCard(m: ChatMessage, task: Long, state: OrbeChatState, actions: CardActions, modifier: Modifier, result: String? = null, attention: Boolean = false) {
    androidx.compose.runtime.LaunchedEffect(task) { actions.watchTask(task) }
    val info = state.taskInfo[task]
    val status = info?.status ?: state.taskStatus[task]
    val kind = when {
        // «Espera tu OK» only when the PC said so; an attention card the PC raised may wait for its first answer.
        status == "awaiting_approval" || (attention && info == null && status == null) -> TaskCardKind.Waiting
        info == null && status == null -> TaskCardKind.Neutral
        info?.held == true -> TaskCardKind.Held
        status == "cancelled" && info?.decision == "rejected" -> TaskCardKind.Rejected
        (status == "queued" || status == "running") && info?.decision == "approved" -> TaskCardKind.Approved
        status == "done" && info?.accepted == true -> TaskCardKind.Accepted
        else -> TaskCardKind.Plain
    }
    val busy = -task in state.busyCards
    Column(modifier.fillMaxWidth().animateContentSize(OrbMotion.standard()), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        AnimatedContent(
            kind, label = "task-card",
            transitionSpec = { fadeIn(tween(OrbMotion.Medium, easing = OrbMotion.EaseOut)) togetherWith fadeOut(tween(OrbMotion.Fast)) },
        ) { k ->
            when (k) {
                TaskCardKind.Waiting -> WaitingCard(m, task, info, state, busy, actions)
                TaskCardKind.Held -> if (info != null) HeldCard(task, info, actions)
                TaskCardKind.Neutral -> OrbTaskCard(
                    title = m.body.removePrefix("⚠️").trim().ifBlank { ChatTexts.taskTitle(task, null) }, badge = ChatTexts.TASK_ENDED_BADGE, titleMaxLines = Int.MAX_VALUE,
                    footer = { OrbButton(ChatTexts.TASK_SEE_TASK, { actions.openTask(task) }) },
                )
                TaskCardKind.Approved -> {
                    val (badge, bk) = taskBadge(status)
                    OrbTaskCard(ChatTexts.taskApproved(task), badge, badgeKind = bk, icon = OrbIcons.CircleCheck)
                }
                TaskCardKind.Rejected -> OrbTaskCard(ChatTexts.taskRejected(task), ChatTexts.TASK_REJECTED_BADGE, badgeKind = OrbBadgeKind.Err, icon = OrbIcons.CircleX)
                TaskCardKind.Accepted -> OrbTaskCard(ChatTexts.taskAccepted(task), ChatTexts.TASK_ACCEPTED_BADGE, badgeKind = OrbBadgeKind.Ok, icon = OrbIcons.CircleCheck)
                TaskCardKind.Plain -> PlainCard(task, info, status, state, busy, actions)
            }
        }
        // The line that came with the message, which the PC already cleaned of secrets, not the raw result of the task.
        result?.takeIf { it.isNotBlank() }?.let { ResultFold(it) }
    }
}

/**
 * Everything the OK is about, none of it cut: why it asks first, then what the task will do, who runs it and where. These are
 * the fields the PC's fingerprint covers; the task's own screen is the only place that draws them, so nothing is shortened.
 */
@Composable
internal fun ApprovalFacts(d: TaskDetail) {
    if (d.reasons.isNotEmpty()) Text(ChatTexts.asksBecause(d.reasons), color = OrbKit.warning, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold)
    if (!d.description.isNullOrBlank()) Text(d.description.trim(), color = OrbKit.foreground, fontSize = 13.sp, lineHeight = 18.sp)
    // The phone shortens the paths of Orb's own folder in the text it gets, so what is read here is not letter for letter what the OK covers.
    if (d.descriptionCut) Text(ChatTexts.DESCRIPTION_CUT_NOTE, color = OrbKit.warning, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold)
    if (d.userAsked.isNotEmpty()) {
        Text(ChatTexts.USER_ASKED_LABEL, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold)
        for (u in d.userAsked) Text(u, color = OrbKit.foreground, fontSize = 13.sp, lineHeight = 18.sp)
    }
    val who = d.agent?.takeIf { it.isNotBlank() }?.let { if (it == "any") ChatTexts.AGENT_ANY else agentName(it) ?: it }
    if (who != null) Text(ChatTexts.approvalWho(who, d.model, d.reasoning, d.fast, d.mode, d.readonly, d.autonomy), color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp)
    if (d.folderChanged) Text(ChatTexts.FOLDER_CHANGED_NOTE, color = OrbKit.warning, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold)
    if (!d.folderShown.isNullOrBlank()) Text(d.folderShown!!, color = OrbKit.mutedForeground, fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 16.sp)
    if (d.folderOutside) Text(ChatTexts.FOLDER_OUTSIDE_NOTE, color = OrbKit.warning, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold)
}

/**
 * «Espera tu OK» as the mockup draws it: a compact card with the fingerprint of what is asked on one line. It never approves:
 * «Ver y aprobar» opens the task, where everything the PC's fingerprint covers is shown whole and the OK is given with it.
 * «Rechazar» stays here and asks for confirmation first.
 */
@Composable
private fun WaitingCard(m: ChatMessage, task: Long, info: TaskDetail?, state: OrbeChatState, busy: Boolean, actions: CardActions) {
    val body = m.body.removePrefix("⚠️").trim()
    val named = !info?.title.isNullOrBlank()
    // Under Auto a task that still asks is one the PC found delicate.
    val delicate = state.mode == "auto" && info?.reasons?.isNotEmpty() == true
    val who = info?.agent?.takeIf { it != "any" }
    OrbTaskCard(
        title = if (named) ChatTexts.taskTitle(task, info?.title) else body, titleMaxLines = 2,
        badge = if (delicate) ChatTexts.TASK_SENSITIVE else ChatTexts.taskStatus("awaiting_approval"), badgeKind = OrbBadgeKind.Warn,
        agent = who,
        line = if (info != null && named) {
            ChatTexts.approvalLine(who?.let { agentName(it) ?: it }, null, info.folderShown?.let(::lastFolder), info.reasons).ifBlank { null }
        } else body,
        lineMaxLines = 2,
        footer = {
            val enabled = state.online && !busy
            if (!state.online) Text(ChatTexts.NEEDS_PC_TO_ANSWER, Modifier.weight(1f), color = OrbKit.mutedForeground, fontSize = 12.sp, lineHeight = 16.sp)
            OrbButton(ChatTexts.REJECT, { actions.reject(task) }, enabled = enabled)
            OrbButton(ChatTexts.SEE_AND_APPROVE, { actions.openTask(task) }, kind = OrbButtonKind.Primary)
        },
    )
}

/** The last name of a folder path (`app-movil` of `C:\work\app-movil`), the way the mockup names the project. */
private fun lastFolder(path: String): String = path.trimEnd('/', '\\').substringAfterLast('/').substringAfterLast('\\').ifBlank { path }

/**
 * A task Orb stopped after it ran. The reason is on the card, and the only way forward is to look: «Aceptar» there would keep
 * the work and free the tasks waiting for it, so it (and «Deshacer») live on the changes screen, with the PC's own recheck.
 */
@Composable
private fun HeldCard(task: Long, info: TaskDetail, actions: CardActions) {
    val canSee = dev.orb.app.ui.tasks.TaskAction.SeeChanges in info.actions
    OrbTaskCard(
        title = ChatTexts.taskTitle(task, info.title.ifBlank { null }), titleMaxLines = Int.MAX_VALUE,
        badge = ChatTexts.TASK_HELD_BADGE, badgeKind = OrbBadgeKind.Warn, agent = (info.runner ?: info.agent)?.takeIf { it != "any" },
        body = {
            Text(dev.orb.app.ui.tasks.TaskTexts.heldLine(info.heldReasons, info.heldFolder), color = OrbKit.warning, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold)
        },
        footer = {
            if (canSee) OrbButton(ChatTexts.TASK_SEE_CHANGES, { actions.openChanges(task) }) else OrbButton(ChatTexts.TASK_SEE_TASK, { actions.openTask(task) })
        },
    )
}

@Composable
private fun PlainCard(task: Long, info: TaskDetail?, status: String?, state: OrbeChatState, busy: Boolean, actions: CardActions) {
    val named = !info?.title.isNullOrBlank()
    val undone = info?.undone == true
    val (badge, bk) = if (undone) ChatTexts.TASK_UNDONE_BADGE to OrbBadgeKind.Neutral else taskBadge(status)
    val stat = state.taskStat[task]
    val granted = info?.actions.orEmpty()
    val canSee = dev.orb.app.ui.tasks.TaskAction.SeeChanges in granted
    val canUndo = dev.orb.app.ui.tasks.TaskAction.UndoHeld in granted
    val canAccept = dev.orb.app.ui.tasks.TaskAction.AcceptHeld in granted
    val autoPassed = info != null && info.autonomy == "auto" && info.approvalRequired == false && (status == "queued" || status == "running")
    val green = OrbKit.success
    val red = OrbKit.destructive
    val rich = if (status == "done" && !undone && info != null) doneLine(info, stat, green, red) else null
    val who = info?.let { it.runner ?: it.agent }?.takeIf { it != "any" }
    OrbTaskCard(
        title = if (named) ChatTexts.taskTitle(task, info?.title) else ChatTexts.taskTitle(task, null), badge = badge, badgeKind = bk, agent = who,
        line = if (rich != null || undone) null else if (autoPassed) ChatTexts.TASK_AUTO_PASSED else who?.let { agentName(it) ?: it },
        lineRich = rich,
        footer = if (!undone && (canSee || canUndo || canAccept)) {
            {
                val enabled = state.online && !busy
                if (canSee) OrbButton(ChatTexts.TASK_CHANGES, { actions.openChanges(task) })
                if (canUndo) OrbButton(ChatTexts.TASK_UNDO, { actions.undoTask(task) }, enabled = enabled)
                if (canAccept) OrbButton(ChatTexts.TASK_ACCEPT, { actions.acceptTask(task) }, kind = OrbButtonKind.Primary, enabled = enabled)
            }
        } else null,
    )
}

/** «3 archivos · +42 −7 · revisada por Claude»: only the parts the PC gave. */
private fun doneLine(info: TaskDetail, stat: TaskStat?, green: androidx.compose.ui.graphics.Color, red: androidx.compose.ui.graphics.Color): androidx.compose.ui.text.AnnotatedString? {
    val review = info.reviewAgent?.takeIf { it.isNotBlank() }?.let { ChatTexts.reviewedBy(agentName(it) ?: it) }
    if (stat == null && review == null) return null
    return buildAnnotatedString {
        var first = true
        fun sep() { if (!first) append(" · "); first = false }
        if (stat != null) {
            sep(); append(ChatTexts.taskFiles(stat.files))
            if (stat.added != null && stat.removed != null) {
                sep()
                withStyle(SpanStyle(color = green)) { append("+${stat.added}") }
                append(" ")
                withStyle(SpanStyle(color = red)) { append("−${stat.removed}") }
            }
        }
        if (review != null) { sep(); append(review) }
    }
}

/** The task's own result, folded under its card. */
@Composable
private fun ResultFold(result: String) {
    var open by rememberSaveable(result) { mutableStateOf(false) }
    Text(
        if (open) ChatTexts.HIDE_DETAILS else ChatTexts.SEE_RESULT,
        Modifier.clickable(role = Role.Button) { open = !open }.heightIn(min = 48.dp).padding(horizontal = 4.dp).wrapContentHeight(Alignment.CenterVertically),
        color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium,
    )
    AnimatedVisibility(open, enter = expandVertically(OrbMotion.standard()) + fadeIn(), exit = shrinkVertically(OrbMotion.standard()) + fadeOut()) {
        Text(result, Modifier.padding(horizontal = 4.dp), color = OrbTheme.colors.text2, style = MaterialTheme.typography.bodySmall)
    }
}

private fun taskBadge(status: String?): Pair<String, OrbBadgeKind> = when (status) {
    "awaiting_approval", null -> ChatTexts.taskStatus("awaiting_approval") to OrbBadgeKind.Warn
    "running" -> ChatTexts.TASK_RUNNING to OrbBadgeKind.Acc
    "done" -> ChatTexts.TASK_DONE to OrbBadgeKind.Ok
    "failed" -> ChatTexts.taskStatus(status) to OrbBadgeKind.Err
    "blocked" -> ChatTexts.taskStatus(status) to OrbBadgeKind.Warn
    else -> ChatTexts.taskStatus(status) to OrbBadgeKind.Neutral
}

/** A task of this conversation that is running now, as the PC reports it: who is on it and what they are doing. */
@Composable
fun LiveTaskCard(t: LiveTask, modifier: Modifier = Modifier) {
    OrbTaskCard(
        title = ChatTexts.taskTitle(t.id, t.title),
        badge = if (t.waiting) ChatTexts.TASK_WAITING_PERMISSION else ChatTexts.TASK_RUNNING,
        badgeKind = if (t.waiting) OrbBadgeKind.Warn else OrbBadgeKind.Acc,
        modifier = modifier, agent = t.agent, working = !t.waiting,
        line = ChatTexts.taskLiveLine(agentName(t.agent) ?: t.agent, t.doing, t.percent).ifEmpty { null },
    )
}

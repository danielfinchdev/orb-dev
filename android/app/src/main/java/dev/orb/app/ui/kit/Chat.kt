package dev.orb.app.ui.kit

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.theme.OrbMotion
import kotlin.math.PI
import kotlin.math.sin

// The pieces of a chat screen (the mockups' `.me`, `.who`, `.mturn`, `.thinking`, `.ctxbar`, `.mcomp`, `.send`), shared by
// the Orbe chat and the direct chat so both draw the same conversation.

/**
 * `.me`: the person's own message, in a bubble on the right that takes at most 84 % of the width. [content] holds the
 * text and, below it, the delivery mark.
 */
@Composable
fun OrbBubble(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Spacer(Modifier.weight(0.16f))
        Column(
            Modifier.weight(0.84f, fill = false).clip(RadiusBig).background(OrbKit.bubble).padding(horizontal = 14.dp, vertical = 9.dp),
            content = content,
        )
    }
}

/** The text of a bubble or of a message of the assistant: 15 sp on 1.5 lines. */
@Composable
fun OrbMessageText(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier, color = OrbKit.foreground, fontSize = 15.sp, lineHeight = 22.5.sp)
}

/** `.who`: the mark and the name over a message of an agent. */
@Composable
fun OrbAuthor(agent: String?, name: String, modifier: Modifier = Modifier, time: String? = null) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        AgentMark(agent, size = 16.dp, description = null)
        Text(name, color = OrbKit.foreground, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium)
        if (!time.isNullOrEmpty()) Text(time, color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp)
    }
}

/** How far a message of the person has got, in the order it happens. */
enum class OrbDelivery {
    /** On the phone, waiting for the link. */
    Queued,

    /** The phone is handing it to the PC. */
    Sending,

    /** The PC took it (✓). */
    Arrived,

    /** The PC has it saved in the conversation (✓✓). */
    Saved,
}

/** `.note-s` under a message: the time and one tick when the PC took it, two when it is saved there. */
@Composable
fun OrbDeliveryMark(time: String, delivery: OrbDelivery, modifier: Modifier = Modifier) {
    val saved = delivery == OrbDelivery.Saved
    val said = if (saved) "Guardado en el PC" else "Enviado"
    Row(
        modifier.clearAndSetSemantics { contentDescription = if (time.isEmpty()) said else "$time, $said" },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (time.isNotEmpty()) Text(time, color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp)
        Icon(if (saved) OrbIcons.CheckCheck else OrbIcons.Check, null, Modifier.size(14.dp), tint = OrbKit.faintForeground)
    }
}

/** `.thinking`: three bobbing dots and what the assistant is doing («Pensando…»). */
@Composable
fun OrbThinking(text: String, modifier: Modifier = Modifier) {
    val still = reducedMotion()
    val clock = if (still) null else rememberInfiniteTransition(label = "thinking").animateFloat(
        0f, 1000f, infiniteRepeatable(tween(1000, easing = LinearEasing), RepeatMode.Restart), label = "t",
    )
    Row(
        modifier.semantics { liveRegion = LiveRegionMode.Polite }, verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        for (i in 0..2) {
            Box(
                Modifier.size(6.dp).graphicsLayer {
                    // bob: up 3 px and half faded at the middle of the second, each dot 150 ms after the one before
                    val phase = (((clock?.value ?: 0f) - i * 150f) / 1000f).let { it - kotlin.math.floor(it) }
                    val wave = if (clock == null) 0f else sin(PI * phase).toFloat()
                    translationY = -3.dp.toPx() * wave
                    alpha = 1f - 0.5f * wave
                }.clip(CircleShape).background(OrbKit.mutedForeground).clearAndSetSemantics {},
            )
        }
        Text(text, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp)
    }
}

/**
 * `.mturn`: a task in the conversation. The header names it with [badge] for its state; [line] (monospace) says what
 * it is doing now, with a turning mark while [working]; [footer] holds its buttons. [icon] replaces the agent's mark in the
 * header (a task folded to one line); [lineRich] is a [line] with parts in colour (the counts of a finished task).
 */
@Composable
fun OrbTaskCard(
    title: String,
    badge: String,
    modifier: Modifier = Modifier,
    badgeKind: OrbBadgeKind = OrbBadgeKind.Neutral,
    agent: String? = null,
    line: String? = null,
    working: Boolean = false,
    lineMaxLines: Int = 1,
    icon: ImageVector? = null,
    lineRich: androidx.compose.ui.text.AnnotatedString? = null,
    footer: (@Composable RowScope.() -> Unit)? = null,
    /** Free content between the header (or [line]) and the footer: what a permission asks for, its reason, its details. */
    body: (@Composable ColumnScope.() -> Unit)? = null,
) {
    Column(modifier.fillMaxWidth().clip(RadiusCard).background(OrbKit.card).border(1.dp, OrbKit.border, RadiusCard)) {
        Column(Modifier.semantics(mergeDescendants = true) {}) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (icon != null) Icon(icon, null, Modifier.size(16.dp), tint = OrbKit.foreground)
                else if (agent != null) AgentMark(agent, size = 16.dp, description = null)
                Text(title, Modifier.weight(1f), color = OrbKit.foreground, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                OrbBadge(badge, kind = badgeKind)
            }
            if (line != null || lineRich != null) {
                Box(Modifier.fillMaxWidth().height(1.dp).background(OrbKit.border))
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (working) OrbSpinner(size = 12.dp)
                    if (lineRich != null) Text(
                        lineRich, Modifier.weight(1f), color = OrbKit.foreground, fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 16.sp,
                        maxLines = lineMaxLines, overflow = TextOverflow.Ellipsis,
                    ) else Text(
                        line.orEmpty(), Modifier.weight(1f), color = OrbKit.foreground, fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 16.sp,
                        maxLines = lineMaxLines, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        if (body != null) {
            Box(Modifier.fillMaxWidth().height(1.dp).background(OrbKit.border))
            Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp), content = body)
        }
        if (footer != null) {
            Box(Modifier.fillMaxWidth().height(1.dp).background(OrbKit.border))
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically, content = footer,
            )
        }
    }
}

/**
 * `.ctxbar`: a quiet line over the box («1 en cola»). [onEdit] non-null adds «Editar», for the screens whose PC can
 * change the queue.
 */
@Composable
fun OrbQueueBar(text: String, modifier: Modifier = Modifier, onEdit: (() -> Unit)? = null, editLabel: String = "Editar") {
    Row(
        modifier.fillMaxWidth().heightIn(min = 24.dp).padding(start = 18.dp, end = if (onEdit != null) 10.dp else 18.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(OrbIcons.ListEnd, null, Modifier.size(16.dp), tint = OrbKit.mutedForeground)
        Text(text, Modifier.weight(1f), color = OrbKit.mutedForeground, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (onEdit != null) OrbButton(editLabel, onEdit, kind = OrbButtonKind.Ghost, small = true)
    }
}

/**
 * `.ctxbar` with a quiet action at its end («Contexto 62 %  ⎇ Bifurcar»): [text] on the left and, when [action] is given, an
 * icon with its label that [onAction] runs. [enabled] false dims the action and takes it out of reach.
 */
@Composable
fun OrbContextBar(
    text: String, modifier: Modifier = Modifier, action: String? = null, actionIcon: ImageVector? = null, onAction: (() -> Unit)? = null,
    enabled: Boolean = true,
) {
    Row(
        modifier.fillMaxWidth().heightIn(min = 24.dp).padding(start = 18.dp, end = if (action != null) 6.dp else 18.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(text, Modifier.weight(1f), color = OrbKit.mutedForeground, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (action != null) {
            val tone = if (enabled) OrbKit.mutedForeground else OrbKit.mutedForeground.copy(alpha = 0.45f)
            // 48 dp tall to touch, drawn like the 12 sp line of the mockup
            Row(
                Modifier.heightIn(min = 48.dp).clip(RadiusCtl).clickable(enabled = enabled && onAction != null, role = Role.Button, onClick = { onAction?.invoke() })
                    .padding(horizontal = 10.dp).semantics { if (!enabled) disabled() },
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (actionIcon != null) Icon(actionIcon, null, Modifier.size(16.dp), tint = tone)
                Text(action, color = tone, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 1)
            }
        }
    }
}

/** `.mcomp`: the frame of the writing box: a 10 % outline, the card colour, a soft shadow and 18 dp corners. */
@Composable
fun OrbComposerFrame(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxWidth().padding(start = 10.dp, end = 10.dp, bottom = 6.dp)
            .shadow(2.dp, RadiusBig, ambientColor = Color.Black.copy(alpha = 0.10f), spotColor = Color.Black.copy(alpha = 0.10f))
            .clip(RadiusBig).background(OrbKit.card).border(1.dp, OrbKit.foreground.copy(alpha = 0.10f), RadiusBig)
            .padding(start = 14.dp, end = 10.dp, top = 10.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp), content = content,
    )
}

/** `.mcomp .lab`: a quiet label of the box's bottom row (permissions, brain). [onClick] null makes it plain text. */
@Composable
fun OrbComposerLabel(
    text: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    chevron: Boolean = false,
    onClick: (() -> Unit)? = null,
    description: String? = null,
) {
    val tap = if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier
    // 32 dp inside a 48 dp touch height when it can be tapped
    Box(modifier.then(if (onClick != null) Modifier.heightIn(min = 48.dp) else Modifier).then(tap), contentAlignment = Alignment.Center) {
        Row(
            Modifier.height(32.dp).padding(horizontal = 8.dp)
                .then(if (description != null) Modifier.clearAndSetSemantics { contentDescription = description } else Modifier),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (icon != null) Icon(icon, null, Modifier.size(14.dp), tint = OrbKit.mutedForeground)
            Text(text, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (chevron) Icon(OrbIcons.ChevronDown, null, Modifier.size(14.dp), tint = OrbKit.faintForeground)
        }
    }
}

/** A 36 dp icon button of the box's bottom row, with a 48 dp touch zone (`.mcomp .ib`). */
@Composable
fun OrbComposerIcon(icon: ImageVector, label: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Box(
        modifier.size(48.dp).clip(CircleShape).clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label; if (!enabled) disabled() },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, Modifier.size(20.dp), tint = if (enabled) OrbKit.mutedForeground else OrbKit.mutedForeground.copy(alpha = 0.45f))
    }
}

/**
 * `.send`: the round 36 dp button. An arrow to send; while the assistant works and there is nothing to send, a stop
 * square (`.send.stop`). [sendLabel] and [stopLabel] are what a screen reader says.
 */
@Composable
fun OrbSendButton(
    stop: Boolean, enabled: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier,
    sendLabel: String = "Enviar", stopLabel: String = "Parar",
) {
    AnimatedContent(
        targetState = stop, modifier = modifier, label = "send-stop",
        transitionSpec = { (fadeIn(tween(OrbMotion.Short)) + scaleIn(tween(OrbMotion.Short), 0.8f)) togetherWith (fadeOut(tween(OrbMotion.Fast)) + scaleOut(tween(OrbMotion.Fast), 0.8f)) },
    ) { stopping ->
        val live = stopping || enabled
        Box(
            Modifier.size(48.dp).clip(CircleShape).clickable(enabled = live, role = Role.Button, onClick = onClick)
                .semantics { contentDescription = if (stopping) stopLabel else sendLabel; if (!live) disabled() },
            contentAlignment = Alignment.Center,
        ) {
            Box(
                Modifier.size(36.dp).clip(CircleShape).background(if (stopping) OrbKit.foreground else if (enabled) OrbKit.primary else OrbKit.muted),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (stopping) OrbIcons.Square else OrbIcons.ArrowUp, null, Modifier.size(if (stopping) 16.dp else 18.dp),
                    tint = if (stopping || enabled) OrbKit.primaryForeground else OrbKit.faintForeground,
                )
            }
        }
    }
}

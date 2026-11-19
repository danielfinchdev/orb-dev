package dev.orb.app.ui.chats

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.attach.AttachController
import dev.orb.app.attach.AttachState
import dev.orb.app.attach.AttachTexts
import dev.orb.app.ui.attach.AttachSheet
import dev.orb.app.ui.attach.AttachStrip
import dev.orb.app.ui.attach.rememberAttachLaunchers
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbComposerFrame
import dev.orb.app.ui.kit.OrbComposerIcon
import dev.orb.app.ui.kit.OrbComposerLabel
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbSendButton
import dev.orb.app.ui.kit.kitTween
import dev.orb.app.ui.theme.OrbMotion

/** One way to send a message while the agent works. */
class ComposerChoice(val label: String, val send: (String) -> Unit)

/** Text that fills the box once for each [key] (a queued message brought back to be edited). */
class ComposerSeed(val key: Long, val text: String)

/**
 * The writing box (`.mcomp`): the text on top and, below, «+», the permission label (or [leading]), the brain label,
 * the microphone and the round send/stop button. [brain] null hides the brain label; [mic] draws the microphone, which
 * dictates through the system's recognizer when the phone has one.
 *
 * Over the box: the «@» list ([mentions], only while linked) and the «/» list ([commands]).
 */
@Composable
internal fun Composer(
    online: Boolean, busy: Boolean, mode: String?, canSetMode: Boolean,
    onSend: (String) -> Unit, onStop: () -> Unit,
    /** Unused: the mode is chosen in the selector under the header; the box only shows it. */
    onMode: (String) -> Unit = {},
    placeholder: String = ChatTexts.MESSAGE_FIELD,
    /** While the agent works and there is text: the ways to send it («Corregir», «Encolar»); the first is the send button's. */
    busyChoices: List<ComposerChoice> = emptyList(),
    /** Replaces the permission label (a direct chat shows its agent and model instead). */
    leading: (@Composable () -> Unit)? = null,
    /** The pictures and files of this message; null hides «+» (where nothing can be attached). */
    attach: AttachController? = null,
    brain: String? = null,
    mic: Boolean = false,
    /** A bar over the box that sees what is written and can empty it (the context bar, or «Editando…» with its «Guardar»). */
    above: (@Composable (text: String, clear: () -> Unit) -> Unit)? = null,
    seed: ComposerSeed? = null,
    /** While non-null the send button hands the text to it (saving an edit) and the busy choices are off. */
    sendOverride: ((String) -> Unit)? = null,
    /** What «@» offers; null where the PC cannot expand mentions. */
    mentions: MentionSource? = null,
    /** What «/» offers: only commands that do something in this chat. */
    commands: List<ComposerCommand> = emptyList(),
) {
    // A TextFieldValue, not a String: «@» is looked for at the cursor and a pick is written there.
    var field by rememberSaveable(stateSaver = TextFieldValue.Saver) { mutableStateOf(TextFieldValue("")) }
    val text = field.text
    fun setText(value: String) { field = TextFieldValue(value, TextRange(value.length)) }
    // What was written before a queued message was brought in to be edited; it comes back when the edit ends.
    var stash by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(seed?.key) {
        val kept = stash
        if (seed != null) {
            if (kept == null) stash = text
            setText(seed.text)
        } else if (kept != null) {
            setText(kept)
            stash = null
        }
    }
    val attached = attach?.items?.collectAsState()?.value.orEmpty()
    val attachNotice = attach?.notice?.collectAsState()?.value
    var problem by remember { mutableStateOf<String?>(null) }
    var sheet by remember { mutableStateOf(false) }
    val launchers = if (attach != null) rememberAttachLaunchers(attach) { problem = it } else null
    // Sending waits for every upload: a message that left before them would reach the PC without its files.
    val attachOk = attached.all { it.state == AttachState.Ready }
    val canSend = text.isNotBlank() && attachOk
    if (sheet && attach != null && launchers != null) AttachSheet(attach.currentPolicy, launchers, onDismiss = { sheet = false })

    val cursor = if (field.selection.collapsed) field.selection.end else -1
    val trigger = if (mentions != null && online) MentionTrigger.at(text, cursor) else null
    var offered by remember { mutableStateOf<List<MentionOption>?>(null) }
    val asking = trigger != null
    LaunchedEffect(asking, mentions) { if (asking && mentions != null) offered = mentions.options() }
    val mentionRows = if (trigger != null) offered?.let { MentionFilter.filter(it, trigger.query) }.orEmpty() else emptyList()
    val commandRows = CommandTrigger.query(text)?.takeIf { commands.isNotEmpty() }?.let { CommandTrigger.filter(commands, it) }.orEmpty()

    val dictation = if (mic) rememberDictation { phrase ->
        val sel = field.selection
        val before = text.substring(0, sel.min)
        val after = text.substring(sel.max)
        val gap = if (before.isNotEmpty() && !before.last().isWhitespace()) " " else ""
        val tail = if (after.isNotEmpty() && !after.first().isWhitespace()) " " else ""
        val head = before + gap + phrase + tail
        field = TextFieldValue(head + after, TextRange(head.length))
    } else null

    if (above != null) above(text) { setText("") }
    if (mentionRows.isNotEmpty() && trigger != null) {
        MentionList(mentionRows, onPick = { pick ->
            val before = text.substring(0, trigger.start)
            val after = text.substring(cursor)
            val insert = pick.token + if (after.firstOrNull()?.isWhitespace() == true) "" else " "
            field = TextFieldValue(before + insert + after, TextRange((before + insert).length))
        })
    } else if (commandRows.isNotEmpty()) {
        CommandList(commandRows, onPick = { setText(""); it.run() })
    }
    OrbComposerFrame {
        if (attach != null) {
            AttachStrip(attached, attachNotice ?: problem, attach::remove, attach::retry, Modifier.padding(end = 8.dp))
        }
        Box(Modifier.fillMaxWidth().heightIn(min = 22.dp, max = 160.dp).padding(end = 4.dp), contentAlignment = Alignment.CenterStart) {
            BasicTextField(
                field, { field = it }, Modifier.fillMaxWidth().semantics { contentDescription = placeholder },
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = OrbKit.foreground, fontSize = 15.sp, lineHeight = 22.sp),
                cursorBrush = SolidColor(OrbKit.foreground), maxLines = 8,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            )
            if (text.isEmpty()) Text(placeholder, color = OrbKit.faintForeground, fontSize = 15.sp, lineHeight = 22.sp)
        }
        AnimatedVisibility(
            busy && canSend && busyChoices.isNotEmpty() && sendOverride == null,
            enter = fadeIn(tween(OrbMotion.Short)) + expandVertically(OrbMotion.standard(OrbMotion.Short)),
            exit = fadeOut(tween(OrbMotion.Fast)) + shrinkVertically(OrbMotion.standard(OrbMotion.Fast)),
        ) {
            Row(Modifier.padding(top = 2.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (choice in busyChoices) {
                    OrbButton(choice.label, { val t = text; setText(""); choice.send(t) }, small = true)
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (attach != null) {
                // «+» turns a quarter of a turn into «×» while the tray is open; the turn is drawn by the layer, not recomposed.
                val turn by animateFloatAsState(if (sheet) 45f else 0f, kitTween(OrbMotion.Short), label = "attach-turn")
                OrbComposerIcon(
                    OrbIcons.Plus, if (sheet) ChatTexts.ATTACH_CLOSE else AttachTexts.ADD, { problem = null; sheet = !sheet },
                    rotation = { turn },
                )
            }
            // Only says which mode is on; the choice is made in the selector under the header.
            if (leading != null) leading() else if (canSetMode) ChatTexts.modeLabel(mode).let { OrbComposerLabel(it, icon = OrbIcons.ShieldCheck, description = "${ChatTexts.MODE_SELECTOR}: $it") }
            if (brain != null) OrbComposerLabel(brain, description = "${ChatTexts.BRAIN_DESC}: $brain")
            Box(Modifier.weight(1f))
            if (mic) {
                val ready = dictation?.available == true
                OrbComposerIcon(OrbIcons.Mic, if (ready) ChatTexts.MIC else ChatTexts.MIC_NONE, { dictation?.start?.invoke() }, enabled = ready)
            }
            // Parar only when there is nothing to send: with text, the message goes to the PC's queue behind the turn.
            OrbSendButton(
                stop = busy && !canSend && sendOverride == null, enabled = canSend, sendLabel = if (sendOverride != null) ChatTexts.QUEUED_SAVE else ChatTexts.SEND,
                stopLabel = ChatTexts.STOP,
                onClick = {
                    if (sendOverride != null) { if (canSend) { val t = text; setText(""); sendOverride(t) } }
                    else if (busy && !canSend) onStop() else {
                        val t = text; setText("")
                        if (busy && busyChoices.isNotEmpty()) busyChoices.first().send(t) else onSend(t)
                    }
                },
            )
        }
    }
}

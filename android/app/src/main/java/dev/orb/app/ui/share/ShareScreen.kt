package dev.orb.app.ui.share

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.attach.AttachTexts
import dev.orb.app.ui.attach.AttachStrip
import dev.orb.app.ui.chats.ChatKind
import dev.orb.app.ui.chats.ChatRef
import dev.orb.app.ui.chats.ChatRow
import dev.orb.app.ui.chats.ChatTexts
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.AgentMark
import dev.orb.app.ui.kit.chosenFill
import dev.orb.app.ui.kit.OrbBadge
import dev.orb.app.ui.kit.OrbBadgeKind
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbButtonKind
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbSheet
import dev.orb.app.ui.kit.OrbSheetLabel
import dev.orb.app.ui.kit.ProjectDot
import dev.orb.app.ui.theme.OrbFonts

/**
 * «Compartir con Orb» as the mockup's bottom sheet, over a dimmed page: the title with what is shared, the text to send with
 * it, where it goes («Enviar a») and the two buttons. The app opens on it when another app shares something, so the page
 * behind is only the background the sheet dims. Nothing leaves until «Enviar a Orb»; closing the sheet is «Cancelar».
 */
@Composable
fun ShareScreen(vm: ShareViewModel, onClose: () -> Unit, modifier: Modifier = Modifier) {
    val state by vm.state.collectAsStateWithLifecycle()
    val items by vm.attach.items.collectAsStateWithLifecycle()
    val notice by vm.attach.notice.collectAsStateWithLifecycle()
    val cancel = { vm.discard(); onClose() }
    val nothing = state.empty && items.isEmpty()
    Box(modifier.fillMaxSize().background(OrbKit.background))
    OrbSheet(
        onDismiss = cancel,
        header = {
            Text(
                AttachTexts.SHARE_TITLE, Modifier.weight(1f, fill = false).semantics { heading() }, color = OrbKit.foreground, fontSize = 16.sp,
                lineHeight = 22.sp, fontFamily = OrbFonts.title, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            val what = sharedLabel(items.map { it.name }, state.text.isNotBlank())
            if (what != null) OrbBadge(what, kind = OrbBadgeKind.Acc)
        },
        footer = {
            state.message?.let { Text(it, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), color = OrbKit.destructive, fontSize = 13.sp, lineHeight = 18.sp) }
            ActionBar(onCancel = cancel, onSend = if (nothing) null else vm::send, sending = state.sending, modifier = Modifier.imePadding())
        },
    ) {
        if (nothing) {
            Text(AttachTexts.SHARE_EMPTY, Modifier.padding(16.dp), color = OrbKit.mutedForeground, fontSize = 15.sp, lineHeight = 22.sp)
            return@OrbSheet
        }
        Column(Modifier.imePadding(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (state.skipped > 0) Note(AttachTexts.SHARE_SKIPPED)
                if (state.textCut) Note(AttachTexts.SHARE_CUT)
                AttachStrip(items, notice, vm.attach::remove, vm.attach::retry, inset = 0.dp)
                ShareText(state.text, vm::setText)
            }
            OrbSheetLabel(AttachTexts.SHARE_TO)
            // The recent chats come straight under «Enviar a», as in the mockup.
            for (row in state.recents) {
                val dest = ShareDest.Chat(ChatRef(row.kind, row.id))
                DestRow(row.title.ifBlank { ChatTexts.UNTITLED }, row.project, state.dest == dest, { vm.choose(dest) }) { ChatMark(row) }
            }
            if (state.projects.isNotEmpty()) {
                OrbSheetLabel(AttachTexts.SHARE_PROJECTS)
                for (name in state.projects) {
                    val dest = ShareDest.Project(name)
                    DestRow(name, null, state.dest == dest, { vm.choose(dest) }) { ProjectDot(name) }
                }
            }
            DestRow(AttachTexts.SHARE_NEW_ORBE, null, state.dest == ShareDest.NewOrbe, { vm.choose(ShareDest.NewOrbe) }) {
                Icon(OrbIcons.SquarePen, null, Modifier.size(18.dp), tint = OrbKit.mutedForeground)
            }
        }
    }
}

/** What the badge says: the file's name, how many files, or that it is a text. Null when there is nothing yet. */
internal fun sharedLabel(names: List<String>, hasText: Boolean): String? = when {
    names.size == 1 -> names.single()
    names.size > 1 -> "${names.size} archivos"
    hasText -> "Texto"
    else -> null
}

@Composable
private fun Note(text: String) {
    Text(text, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp)
}

/** The message that goes with what is shared: a bordered multi-line field in the look of the kit's `.field`. */
@Composable
private fun ShareText(value: String, onChange: (String) -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Box(
        Modifier.fillMaxWidth().heightIn(min = 96.dp, max = 240.dp).clip(shape).background(OrbKit.card).border(1.dp, OrbKit.border, shape).padding(14.dp),
    ) {
        if (value.isEmpty()) Text(AttachTexts.SHARE_TEXT_HINT, color = OrbKit.faintForeground, fontSize = 15.sp, lineHeight = 22.sp)
        BasicTextField(
            value, onChange, Modifier.fillMaxWidth().semantics { contentDescription = AttachTexts.SHARE_TEXT_HINT },
            textStyle = TextStyle(color = OrbKit.foreground, fontSize = 15.sp, lineHeight = 22.sp), cursorBrush = SolidColor(OrbKit.foreground),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        )
    }
}

/** A sheet row `.it` that picks where it goes: the mark, the name, the project at the end and a check on the chosen one. */
@Composable
private fun DestRow(title: String, meta: String?, selected: Boolean, onClick: () -> Unit, lead: @Composable () -> Unit) {
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = 52.dp).chosenFill(selected).selectable(selected = selected, role = Role.RadioButton, onClick = onClick).padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.width(20.dp), contentAlignment = Alignment.Center) { lead() }
        Text(
            title, Modifier.weight(1f), color = OrbKit.foreground, fontSize = 15.sp, lineHeight = 22.sp,
            fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal, maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
        if (!meta.isNullOrBlank()) Text(meta, color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(96.dp))
        if (selected) Icon(OrbIcons.Check, null, Modifier.size(20.dp), tint = OrbKit.primaryText)
    }
}

@Composable
private fun ChatMark(row: ChatRow) {
    AgentMark(if (row.kind == ChatKind.Agent) row.agent else "orbe")
}

/** `.actbar`: a line over two buttons at the end. [onSend] null leaves only «Cancelar» (there is nothing to send). */
@Composable
private fun ActionBar(onCancel: () -> Unit, onSend: (() -> Unit)?, sending: Boolean, modifier: Modifier = Modifier) {
    Column(modifier) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(OrbKit.border))
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
            OrbButton(AttachTexts.SHARE_CANCEL, onCancel, kind = OrbButtonKind.Ghost)
            if (onSend != null) OrbButton(AttachTexts.SHARE_SEND, onSend, kind = OrbButtonKind.Primary, enabled = !sending)
        }
    }
}

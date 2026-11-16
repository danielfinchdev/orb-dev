package dev.orb.app.ui.share

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.attach.AttachTexts
import dev.orb.app.ui.chats.ChatTexts
import dev.orb.app.ui.attach.AttachStrip
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.theme.OrbTheme

/** Full-screen sheet of «Compartir con Orb» (A06): pick where it goes, edit the text, send. */
@Composable
fun ShareScreen(vm: ShareViewModel, onClose: () -> Unit, modifier: Modifier = Modifier) {
    val state by vm.state.collectAsStateWithLifecycle()
    val items by vm.attach.items.collectAsStateWithLifecycle()
    val notice by vm.attach.notice.collectAsStateWithLifecycle()
    Column(modifier.fillMaxSize().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 16.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { vm.discard(); onClose() }, Modifier.semantics { contentDescription = AttachTexts.SHARE_CLOSE }) {
                Icon(OrbIcons.Close, null)
            }
            Text(AttachTexts.SHARE_TITLE, style = MaterialTheme.typography.titleLarge)
        }
        if (state.empty && items.isEmpty()) {
            Text(AttachTexts.SHARE_EMPTY, Modifier.padding(24.dp), color = OrbTheme.colors.text2)
            return@Column
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (state.skipped > 0) Text(AttachTexts.SHARE_SKIPPED, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2)
            if (state.textCut) Text(AttachTexts.SHARE_CUT, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2)
            AttachStrip(items, notice, vm.attach::remove, vm.attach::retry)
            OutlinedTextField(
                state.text, vm::setText, Modifier.fillMaxWidth().heightIn(min = 120.dp, max = 260.dp),
                placeholder = { Text(AttachTexts.SHARE_TEXT_HINT) },
            )
            Text(AttachTexts.SHARE_TO, Modifier.padding(top = 8.dp), style = MaterialTheme.typography.titleSmall)
            DestRow(AttachTexts.SHARE_NEW_ORBE, null, state.dest == ShareDest.NewOrbe) { vm.choose(ShareDest.NewOrbe) }
            if (state.recents.isNotEmpty()) {
                Text(AttachTexts.SHARE_RECENT, Modifier.padding(top = 8.dp), style = MaterialTheme.typography.labelLarge, color = OrbTheme.colors.text2)
                for (row in state.recents) {
                    val dest = ShareDest.Chat(dev.orb.app.ui.chats.ChatRef(row.kind, row.id))
                    DestRow(row.title.ifBlank { ChatTexts.UNTITLED }, row.project, state.dest == dest) { vm.choose(dest) }
                }
            }
            if (state.projects.isNotEmpty()) {
                Text(AttachTexts.SHARE_PROJECTS, Modifier.padding(top = 8.dp), style = MaterialTheme.typography.labelLarge, color = OrbTheme.colors.text2)
                for (name in state.projects) {
                    val dest = ShareDest.Project(name)
                    DestRow(name, null, state.dest == dest) { vm.choose(dest) }
                }
            }
        }
        state.message?.let { Text(it, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        Button(
            onClick = vm::send, enabled = !state.sending, modifier = Modifier.fillMaxWidth().padding(16.dp),
        ) { Text(AttachTexts.SHARE_SEND) }
    }
}

@Composable
private fun DestRow(title: String, subtitle: String?, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.RadioButton, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected, onClick = null, Modifier.padding(end = 12.dp).size(24.dp))
        Column(Modifier.padding(vertical = 8.dp)) {
            Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
            if (!subtitle.isNullOrBlank()) Text(subtitle, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2)
        }
    }
}

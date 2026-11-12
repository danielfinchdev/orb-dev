package dev.orb.app.ui.thisphone

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.shell.ScreenBar
import dev.orb.app.ui.shell.UnlinkDialog
import dev.orb.app.ui.theme.OrbTheme

/** The «Este móvil» screen: the link, the notices, the lock screen, the look and the way to unlink. */
@Composable
fun ThisPhoneScreen(vm: ThisPhoneViewModel, onBack: () -> Unit, onAppearance: () -> Unit, onUnlinked: () -> Unit, modifier: Modifier = Modifier) {
    val state by vm.state.collectAsStateWithLifecycle()
    var confirming by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(state.unlinked) { if (state.unlinked) onUnlinked() }

    Column(modifier.fillMaxSize()) {
        ScreenBar(ThisPhoneTexts.TITLE, onBack, ThisPhoneTexts.BACK)
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
            Section(ThisPhoneTexts.SECTION_LINK)
            Info(state.pcName?.takeIf { it.isNotBlank() } ?: ThisPhoneTexts.NO_NAME, ThisPhoneTexts.link(state.connection))

            Section(ThisPhoneTexts.SECTION_NOTICES)
            SwitchRow(ThisPhoneTexts.KEEP, ThisPhoneTexts.KEEP_HINT, state.keepConnected, vm::setKeepConnected)
            Row(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(ThisPhoneTexts.NOTICES, style = MaterialTheme.typography.bodyLarge)
                    Text(
                        if (state.notificationsEnabled) ThisPhoneTexts.NOTICES_ON else ThisPhoneTexts.NOTICES_OFF,
                        style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2,
                    )
                }
                if (!state.notificationsEnabled) TextButton(onClick = vm::requestNotifications) { Text(ThisPhoneTexts.ALLOW) }
            }
            SwitchRow(ThisPhoneTexts.LOCK_CONTENT, ThisPhoneTexts.LOCK_CONTENT_HINT, state.lockScreenPublic, vm::setLockScreenPublic)

            Section(ThisPhoneTexts.SECTION_SECURITY)
            SwitchRow(ThisPhoneTexts.FINGERPRINT, ThisPhoneTexts.FINGERPRINT_HINT, checked = false, onChange = {}, enabled = false)

            Section(ThisPhoneTexts.SECTION_LOOK)
            Text(
                ThisPhoneTexts.APPEARANCE,
                Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onAppearance).padding(horizontal = 24.dp, vertical = 16.dp),
                style = MaterialTheme.typography.bodyLarge,
            )

            TextButton(onClick = { confirming = true }, enabled = !state.unlinking, modifier = Modifier.padding(horizontal = 12.dp, vertical = 16.dp)) {
                Text(ThisPhoneTexts.UNLINK, color = MaterialTheme.colorScheme.error)
            }
        }
    }
    if (confirming) UnlinkDialog(onConfirm = { confirming = false; vm.unlink() }, onDismiss = { confirming = false })
}

@Composable
private fun Section(title: String) =
    Text(title, Modifier.padding(start = 24.dp, end = 24.dp, top = 20.dp, bottom = 4.dp), style = MaterialTheme.typography.labelLarge, color = OrbTheme.colors.text3)

@Composable
private fun Info(title: String, detail: String) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, style = MaterialTheme.typography.bodyLarge)
        Text(detail, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2)
    }
}

@Composable
private fun SwitchRow(title: String, hint: String, checked: Boolean, onChange: (Boolean) -> Unit, enabled: Boolean = true) {
    Row(
        Modifier.fillMaxWidth().toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onChange).padding(horizontal = 24.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = if (enabled) androidx.compose.ui.graphics.Color.Unspecified else OrbTheme.colors.text3)
            Text(hint, style = MaterialTheme.typography.bodySmall, color = OrbTheme.colors.text2)
        }
        Switch(checked = checked, onCheckedChange = null, enabled = enabled)
    }
}

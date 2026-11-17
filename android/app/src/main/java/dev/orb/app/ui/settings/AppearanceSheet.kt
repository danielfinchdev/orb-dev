package dev.orb.app.ui.settings

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.AppearanceTexts as T
import dev.orb.app.ui.theme.DarkMode
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.ThemeChoice
import dev.orb.app.ui.theme.ThemePrefs
import dev.orb.app.ui.theme.ThemeSettings
import dev.orb.app.ui.theme.dynamicColorsSupported

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppearanceSheet(prefs: ThemePrefs, onDismiss: () -> Unit) {
    val settings by prefs.settings.collectAsStateWithLifecycle()
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        AppearanceContent(
            settings = settings,
            dynamicSupported = dynamicColorsSupported,
            onChoice = prefs::setChoice,
            onDark = prefs::setDark,
            onDynamic = prefs::setDynamic,
        )
    }
}

@Composable
fun AppearanceContent(
    settings: ThemeSettings,
    dynamicSupported: Boolean,
    onChoice: (ThemeChoice?) -> Unit,
    onDark: (DarkMode) -> Unit,
    onDynamic: (Boolean) -> Unit,
) {
    Column(Modifier.fillMaxWidth().verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(T.TITLE, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))

        Column(Modifier.selectableGroup().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            ChoiceRow(T.FOLLOW_PC, selected = settings.choice == null) { onChoice(null) }
            ChoiceRow(T.ORBITA, selected = settings.choice == ThemeChoice.Orbita) { onChoice(ThemeChoice.Orbita) }
            ChoiceRow(T.CRISTAL, selected = settings.choice == ThemeChoice.Cristal) { onChoice(ThemeChoice.Cristal) }
            ChoiceRow(T.GRAFITO, selected = settings.choice == ThemeChoice.Grafito) { onChoice(ThemeChoice.Grafito) }
        }

        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp)
                .toggleable(settings.dynamic && dynamicSupported, enabled = dynamicSupported, role = Role.Switch, onValueChange = onDynamic),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
                Text(T.DYNAMIC, style = MaterialTheme.typography.bodyLarge, color = if (dynamicSupported) MaterialTheme.colorScheme.onSurface else OrbTheme.colors.text3)
                Text(
                    if (dynamicSupported) T.DYNAMIC_HINT else T.DYNAMIC_UNAVAILABLE,
                    style = MaterialTheme.typography.bodyMedium, color = OrbTheme.colors.text2,
                )
            }
            Switch(checked = settings.dynamic && dynamicSupported, onCheckedChange = null, enabled = dynamicSupported)
        }

        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(40.dp).selectableGroup(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ModeButton(T.LIGHT, settings.dark == DarkMode.Light, Modifier.weight(1f)) { onDark(DarkMode.Light) }
            ModeButton(T.DARK, settings.dark == DarkMode.Dark, Modifier.weight(1f)) { onDark(DarkMode.Dark) }
            ModeButton(T.SYSTEM, settings.dark == DarkMode.System, Modifier.weight(1f)) { onDark(DarkMode.System) }
        }
    }
}

@Composable
private fun ChoiceRow(label: String, selected: Boolean, onClick: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = if (selected) scheme.primaryContainer else scheme.surfaceContainerHigh,
        contentColor = if (selected) scheme.onPrimaryContainer else scheme.onSurface,
        border = if (selected) BorderStroke(2.dp, scheme.primary) else null,
        modifier = Modifier.fillMaxWidth().selectable(selected = selected, role = Role.RadioButton, onClick = onClick),
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp))
    }
}

@Composable
private fun ModeButton(label: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    Surface(
        shape = androidx.compose.foundation.shape.CircleShape,
        color = if (selected) scheme.primaryContainer else androidx.compose.ui.graphics.Color.Transparent,
        contentColor = if (selected) scheme.onPrimaryContainer else scheme.onSurface,
        border = BorderStroke(1.dp, if (selected) scheme.primary else scheme.outline),
        modifier = modifier.selectable(selected = selected, role = Role.RadioButton, onClick = onClick),
    ) {
        Row(Modifier.fillMaxWidth().height(40.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.labelLarge)
        }
    }
}

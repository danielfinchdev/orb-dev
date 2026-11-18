package dev.orb.app.ui.settings

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.AppearanceTexts as T
import dev.orb.app.ui.theme.DarkMode
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.OrbTheme
import dev.orb.app.ui.theme.ThemePrefs
import dev.orb.app.ui.theme.ThemeSettings
import dev.orb.app.ui.theme.paletteFor

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppearanceSheet(prefs: ThemePrefs, onDismiss: () -> Unit) {
    val settings by prefs.settings.collectAsStateWithLifecycle()
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        AppearanceContent(settings = settings, onPalette = prefs::setPalette, onDark = prefs::setDark)
    }
}

@Composable
fun AppearanceContent(
    settings: ThemeSettings,
    onPalette: (OrbPaletteChoice) -> Unit,
    onDark: (DarkMode) -> Unit,
) {
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(T.TITLE, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))

        GroupLabel(T.MODE_GROUP)
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp).selectableGroup(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ModeButton(T.SYSTEM, settings.dark == DarkMode.System, Modifier.weight(1f)) { onDark(DarkMode.System) }
            ModeButton(T.LIGHT, settings.dark == DarkMode.Light, Modifier.weight(1f)) { onDark(DarkMode.Light) }
            ModeButton(T.DARK, settings.dark == DarkMode.Dark, Modifier.weight(1f)) { onDark(DarkMode.Dark) }
        }

        GroupLabel(T.PALETTE_GROUP)
        // Swatches show the accent of each palette in the mode that is on screen.
        val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp).selectableGroup(), horizontalArrangement = Arrangement.SpaceBetween) {
            for (choice in OrbPaletteChoice.entries) {
                Swatch(choice, paletteFor(choice, dark).primaryText, settings.palette == choice) { onPalette(choice) }
            }
        }
    }
}

@Composable
private fun GroupLabel(text: String) {
    Text(
        text, style = MaterialTheme.typography.labelLarge, color = OrbTheme.colors.text2,
        modifier = Modifier.padding(horizontal = 16.dp),
    )
}

/** A 24 dp round sample inside a 48 dp touch zone; the chosen one gets a ring, and is announced as selected. */
@Composable
private fun Swatch(choice: OrbPaletteChoice, accent: Color, selected: Boolean, onClick: () -> Unit) {
    val ring = MaterialTheme.colorScheme.onSurface
    Box(
        Modifier.size(48.dp)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .semantics { contentDescription = T.paletteDescription(choice.label) },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.size(if (selected) 34.dp else 24.dp)
                .then(if (selected) Modifier.border(2.dp, ring, CircleShape) else Modifier),
            contentAlignment = Alignment.Center,
        ) { Box(Modifier.size(24.dp).clip(CircleShape).background(accent)) }
    }
}

@Composable
private fun ModeButton(label: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    // The button is 40 dp tall inside a 48 dp touch zone.
    Box(modifier.height(48.dp).selectable(selected = selected, role = Role.RadioButton, onClick = onClick), contentAlignment = Alignment.Center) {
        Surface(
            shape = CircleShape,
            color = if (selected) scheme.primaryContainer else Color.Transparent,
            contentColor = if (selected) scheme.onPrimaryContainer else scheme.onSurface,
            border = BorderStroke(1.dp, if (selected) scheme.primary else scheme.outline),
            modifier = Modifier.fillMaxWidth().height(40.dp),
        ) {
            Row(Modifier.fillMaxWidth().height(40.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                Text(label, style = MaterialTheme.typography.labelMedium, maxLines = 1)
            }
        }
    }
}

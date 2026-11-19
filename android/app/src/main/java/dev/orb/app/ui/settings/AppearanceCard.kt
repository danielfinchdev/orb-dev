package dev.orb.app.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.ui.AppearanceTexts as T
import dev.orb.app.ui.kit.OrbCard
import dev.orb.app.ui.kit.OrbChip
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbSegmented
import dev.orb.app.ui.theme.DarkMode
import dev.orb.app.ui.theme.OrbPaletteChoice
import dev.orb.app.ui.theme.ThemeSettings
import dev.orb.app.ui.theme.sample

/**
 * The «Apariencia» card of «Este móvil»: the mode as a segmented control and the palette as small chips with a dot and
 * the name. The dots are the fixed sample colours of the palettes, the same by day and by night.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AppearanceCard(settings: ThemeSettings, onPalette: (OrbPaletteChoice) -> Unit, onDark: (DarkMode) -> Unit, modifier: Modifier = Modifier) {
    OrbCard(modifier) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            GroupLabel(T.MODE_GROUP)
            val modes = DarkMode.entries
            OrbSegmented(listOf(T.SYSTEM, T.LIGHT, T.DARK), modes.indexOf(settings.dark), { onDark(modes[it]) }, stretch = true)
            GroupLabel(T.PALETTE_GROUP)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (choice in OrbPaletteChoice.entries) {
                    OrbChip(
                        choice.label, settings.palette == choice, { onPalette(choice) },
                        Modifier.semantics { contentDescription = T.paletteDescription(choice.label) },
                        lead = { Box(Modifier.size(10.dp).clip(CircleShape).background(choice.sample)) },
                    )
                }
            }
        }
    }
}

@Composable
private fun GroupLabel(text: String) {
    Text(text, color = OrbKit.faintForeground, fontSize = 12.sp, lineHeight = 16.sp)
}

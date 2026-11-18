package dev.orb.app.ui.kit

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.ui.icons.OrbIcons

/**
 * The band under the header when the PC cannot be reached: the reason in the destructive colour, with [action] to try
 * again at once. It sits in a card so it reads as part of the page, not as an alert over it.
 */
@Composable
fun OrbConnectionBand(text: String, modifier: Modifier = Modifier, action: String? = null, onAction: (() -> Unit)? = null) {
    Box(modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 8.dp)) {
        OrbCard {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Row(
                    Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite }, verticalAlignment = Alignment.Top,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon(OrbIcons.WifiOff, null, Modifier.padding(top = 1.dp).size(16.dp), tint = OrbKit.destructive)
                    Text(text, color = OrbKit.destructive, fontSize = 12.sp, lineHeight = 17.sp)
                }
                if (action != null && onAction != null) OrbButton(action, onAction, small = true)
            }
        }
    }
}

/** «Conectado» in green, the moment the link is back. */
@Composable
fun OrbConnectedBadge(text: String, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 8.dp).semantics { liveRegion = LiveRegionMode.Polite }) {
        OrbBadge(text, kind = OrbBadgeKind.Ok, icon = OrbIcons.Wifi)
    }
}

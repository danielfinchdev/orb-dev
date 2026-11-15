package dev.orb.app.ui.island

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.orb.app.ui.web.LocalWebView
import dev.orb.app.ui.web.WebController
import kotlinx.coroutines.delay

/** How long Kotlin waits for the first size once the page has said it is ready, before giving the block back as code. */
const val ISLAND_TIMEOUT_MS = 12_000L

/** How long the page itself may take to come up and say it is ready. */
const val ISLAND_LOAD_TIMEOUT_MS = 20_000L
val ISLAND_MIN_HEIGHT = 48.dp
val ISLAND_MAX_HEIGHT = 480.dp

/**
 * A diagram or formula of a chat. It starts as a card (tap to draw) with [code] below; once drawn it lives in a local
 * WebView page (`island/index.html`, no network) and can return to the text. Sources over [IslandMessages.MAX_SOURCE_CHARS],
 * a failed or timed out render and a dead render process all end as the plain [code] plus a note.
 */
@Composable
fun IslandBlock(
    kind: IslandKind, source: String, dark: Boolean, modifier: Modifier = Modifier,
    display: Boolean = true, code: @Composable () -> Unit,
) {
    if (source.length > IslandMessages.MAX_SOURCE_CHARS || source.isBlank()) { code(); return }
    val key = remember(kind, source) { IslandShown.key(kind, source) }
    var wantOpen by remember(key) { mutableStateOf(IslandShown.wasShown(key)) }
    var failed by remember(key) { mutableStateOf(false) }
    var mounted by remember(key) { mutableStateOf(false) }
    var noSlot by remember(key) { mutableStateOf(false) }
    // Every tap on the card is a new try, so a block that found all slots taken can be opened once one is free.
    var attempt by remember(key) { mutableIntStateOf(0) }
    val token = remember { Any() }
    // The slot is held while the block is on screen and open; leaving the list releases it.
    DisposableEffect(key, wantOpen, failed, attempt) {
        if (wantOpen && !failed) {
            if (IslandShown.slots.tryAcquire(token)) { mounted = true; noSlot = false } else noSlot = true
        }
        onDispose { IslandShown.slots.release(token); mounted = false }
    }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        when {
            failed -> {
                Text(IslandTexts.FAILED, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelMedium)
                code()
            }
            mounted -> {
                IslandPage(kind, source, display, dark, onFailed = { failed = true })
                TextButton(onClick = { IslandShown.forget(key); wantOpen = false }) { Text(IslandTexts.VIEW_CODE) }
            }
            else -> {
                val label = if (kind == IslandKind.Mermaid) IslandTexts.VIEW_DIAGRAM else IslandTexts.VIEW_FORMULA
                val desc = if (kind == IslandKind.Mermaid) IslandTexts.DIAGRAM_CARD_DESC else IslandTexts.FORMULA_CARD_DESC
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
                        .border(BorderStroke(1.dp, MaterialTheme.colorScheme.primary), RoundedCornerShape(10.dp))
                        .clickable(role = Role.Button) { IslandShown.mark(key); wantOpen = true; attempt++ }
                        .semantics { contentDescription = desc }
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) { Text(label, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge) }
                if (noSlot) Text(IslandTexts.NO_SLOT, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelMedium)
                code()
            }
        }
    }
}

@Composable
private fun IslandPage(kind: IslandKind, source: String, display: Boolean, dark: Boolean, onFailed: () -> Unit) {
    val controller = remember { WebController() }
    var heightPx by remember { mutableIntStateOf(0) }
    val fail = rememberUpdatedState(onFailed)
    val seq = 1
    var ready by remember { mutableStateOf(false) }
    val bridge = remember {
        IslandBridge { m ->
            when (m) {
                IslandMessage.Ready -> { ready = true; controller.send(IslandMessages.renderJson(kind, source, display, seq)) }
                is IslandMessage.Size -> if (m.seq == seq) heightPx = m.height
                is IslandMessage.Failed -> if (m.seq == seq) fail.value()
            }
        }
    }
    // The render budget runs from the page's «ready», not from the mount, so a slow start does not eat it.
    LaunchedEffect(ready) { delay(if (ready) ISLAND_TIMEOUT_MS else ISLAND_LOAD_TIMEOUT_MS); if (heightPx == 0) fail.value() }
    val h = if (heightPx == 0) ISLAND_MIN_HEIGHT else heightPx.dp.coerceIn(ISLAND_MIN_HEIGHT, ISLAND_MAX_HEIGHT)
    val desc = if (kind == IslandKind.Mermaid) IslandTexts.DIAGRAM_DESC else IslandTexts.FORMULA_DESC
    LocalWebView(
        page = "island/index.html", dark = dark, background = Color.Transparent, bridge = bridge, onBack = {},
        modifier = Modifier.fillMaxWidth().height(h).semantics { contentDescription = desc },
        controller = controller, onGone = { fail.value() }, handleBack = false, domStorage = false, errorContent = { },
    )
}

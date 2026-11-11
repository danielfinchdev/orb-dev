package dev.orb.app.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.AppearanceTexts
import dev.orb.app.ui.connectionText

@Composable
fun HomeScreen(vm: HomeViewModel, onLinkTest: () -> Unit, onAppearance: () -> Unit, onUnlinked: () -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    var confirming by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(state.unlinked) { if (state.unlinked) onUnlinked() }
    Column(modifier = Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(state.pcName ?: "Orb", style = MaterialTheme.typography.headlineSmall)
        Text(connectionText(state.connection))
        Button(onClick = onLinkTest) { Text("Prueba de conexión") }
        OutlinedButton(onClick = onAppearance) { Text(AppearanceTexts.BUTTON) }
        OutlinedButton(onClick = { confirming = true }, enabled = !state.unlinking) { Text("Desvincular") }
    }
    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text("¿Desvincular este móvil?") },
            text = { Text("Se borrarán la copia guardada y los mensajes sin enviar. Tendrás que enlazar de nuevo.") },
            confirmButton = { TextButton(onClick = { confirming = false; vm.unlink() }) { Text("Desvincular") } },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text("Cancelar") } },
        )
    }
}

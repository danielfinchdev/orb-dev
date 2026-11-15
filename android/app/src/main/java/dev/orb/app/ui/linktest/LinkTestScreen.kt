package dev.orb.app.ui.linktest

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.connectionText

@Composable
fun LinkTestScreen(vm: LinkTestViewModel) {
    val s by vm.state.collectAsStateWithLifecycle()
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("Prueba de conexión", style = MaterialTheme.typography.headlineSmall)
        Text("Estado: ${connectionText(s.connection)}")

        Button(onClick = vm::callMe, enabled = s.me != Probe.Running) { Text("Llamar a /api/me") }
        when (val me = s.me) {
            Probe.Idle -> Unit
            Probe.Running -> Text("Llamando…")
            is Probe.Failed -> Text(me.message, color = MaterialTheme.colorScheme.error)
            is Probe.Done -> with(me.value) {
                Text("PC: ${pcName ?: "?"}\nVersión de Orb: ${version ?: "?"}\nProtocolo: ${protocol ?: "?"} (mínimo ${minProtocol ?: "?"})\nHuella: ${fingerprint ?: "?"}\nLatencia: $latencyMs ms")
            }
        }

        Button(onClick = vm::callAppState, enabled = s.appState != Probe.Running) { Text("app.state") }
        when (val a = s.appState) {
            Probe.Idle -> Unit
            Probe.Running -> Text("Llamando…")
            is Probe.Failed -> Text(a.message, color = MaterialTheme.colorScheme.error)
            is Probe.Done -> Text("Respuesta: ${a.value.chars} caracteres\nClaves: ${a.value.keys.joinToString(", ").ifEmpty { "—" }}\nLatencia: ${a.value.latencyMs} ms")
        }

        Text("Eventos en vivo", style = MaterialTheme.typography.titleMedium)
        Text(if (s.eventCounts.isEmpty()) "Ninguno todavía" else s.eventCounts.entries.sortedBy { it.key }.joinToString("\n") { "${it.key}: ${it.value}" })

        Text("Cola de envío", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(value = s.draft, onValueChange = vm::setDraft, label = { Text("Mensaje de prueba") }, modifier = Modifier.fillMaxWidth())
        Button(onClick = vm::enqueueTest, enabled = s.draft.isNotBlank()) { Text("Enviar a un chat nuevo de prueba") }
        Text(
            if (s.queue.isEmpty()) "Cola vacía"
            else s.queue.joinToString("\n") { "${it.id} · ${it.state} · intentos ${it.attempts}" + (it.lastError?.let { e -> " · $e" } ?: "") },
        )

        Text("Copia guardada", style = MaterialTheme.typography.titleMedium)
        Text("Conversaciones: ${s.conversations}\nMensajes: ${s.messages}")

        Text("Ver registro", style = MaterialTheme.typography.titleMedium)
        Text(if (s.log.isEmpty()) "Sin líneas" else s.log.joinToString("\n"), style = MaterialTheme.typography.bodySmall)
    }
}

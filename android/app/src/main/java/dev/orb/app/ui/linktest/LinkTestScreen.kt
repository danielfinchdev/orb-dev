package dev.orb.app.ui.linktest

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.orb.app.ui.connectionText
import dev.orb.app.ui.kit.OrbButton
import dev.orb.app.ui.kit.OrbCard
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.OrbTextField
import dev.orb.app.ui.shell.ScreenBar

/** The connection test: one call through the link, the live events, the send queue, the saved copy and the log. */
@Composable
fun LinkTestScreen(vm: LinkTestViewModel, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val s by vm.state.collectAsStateWithLifecycle()
    Column(modifier.fillMaxSize()) {
        ScreenBar("Prueba de conexión", onBack)
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Line("Estado: ${connectionText(s.connection)}")

            OrbButton("Llamar a /api/me", vm::callMe, enabled = s.me != Probe.Running)
            when (val me = s.me) {
                Probe.Idle -> Unit
                Probe.Running -> Line("Llamando…", quiet = true)
                is Probe.Failed -> Text(me.message, color = OrbKit.destructive, fontSize = 14.5.sp, lineHeight = 21.sp)
                is Probe.Done -> with(me.value) {
                    Card {
                        Line("PC: ${pcName ?: "?"}\nVersión de Orb: ${version ?: "?"}\nProtocolo: ${protocol ?: "?"} (mínimo ${minProtocol ?: "?"})\nHuella: ${fingerprint ?: "?"}\nLatencia: $latencyMs ms")
                    }
                }
            }

            OrbButton("app.state", vm::callAppState, enabled = s.appState != Probe.Running)
            when (val a = s.appState) {
                Probe.Idle -> Unit
                Probe.Running -> Line("Llamando…", quiet = true)
                is Probe.Failed -> Text(a.message, color = OrbKit.destructive, fontSize = 14.5.sp, lineHeight = 21.sp)
                is Probe.Done -> Card {
                    Line("Respuesta: ${a.value.chars} caracteres\nClaves: ${a.value.keys.joinToString(", ").ifEmpty { "—" }}\nLatencia: ${a.value.latencyMs} ms")
                }
            }

            Heading("Eventos en vivo")
            Card { Line(if (s.eventCounts.isEmpty()) "Ninguno todavía" else s.eventCounts.entries.sortedBy { it.key }.joinToString("\n") { "${it.key}: ${it.value}" }) }

            Heading("Cola de envío")
            OrbTextField(s.draft, vm::setDraft, "Mensaje de prueba")
            OrbButton("Enviar a un chat nuevo de prueba", vm::enqueueTest, enabled = s.draft.isNotBlank())
            Card {
                Line(
                    if (s.queue.isEmpty()) "Cola vacía"
                    else s.queue.joinToString("\n") { "${it.id} · ${it.state} · intentos ${it.attempts}" + (it.lastError?.let { e -> " · $e" } ?: "") },
                )
            }

            Heading("Copia guardada")
            Card { Line("Conversaciones: ${s.conversations}\nMensajes: ${s.messages}") }

            Heading("Ver registro")
            Card {
                Text(
                    if (s.log.isEmpty()) "Sin líneas" else s.log.joinToString("\n"), color = OrbKit.mutedForeground, fontSize = 12.sp, lineHeight = 17.sp,
                    fontFamily = FontFamily.Monospace,
                )
            }
        }
    }
}

@Composable
private fun Heading(text: String) {
    Text(text, Modifier.padding(top = 8.dp).semantics { heading() }, color = OrbKit.foreground, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium)
}

@Composable
private fun Line(text: String, quiet: Boolean = false) {
    Text(text, color = if (quiet) OrbKit.mutedForeground else OrbKit.foreground, fontSize = 14.5.sp, lineHeight = 21.sp)
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    OrbCard { Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) { content() } }
}

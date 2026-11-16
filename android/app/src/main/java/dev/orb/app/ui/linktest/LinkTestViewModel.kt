package dev.orb.app.ui.linktest

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.data.OutboxEntity
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.LinkTestBackend
import dev.orb.app.ui.linkErrorText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

/** The state of one probe button. */
sealed interface Probe<out T> {
    data object Idle : Probe<Nothing>
    data object Running : Probe<Nothing>
    data class Done<T>(val value: T) : Probe<T>
    data class Failed(val message: String) : Probe<Nothing>
}

data class MeSummary(val pcName: String?, val version: String?, val protocol: Int?, val minProtocol: Int?, val fingerprint: String?, val latencyMs: Long)

/** Only the shape of the answer: its size and a few top-level keys, never its content. */
data class AppStateSummary(val chars: Int, val keys: List<String>, val latencyMs: Long)

data class QueueRow(val id: String, val state: String, val attempts: Int, val lastError: String?)

data class LinkTestUiState(
    val connection: ConnectionState = ConnectionState.Connecting,
    val me: Probe<MeSummary> = Probe.Idle,
    val appState: Probe<AppStateSummary> = Probe.Idle,
    val eventCounts: Map<String, Int> = emptyMap(),
    val draft: String = "",
    val queue: List<QueueRow> = emptyList(),
    val conversations: Int = 0,
    val messages: Int = 0,
    val log: List<String> = emptyList(),
)

class LinkTestViewModel(
    private val backend: LinkTestBackend,
    // Monotonic clock in ms, injectable for tests.
    private val now: () -> Long = { System.nanoTime() / 1_000_000 },
) : ViewModel() {
    private val _state = MutableStateFlow(LinkTestUiState(connection = backend.connection.value))
    val state: StateFlow<LinkTestUiState> = _state.asStateFlow()

    init {
        collect(backend.connection) { c -> _state.update { it.copy(connection = c) } }
        collect(backend.events) { e -> _state.update { it.copy(eventCounts = it.eventCounts + (e.name to ((it.eventCounts[e.name] ?: 0) + 1))) } }
        collect(backend.queue) { q -> _state.update { it.copy(queue = q.map(::rowOf)) } }
        collect(backend.conversationCount) { n -> _state.update { it.copy(conversations = n) } }
        collect(backend.messageCount) { n -> _state.update { it.copy(messages = n) } }
        collect(backend.log) { l -> _state.update { it.copy(log = l.takeLast(30)) } }
    }

    private fun <T> collect(flow: kotlinx.coroutines.flow.Flow<T>, block: (T) -> Unit) {
        viewModelScope.launch { flow.collect { block(it) } }
    }

    private fun rowOf(o: OutboxEntity) = QueueRow(o.clientId.take(8), o.state, o.attempts, o.lastError)

    fun setDraft(v: String) = _state.update { it.copy(draft = v) }

    fun callMe() {
        if (_state.value.me == Probe.Running) return
        _state.update { it.copy(me = Probe.Running) }
        viewModelScope.launch {
            val t0 = now()
            val result = guard { backend.me() }
            val ms = now() - t0
            val next: Probe<MeSummary> = result.fold(
                { info ->
                    backend.note("/api/me ok ${ms} ms")
                    Probe.Done(MeSummary(info.name, info.versions.version, info.versions.v, info.versions.min, info.pc, ms))
                },
                { e ->
                    backend.note("/api/me error ${e.javaClass.simpleName} ${ms} ms")
                    Probe.Failed(linkErrorText(e))
                },
            )
            _state.update { it.copy(me = next) }
        }
    }

    fun callAppState() {
        if (_state.value.appState == Probe.Running) return
        _state.update { it.copy(appState = Probe.Running) }
        viewModelScope.launch {
            val t0 = now()
            val result = guard { backend.appState() }
            val ms = now() - t0
            val next: Probe<AppStateSummary> = result.fold(
                { el ->
                    backend.note("app.state ok ${ms} ms")
                    val keys = (el as? JsonObject)?.keys?.take(8) ?: if (el is JsonArray) listOf("[${el.size}]") else emptyList()
                    Probe.Done(AppStateSummary(el.toString().length, keys, ms))
                },
                { e ->
                    backend.note("app.state error ${e.javaClass.simpleName} ${ms} ms")
                    Probe.Failed(linkErrorText(e))
                },
            )
            _state.update { it.copy(appState = next) }
        }
    }

    fun enqueueTest() {
        val text = _state.value.draft.trim()
        if (text.isEmpty()) return
        _state.update { it.copy(draft = "") }
        viewModelScope.launch {
            backend.enqueueNewChat(text)
            // Only the fact, never the text.
            backend.note("mensaje de prueba en cola")
        }
    }

    private suspend fun <T> guard(block: suspend () -> Result<T>): Result<T> = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Result.failure(e)
    }
}
